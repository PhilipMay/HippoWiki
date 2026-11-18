// Pure helpers that derive the title and suggest a name for a page. Used by Client Components, so no server-only
// imports.

import { parseMarkdown, titleFromTokens } from "@/features/pages/markdown";
import { NAME_MAX_LENGTH } from "@/lib/name-limits";

/**
 * Returns the page title of the Markdown content, or `null` if it has none: the text of a leading level-one ATX
 * heading (`# Title`), parsed as the page view parses it. The exact rule is `titleFromTokens()` in `markdown.ts`.
 * There is no fallback title: content without a title is refused by the schemas.
 */
export function titleFromContent(content: string): string | null {
  return titleFromTokens(content, parseMarkdown(content));
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
