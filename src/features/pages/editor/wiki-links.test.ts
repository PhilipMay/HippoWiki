import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "@/features/pages/editor/extensions";
import {
  editorPageList,
  readWikiLink,
  showWikiLink,
  wikiLinkAt,
  type EditorPageList,
} from "@/features/pages/editor/wiki-links";
import { wikiLinksOf } from "@/features/pages/wiki-links";

/** A folder with a page `setup` placed directly in it, a page `setup` in the tab `guides` and an empty tab `docs`. */
const PAGE_LIST: EditorPageList = {
  pages: [
    { tab: null, name: "setup", title: "Setup", address: "/folders/f/setup.md" },
    { tab: "guides", name: "setup", title: "Setup guide", address: "/folders/f/guides/setup.md" },
  ],
  places: [
    { tab: null, newPageAddress: "/folders/f?action=new&name=" },
    { tab: "guides", newPageAddress: "/folders/f/guides?action=new&name=" },
    { tab: "docs", newPageAddress: "/folders/f/docs?action=new&name=" },
  ],
};

/** The parsed state of the editor with `doc`, and the page list, or none for `null`. */
function stateOf(doc: string, pageList: EditorPageList | null = PAGE_LIST): EditorState {
  const options = { newPage: false, labelId: "l", descriptionId: "d" };
  const state = EditorState.create({
    doc,
    extensions: editorExtensions(pageList ? { ...options, pageList } : options),
  });
  ensureSyntaxTree(state, doc.length);
  return state;
}

/** The wiki links of the editor's parse, each as its whole text, its target and its label. */
function linksOf(doc: string) {
  const state = stateOf(doc);
  const links: { text: string; target: string; label: string | null }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "WikiLink") return;
      const inTable = node.node.parent?.name === "TableCell";
      const link = readWikiLink(state, node.node, inTable);
      if (link) links.push({ text: doc.slice(link.from, link.to), target: link.target, label: link.label });
    },
  });
  return links;
}

describe("the parse of wiki links in the editor", () => {
  it("reads the target and the label", () => {
    expect(linksOf("See [[setup]] and [[guides/setup|the setup]].")).toEqual([
      { text: "[[setup]]", target: "setup", label: null },
      { text: "[[guides/setup|the setup]]", target: "guides/setup", label: "the setup" },
    ]);
  });

  it("takes the target up to the first | and the label up to the first ]]", () => {
    expect(linksOf("[[a|b|c]] [[a]]]")).toEqual([
      { text: "[[a|b|c]]", target: "a", label: "b|c" },
      { text: "[[a]]", target: "a", label: null },
    ]);
  });

  it("counts an empty label as none and makes no link of an empty target", () => {
    expect(linksOf("[[a|]] [[]] [[|b]]")).toEqual([{ text: "[[a|]]", target: "a", label: null }]);
  });

  it("keeps the label as written, without formatting it", () => {
    expect(linksOf("[[setup|**Setup** [x](y)]]")).toEqual([
      { text: "[[setup|**Setup** [x](y)]]", target: "setup", label: "**Setup** [x](y)" },
    ]);
  });

  it("keeps [[...]] as text in code, after a backslash and over a line break", () => {
    expect(linksOf("`[[setup]]` \\[[setup]]\n\n```\n[[setup]]\n```\n\n    [[setup]]\n\n[[setup\n]]")).toEqual([]);
  });

  it("reads ![[setup]] as ! and a wiki link, and leaves an image to the parser of images", () => {
    expect(linksOf("![[setup]] ![[a]](b.png)")).toEqual([{ text: "[[setup]]", target: "setup", label: null }]);
  });

  it("reads \\| in a table cell as the | between target and label", () => {
    expect(linksOf("| a |\n| - |\n| [[setup\\|Setup]] |")).toEqual([
      { text: "[[setup\\|Setup]]", target: "setup", label: "Setup" },
    ]);
  });

  it("reads the same targets and labels as the page view on a mix of blocks", () => {
    const doc = [
      "# About [[setup|the setup]]",
      "",
      "- [[a]] and [[b|B]]",
      "  > [[guides/c]]",
      "1. [ ] [[Not Valid]] `[[code]]`",
      "",
      "Text [[d#e]] ![[f]] \\[[g]] [[h|]]",
    ].join("\n");
    const pageView = wikiLinksOf(doc).map(({ target, label }) => ({ target, label }));
    expect(linksOf(doc).map(({ target, label }) => ({ target, label }))).toEqual(pageView);
  });
});

describe("showWikiLink", () => {
  const show = (doc: string, pageList: EditorPageList | null = PAGE_LIST) => {
    const state = stateOf(doc, pageList);
    const link = wikiLinkAt(state, 0);
    if (!link) throw new Error(`no wiki link in ${doc}`);
    return showWikiLink(state.facet(editorPageList), link);
  };

  it("shows the title of an existing page without a label, and the label with one", () => {
    expect(show("[[guides/setup]]")).toEqual({
      text: "Setup guide",
      exists: true,
      hint: null,
      address: "/folders/f/guides/setup.md",
    });
    expect(show("[[setup]]")).toMatchObject({ text: "Setup", address: "/folders/f/setup.md" });
    expect(show("[[guides/setup|the setup]]")).toMatchObject({ text: "the setup", exists: true });
  });

  it("leads a missing page in a place that exists to the editor of a new page with its name", () => {
    expect(show("[[docs/faq]]")).toEqual({
      text: "docs/faq",
      exists: false,
      hint: "Page does not exist",
      address: "/folders/f/docs?action=new&name=faq",
    });
    expect(show("[[faq|FAQ]]")).toMatchObject({ text: "FAQ", address: "/folders/f?action=new&name=faq" });
  });

  it("leads nowhere for a target that breaks the name rule or names a tab that does not exist", () => {
    for (const target of ["Setup Guide", "setup.md", "Guides/Setup", "guides/setup/more", "setup#install"]) {
      expect(show(`[[${target}]]`)).toEqual({
        text: target,
        exists: false,
        hint: "Not a valid page name",
        address: null,
      });
    }
    expect(show("[[nosuchtab/setup]]")).toEqual({
      text: "nosuchtab/setup",
      exists: false,
      hint: "Tab does not exist",
      address: null,
    });
  });

  it("leads nowhere without a page list", () => {
    expect(show("[[setup]]", null)).toMatchObject({ exists: false, address: null });
  });
});

describe("wikiLinkAt", () => {
  it("finds the wiki link at a position from its start to before its end", () => {
    const state = stateOf("x [[setup]] y");
    expect(wikiLinkAt(state, 2)?.target).toBe("setup");
    expect(wikiLinkAt(state, 10)?.target).toBe("setup");
    expect(wikiLinkAt(state, 11)).toBeNull();
    expect(wikiLinkAt(state, 1)).toBeNull();
  });

  it("finds no wiki link in the text of a Markdown link", () => {
    expect(wikiLinkAt(stateOf("[a [[setup]] b](https://example.com)"), 5)).toBeNull();
  });

  it("reads a wiki link in a table cell as the table does", () => {
    const doc = "| a |\n| - |\n| [[setup\\|Setup]] |";
    const link = wikiLinkAt(stateOf(doc), doc.indexOf("[[") + 3);
    expect(link).toMatchObject({ target: "setup", label: "Setup" });
  });
});
