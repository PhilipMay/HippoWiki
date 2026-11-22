import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "@/features/pages/editor/extensions";
import { imageEmbeds, imageEmbedsField } from "@/features/pages/editor/file-embeds";
import type { EditorPageList } from "@/features/pages/editor/wiki-links";

/** A folder with the image `guides/diagram.png`, the PDF `report.pdf` and the page `setup`. */
const PAGE_LIST: EditorPageList = {
  pages: [{ tab: null, name: "setup", title: "Setup", address: "/folders/f/setup.md" }],
  files: [
    { tab: "guides", name: "diagram.png", address: "/files/f/guides/diagram.png", image: { width: 640, height: 480 } },
    { tab: null, name: "report.pdf", address: "/files/f/report.pdf", image: null },
  ],
  places: [
    { tab: null, newPageAddress: "/folders/f?action=new&name=", uploadAddress: "/folders/f?action=upload&name=" },
    {
      tab: "guides",
      newPageAddress: "/folders/f/guides?action=new&name=",
      uploadAddress: "/folders/f/guides?action=upload&name=",
    },
  ],
};

/** The state of the editor with `doc`, parsed to its end. */
function stateOf(doc: string, pageList: EditorPageList = PAGE_LIST): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(0),
    extensions: [editorExtensions({ newPage: false, labelId: "l", descriptionId: "d", pageList }), imageEmbedsField],
  });
  ensureSyntaxTree(state, doc.length);
  return state;
}

/** The images under the lines of `doc`: the number of the line, the address, the alt text, the width and height. */
function images(state: EditorState): string[] {
  const shown: string[] = [];
  imageEmbeds(state).between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as {
      block?: boolean;
      widget: { address: string; alt: string; width: number | null; height: number | null };
    };
    expect(spec.block).toBe(true);
    expect(from).toBe(state.doc.lineAt(from).to);
    const { address, alt, width, height } = spec.widget;
    shown.push(`${state.doc.lineAt(from).number}: ${address} "${alt}" ${width}×${height}`);
  });
  return shown;
}

describe("the images of live preview", () => {
  it("show the image of an embed under its line, with the label or the name as alt text and its size", () => {
    const state = stateOf("# Setup\n\nSee ![[guides/diagram.png]] here\n\n![[guides/diagram.png|The network]]");
    expect(images(state)).toEqual([
      '3: /files/f/guides/diagram.png "diagram.png" 640×480',
      '5: /files/f/guides/diagram.png "The network" 640×480',
    ]);
  });

  it("show nothing for a PDF, a link of an image, a missing file, a page, code and a Markdown link", () => {
    const doc = [
      "![[report.pdf]] [[guides/diagram.png]] ![[guides/missing.png]] ![[setup]]",
      "`![[guides/diagram.png]]` \\![[guides/diagram.png]]",
      "[a ![[guides/diagram.png]]](https://x.org)",
      "```",
      "![[guides/diagram.png]]",
      "```",
    ].join("\n");
    expect(images(stateOf(doc))).toEqual([]);
  });

  it("follow the document as it changes", () => {
    let state = stateOf("text");
    expect(state.field(imageEmbedsField).size).toBe(0);
    state = state.update({ changes: { from: 0, insert: "![[guides/diagram.png]]\n" } }).state;
    expect(state.field(imageEmbedsField).size).toBe(1);
  });

  it("show nothing without files in the page list", () => {
    expect(images(stateOf("![[guides/diagram.png]]", { ...PAGE_LIST, files: [] }))).toEqual([]);
  });
});
