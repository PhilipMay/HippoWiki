import { describe, expect, it } from "vitest";

import {
  linkRowsOf,
  linkTargetsOf,
  pageMoved,
  rewriteWikiLinks,
  tabRenamed,
  wikiLinksOf,
} from "@/features/pages/wiki-links";

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
  it("reads the target and the label of [[target]] and [[target|label]]", () => {
    expect(wikiLinksOf("[[setup|Setup guide]]")).toEqual([
      {
        target: "setup",
        page: { kind: "page", tab: null, name: "setup" },
        embed: false,
        label: "Setup guide",
        position: 2,
      },
    ]);
    expect(wikiLinksOf("[[setup]]")).toEqual([
      { target: "setup", page: { kind: "page", tab: null, name: "setup" }, embed: false, label: null, position: 2 },
    ]);
  });

  it("reads the target first, so a title before the bar names no page", () => {
    expect(wikiLinksOf("[[Setup guide|setup]]")).toEqual([
      { target: "Setup guide", page: null, embed: false, label: "setup", position: 2 },
    ]);
  });

  it("reads [[setup]] as the page placed directly in the folder and [[guides/setup]] as the page in the tab", () => {
    expect(wikiLinksOf("[[setup]] [[guides/setup]]").map((link) => link.page)).toEqual([
      { kind: "page", tab: null, name: "setup" },
      { kind: "page", tab: "guides", name: "setup" },
    ]);
  });

  it("reads the first part of a target with a slash as a tab of the own folder", () => {
    expect(wikiLinksOf("[[other-folder/setup]]")[0]?.page).toEqual({
      kind: "page",
      tab: "other-folder",
      name: "setup",
    });
  });

  it("reads ![[file]] as an embed of a file, and ![[page]] as no embed", () => {
    expect(wikiLinksOf("![[guides/diagram.png|Diagram]] [[report.pdf]] ![[setup]]")).toEqual([
      {
        target: "guides/diagram.png",
        page: { kind: "file", tab: "guides", name: "diagram.png" },
        embed: true,
        label: "Diagram",
        position: 3,
      },
      {
        target: "report.pdf",
        page: { kind: "file", tab: null, name: "report.pdf" },
        embed: false,
        label: null,
        position: 34,
      },
      { target: "setup", page: { kind: "page", tab: null, name: "setup" }, embed: false, label: null, position: 50 },
    ]);
  });

  it("reads targets that break the name rule as links without a page", () => {
    const content = "[[Setup Guide]] [[setup.md]] [[Guides/Setup]] [[guides/setup/more]] [[setup#install]]";
    expect(wikiLinksOf(content).map((link) => [link.target, link.page])).toEqual([
      ["Setup Guide", null],
      ["setup.md", null],
      ["Guides/Setup", null],
      ["guides/setup/more", null],
      ["setup#install", null],
    ]);
  });

  it("reads ![[setup]] as the character ! and a wiki link", () => {
    expect(targets("![[setup]]")).toEqual(["setup"]);
  });

  it("keeps the label as written, Markdown included", () => {
    expect(wikiLinksOf("[[setup|**Setup**]]")[0]?.label).toBe("**Setup**");
    expect(wikiLinksOf("[[setup|a [b] `c` <d>]]")[0]?.label).toBe("a [b] `c` <d>");
  });

  it("reads [[setup\\|Setup]] in a table cell as the page setup with the label Setup", () => {
    const content = "| Page | Note |\n| --- | --- |\n| [[setup\\|Setup]] | x |";
    expect(wikiLinksOf(content)).toEqual([
      {
        target: "setup",
        page: { kind: "page", tab: null, name: "setup" },
        embed: false,
        label: "Setup",
        position: content.indexOf("setup"),
      },
    ]);
  });

  it("finds no wiki link in a code span, a code block, after a backslash or across a line break", () => {
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
      { kind: "page", tab: "guides", name: "setup" },
      { kind: "page", tab: null, name: "faq" },
      { kind: "page", tab: null, name: "setup" },
    ]);
  });

  it("gives the targets of files, of links and embeds alike, with their extension", () => {
    const content =
      "![[guides/diagram.png]] [[guides/diagram.png|again]] [[report.pdf]] [[photo.jpeg]] [[guides/diagram]]";
    expect(linkTargetsOf(content)).toEqual([
      { kind: "file", tab: "guides", name: "diagram.png" },
      { kind: "file", tab: null, name: "report.pdf" },
      { kind: "page", tab: "guides", name: "diagram" },
    ]);
    expect(linkRowsOf("![[t/a.png]]", "folder")).toEqual([{ folderId: "folder", tabName: "t", pageName: "a.png" }]);
  });

  it("gives the rows of the index of links of a folder", () => {
    expect(linkRowsOf("[[a]] [[t/b]]", "folder")).toEqual([
      { folderId: "folder", tabName: null, pageName: "a" },
      { folderId: "folder", tabName: "t", pageName: "b" },
    ]);
  });
});

describe("rewriteWikiLinks", () => {
  const renamed = pageMoved(
    { kind: "page", tab: "guides", name: "setup" },
    { kind: "page", tab: "guides", name: "install" },
  );

  it("changes only the target and keeps the label as written", () => {
    expect(rewriteWikiLinks("# T\n\nSee [[guides/setup|the setup]] and [[guides/setup]].", renamed)).toBe(
      "# T\n\nSee [[guides/install|the setup]] and [[guides/install]].",
    );
  });

  it("changes several links in one line, a link in a heading and a link of the page to itself", () => {
    const content = "# About [[guides/setup]]\n\n[[guides/setup]][[guides/setup|x]] [[setup]] [[guides/setup-two]]";
    expect(rewriteWikiLinks(content, renamed)).toBe(
      "# About [[guides/install]]\n\n[[guides/install]][[guides/install|x]] [[setup]] [[guides/setup-two]]",
    );
  });

  it("keeps \\| in tables, code, escapes, other targets and invalid targets", () => {
    const content =
      "| a | b |\n| - | - |\n| [[guides/setup\\|Setup]] | `[[guides/setup]]` |\n\n" +
      "```\n[[guides/setup]]\n```\n\n\\[[guides/setup]] [[Guides/Setup]] [[guides/faq]] ![[guides/setup]]";
    expect(rewriteWikiLinks(content, renamed)).toBe(
      "| a | b |\n| - | - |\n| [[guides/install\\|Setup]] | `[[guides/setup]]` |\n\n" +
        "```\n[[guides/setup]]\n```\n\n\\[[guides/setup]] [[Guides/Setup]] [[guides/faq]] ![[guides/install]]",
    );
  });

  it("moves a link into another tab or directly into the folder", () => {
    expect(
      rewriteWikiLinks(
        "[[guides/setup]]",
        pageMoved({ kind: "page", tab: "guides", name: "setup" }, { kind: "page", tab: null, name: "setup" }),
      ),
    ).toBe("[[setup]]");
    expect(
      rewriteWikiLinks(
        "[[setup]]",
        pageMoved({ kind: "page", tab: null, name: "setup" }, { kind: "page", tab: "docs", name: "setup" }),
      ),
    ).toBe("[[docs/setup]]");
  });

  it("changes every link into a renamed tab, whatever the page", () => {
    expect(rewriteWikiLinks("[[guides/setup|the setup]] [[guides/faq]] [[setup]]", tabRenamed("guides", "docs"))).toBe(
      "[[docs/setup|the setup]] [[docs/faq]] [[setup]]",
    );
  });

  it("changes the links and embeds of the files of a renamed tab", () => {
    expect(rewriteWikiLinks("![[guides/diagram.png|D]] [[guides/report.pdf]]", tabRenamed("guides", "docs"))).toBe(
      "![[docs/diagram.png|D]] [[docs/report.pdf]]",
    );
  });

  it("changes the links and embeds of a moved file, and no page of the same name", () => {
    const moved = pageMoved(
      { kind: "file", tab: "guides", name: "diagram.png" },
      { kind: "file", tab: null, name: "network.png" },
    );
    expect(rewriteWikiLinks("![[guides/diagram.png]] [[guides/diagram.png|x]] [[guides/diagram]]", moved)).toBe(
      "![[network.png]] [[network.png|x]] [[guides/diagram]]",
    );
  });

  it("keeps line breaks as CRLF", () => {
    expect(rewriteWikiLinks("# T\r\n\r\n[[guides/setup]]\r\n", renamed)).toBe("# T\r\n\r\n[[guides/install]]\r\n");
  });

  it("returns content without such links as it is", () => {
    expect(rewriteWikiLinks("# T\n\nNo links.", renamed)).toBe("# T\n\nNo links.");
  });

  describe("with a footnote definition before another link", () => {
    const oldRenamed = pageMoved({ kind: "page", tab: null, name: "old" }, { kind: "page", tab: null, name: "new" });

    it("changes the link in the definition and the link after it, and nothing else", () => {
      expect(rewriteWikiLinks("# T\n\n[^1]: see [[old]]\n\nText[^1] and [[old]].\n", oldRenamed)).toBe(
        "# T\n\n[^1]: see [[new]]\n\nText[^1] and [[new]].\n",
      );
    });

    it("keeps line breaks as CRLF", () => {
      expect(rewriteWikiLinks("# T\r\n\r\n[^1]: see [[old]]\r\n\r\nText[^1] and [[old]].\r\n", oldRenamed)).toBe(
        "# T\r\n\r\n[^1]: see [[new]]\r\n\r\nText[^1] and [[new]].\r\n",
      );
    });

    it("changes the links of two definitions in reverse order of their references and of the text", () => {
      const content = "# T\n\n[^b]: B [[old|b]]\n\n[^a]: A [[old]]\n\nFirst[^a], second[^b], and [[old|text]].\n";
      expect(rewriteWikiLinks(content, oldRenamed)).toBe(
        "# T\n\n[^b]: B [[new|b]]\n\n[^a]: A [[new]]\n\nFirst[^a], second[^b], and [[new|text]].\n",
      );
    });

    it("changes the links into a renamed tab", () => {
      const content = "# T\n\n[^1]: see [[guides/setup]]\n\nText[^1] and [[guides/intro]].\n";
      expect(rewriteWikiLinks(content, tabRenamed("guides", "docs"))).toBe(
        "# T\n\n[^1]: see [[docs/setup]]\n\nText[^1] and [[docs/intro]].\n",
      );
    });

    it("changes the embed and the link of a moved file", () => {
      const moved = pageMoved(
        { kind: "file", tab: null, name: "diagram.png" },
        { kind: "file", tab: "docs", name: "network.png" },
      );
      const content = "# T\n\n[^1]: see ![[diagram.png]]\n\nText[^1] and [[diagram.png]].\n";
      expect(rewriteWikiLinks(content, moved)).toBe(
        "# T\n\n[^1]: see ![[docs/network.png]]\n\nText[^1] and [[docs/network.png]].\n",
      );
    });

    it("keeps a link of the definition that does not change", () => {
      expect(rewriteWikiLinks("# T\n\n[^1]: see [[other]]\n\nText[^1] and [[old]].\n", oldRenamed)).toBe(
        "# T\n\n[^1]: see [[other]]\n\nText[^1] and [[new]].\n",
      );
    });
  });
});
