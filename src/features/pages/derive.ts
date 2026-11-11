// Pure helpers that derive the title and suggest a slug for a page. Used by Client Components, so no server-only
// imports.

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString as mdastToString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

import { SLUG_MAX_LENGTH, TITLE_MAX_LENGTH } from "@/features/pages/limits";

/**
 * Returns the page title of the Markdown content, or `null` if it has none. The content must start, after optional
 * blank lines, with a level-one ATX heading (`# Title`); a setext heading or any other block first does not count.
 * The content is parsed as GitHub Flavored Markdown, like the page view renders it, and the heading is reduced to
 * plain text: inline Markdown keeps only its text, images their alt text, and raw HTML stays as typed. Whitespace runs
 * become a single space, and the text is trimmed and cut to `TITLE_MAX_LENGTH`. A heading whose text has no letter
 * or digit, such as `#` or `# **`, gives `null`.
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

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+(.*))?$/;
const CLOSING_SEQUENCE = /(?:^|[ \t]+)#+[ \t]*$/;

/**
 * Returns the text of the first ATX heading (`#` to `######`) in the Markdown, skipping fenced code blocks, or `""`
 * if there is none. An optional closing `#` sequence is removed and the text is cut to `TITLE_MAX_LENGTH`.
 */
export function deriveTitle(markdown: string): string {
  let fence: { char: string; length: number } | null = null;

  for (const line of markdown.split(/\r\n|\r|\n/)) {
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    // The info string of a backtick fence must not contain backticks; otherwise the line is not a fence.
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = { char: open[1][0], length: open[1].length };
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading) return truncate((heading[1] ?? "").replace(CLOSING_SEQUENCE, "").trim(), TITLE_MAX_LENGTH);
  }

  return "";
}

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
 * Turns a title into a slug: German umlauts and ß are spelled out, other accents dropped, everything else than
 * `a-z0-9` becomes a single `-`. A slug longer than `SLUG_MAX_LENGTH` is cut at a word boundary. Returns `""` if
 * nothing usable is left, e.g. for a title in a non-Latin script.
 */
export function deriveSlug(title: string): string {
  let slug = trimHyphens(
    title
      .replace(/[äöüÄÖÜß]/g, (letter) => GERMAN_LETTERS[letter])
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
  );

  if (slug.length > SLUG_MAX_LENGTH) {
    // Include one character past the limit: a hyphen there means the first SLUG_MAX_LENGTH characters are whole words.
    const head = slug.slice(0, SLUG_MAX_LENGTH + 1);
    const boundary = head.lastIndexOf("-");
    slug = trimHyphens(boundary > 0 ? head.slice(0, boundary) : slug.slice(0, SLUG_MAX_LENGTH));
  }

  return slug;
}
