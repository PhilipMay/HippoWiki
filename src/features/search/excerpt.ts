// The piece of text of a search result as parts of plain text, each marked as a match or not. Pure, without
// server-only imports, so that a component can use it. The database cuts the piece from the search text of the page and
// marks each match with two control characters, which no search text holds (see `src/features/search/text.ts`).
//
// The database would drop what its parser reads as an HTML tag from the piece, so it is given the search text with a
// third control character in place of every `<`, which the parts get back.

/** The character before a match in the piece of text that the database cut. */
export const MATCH_START = "\u0002";
/** The character after a match in the piece of text that the database cut. */
export const MATCH_END = "\u0003";

/** The character that stands in for `<` in the text that the database cuts the piece from. */
export const LESS_THAN_STAND_IN = "\u0001";

/** A part of the piece of text of a result: plain text, never HTML, and whether it is a match. */
export type ExcerptPart = { text: string; match: boolean };

/**
 * The parts of the marked piece of text, in their order, without empty parts and without the marker characters, with
 * `<` back in place of its stand-in. A marker without its partner is dropped, and the text after a start without an
 * end is no match.
 */
export function excerptParts(marked: string): ExcerptPart[] {
  const parts: ExcerptPart[] = [];
  const push = (text: string, match: boolean) => {
    const clean = text.replaceAll(MATCH_START, "").replaceAll(MATCH_END, "").replaceAll(LESS_THAN_STAND_IN, "<");
    if (clean === "") return;
    const last = parts.at(-1);
    if (last?.match === match) last.text += clean;
    else parts.push({ text: clean, match });
  };
  let rest = marked;
  for (;;) {
    const start = rest.indexOf(MATCH_START);
    if (start === -1) break;
    const end = rest.indexOf(MATCH_END, start + 1);
    if (end === -1) break;
    push(rest.slice(0, start), false);
    push(rest.slice(start + 1, end), true);
    rest = rest.slice(end + 1);
  }
  push(rest, false);
  return parts;
}
