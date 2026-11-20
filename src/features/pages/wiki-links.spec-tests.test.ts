// Tests written from the requirements of wiki links alone, whose rules are now in `spec/wiki-links.md`, for the rules or the
// parts of rules that the other tests of wiki links leave open: what counts towards the limit of wiki links.

import { describe, expect, it } from "vitest";

import { CONTENT_MAX_WIKI_LINKS } from "@/features/pages/limits";
import { CONTENT_WIKI_LINKS_MESSAGE, pageContentInputSchema } from "@/features/pages/schema";

/** The messages of the content field of the parse, or none when it passes. */
function contentErrorsOf(content: string): string[] {
  const result = pageContentInputSchema.safeParse({ content });
  if (result.success) return [];
  return result.error.issues.filter((issue) => issue.path[0] === "content").map((issue) => issue.message);
}

describe("the limit of wiki links", () => {
  // wiki-links.md, "The limit" and "Syntax and target": a target that breaks the name rule is still a wiki link,
  // shown as missing, so it counts.
  it("counts links whose target breaks the name rule", () => {
    expect(contentErrorsOf(`# Links\n\n${"[[Setup Guide]] ".repeat(CONTENT_MAX_WIKI_LINKS + 1)}`)).toEqual([
      CONTENT_WIKI_LINKS_MESSAGE,
    ]);
  });

  // wiki-links.md, "The limit" and "Syntax and target": [[...]] in code or after a backslash is text, not a wiki
  // link, so it does not count.
  it("does not count [[...]] in a code span or after a backslash", () => {
    expect(contentErrorsOf(`# Links\n\n${"`[[setup]]` ".repeat(CONTENT_MAX_WIKI_LINKS + 1)}`)).toEqual([]);
    expect(contentErrorsOf(`# Links\n\n${"\\[[setup]] ".repeat(CONTENT_MAX_WIKI_LINKS + 1)}`)).toEqual([]);
  });

  // wiki-links.md, "The limit": every link counts, also the same target again.
  it("counts every link, not every target", () => {
    const content = `# Links\n\n${"[[a]] [[b]] ".repeat(CONTENT_MAX_WIKI_LINKS / 2)}[[a]]`;
    expect(contentErrorsOf(content)).toEqual([CONTENT_WIKI_LINKS_MESSAGE]);
  });
});
