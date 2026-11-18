import { describe, expect, it } from "vitest";

import { applyEdits, type Edit } from "@/features/mcp/edits";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

// Wall-clock budgets: this file runs in the Vitest project `cost`, never under coverage and never next to other test
// files. A call of `edit_page_content` carries no limit on the number of its replacements (R15), so the largest calls
// that an MCP request can carry must be applied, or refused, quickly on a content at the length limit, so that a call
// never ties up the server.

/** The budget of one call. */
const BUDGET_MS = 2_000;

/** The default body limit of an MCP request in the SDK (`maxRequestBodySize`), which bounds the replacements of a call. */
const BODY_LIMIT = 4 * 1024 * 1024;

/** How many replacements like the given one fit into the body of an MCP request. */
function fitting(edit: Edit): number {
  return Math.floor(BODY_LIMIT / JSON.stringify(edit).length);
}

/** Content at the length limit: a title, the given text, and filler up to the limit. */
function atLimit(text: string): string {
  const start = `# Cost\n\n${text}`;
  return start + "-".repeat(CONTENT_MAX_LENGTH - start.length);
}

/**
 * The replacements of a chain: each one finds, once, the text the one before it inserted, so that every replacement
 * of the many that fit is found in the content at the limit.
 */
function chain(): [string, Edit[]] {
  const count = fitting({ oldText: "t999999", newText: "t9999999" });
  const edits = Array.from({ length: count }, (_, index) => ({ oldText: `t${index}`, newText: `t${index + 1}` }));
  // The first text sits at the end of the content, so that every replacement searches all of it, with room for the
  // digits that the chain adds.
  const content = atLimit("").slice(0, CONTENT_MAX_LENGTH - 10) + "t0";
  return [content, edits];
}

/** As many distinct texts as fit into the content at the limit, each found once and replaced by a text as long. */
function distinct(): [string, Edit[]] {
  let text = "";
  let count = 0;
  while (text.length < CONTENT_MAX_LENGTH - 100) text += `a${count++} `;
  const edits = Array.from({ length: count }, (_, index) => ({ oldText: `a${index} `, newText: `b${index} ` }));
  return [atLimit(text), edits];
}

/** A replacement of every place of a one-character text that appears on every other character. */
function everyOtherCharacter(): [string, Edit[]] {
  const content = `# C\n\n${"ab".repeat(Math.floor((CONTENT_MAX_LENGTH - 5) / 2))}`;
  return [content, [{ oldText: "a", newText: "c", replaceAll: true }]];
}

/** Each call, how it is built, and whether it is applied or refused as too long. */
const CALLS: Record<string, [() => [string, Edit[]], "applied" | "too-long"]> = {
  "a chain of as many replacements as fit into a request": [chain, "applied"],
  "as many distinct replacements as fit into the content": [distinct, "applied"],
  "replaceAll of a text on every other character": [everyOtherCharacter, "applied"],
  "replaceAll of a text on every other character, too long": [
    () => [everyOtherCharacter()[0], [{ oldText: "a", newText: "cc", replaceAll: true }]],
    "too-long",
  ],
};

describe("applying the largest calls to a content at the length limit", () => {
  it("fits more than 90,000 replacements of a chain into a request", () => {
    expect(chain()[1].length).toBeGreaterThan(90_000);
  });

  it.each(Object.entries(CALLS))("answers within the budget for %s", (_name, [build, outcome]) => {
    const [content, edits] = build();
    expect(content.length).toBeLessThanOrEqual(CONTENT_MAX_LENGTH);

    const start = performance.now();
    const result = applyEdits(content, edits);
    const elapsed = performance.now() - start;

    if (outcome === "applied") expect(result).toMatchObject({ ok: true, counts: edits.map(() => expect.any(Number)) });
    else expect(result).toMatchObject({ ok: false, reason: { code: "too-long" } });
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
