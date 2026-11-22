// Wiki links in the Markdown editor: the extension of the editor's parser that reads `[[target]]`,
// `[[target|label]]` and the embeds `![[target]]` of files, the page list of the folder that the editor gets when it
// opens, with its pages and files, and what a wiki link shows and leads to against that list. The target follows the rule of `wiki-link-target.ts`, which the page view uses as well.
// The addresses come with the page list from the server, so that this module needs no module of addresses.

import { syntaxTree } from "@codemirror/language";
import { Facet, type EditorState } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

import {
  MISSING_WIKI_LINK_HINTS,
  parseWikiLinkTarget,
  wikiLinkTargetText,
  type WikiLinkTarget,
} from "@/features/pages/wiki-link-target";

/** A page of the folder as the editor knows it. */
type EditorPage = {
  /** The tab of the page, or `null` for a page placed directly in the folder. */
  tab: string | null;
  name: string;
  title: string;
  /** The address of the page. */
  address: string;
};

/** A file of the folder as the editor knows it. */
type EditorFile = {
  /** The tab of the file, or `null` for a file placed directly in the folder. */
  tab: string | null;
  /** The name with its extension. */
  name: string;
  /** The address of the file itself. */
  address: string;
  /** The width and height of an image, which an embed shows; `null` for a PDF, which an embed links. */
  image: { width: number | null; height: number | null } | null;
};

/** A place of the folder, as the editor knows it. */
type EditorPlace = {
  /** The tab, or `null` for the folder itself. */
  tab: string | null;
  /** The address of the editor of a new page there, to which the name of the new page is appended. */
  newPageAddress: string;
  /**
   * The address of the "Upload file" dialog there, to which the name of the file is appended, or `null` while the
   * files are off or for a role that may not upload.
   */
  uploadAddress: string | null;
};

/**
 * The pages and files of the folder that are not deleted and the places that exist, as they were when the editor was
 * opened: what live preview resolves wiki links against and what the picker on `[[` offers.
 */
export type EditorPageList = {
  pages: EditorPage[];
  files: EditorFile[];
  /** The folder itself (`tab` `null`) and each of its tabs. */
  places: EditorPlace[];
};

/** The page list as the editor looks it up: the pages and the files by their target, and the places by their tab. */
export type PageIndex = {
  list: EditorPageList;
  pages: ReadonlyMap<string, EditorPage>;
  files: ReadonlyMap<string, EditorFile>;
  places: ReadonlyMap<string | null, EditorPlace>;
};

/** The page list of the editor, or `null` for an editor without one, whose wiki links open nothing. */
export const editorPageList = Facet.define<EditorPageList, PageIndex | null>({
  combine: (values) => {
    const list = values[0];
    if (!list) return null;
    const pages = new Map(list.pages.map((page) => [wikiLinkTargetText(page), page]));
    const files = new Map(list.files.map((file) => [wikiLinkTargetText(file), file]));
    const places = new Map(list.places.map((place) => [place.tab, place]));
    return { list, pages, files, places };
  },
});

const OPEN_BRACKET = 0x5b;
const EXCLAMATION_MARK = 0x21;
const PIPE = 0x7c;

/** The last `]]` and line break found in the text of an inline section, so that a long run of `[[` is searched once. */
const found = new WeakMap<InlineContext, Map<string, { from: number; at: number }>>();

/** The index in the text of the section of the next `mark` at or after `from`, or -1. */
function nextMark(cx: InlineContext, mark: string, from: number): number {
  let marks = found.get(cx);
  if (!marks) {
    marks = new Map();
    found.set(cx, marks);
  }
  const known = marks.get(mark);
  if (known && known.from <= from && (known.at === -1 || from <= known.at)) return known.at;
  const at = cx.text.indexOf(mark, from);
  marks.set(mark, { from, at });
  return at;
}

/**
 * The inline parser of wiki links, as the rule of the page view reads them: `[[`, a target up to the first `|` or `]]`
 * that is not empty, then an optional label up to `]]`, all on one line. It runs before the parser of links, after
 * those of escapes and code spans, so a code span and `\[` keep their text. Nothing inside a wiki link is parsed. `!`
 * before a target that names a file makes an embed, whose first mark is `![[`; before any other target it stays text,
 * as no image follows, unless an image may follow: `![[a]](b)` is left to the parser of images.
 */
function parseWikiLink(cx: InlineContext, next: number, pos: number): number {
  let start = pos;
  if (next === EXCLAMATION_MARK) start = pos + 1;
  else if (next !== OPEN_BRACKET) return -1;
  if (cx.char(start) !== OPEN_BRACKET || cx.char(start + 1) !== OPEN_BRACKET) return -1;
  const textStart = start + 2 - cx.offset;
  const close = nextMark(cx, "]]", textStart);
  if (close === -1) return -1;
  const lineEnd = nextMark(cx, "\n", textStart);
  if (lineEnd !== -1 && lineEnd < close) return -1;
  let bar = -1;
  for (let index = textStart; index < close; index++) {
    if (cx.text.charCodeAt(index) === PIPE) {
      bar = index;
      break;
    }
  }
  if ((bar === -1 ? close : bar) === textStart) return -1;
  const end = close + 2 + cx.offset;
  const embed =
    next === EXCLAMATION_MARK &&
    parseWikiLinkTarget(cx.text.slice(textStart, bar === -1 ? close : bar))?.kind === "file";
  if (next === EXCLAMATION_MARK && !embed) {
    const after = cx.char(end);
    if (after === 0x28 || after === OPEN_BRACKET) return -1;
  }
  if (embed) {
    const marks = [cx.elt("WikiLinkMark", pos, start + 2)];
    if (bar !== -1) marks.push(cx.elt("WikiLinkMark", bar + cx.offset, bar + cx.offset + 1));
    marks.push(cx.elt("WikiLinkMark", close + cx.offset, end));
    return cx.addElement(cx.elt("WikiLink", pos, end, marks));
  }
  const marks = [cx.elt("WikiLinkMark", start, start + 2)];
  if (bar !== -1) marks.push(cx.elt("WikiLinkMark", bar + cx.offset, bar + cx.offset + 1));
  marks.push(cx.elt("WikiLinkMark", close + cx.offset, end));
  return cx.addElement(cx.elt("WikiLink", start, end, marks));
}

/** The extension of the editor's parser for wiki links, with their style in source mode. */
export const wikiLinkSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: tags.link },
    { name: "WikiLinkMark", style: tags.processingInstruction },
  ],
  parseInline: [{ name: "WikiLink", parse: parseWikiLink, before: "Link" }],
};

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/** A wiki link of the document, with the positions of its target and its label. */
export type EditorWikiLink = {
  from: number;
  to: number;
  /** The target as written. */
  target: string;
  targetFrom: number;
  targetTo: number;
  /** The page or file the target names, or `null` for a target that breaks the name rule. */
  page: WikiLinkTarget | null;
  /** Whether it is an embed of a file, `![[…]]`. */
  embed: boolean;
  /** The label as written, or `null` without one; an empty label counts as none. */
  label: string | null;
  labelFrom: number;
  labelTo: number;
};

/**
 * Reads the wiki link of a node `WikiLink`. Inside a cell of a table, `\|` stands for `|`, as the page view reads the
 * cell, so `[[setup\|Setup]]` there has the target `setup` and the label "Setup". `null` where the link has no target,
 * which in a table is `[[\|label]]`.
 */
export function readWikiLink(state: EditorState, node: SyntaxNode, inTable: boolean): EditorWikiLink | null {
  const marks = node.getChildren("WikiLinkMark");
  const open = marks[0];
  const close = marks[marks.length - 1];
  if (!open || !close || open === close) return null;
  const bar = marks.length > 2 ? marks[1] : undefined;
  const targetFrom = open.to;
  let targetTo = bar?.from ?? close.from;
  if (inTable && bar && state.sliceDoc(targetTo - 1, targetTo) === "\\") targetTo -= 1;
  if (targetTo <= targetFrom) return null;
  const target = state.sliceDoc(targetFrom, targetTo);
  const labelFrom = bar?.to ?? close.from;
  const written = state.sliceDoc(labelFrom, close.from);
  const label = written === "" ? null : inTable ? written.replaceAll("\\|", "|") : written;
  return {
    from: node.from,
    to: node.to,
    target,
    targetFrom,
    targetTo,
    page: parseWikiLinkTarget(target),
    embed: state.sliceDoc(node.from, node.from + 1) === "!",
    label,
    labelFrom,
    labelTo: close.from,
  };
}

/** What a wiki link shows and where it leads, as the page view shows it for a user who may create pages. */
export type ShownWikiLink = {
  /**
   * The label, or without one the title of the page or the name of the file, or the target as written for a page or
   * file that does not exist.
   */
  text: string;
  /** Whether the link leads to a page or a file; otherwise it is marked as missing. */
  exists: boolean;
  /** Why a missing link leads to no page or file, or `null` for a link that leads to one. */
  hint: string | null;
  /**
   * The address of the page or of the file, or for one that is missing in a place that exists the editor of a new page
   * or the "Upload file" dialog with its name and place; `null` for a target that breaks the name rule, a tab that does
   * not exist, a file while uploads are not offered, or an editor without a page list.
   */
  address: string | null;
  /** For an embed of an image that exists: the image to show, with its alt text; `null` otherwise. */
  image: { address: string; alt: string; width: number | null; height: number | null } | null;
};

/** Resolves a wiki link against the page list of the editor. */
export function showWikiLink(index: PageIndex | null, link: EditorWikiLink): ShownWikiLink {
  const fallback = link.label ?? link.target;
  const missing = (hint: string, address: string | null = null): ShownWikiLink => ({
    text: fallback,
    exists: false,
    hint,
    address,
    image: null,
  });
  if (link.page === null) return missing(MISSING_WIKI_LINK_HINTS.invalid);
  const target = wikiLinkTargetText(link.page);
  if (link.page.kind === "file") {
    const file = index?.files.get(target);
    if (file) {
      const text = link.label ?? file.name;
      const image = link.embed && file.image ? { address: file.address, alt: text, ...file.image } : null;
      return { text, exists: true, hint: null, address: file.address, image };
    }
  } else {
    const page = index?.pages.get(target);
    if (page) return { text: link.label ?? page.title, exists: true, hint: null, address: page.address, image: null };
  }
  const place = index?.places.get(link.page.tab);
  if (place === undefined) {
    if (link.page.tab !== null) return missing(MISSING_WIKI_LINK_HINTS.noTab);
    return missing(link.page.kind === "file" ? MISSING_WIKI_LINK_HINTS.missingFile : MISSING_WIKI_LINK_HINTS.missing);
  }
  if (link.page.kind === "file") {
    const address = place.uploadAddress === null ? null : `${place.uploadAddress}${link.page.name}`;
    return missing(MISSING_WIKI_LINK_HINTS.missingFile, address);
  }
  return missing(MISSING_WIKI_LINK_HINTS.missing, `${place.newPageAddress}${link.page.name}`);
}

/** Whether a node lies inside a node of one of the names. */
function inside(node: SyntaxNode, names: readonly string[]): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) if (names.includes(parent.name)) return true;
  return false;
}

/**
 * Whether a node lies in the text of a Markdown link or an image, where `[[…]]` is text as in the page view, which
 * makes no link inside a link.
 */
export function insideLink(node: SyntaxNode): boolean {
  return inside(node, ["Link", "Image"]);
}

/**
 * The wiki link at `pos`, or `null`; one in the text of a Markdown link is none. The position before the link counts,
 * which a click on its hidden `[[` gives.
 */
export function wikiLinkAt(state: EditorState, pos: number): EditorWikiLink | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name !== "WikiLink") continue;
    if (insideLink(node)) return null;
    return readWikiLink(state, node, inside(node, ["TableCell"]));
  }
  return null;
}
