import { describe, expect, it } from "vitest";

import { diffRevisions } from "@/features/pages/diff";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

// Wall-clock budgets: this file runs in the Vitest project `cost`, never under coverage and never next to other test
// files. Two completely different revisions at the length limit must be answered quickly, with a diff or with "too
// different", so that a comparison never ties up the server.

/** The budget of one comparison. */
const BUDGET_MS = 2_000;

/** Content at the length limit made of the given line, repeated, or of numbered lines with the given prefix. */
function repeated(line: string): string {
  return line.repeat(Math.floor(CONTENT_MAX_LENGTH / line.length));
}

function numbered(prefix: string): string {
  let content = "";
  for (let index = 0; content.length < CONTENT_MAX_LENGTH - 20; index++) content += `${prefix}${index}\n`;
  return content;
}

const INPUTS: Record<string, [string, string]> = {
  "many short lines": [repeated("a\n"), repeated("b\n")],
  "many short numbered lines": [numbered("a"), numbered("b")],
  "lines that agree in every other line": [repeated("a\nc\n"), repeated("a\na\nb\n")],
  "few long lines": [repeated(`${"x".repeat(999)}\n`), repeated(`${"y".repeat(999)}\n`)],
  "one line": ["a".repeat(CONTENT_MAX_LENGTH), "b".repeat(CONTENT_MAX_LENGTH)],
};

describe("comparing two completely different revisions at the length limit", () => {
  it.each(Object.entries(INPUTS))("answers within the budget for %s", (_name, [older, newer]) => {
    expect(older.length).toBeLessThanOrEqual(CONTENT_MAX_LENGTH);
    expect(newer.length).toBeLessThanOrEqual(CONTENT_MAX_LENGTH);

    const start = performance.now();
    const diff = diffRevisions(older, newer);
    const elapsed = performance.now() - start;

    expect(["lines", "too-different"]).toContain(diff.kind);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
