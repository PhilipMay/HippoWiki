// A page at the content limit with every kind of block that live preview shows: headings, inline elements, lists,
// task lists, quotes, code blocks and tables. The cost test of live preview
// (`src/features/pages/editor/live-preview.cost.test.ts`) uses it, and it is the page of the manual check of the
// editor's speed. No test itself.

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

/** One section of the page, numbered so that the sections differ, about 1,000 characters long. */
function section(index: number): string {
  return [
    `## Section ${index}`,
    "",
    `Some **bold**, *italic*, ~~struck~~ and \`inline code\` text with a [link](https://example.com/${index}), an`,
    "autolink <https://example.org> and a bare address www.example.net in a paragraph that wraps.",
    "",
    "- first item",
    "- second item with **bold**",
    "  - nested item",
    "1. one",
    "2. two",
    "",
    "- [ ] open task",
    "- [x] done task",
    "",
    "> A quote with *emphasis*",
    "> > and a nested quote",
    "",
    "```ts",
    `const value = ${index};`,
    "console.log(value);",
    "```",
    "",
    "| Name | Count | Note |",
    "| :--- | ----: | :--: |",
    `| a | ${index} | **bold** |`,
    "| b | 2 | `code` |",
    "| c | 3 | [link](https://example.com) |",
    "",
    "---",
    "",
  ].join("\n");
}

/** The page: the title heading and numbered sections up to the content limit, filled up to exactly the limit. */
function editorPage(): string {
  let page = "# Editor speed\n\n";
  for (let index = 1; ; index++) {
    const next = section(index);
    if (page.length + next.length > CONTENT_MAX_LENGTH) break;
    page += next;
  }
  return page + "x".repeat(CONTENT_MAX_LENGTH - page.length);
}

/** A page of exactly the content limit with headings, lists, task lists, quotes, code blocks and tables. */
export const EDITOR_PAGE = editorPage();
