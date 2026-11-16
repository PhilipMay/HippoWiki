// The one Markdown parser of HippoWiki: markdown-it with the GitHub Flavored Markdown features the wiki supports. The
// title (`derive.ts`), the page view (`components/markdownToReact.tsx`) and, in the browser, the name the save dialog
// suggests (`NewPageForm`) all parse with it, so this module has no server-only imports.

import MarkdownIt, { type StateCore, type Token } from "markdown-it";
import footnote from "markdown-it-footnote";

import { TITLE_MAX_LENGTH } from "@/features/pages/limits";

export type { Token };

/**
 * The protocols a link or image may use, as react-markdown allowed them before; any other address with a protocol,
 * `javascript:`, `vbscript:` and `data:` included, is not parsed as a link or image and stays its Markdown text.
 */
const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(["http", "https", "mailto", "irc", "ircs", "xmpp"]);

/**
 * Returns whether an address may become a link or an image: a relative address, or one with a protocol of
 * `SAFE_PROTOCOLS` in any spelling. A colon counts as the end of a protocol only before the first `/`, `?` or `#`,
 * as browsers read it. markdown-it passes the address after decoding entities and escapes and percent-encoding what
 * is not allowed in a URL, so `&#106;avascript:` arrives as `javascript:`, and a space or control character inside a
 * protocol makes it no protocol of the list.
 */
export function isSafeAddress(address: string): boolean {
  const colon = address.indexOf(":");
  if (colon === -1) return true;
  const pathStart = address.search(/[/?#]/);
  if (pathStart !== -1 && pathStart < colon) return true;
  return SAFE_PROTOCOLS.has(address.slice(0, colon).toLowerCase());
}

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
 * The parser. `html: false` keeps raw HTML as text, `linkify` makes links of bare addresses as linkify-it finds them,
 * and `typographer: false` leaves quotes and dashes as typed.
 *
 * `maxNesting` bounds the nesting of tokens: past it markdown-it stops nesting blocks and drops the rest of the
 * deepest block, and inline markup past it stays text. Each list takes two levels (the list and its item) and each
 * quote one, so 100 keeps lists and quotes nested well past the depth limit of the content visible in the tokens,
 * and the parse and the page view stay flat enough for the stack.
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

/** Parses Markdown into the tokens of markdown-it: blocks, with the inline tokens as children of `inline` tokens. */
export function parseMarkdown(content: string): Token[] {
  return markdown.parse(content, {});
}

/**
 * The plain text of inline tokens: text, inline code and the alt text of images; line breaks become spaces, and
 * markup, links and footnote references add nothing. Walks with a stack of its own, so that nested images cannot
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
