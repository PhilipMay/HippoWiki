// The name that a title or the name of an uploaded file suggests, by the name rule: a pure module that imports only the
// limits of a name, so that the dialogs of new pages and of uploads can use it without loading the Markdown parser or
// Zod into the browser (see "UI" in `architecture.md`).

import { NAME_MAX_LENGTH } from "@/lib/name-limits";

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
 * Turns a title, or the name of an uploaded file without its extension, into a name: German umlauts and ß are spelled out, other accents dropped, everything else than
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
