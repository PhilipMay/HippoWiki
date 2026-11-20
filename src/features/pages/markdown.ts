// The one Markdown parser of HippoWiki: markdown-it with the GitHub Flavored Markdown features the wiki supports. The
// title (`derive.ts`), the page view (`components/markdownToReact.tsx`) and, in the browser, the name the save dialog
// suggests (`NewPageForm`) all parse with it, so this module has no server-only imports.

import MarkdownIt, { type StateBlock, type StateCore, type StateInline, type Token } from "markdown-it";
import footnote from "markdown-it-footnote";

import { TITLE_MAX_LENGTH } from "@/features/pages/limits";
import { isSafeAddress } from "@/features/pages/safe-address";
import { parseWikiLinkTarget, type WikiLinkTarget } from "@/features/pages/wiki-link-target";

export type { Token };

/** A list item whose text starts with `[ ] `, `[x] ` or `[X] ` is a task, as in GitHub Flavored Markdown. */
const TASK_MARKER = /^\[([ xX])\][ \t]+/;

/** What the page view needs to know about a list item that is a task. */
export type TaskMeta = { task?: { checked: boolean } };
/** What the page view needs to know about a list that has tasks. */
export type ListMeta = { containsTasks?: boolean };

/**
 * Marks task list items: a list item whose first paragraph starts with a task marker gets `meta.task` and loses the
 * marker from its text, and its list gets `meta.containsTasks`. A rule of its own, because the common plugins for
 * task lists are no longer maintained. It runs once over the tokens, so it stays linear.
 */
function taskLists(state: StateCore): void {
  const tokens = state.tokens;
  const lists: Token[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      lists.push(token);
    } else if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
      lists.pop();
    } else if (
      token.type === "list_item_open" &&
      tokens[index + 1]?.type === "paragraph_open" &&
      tokens[index + 2]?.type === "inline"
    ) {
      const first = tokens[index + 2]?.children?.[0];
      const match = first?.type === "text" ? TASK_MARKER.exec(first.content) : null;
      if (first && match) {
        first.content = first.content.slice(match[0].length);
        token.meta = { ...token.meta, task: { checked: match[1] !== " " } } satisfies TaskMeta;
        const list = lists.at(-1);
        if (list) list.meta = { ...list.meta, containsTasks: true } satisfies ListMeta;
      }
    }
  }
}

/** The footnotes that markdown-it-footnote collects in the environment of a parse. */
type FootnoteEnv = { footnotes?: { list?: { label?: string; count: number }[] } };

/**
 * Moves the footnote definitions to a footnote block at the end, as the rule `footnote_tail` of markdown-it-footnote
 * does, but in one pass: the rule of the plugin copies all tokens once per footnote, so that many footnotes in long
 * content take time that grows with the square of the content. It makes the same tokens: `footnote_block_open`, per
 * footnote `footnote_open`, the tokens of its definition with one `footnote_anchor` per reference before the closing
 * paragraph, `footnote_close`, then `footnote_block_close`. Inline footnotes (`^[text]`) are switched off, so every
 * footnote has a label and a definition.
 */
function footnoteTail(state: StateCore): void {
  const footnotes = (state.env as FootnoteEnv).footnotes;
  if (!footnotes) return;

  const tokens: Token[] = [];
  const definitions = new Map<string, Token[]>();
  let definition: Token[] | null = null;
  for (const token of state.tokens) {
    if (token.type === "footnote_reference_open") {
      definition = [];
      definitions.set((token.meta as { label: string }).label, definition);
    } else if (token.type === "footnote_reference_close") {
      definition = null;
    } else {
      (definition ?? tokens).push(token);
    }
  }
  state.tokens = tokens;

  const list = footnotes.list;
  if (!list) return;
  tokens.push(new state.Token("footnote_block_open", "", 1));
  list.forEach(({ label, count }, id) => {
    const open = new state.Token("footnote_open", "", 1);
    open.meta = { id, label };
    tokens.push(open);
    for (const token of (label !== undefined && definitions.get(label)) || []) tokens.push(token);
    const lastParagraph = tokens.at(-1)?.type === "paragraph_close" ? tokens.pop() : undefined;
    for (let subId = 0; subId < Math.max(count, 1); subId++) {
      const anchor = new state.Token("footnote_anchor", "", 0);
      anchor.meta = { id, subId, label };
      tokens.push(anchor);
    }
    if (lastParagraph) tokens.push(lastParagraph);
    tokens.push(new state.Token("footnote_close", "", -1));
  });
  tokens.push(new state.Token("footnote_block_close", "", -1));
}

/**
 * What a token `wiki_link` holds: a link `[[target]]` or `[[target|label]]` to a page of the folder. Its `content` is
 * its plain text, the label or, without one, the target as written.
 */
export type WikiLinkMeta = {
  /** The target as written, between `[[` and the first `|` or `]]`. */
  target: string;
  /** The page the target names, or `null` for a target that breaks the rule of `wiki-link-target.ts`. */
  page: WikiLinkTarget | null;
  /** The label as written, plain text after the `|`, or `null` without one; an empty label counts as none. */
  label: string | null;
  /** Where the target starts in the content of its inline token. */
  offset: number;
  /**
   * Where the target starts in the source as markdown-it normalises it (line breaks as `\n`), or `null` for a link
   * inside the alt text of an image, which markdown-it parses as a text of its own; such a link is no link.
   */
  position: number | null;
};

/** The positions of the next `]]` and the next line break in the content of an inline parse, found once per run. */
type NextMarks = Map<string, { from: number; at: number }>;
const nextMarks = new WeakMap<StateInline, NextMarks>();

/**
 * The index of the next `mark` at or after `from` in the content of the inline parse, or -1. Remembers what it found,
 * so that a long line of `[[` without `]]` is searched once and not once per `[[`.
 */
function nextMark(state: StateInline, mark: string, from: number): number {
  let marks = nextMarks.get(state);
  if (!marks) {
    marks = new Map();
    nextMarks.set(state, marks);
  }
  const known = marks.get(mark);
  if (known && known.from <= from && (known.at === -1 || from <= known.at)) return known.at;
  const at = state.src.indexOf(mark, from);
  marks.set(mark, { from, at });
  return at;
}

/**
 * The inline rule of wiki links: `[[`, a target up to the first `|` or `]]`, then an optional label up to `]]`, all on
 * one line. It runs before the rule of links, after those of escapes and code spans, so a code span and `\[` keep
 * their text. The label is plain text: nothing in it is parsed. Inside the text of a Markdown link there is no wiki
 * link, as there is no link inside a link. An empty target makes no wiki link.
 */
function wikiLink(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const src = state.src;
  if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;
  if (state.linkLevel > 0) return false;
  const close = nextMark(state, "]]", start + 2);
  if (close === -1) return false;
  const lineEnd = nextMark(state, "\n", start + 2);
  if (lineEnd !== -1 && lineEnd < close) return false;
  let targetEnd = close;
  for (let index = start + 2; index < close; index++) {
    if (src.charCodeAt(index) === 0x7c) {
      targetEnd = index;
      break;
    }
  }
  if (targetEnd === start + 2) return false;
  if (!silent) {
    const target = src.slice(start + 2, targetEnd);
    const label = targetEnd < close && targetEnd + 1 < close ? src.slice(targetEnd + 1, close) : null;
    const token = state.push("wiki_link", "", 0);
    token.markup = "[[";
    token.content = label ?? target;
    token.meta = {
      target,
      page: parseWikiLinkTarget(target),
      label,
      offset: start + 2,
      position: null,
    } satisfies WikiLinkMeta;
  }
  state.pos = close + 2;
  return true;
}

/** Whether the token is a wiki link. */
export function isWikiLink(token: Token): token is Token & { meta: WikiLinkMeta } {
  return token.type === "wiki_link";
}

/**
 * Where the content of a table cell comes from in the source: the start of its trimmed text, and the indexes in it of
 * the `|` characters whose `\` markdown-it dropped, since `\|` in a cell is a `|` of its text.
 */
type CellSource = { start: number; escapes: number[] };

/** The source of the content of a table cell, in the `meta` of its inline token. */
type CellMeta = { cell: CellSource };

/**
 * The sources of the cells of a table row, as the table rule of markdown-it splits the row (`escapedSplit()`): at every
 * `|` that no `\` comes before, dropping the `\` of an escaped one, without an empty first and last cell.
 */
function rowCells(src: string, lineStart: number, lineEnd: number): CellSource[] {
  const line = src.slice(lineStart, lineEnd);
  const text = line.trim();
  const textStart = lineStart + line.length - line.trimStart().length;
  const cells: { start: number; content: string; escapes: number[] }[] = [];
  let content = "";
  let escapes: number[] = [];
  let cellStart = textStart;
  let lastPos = 0;
  let isEscaped = false;
  for (let pos = 0; pos < text.length; pos++) {
    const ch = text.charCodeAt(pos);
    if (ch === 0x7c) {
      if (isEscaped) {
        content += text.substring(lastPos, pos - 1);
        escapes.push(content.length);
        lastPos = pos;
      } else {
        cells.push({ start: cellStart, content: content + text.substring(lastPos, pos), escapes });
        content = "";
        escapes = [];
        lastPos = pos + 1;
        cellStart = textStart + pos + 1;
      }
    }
    isEscaped = ch === 0x5c;
  }
  cells.push({ start: cellStart, content: content + text.substring(lastPos), escapes });
  if (cells[0]?.content === "") cells.shift();
  if (cells.at(-1)?.content === "") cells.pop();
  return cells.map(({ start, content, escapes }) => {
    const leading = content.length - content.trimStart().length;
    // The cell content is trimmed; an escape is never part of the leading whitespace.
    return {
      start: start + leading + escapes.filter((at) => at < leading).length,
      escapes: escapes.map((at) => at - leading),
    };
  });
}

/** The source offset of the character at `offset` of the trimmed text of a cell. */
function cellOffset(cell: CellSource, offset: number): number {
  return cell.start + offset + cell.escapes.filter((at) => at <= offset).length;
}

/** The table rule of markdown-it, which `tableWithSources` wraps. */
const tableRule = (() => {
  const markdownRules = new MarkdownIt().block.ruler.__rules__;
  const rule = markdownRules.find(({ name }) => name === "table");
  if (!rule) throw new Error("markdown-it has no table rule");
  return rule;
})();

/**
 * The table rule of markdown-it, which also tells each cell where its text comes from in the source (`CellMeta`), so
 * that the wiki links of a cell have a position: markdown-it trims the cells and drops the `\` of `\|`, and gives the
 * inline tokens of cells no line map.
 */
function tableWithSources(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const first = state.tokens.length;
  if (!tableRule.fn(state, startLine, endLine, silent)) return false;
  if (silent) return true;
  let cells: CellSource[] = [];
  let cell = 0;
  for (const token of state.tokens.slice(first)) {
    if (token.type === "tr_open" && token.map) {
      const line = token.map[0];
      cells = rowCells(state.src, state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]!);
      cell = 0;
    } else if (token.type === "inline") {
      const source = cells[cell++];
      // A cell that fills up a row has no source and no text.
      if (source) token.meta = { cell: source } satisfies CellMeta;
    }
  }
  return true;
}

/** The index of the end of the text before `end`, without the whitespace that `String.prototype.trim()` removes. */
function trimmedEnd(text: string, start: number, end: number): number {
  let at = end;
  while (at > start && /\s/.test(text.charAt(at - 1))) at--;
  return at;
}

/**
 * The end of the text of an ATX heading in its source line, as markdown-it finds it: without trailing spaces and tabs,
 * a closing sequence of `#` after a space or tab, and then the whitespace before it.
 */
function headingEnd(src: string, lineStart: number, lineEnd: number): number {
  let end = lineEnd;
  while (end > lineStart && (src.charAt(end - 1) === " " || src.charAt(end - 1) === "\t")) end--;
  let hashes = end;
  while (hashes > lineStart && src.charAt(hashes - 1) === "#") hashes--;
  if (hashes < end && hashes > lineStart && (src.charAt(hashes - 1) === " " || src.charAt(hashes - 1) === "\t")) {
    end = hashes;
  }
  return trimmedEnd(src, lineStart, end);
}

/**
 * Gives every wiki link of the blocks its position in the source (`WikiLinkMeta.position`). markdown-it strips the
 * lines of a block of the marks and indents of lists, quotes and footnotes before the inline parse, but never changes
 * what follows them, and trims the end of the block; so the target lies as far before the end of its source line as
 * before the end of its line in the inline content. A heading also loses its closing `#` sequence, and a table cell
 * has the source of `tableWithSources`. A position whose source does not hold `[[` and the target stays `null`.
 */
function wikiLinkPositions(state: StateCore): void {
  const src = state.src;
  let lineStarts: number[] | null = null;
  for (const [index, token] of state.tokens.entries()) {
    if (token.type !== "inline" || !token.children?.some(isWikiLink)) continue;
    const cell = (token.meta as CellMeta | null)?.cell;
    const content = token.content;
    const breaks: number[] = [];
    for (let at = content.indexOf("\n"); at !== -1; at = content.indexOf("\n", at + 1)) breaks.push(at);
    const heading = state.tokens[index - 1];
    const atxHeading = heading?.type === "heading_open" && heading.markup.startsWith("#");
    let line = 0;
    for (const child of token.children) {
      if (!isWikiLink(child)) continue;
      const { offset, target } = child.meta;
      let position: number | null = null;
      if (cell) {
        position = cellOffset(cell, offset);
      } else if (token.map) {
        while (line < breaks.length && breaks[line]! < offset) line++;
        const inlineStart = line === 0 ? 0 : breaks[line - 1]! + 1;
        const inlineEnd = trimmedEnd(content, inlineStart, line < breaks.length ? breaks[line]! : content.length);
        lineStarts ??= startsOfLines(src);
        const sourceLine = token.map[0] + line;
        const sourceStart = lineStarts[sourceLine];
        if (sourceStart !== undefined) {
          const nextStart = lineStarts[sourceLine + 1];
          const sourceEnd = nextStart === undefined ? src.length : nextStart - 1;
          const end = atxHeading ? headingEnd(src, sourceStart, sourceEnd) : trimmedEnd(src, sourceStart, sourceEnd);
          position = end - (inlineEnd - offset);
        }
      }
      const placed = position !== null && src.startsWith(`[[${target}`, position - 2);
      child.meta = { ...child.meta, position: placed ? position : null };
    }
  }
}

/** The indexes at which the lines of the text start. */
function startsOfLines(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

/**
 * The parser. `html: false` keeps raw HTML as text, `linkify` makes links of bare addresses as linkify-it finds them,
 * and `typographer: false` leaves quotes and dashes as typed.
 *
 * `maxNesting` bounds the nesting of tokens: past it markdown-it stops nesting blocks and drops the rest of the
 * deepest block, and inline markup past it stays text. Each list takes two levels (the list and its item) and each
 * quote one, so 100 keeps lists nested up to about 50 deep and quotes up to about 100 deep in the tokens: well past
 * `CONTENT_MAX_DEPTH` of `limits.ts`, so that content one level deeper than the limit still shows that depth, and flat enough for
 * the stack of the parse and of the page view.
 */
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false, maxNesting: 100 })
  .use(footnote)
  .disable("footnote_inline");
markdown.core.ruler.at("footnote_tail", footnoteTail);
// Links of bare addresses starting with `www.`, as in GitHub Flavored Markdown; linkify-it also links a bare domain
// with a known top-level domain, such as `example.com`.
markdown.linkify.set({ fuzzyLink: true });
markdown.validateLink = isSafeAddress;
markdown.core.ruler.push("task_lists", taskLists);
markdown.inline.ruler.before("link", "wiki_link", wikiLink);
markdown.block.ruler.at("table", tableWithSources, { alt: tableRule.alt });
markdown.core.ruler.after("inline", "wiki_link_positions", wikiLinkPositions);

/** Parses Markdown into the tokens of markdown-it: blocks, with the inline tokens as children of `inline` tokens. */
export function parseMarkdown(content: string): Token[] {
  return markdown.parse(content, {});
}

/**
 * The plain text of inline tokens: text, inline code, the alt text of images and the label of a wiki link, or its
 * target as written without a label; line breaks become spaces, and markup, links and footnote references add nothing. Walks with a stack of its own, so that nested images cannot
 * deepen the call stack.
 */
export function plainText(tokens: readonly Token[]): string {
  let text = "";
  const pending: Token[] = [...tokens].reverse();
  for (let token = pending.pop(); token !== undefined; token = pending.pop()) {
    switch (token.type) {
      case "text":
      case "text_special":
      case "code_inline":
      case "wiki_link":
        text += token.content;
        break;
      case "softbreak":
      case "hardbreak":
        text += " ";
        break;
      case "image":
        // A loop instead of `push(...children)`, which fails for more children than a call takes arguments.
        for (const child of [...(token.children ?? [])].reverse()) pending.push(child);
        break;
    }
  }
  return text;
}

/** The index of the first line of the content that is not blank, as markdown-it counts lines, or -1 for none. */
function firstNonBlankLine(content: string): number {
  const lines = content.split(/\r\n?|\n/);
  return lines.findIndex((line) => !/^[ \t]*$/.test(line));
}

/**
 * Returns the page title of Markdown content from its tokens, or `null` if it has none. The content must start, after
 * optional blank lines, with a level-one ATX heading (`# Title`): `#`, a space or tab, then the text; up to three
 * leading spaces and a closing `#` sequence are allowed, as in CommonMark. A setext heading (`Title` underlined with
 * `===`), a `##` heading, and a heading after any other block, such as text, a list, a quote, a code block, HTML, a
 * link reference definition or a footnote definition, do not count: the heading must be the first token and start on
 * the first line that is not blank, because a definition leaves no token in front of it.
 * The heading is reduced to plain text (`plainText`): inline Markdown keeps only its text, images their alt text, and
 * raw HTML stays as typed. Whitespace runs become a single space, and the text is trimmed and cut to
 * `TITLE_MAX_LENGTH`. A heading whose text has no letter or digit, such as `#`, `# **` or `# ...`, gives `null`.
 */
export function titleFromTokens(content: string, tokens: readonly Token[]): string | null {
  const [first, inline] = tokens;
  if (first?.type !== "heading_open" || first.tag !== "h1" || first.markup !== "#") return null;
  if (first.map?.[0] !== firstNonBlankLine(content)) return null;

  const title = truncate(
    plainText(inline?.children ?? [])
      .replace(/\s+/g, " ")
      .trim(),
    TITLE_MAX_LENGTH,
  );
  return TITLE_CHARACTER.test(title) ? title : null;
}

/** A letter or digit in any script; a title needs at least one. */
const TITLE_CHARACTER = /[\p{L}\p{N}]/u;

/** Cuts the text to at most `maxLength` UTF-16 code units without splitting a surrogate pair. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let cut = text.slice(0, maxLength);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

/** What the checks of the content need to know about it, from one parse. */
export type MarkdownAnalysis = {
  /** The title (`titleFromTokens`), or `null` if the content has none. */
  title: string | null;
  /** The deepest nesting of lists and quotes: 0 without any, 1 for a list or quote that is not inside another. */
  depth: number;
  /** The number of table cells of all tables, the cells that rows are filled up with included. */
  cells: number;
  /** The number of wiki links. */
  wikiLinks: number;
};

/**
 * Parses the content once and returns its title, the deepest nesting of lists and quotes, the number of table cells
 * and the number of wiki links. markdown-it fills every row of a table up to the columns of its header, so the cells
 * count what the page view would show.
 */
export function analyseMarkdown(content: string): MarkdownAnalysis {
  const tokens = parseMarkdown(content);
  let depth = 0;
  let open = 0;
  let cells = 0;
  let wikiLinks = 0;
  for (const token of tokens) {
    switch (token.type) {
      case "bullet_list_open":
      case "ordered_list_open":
      case "blockquote_open":
        open++;
        if (open > depth) depth = open;
        break;
      case "bullet_list_close":
      case "ordered_list_close":
      case "blockquote_close":
        open--;
        break;
      case "th_open":
      case "td_open":
        cells++;
        break;
      case "inline":
        for (const child of token.children ?? []) if (isWikiLink(child)) wikiLinks++;
        break;
    }
  }
  return { title: titleFromTokens(content, tokens), depth, cells, wikiLinks };
}
