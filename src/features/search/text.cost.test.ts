import { describe, expect, it } from "vitest";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { searchIndexData } from "@/features/search/index-data";
import { SLOW_INPUTS } from "@/test/slow-markdown";
import { samplePage } from "@/test/language-samples";

// Wall-clock budgets: this file runs in the Vitest project `cost`, never under coverage and never next to other test
// files.

/** The German sample repeated up to the content limit: prose that the detector reads in full. */
function prose(): string {
  const page = samplePage("german");
  const body = page.slice(page.indexOf("\n\n") + 2);
  return `${page}${body.repeat(Math.floor((CONTENT_MAX_LENGTH - page.length) / body.length))}`;
}

describe("the cost of the search text and the language of a page", () => {
  // The first derivation loads the detector; it counts like every other one.
  const inputs: Record<string, string> = { "prose at the content limit": prose(), ...SLOW_INPUTS };
  for (const [name, content] of Object.entries(inputs)) {
    it(`derives them for ${name} within 2 s`, async () => {
      expect(content.length).toBeLessThanOrEqual(CONTENT_MAX_LENGTH);
      const start = performance.now();
      await searchIndexData(content);
      expect(performance.now() - start).toBeLessThan(2_000);
    });
  }
});
