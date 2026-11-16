import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import MarkdownContent from "@/features/pages/components/MarkdownContent";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { isSafeAddress, parseMarkdown } from "@/features/pages/markdown";

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

  it("allows only relative addresses and the safe protocols", () => {
    for (const address of [
      "https://a",
      "HTTP://a",
      "mailto:a@b",
      "irc://a",
      "ircs://a",
      "xmpp:a@b",
      "/a:b",
      "a?b:c",
      "#a:b",
      "a",
    ]) {
      expect(isSafeAddress(address)).toBe(true);
    }
    for (const address of [
      "javascript:a",
      "JAVASCRIPT:a",
      "vbscript:a",
      "data:a",
      "file:///a",
      "java%09script:a",
      ":a",
    ]) {
      expect(isSafeAddress(address)).toBe(false);
    }
  });
});

describe("GitHub Flavored Markdown", () => {
  it("renders a table with alignment", () => {
    const html = render("| Left | Center | Right |\n| :--- | :----: | ----: |\n| a | b | c |\n| d |");
    expect(html.match(/<th\b/g)).toHaveLength(3);
    // The second row is filled up to the columns of the header.
    expect(html.match(/<td\b/g)).toHaveLength(6);
    expect(html).toContain("MuiTableCell-alignCenter");
    expect(html).toContain("MuiTableCell-alignRight");
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
