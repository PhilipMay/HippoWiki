// The replacements of `edit_page_content`: exact texts of the content of a page and the texts that replace them,
// applied one after the other. A pure, synchronous module without the database, the services, Next.js or React: it
// builds the new content, or names the first replacement that cannot be applied and why, and the tool stores the
// result with the pages service, which checks the rules of content such as the title heading. The rules are
// "Changing parts of a page" in `spec/mcp.md`.

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

/** One replacement: the exact text to find, the text that replaces it, and whether every place is replaced. */
export type Edit = { oldText: string; newText: string; replaceAll?: boolean | undefined };

/** Why a replacement cannot be applied. */
type EditFailureReason =
  /** The call carries no replacement at all. */
  | { code: "no-edits" }
  /** The text to find is empty. */
  | { code: "empty-old-text" }
  /** The new text is the same as the text to find, once the line breaks are plain. */
  | { code: "no-change" }
  /** The text to find is not in the content as the replacements before it left it. */
  | { code: "not-found" }
  /** The text to find is in the content more than once, and the replacement does not replace every place. */
  | { code: "found-several-times"; count: number }
  /** The content after the replacement would be longer than `CONTENT_MAX_LENGTH`. */
  | { code: "too-long" };

/**
 * The result of the replacements: the new content and the number of places each replacement changed, in the order
 * given, or the first replacement that cannot be applied, by its position in the list (counted from 1) and the start
 * of its text to find. The position of `no-edits` is 0, because there is no replacement to name.
 */
export type EditsResult =
  | { ok: true; content: string; counts: number[] }
  | { ok: false; position: number; oldText: string; reason: EditFailureReason };

/** Makes the line breaks plain, CRLF and CR to LF, as `contentSchema` in `src/features/pages/schema.ts` does. */
function plainLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * The number of places where the text starts in the content, also places that overlap, such as `aa` twice in `aaa`.
 * It stops at 2, because a replacement of one place only needs to know whether there is more than one; the count of
 * a failure is then counted in full.
 */
function countStarts(content: string, text: string, stopAt = Infinity): number {
  let count = 0;
  for (let index = content.indexOf(text); index !== -1 && count < stopAt; index = content.indexOf(text, index + 1)) {
    count++;
  }
  return count;
}

/** The number of places that `String.prototype.replaceAll` changes: from the start, each place after the one before. */
function countPlaces(content: string, text: string): number {
  let count = 0;
  for (let index = content.indexOf(text); index !== -1; index = content.indexOf(text, index + text.length)) count++;
  return count;
}

/**
 * Applies the replacements to the content, one after the other, each to the content as the ones before it left it
 *, or returns the first one that cannot be applied, so that a call is all or nothing. Matching is exact:
 * case, spaces and indentation count, and nothing looser is tried, so that the agent reads the real text again.
 * There is no limit on the number of replacements: the length limit of the content bounds the result.
 */
export function applyEdits(content: string, edits: readonly Edit[]): EditsResult {
  // A call without replacements is a mistake of the agent, like the two checks below.
  if (edits.length === 0) return { ok: false, position: 0, oldText: "", reason: { code: "no-edits" } };

  const plain = edits.map((edit) => ({
    oldText: plainLineBreaks(edit.oldText),
    newText: plainLineBreaks(edit.newText),
    replaceAll: edit.replaceAll === true,
  }));

  // Checked before anything is applied, so that such a call is refused even when its other replacements match.
  for (const [index, edit] of plain.entries()) {
    const failed = (reason: EditFailureReason): EditsResult => ({
      ok: false,
      position: index + 1,
      oldText: edit.oldText,
      reason,
    });
    // An empty text is found everywhere and names no place.
    if (edit.oldText === "") return failed({ code: "empty-old-text" });
    // A replacement that changes nothing is a mistake of the agent, which meant to change something.
    if (edit.newText === edit.oldText) return failed({ code: "no-change" });
  }

  let current = content;
  const counts: number[] = [];
  for (const [index, { oldText, newText, replaceAll }] of plain.entries()) {
    const failed = (reason: EditFailureReason): EditsResult => ({ ok: false, position: index + 1, oldText, reason });
    const first = current.indexOf(oldText);
    // The agent's text is not, or no longer, in the content: it has to read the page again.
    if (first === -1) return failed({ code: "not-found" });

    // Every place is counted before the new content is built, so that a call never builds a content far beyond the
    // limit in memory; the other rules of content are checked by the service.
    const places = replaceAll ? countPlaces(current, oldText) : 1;
    if (!replaceAll && countStarts(current, oldText, 2) > 1) {
      // A text of several places, also overlapping ones, names no single place: the agent adds surrounding text or
      // asks for every place, so that it never changes a place it did not mean.
      return failed({ code: "found-several-times", count: countStarts(current, oldText) });
    }
    // The length after this replacement; a later replacement that would shorten the content again does not help.
    if (current.length + places * (newText.length - oldText.length) > CONTENT_MAX_LENGTH) {
      return failed({ code: "too-long" });
    }

    // `split()` and `join()`, and the slices, insert the new text as it is: a `$` in it is no replacement pattern, as
    // it would be in the replacement string of `replace()` or `replaceAll()`.
    current = replaceAll
      ? current.split(oldText).join(newText)
      : current.slice(0, first) + newText + current.slice(first + oldText.length);
    counts.push(places);
  }
  return { ok: true, content: current, counts };
}
