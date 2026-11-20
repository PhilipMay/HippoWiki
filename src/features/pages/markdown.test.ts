import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import MarkdownContent from "@/features/pages/components/MarkdownContent";
import {
  CONTENT_MAX_DEPTH,
  CONTENT_MAX_LENGTH,
  CONTENT_MAX_TABLE_CELLS,
  CONTENT_MAX_WIKI_LINKS,
} from "@/features/pages/limits";
import { analyseMarkdown, parseMarkdown, type Token, type WikiLinkMeta } from "@/features/pages/markdown";

/** The page view of the content as HTML, as the server renders it. */
function render(content: string): string {
  return renderToString(createElement(MarkdownContent, null, content));
}

/** The unit repeated up to the content limit. */
function repeated(unit: string): string {
  return unit.repeat(Math.floor(CONTENT_MAX_LENGTH / unit.length));
}

/** The addresses of all links and images of rendered HTML. */
function addresses(html: string): string[] {
  return [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((match) => match[1] ?? "");
}

describe("raw HTML and unsafe addresses", () => {
  it("shows raw HTML as text", () => {
    const html = render("# Title\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\nInline <b>bold</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toMatch(/<script|<img|<b>/);
  });

  it("makes no link or image of an unsafe address", () => {
    const html = render(
      [
        "[plain](javascript:alert(1))",
        "[mixed case](JaVaScRiPt:alert(1))",
        "[entity](&#106;avascript:alert(1))",
        "[vbscript](vbscript:msgbox(1))",
        "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
        "[reference][unsafe]",
        "<javascript:alert(1)>",
        "![dot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==)",
        "",
        "[unsafe]: javascript:alert(1)",
      ].join("\n\n"),
    );
    expect(addresses(html)).toEqual([]);
    expect(html).not.toMatch(/<a\s|<img/);
    // The unsafe links stay their Markdown text.
    expect(html).toContain("[plain](javascript:alert(1))");
    expect(html).toContain("&lt;javascript:alert(1)&gt;");
  });

  it("keeps https, relative and mailto links", () => {
    const html = render(
      "[web](https://example.com/a)\n\n[page](/folders/handbook/intro.md)\n\n[mail](mailto:a@example.com)",
    );
    expect(addresses(html)).toEqual(["https://example.com/a", "/folders/handbook/intro.md", "mailto:a@example.com"]);
  });
});

describe("GitHub Flavored Markdown", () => {
  it("renders a table with alignment", () => {
    const html = render("| Left | Center | Right |\n| :--- | :----: | ----: |\n| a | b | c |\n| d |");
    expect(html.match(/<th\b/g)).toHaveLength(3);
    // The second row is filled up to the columns of the header.
    expect(html.match(/<td\b/g)).toHaveLength(6);
    expect(html).toContain('<th scope="col" class="align-center">');
    expect(html).toContain('<td class="align-right">');
    expect(html).not.toMatch(/style="/);
  });

  it("renders strikethrough with two tildes only", () => {
    const html = render("~~struck~~ and ~single~");
    expect(html).toContain("<del>struck</del>");
    expect(html).toContain("~single~");
  });

  it("renders a task list", () => {
    const html = render("- [ ] open\n- [x] done\n- [X] also done\n- plain");
    expect(html).toContain('<ul class="contains-task-list">');
    expect(html.match(/<li class="task-list-item">/g)).toHaveLength(3);
    expect(html.match(/<input type="checkbox" disabled=""/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain("<li>plain</li>");
    expect(html).not.toContain("[x]");
  });

  it("renders a nested task list inside the task item of its parent", () => {
    const html = render("- [ ] parent\n    - [ ] child");
    expect(html).toMatch(
      /<li class="task-list-item"><input [^>]*>parent<ul class="contains-task-list"><li class="task-list-item"><input [^>]*>child<\/li><\/ul><\/li>/,
    );
    expect(html.match(/<input type="checkbox" disabled=""/g)).toHaveLength(2);
  });

  it("renders an ordered task list", () => {
    const html = render("1. [ ] first\n2. [x] second");
    expect(html).toContain('<ol class="contains-task-list">');
    expect(html.match(/<li class="task-list-item">/g)).toHaveLength(2);
    expect(html).toMatch(/<input type="checkbox" disabled=""\/>first/);
    expect(html).toMatch(/<input type="checkbox" disabled="" checked=""\/>second/);
  });

  it("renders footnotes at the end with ids of the prefix user-content-", () => {
    const html = render("# Notes\n\nText[^note] and again[^note], then[^2].\n\n[^note]: The note.\n[^2]: Second.");
    expect(html).toContain('href="#user-content-fn-1" id="user-content-fnref-1"');
    expect(html).toContain('href="#user-content-fn-1" id="user-content-fnref-1-2"');
    expect(html).toContain('href="#user-content-fn-2" id="user-content-fnref-2"');
    expect(html).toContain('<li id="user-content-fn-1">');
    expect(html).toContain('href="#user-content-fnref-1-2"');
    expect(html.indexOf("The note.")).toBeGreaterThan(html.indexOf("then"));
    for (const [, id] of html.matchAll(/\sid="([^"]*)"/g)) expect(id).toMatch(/^user-content-/);
  });

  it("turns bare addresses into links", () => {
    const html = render("See https://example.com/a, www.example.org and mail@example.net.");
    expect(addresses(html)).toEqual(["https://example.com/a", "http://www.example.org", "mailto:mail@example.net"]);
  });

  it("renders code blocks with the class of their language", () => {
    const html = render("```ts\nconst a = 1 < 2;\n```\n\n    indented");
    expect(html).toContain('<pre><code class="language-ts">const a = 1 &lt; 2;\n</code></pre>');
    expect(html).toContain("<pre><code>indented\n</code></pre>");
  });
});

describe("a page view that cannot be rendered", () => {
  afterEach(() => {
    vi.doUnmock("@/features/pages/components/markdownToReact");
    vi.doUnmock("@/lib/logger");
    vi.resetModules();
  });

  it("shows the source as text and logs the error without the content", async () => {
    const error = vi.fn();
    vi.resetModules();
    vi.doMock("@/features/pages/components/markdownToReact", () => ({
      markdownToReact: () => {
        throw new RangeError("Maximum call stack size exceeded");
      },
    }));
    vi.doMock("@/lib/logger", () => ({ logger: { error } }));
    const { default: FailingMarkdownContent } = await import("@/features/pages/components/MarkdownContent");

    const html = renderToString(createElement(FailingMarkdownContent, null, "# Title\n\n<b>secret</b>"));

    expect(html).toContain("<pre># Title\n\n&lt;b&gt;secret&lt;/b&gt;</pre>");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toEqual({ err: expect.any(RangeError) });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
  });
});

/** Lists nested `depth` deep, one level per line, as an author writes them. */
function nestedLists(depth: number): string {
  return Array.from({ length: depth }, (_, level) => `${"  ".repeat(level)}- item ${level + 1}`).join("\n");
}

/** A table with a header of `columns` columns and `rows` rows of one cell, which are filled up to the header. */
function table(columns: number, rows: number): string {
  return `|${" h |".repeat(columns)}\n|${" - |".repeat(columns)}\n${"| a |\n".repeat(rows)}`;
}

describe("analyseMarkdown", () => {
  it("finds the title, no depth and no cells in flat content", () => {
    expect(analyseMarkdown("# Title\n\nText with *emphasis*.\n\n---\n\n    code")).toEqual({
      title: "Title",
      depth: 0,
      cells: 0,
      wikiLinks: 0,
    });
    expect(analyseMarkdown("No title")).toEqual({ title: null, depth: 0, cells: 0, wikiLinks: 0 });
  });

  it("counts one level for a list or quote that is not inside another", () => {
    expect(analyseMarkdown("# T\n\n- a\n- b\n\n1. c\n\n> d").depth).toBe(1);
  });

  it("counts lists nested to the limit and one deeper", () => {
    expect(analyseMarkdown(nestedLists(CONTENT_MAX_DEPTH)).depth).toBe(CONTENT_MAX_DEPTH);
    expect(analyseMarkdown(nestedLists(CONTENT_MAX_DEPTH + 1)).depth).toBe(CONTENT_MAX_DEPTH + 1);
    expect(analyseMarkdown(`${"1. ".repeat(CONTENT_MAX_DEPTH + 1)}a`).depth).toBe(CONTENT_MAX_DEPTH + 1);
  });

  it("counts quotes nested to the limit and one deeper", () => {
    expect(analyseMarkdown(`${">".repeat(CONTENT_MAX_DEPTH)} a`).depth).toBe(CONTENT_MAX_DEPTH);
    expect(analyseMarkdown(`${">".repeat(CONTENT_MAX_DEPTH + 1)} a`).depth).toBe(CONTENT_MAX_DEPTH + 1);
  });

  it("counts lists and quotes together", () => {
    expect(analyseMarkdown(`${"> - ".repeat(CONTENT_MAX_DEPTH / 2)}a`).depth).toBe(CONTENT_MAX_DEPTH);
    expect(analyseMarkdown(`${"- > ".repeat(CONTENT_MAX_DEPTH / 2)}- a`).depth).toBe(CONTENT_MAX_DEPTH + 1);
  });

  it("still counts past the limit for content nested 50,000 deep", () => {
    expect(analyseMarkdown(`${"- ".repeat(49_999)}a`).depth).toBeGreaterThan(CONTENT_MAX_DEPTH);
    expect(analyseMarkdown(`${">".repeat(50_000)} a`).depth).toBeGreaterThan(CONTENT_MAX_DEPTH);
    expect(analyseMarkdown(repeated("- * ")).depth).toBeGreaterThan(CONTENT_MAX_DEPTH);
  });

  it("counts the cells of all tables, header and filled-up rows included", () => {
    expect(analyseMarkdown("| a | b |\n| - | - |\n| c | d |\n| e |").cells).toBe(6);
    expect(analyseMarkdown(`${table(2, 1)}\n${table(3, 2)}`).cells).toBe(2 * 2 + 3 * 3);
    // At the limit: 100 columns in the header and 99 rows filled up to 100 cells.
    expect(analyseMarkdown(table(100, 99)).cells).toBe(CONTENT_MAX_TABLE_CELLS);
    expect(analyseMarkdown(`${table(100, 99)}\n${table(1, 0)}`).cells).toBe(CONTENT_MAX_TABLE_CELLS + 1);
  });

  it("counts past the limit for a table header of 3,000 columns with 3,000 rows of one cell", () => {
    expect(
      analyseMarkdown(`|${"a|".repeat(3_000)}\n|${"-|".repeat(3_000)}\n${"a\n".repeat(3_000)}`).cells,
    ).toBeGreaterThan(CONTENT_MAX_TABLE_CELLS);
  });

  it("counts the wiki links in every block, but none in code or the alt text of an image", () => {
    const content = "# [[a]]\n\n[[b]] [[c|C]]\n\n- [[d]]\n\n| [[e]] |\n| - |\n\n`[[f]]` ![[[g]]](/a.png)";
    expect(analyseMarkdown(content).wikiLinks).toBe(5);
    expect(analyseMarkdown(`# T\n\n${"[[a]]".repeat(CONTENT_MAX_WIKI_LINKS + 1)}`).wikiLinks).toBe(
      CONTENT_MAX_WIKI_LINKS + 1,
    );
  });
});

/** The inline tokens of the first block of the content. */
function inlineTokens(content: string): Token[] {
  return parseMarkdown(content).find((token) => token.type === "inline")?.children ?? [];
}

describe("wiki links", () => {
  it("are tokens wiki_link with the target, the page, the label and their plain text", () => {
    const [link, text, labelled] = inlineTokens("[[guides/setup]] [[setup|Setup guide]]");
    expect(link).toMatchObject({ type: "wiki_link", content: "guides/setup" });
    expect(link?.meta).toEqual({
      target: "guides/setup",
      page: { tab: "guides", name: "setup" },
      label: null,
      offset: 2,
      position: 2,
    } satisfies WikiLinkMeta);
    expect(text).toMatchObject({ type: "text", content: " " });
    expect(labelled).toMatchObject({ type: "wiki_link", content: "Setup guide" });
    expect((labelled?.meta as WikiLinkMeta).page).toEqual({ tab: null, name: "setup" });
  });

  it("make ![[setup]] the text ! and a wiki link", () => {
    expect(inlineTokens("![[setup]]").map((token) => token.type)).toEqual(["text", "wiki_link"]);
  });

  it("keep a wiki link inside the text of a Markdown link, which then stays text", () => {
    const tokens = inlineTokens("[see [[setup]]](https://example.com)");
    expect(tokens.slice(0, 3).map((token) => [token.type, token.content])).toEqual([
      ["text", "[see "],
      ["wiki_link", "setup"],
      ["text", "]("],
    ]);
  });

  it("stand next to a footnote reference", () => {
    const tokens = inlineTokens("[[setup]][^1]\n\n[^1]: Note");
    expect(tokens.map((token) => token.type)).toEqual(["wiki_link", "footnote_ref"]);
  });

  it("show their plain text in the page view until they are rendered as links", () => {
    const html = render("# T\n\n[[setup]] and [[guides/setup|<b>the setup</b>]]");
    expect(html).toContain(">setup<!-- --> and <!-- -->&lt;b&gt;the setup&lt;/b&gt;</p>");
    expect(html).not.toContain("[[");
  });
});
