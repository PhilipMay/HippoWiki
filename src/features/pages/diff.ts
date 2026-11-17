// The difference between two revisions of a page, line by line, as the comparison of revisions shows it. A pure module
// without server-only imports; the diff comes from jsdiff (`diff`).

import { diffLines } from "diff";

/**
 * The most lines that may be added and removed together before two revisions count as too different to compare. jsdiff
 * stops its search there instead of computing a long diff, so that comparing stays fast for two completely different
 * revisions at the length limit of a page (`diff.cost.test.ts` checks it). Far more than the changes of one save.
 */
export const DIFF_MAX_EDIT_LENGTH = 2_000;

/** A line of a comparison: added in the newer revision, removed from the older one, or the same in both. */
export type DiffLine = { kind: "added" | "removed" | "unchanged"; text: string };

/**
 * The comparison of two revisions: `same` when no line was added or removed, `too-different` when more lines changed
 * than `DIFF_MAX_EDIT_LENGTH`, and otherwise the lines of both in one column.
 */
export type RevisionDiff = { kind: "same" } | { kind: "too-different" } | { kind: "lines"; lines: DiffLine[] };

/** The lines of a part of a text; the line break at the end of the part ends its last line and starts no new one. */
function linesOf(value: string): string[] {
  const lines = value.split("\n");
  if (value.endsWith("\n")) lines.pop();
  return lines;
}

/**
 * Compares the content of an older revision with that of a newer one, line by line. A missing line break at the end of
 * the last line counts as no change, so that a line added at the end does not mark the line before it as changed.
 */
export function diffRevisions(older: string, newer: string): RevisionDiff {
  if (older === newer) return { kind: "same" };
  const changes = diffLines(older, newer, { ignoreNewlineAtEof: true, maxEditLength: DIFF_MAX_EDIT_LENGTH });
  if (changes === undefined) return { kind: "too-different" };
  const lines = changes.flatMap((change): DiffLine[] => {
    const kind = change.added ? "added" : change.removed ? "removed" : "unchanged";
    return linesOf(change.value).map((text) => ({ kind, text }));
  });
  return lines.some(({ kind }) => kind !== "unchanged") ? { kind: "lines", lines } : { kind: "same" };
}
