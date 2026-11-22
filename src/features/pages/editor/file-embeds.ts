// The images of live preview: the embed `![[name.ext]]` of an image of the folder shows the image under its line, as
// the page view shows it in its place. A block widget, which only a state field may provide, so it is a field of its
// own next to the view plugin of live preview. Its DOM is built with `document.createElement` only, never from HTML.

import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

import { editorPageList, insideLink, readWikiLink, showWikiLink } from "@/features/pages/editor/wiki-links";

/** The class of the block of an image under its line, which the theme of `preview-plugin.ts` styles. */
export const IMAGE_CLASS = "cm-lp-image";

/**
 * An image of the folder under the line of its embed: at its own size but at most as wide as the editor, with its
 * width and height given, so that its place is kept before it loads; once loaded, the editor measures its lines
 * again.
 */
class ImageWidget extends WidgetType {
  constructor(
    readonly address: string,
    readonly alt: string,
    readonly width: number | null,
    readonly height: number | null,
  ) {
    super();
  }

  override eq(other: ImageWidget) {
    return (
      other.address === this.address &&
      other.alt === this.alt &&
      other.width === this.width &&
      other.height === this.height
    );
  }

  toDOM(view: EditorView) {
    const block = document.createElement("div");
    block.className = IMAGE_CLASS;
    const image = document.createElement("img");
    image.src = this.address;
    image.alt = this.alt;
    if (this.width !== null) image.width = this.width;
    if (this.height !== null) image.height = this.height;
    image.addEventListener("load", () => view.requestMeasure());
    block.append(image);
    return block;
  }
}

/** The nodes in which `![[` is no embed of live preview: code, and tables, which `tables.ts` renders. */
const NOT_SHOWN = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "HTMLBlock", "Comment", "Table"]);

/**
 * The images of the embeds of the document, each as a block under its line, in the order of the document. The text is
 * searched for `![[` first, so that a page without embeds costs one search of its text; each one is then read from the
 * syntax tree, as far as the editor has parsed it.
 */
export function imageEmbeds(state: EditorState): DecorationSet {
  const index = state.facet(editorPageList);
  if (!index || index.list.files.length === 0) return Decoration.none;
  const text = state.doc.toString();
  const tree = syntaxTree(state);
  const decorations: Range<Decoration>[] = [];
  for (let at = text.indexOf("![["); at !== -1; at = text.indexOf("![[", at + 3)) {
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(at, 1);
    while (node && node.name !== "WikiLink") node = node.parent;
    if (!node || node.from !== at || insideLink(node)) continue;
    let shown = true;
    for (let parent = node.parent; parent; parent = parent.parent) if (NOT_SHOWN.has(parent.name)) shown = false;
    if (!shown) continue;
    const link = readWikiLink(state, node, false);
    const image = link && showWikiLink(index, link).image;
    if (!image) continue;
    const widget = new ImageWidget(image.address, image.alt, image.width, image.height);
    decorations.push(Decoration.widget({ widget, block: true, side: 1 }).range(state.doc.lineAt(at).to));
  }
  return Decoration.set(decorations, true);
}

/** The images of live preview, built again when the document changes or the background parse goes further. */
export const imageEmbedsField = StateField.define<DecorationSet>({
  create: imageEmbeds,
  update(decorations, tr) {
    if (!tr.docChanged && syntaxTree(tr.state) === syntaxTree(tr.startState)) return decorations;
    return imageEmbeds(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});
