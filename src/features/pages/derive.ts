// Pure helpers that derive the title and suggest a name for a page. Used by Client Components, so no server-only
// imports.

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString as mdastToString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

import { TITLE_MAX_LENGTH } from "@/features/pages/limits";
import { NAME_MAX_LENGTH } from "@/lib/names";

/**
 * Returns the page title of the Markdown content, or `null` if it has none. The content must start, after optional
 * blank lines, with a level-one ATX heading (`# Title`): `#`, a space or tab, then the text; up to three leading
 * spaces and a closing `#` sequence are allowed, as in CommonMark. A setext heading (`Title` underlined with `===`), a
 * `##` heading, and a heading after any other block, such as text, a list, a quote, a code block, HTML or a link
 * reference definition, do not count.
 * The content is parsed as GitHub Flavored Markdown, like the page view renders it, and the heading is reduced to
 * plain text: inline Markdown keeps only its text, images their alt text, and raw HTML stays as typed. Whitespace runs
 * become a single space, and the text is trimmed and cut to `TITLE_MAX_LENGTH`. A heading whose text has no letter
 * or digit, such as `#`, `# **` or `# ...`, gives `null`. There is no fallback title: content without a title is
 * refused by the schemas.
 */
export function titleFromContent(content: string): string | null {
  const tree = fromMarkdown(content, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const first = tree.children[0];
  if (first?.type !== "heading" || first.depth !== 1) return null;

  // An ATX heading's source starts with `#` (its position starts after up to three leading spaces); a setext
  // heading's source starts with its text.
  const start = first.position?.start.offset;
  if (start === undefined || content[start] !== "#") return null;

  const title = truncate(mdastToString(first).replace(/\s+/g, " ").trim(), TITLE_MAX_LENGTH);
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

const GERMAN_LETTERS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

function trimHyphens(text: string): string {
  return text.replace(/^-+|-+$/g, "");
}

/**
 * Turns a title into a page name: German umlauts and ß are spelled out, other accents dropped, everything else than
 * `a-z0-9` becomes a single `-`. A name longer than `NAME_MAX_LENGTH` is cut at a word boundary. Returns `""` if
 * nothing usable is left, e.g. for a title in a non-Latin script.
 */
export function deriveName(title: string): string {
  let name = trimHyphens(
    title
      .replace(/[äöüÄÖÜß]/g, (letter) => GERMAN_LETTERS[letter] ?? letter)
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
  );

  if (name.length > NAME_MAX_LENGTH) {
    // Include one character past the limit: a hyphen there means the first NAME_MAX_LENGTH characters are whole words.
    const head = name.slice(0, NAME_MAX_LENGTH + 1);
    const boundary = head.lastIndexOf("-");
    name = trimHyphens(boundary > 0 ? head.slice(0, boundary) : name.slice(0, NAME_MAX_LENGTH));
  }

  return name;
}
