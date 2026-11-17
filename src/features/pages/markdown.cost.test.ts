import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MarkdownContent from "@/features/pages/components/MarkdownContent";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { parseMarkdown } from "@/features/pages/markdown";

// Wall-clock budgets: this file runs in the Vitest project `cost`, never under coverage (which instruments markdown-it
// and react-dom too) and never next to other test files.

/** The page view of the content as HTML, as the server renders it. */
function render(content: string): string {
  return renderToString(createElement(MarkdownContent, null, content));
}

/** The unit repeated up to the content limit. */
function repeated(unit: string): string {
  return unit.repeat(Math.floor(CONTENT_MAX_LENGTH / unit.length));
}

/** Content at the content limit with many footnotes, each defined and referenced once, and many other tokens. */
function manyFootnotes(): string {
  let references = "";
  let definitions = "";
  for (let index = 0; references.length + definitions.length < CONTENT_MAX_LENGTH / 2; index++) {
    references += `[^${index.toString(36)}]`;
    definitions += `[^${index.toString(36)}]: x\n`;
  }
  const list = "- a\n".repeat(Math.floor(CONTENT_MAX_LENGTH / 2 / 4));
  return `${references}\n\n${list}\n${definitions}`.slice(0, CONTENT_MAX_LENGTH);
}

// The inputs of the benchmark of the review: micromark and react-markdown took between 2.5 s and more than 60 s for
// each, markdown-it at most 110 ms. They guard the cost of the parse and the page view, so that an update of
// markdown-it or of the renderer cannot bring a slow parse back unnoticed.
const SLOW_INPUTS: Record<string, string> = {
  "a~": repeated("a~"),
  "**a": repeated("**a"),
  "[a][": repeated("[a]["),
  "*a": repeated("*a"),
  _a: repeated("_a"),
  "~~a": repeated("~~a"),
  "[": repeated("["),
  "![": repeated("!["),
  "[a](": repeated("[a]("),
  "`a": repeated("`a"),
  "<a": repeated("<a"),
  "a]": repeated("a]"),
  "www.a": repeated("www.a"),
  "bare addresses": repeated("www.a.de a.com "),
  "[^a]": repeated("[^a]"),
  "one list item per line": repeated("- a\n"),
  // Alternating markers, because `- - -` is a thematic break.
  "lists nested 50,000 deep": repeated("- * "),
  "quotes nested 50,000 deep": repeated("> "),
  "a table header of 3,000 columns with 3,000 rows of one cell": `|${"a|".repeat(3_000)}\n|${"-|".repeat(3_000)}\n${"a\n".repeat(3_000)}`,
  "many footnotes": manyFootnotes(),
};

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
