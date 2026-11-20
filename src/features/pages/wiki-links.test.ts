import { describe, expect, it } from "vitest";

import { linkRowsOf, linkTargetsOf, wikiLinksOf } from "@/features/pages/wiki-links";

/** The targets of the wiki links of the content, as written. */
function targets(content: string): string[] {
  return wikiLinksOf(content).map((link) => link.target);
}

/** The text of the content at the position of every wiki link, as long as its target. */
function atPositions(content: string): (string | null)[] {
  return wikiLinksOf(content).map(({ position, target }) =>
    position === null ? null : content.slice(position, position + target.length),
  );
}

describe("wikiLinksOf", () => {
  it("reads the target and the label of [[target]] and [[target|label]] (R4)", () => {
    expect(wikiLinksOf("[[setup|Setup guide]]")).toEqual([
      { target: "setup", page: { tab: null, name: "setup" }, label: "Setup guide", position: 2 },
    ]);
    expect(wikiLinksOf("[[setup]]")).toEqual([
      { target: "setup", page: { tab: null, name: "setup" }, label: null, position: 2 },
    ]);
  });

  it("reads the target first, so a title before the bar names no page (R4)", () => {
    expect(wikiLinksOf("[[Setup guide|setup]]")).toEqual([
      { target: "Setup guide", page: null, label: "setup", position: 2 },
    ]);
  });

  it("reads [[setup]] as the page placed directly in the folder and [[guides/setup]] as the page in the tab (R5)", () => {
    expect(wikiLinksOf("[[setup]] [[guides/setup]]").map((link) => link.page)).toEqual([
      { tab: null, name: "setup" },
      { tab: "guides", name: "setup" },
    ]);
  });

  it("reads the first part of a target with a slash as a tab of the own folder (R1)", () => {
    expect(wikiLinksOf("[[other-folder/setup]]")[0]?.page).toEqual({ tab: "other-folder", name: "setup" });
  });

  it("reads targets that break the name rule as links without a page (R13, R25)", () => {
    const content = "[[Setup Guide]] [[setup.md]] [[Guides/Setup]] [[guides/setup/more]] [[setup#install]]";
    expect(wikiLinksOf(content).map((link) => [link.target, link.page])).toEqual([
      ["Setup Guide", null],
      ["setup.md", null],
      ["Guides/Setup", null],
      ["guides/setup/more", null],
      ["setup#install", null],
    ]);
  });

  it("reads ![[setup]] as the character ! and a wiki link (R25)", () => {
    expect(targets("![[setup]]")).toEqual(["setup"]);
  });

  it("keeps the label as written, Markdown included (R18)", () => {
    expect(wikiLinksOf("[[setup|**Setup**]]")[0]?.label).toBe("**Setup**");
    expect(wikiLinksOf("[[setup|a [b] `c` <d>]]")[0]?.label).toBe("a [b] `c` <d>");
  });

  it("reads [[setup\\|Setup]] in a table cell as the page setup with the label Setup (R18)", () => {
    const content = "| Page | Note |\n| --- | --- |\n| [[setup\\|Setup]] | x |";
    expect(wikiLinksOf(content)).toEqual([
      { target: "setup", page: { tab: null, name: "setup" }, label: "Setup", position: content.indexOf("setup") },
    ]);
  });

  it("finds no wiki link in a code span, a code block, after a backslash or across a line break (R31)", () => {
    expect(targets("`[[setup]]`")).toEqual([]);
    expect(targets("```\n[[setup]]\n```")).toEqual([]);
    expect(targets("    [[setup]]")).toEqual([]);
    expect(targets("\\[[setup]]")).toEqual([]);
    expect(targets("[[setup\n]]")).toEqual([]);
    expect(targets("[[setup|the\nsetup]]")).toEqual([]);
  });

  it("finds no wiki link with an empty target", () => {
    expect(targets("[[]] [[|label]]")).toEqual([]);
  });

  it("counts an empty label as none", () => {
    expect(wikiLinksOf("[[setup|]]")[0]?.label).toBeNull();
  });

  it("keeps a wiki link inside the text of a Markdown link, which then is no link, as for links in links", () => {
    expect(targets("[see [[setup]]](https://example.com)")).toEqual(["setup"]);
  });

  it("finds no wiki link in the alt text of an image", () => {
    expect(targets("![see [[setup]]](https://example.com/a.png)")).toEqual([]);
  });

  it("finds a wiki link next to a footnote reference", () => {
    expect(targets("[[setup]][^1] and [^1][[guides/setup]]\n\n[^1]: A note with [[faq]].")).toEqual([
      "setup",
      "guides/setup",
      "faq",
    ]);
  });

  it("finds several links in one line and in one page, in their order", () => {
    const content = "# Links\n\n[[a]] and [[b|B]], [[c/d]]\n\n- [[e]]\n- [[a]]";
    expect(targets(content)).toEqual(["a", "b", "c/d", "e", "a"]);
  });

  it("ends a target at the first ]] and a label at the next", () => {
    expect(wikiLinksOf("[[a]]] [[b|c]d]]")).toMatchObject([
      { target: "a", label: null },
      { target: "b", label: "c]d" },
    ]);
  });

  describe("the position of the target in the content", () => {
    const corpus: Record<string, string> = {
      paragraph: "# Title\n\nSee [[setup]] and [[guides/setup|the setup]] here.\nAnd [[faq]] on a second line.  \n",
      "trailing spaces after the last line": "Text [[setup]]   \n\nMore",
      "headings with closing sequences": "# About [[setup]] #\n\n## [[a]] and [[b]] ##   \n\n### [[c]]#",
      "setext headings": "Intro [[setup]]\n[[faq]] end\n===\n\nSecond [[a]]\n---",
      "nested lists": "- [[a]]\n  - [[b]]\n    1. [[c]] and [[d]]\n       continued [[e]]\n- [[f]]",
      quotes: "> [[a]]\n> > [[b]]\nlazy [[c]]\n>\n> - [[d]]",
      "task items": "- [ ] [[a]]\n- [x] Done [[b|B]]\n  - [ ] [[c]]",
      tables:
        "| A | B |\n| --- | :-: |\n| [[a]] | x [[b\\|B]] |\n|[[c]]|[[d]]|\n| \\| [[e]] | [[f\\|F]] [[g]] |\n" +
        "> | [[h]] | i |\n> | - | - |\n> | [[j]] | [[k]] |",
      footnotes: "Text[^n] [[a]]\n\n[^n]: Note [[b]]\n    with [[c]]\n\n    And [[d]].",
      "indented lines": "   [[a]]\n  text [[b]]\n\n- item\n\n    [[c]] in a loose item",
      tabs: "-\t[[a]]\n\t-\t[[b]]\n>\t[[c]]",
      "a table in a list": "- | [[a]] | b |\n  | --- | --- |\n  | [[c]] | [[d]] |",
      "line breaks as CRLF": "# T\r\n\r\n[[a]] text\r\n[[b]]\r\n\r\n- [[c]]\r\n| x | y |\r\n|---|---|\r\n| [[d]] | e |",
      "line breaks as CR": "# T\r\r[[a]]\r[[b]]",
      "emphasis and links around": "*[[a]]* **x [[b]]** [link](https://e.com) [[c]] ~~[[d]]~~ `[[no]]` [[e]]",
      "same target twice in a line": "[[a]] [[a]] `[[a]]` [[a|a]]",
    };

    for (const [name, content] of Object.entries(corpus)) {
      it(`holds the target as written for ${name}`, () => {
        const links = wikiLinksOf(content);
        expect(links.length).toBeGreaterThan(0);
        expect(atPositions(content)).toEqual(links.map((link) => link.target));
        for (const { position } of links) expect(content.slice(position! - 2, position!)).toBe("[[");
      });
    }

    it("finds every link of the corpus", () => {
      expect(targets(corpus.tables!)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "j", "k"]);
      expect(targets(corpus["headings with closing sequences"]!)).toEqual(["setup", "a", "b", "c"]);
    });

    it("places links in distinct places when the same text repeats", () => {
      const content = "[[a]] [[a]] [[a]]";
      expect(wikiLinksOf(content).map((link) => link.position)).toEqual([2, 8, 14]);
    });
  });
});

describe("linkTargetsOf", () => {
  it("gives each valid target once, in the order of its first link, a link of the page to itself included", () => {
    const content = "# Setup\n\n[[guides/setup]] [[faq]] [[guides/setup|again]] [[Setup Guide]] `[[code]]` [[setup]]";
    expect(linkTargetsOf(content)).toEqual([
      { tab: "guides", name: "setup" },
      { tab: null, name: "faq" },
      { tab: null, name: "setup" },
    ]);
  });

  it("gives the rows of the index of links of a folder", () => {
    expect(linkRowsOf("[[a]] [[t/b]]", "folder")).toEqual([
      { folderId: "folder", tabName: null, pageName: "a" },
      { folderId: "folder", tabName: "t", pageName: "b" },
    ]);
  });
});
