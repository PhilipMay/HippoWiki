import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MarkdownContent from "@/features/pages/components/MarkdownContent";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { parseMarkdown } from "@/features/pages/markdown";
import { SLOW_INPUTS } from "@/test/slow-markdown";

// Wall-clock budgets: this file runs in the Vitest project `cost`, never under coverage (which instruments markdown-it
// and react-dom too) and never next to other test files.

/** The page view of the content as HTML, as the server renders it. */
function render(content: string): string {
  return renderToString(createElement(MarkdownContent, null, content));
}

describe("the cost of the parse and the page view", () => {
  for (const [name, content] of Object.entries(SLOW_INPUTS)) {
    it(`parses and renders ${name} at the content limit within 2 s`, () => {
      expect(content.length).toBeLessThanOrEqual(CONTENT_MAX_LENGTH);
      const start = performance.now();
      parseMarkdown(content);
      render(content);
      expect(performance.now() - start).toBeLessThan(2_000);
    });
  }
});
