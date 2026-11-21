// Content at the content limit that slows a Markdown parser down: the inputs of the benchmark of the review. The
// cost tests of the parse and the page view (`src/features/pages/markdown.cost.test.ts`) and of the search text
// (`src/features/search/text.cost.test.ts`) use them. No test itself.

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

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
export const SLOW_INPUTS: Readonly<Record<string, string>> = {
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
  // A `www.` link every nine characters, which calls `validate` of the schema `www.` most often.
  "www addresses": repeated("www.a.de "),
  "[^a]": repeated("[^a]"),
  "one list item per line": repeated("- a\n"),
  // Alternating markers, because `- - -` is a thematic break.
  "lists nested 50,000 deep": repeated("- * "),
  "quotes nested 50,000 deep": repeated("> "),
  "a table header of 3,000 columns with 3,000 rows of one cell": `|${"a|".repeat(3_000)}\n|${"-|".repeat(3_000)}\n${"a\n".repeat(3_000)}`,
  "many footnotes": manyFootnotes(),
  // Inputs for the rule of wiki links, which looks for the end of a link after every `[[`.
  "[[ with ]] at the end": `${repeated("[[").slice(2)}]]`,
  "[[a|": repeated("[[a|"),
  "[[a| with ]] at the end": `${repeated("[[a|").slice(4)}]]`,
  "[[a]]": repeated("[[a]]"),
  "[[ between code spans": repeated("`a` [[ "),
  "[[a on every line with ]] at the end": `${repeated("[[a\n").slice(4)}]]`,
  "[[a]] in table cells": `| a |\n| - |\n${repeated("| [[a]] \\| [[b|c]] |\n")}`.slice(0, CONTENT_MAX_LENGTH),
};
