import { undo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { editorExtensions, type EditorOptions } from "@/features/pages/editor/extensions";
import { livePreviewDecorations, toggleTask } from "@/features/pages/editor/live-preview";

/** A folder with the page `setup` in the tab `guides`, titled "Setup guide". */
const PAGE_LIST = {
  pages: [{ tab: "guides", name: "setup", title: "Setup guide", address: "/folders/f/guides/setup.md" }],
  files: [],
  places: [
    { tab: null, newPageAddress: "/folders/f?action=new&name=", uploadAddress: "/folders/f?action=upload&name=" },
    {
      tab: "guides",
      newPageAddress: "/folders/f/guides?action=new&name=",
      uploadAddress: "/folders/f/guides?action=upload&name=",
    },
  ],
};

const OPTIONS = { newPage: false, labelId: "label", descriptionId: "description", pageList: PAGE_LIST };

/**
 * What a decoration does: hides text, replaces it by a widget (with the class of the widget's element unknown here, its
 * kind by the name of its class and what it shows), styles text with a class, or styles a line with classes.
 */
type Shown = {
  hidden: string[];
  widgets: string[];
  marked: Record<string, string[]>;
  lines: Record<number, string>;
};

/**
 * The decorations of live preview for `doc` with the cursor at `cursor` (the end of the document by default, on a line
 * of its own), or with the given selection: the hidden texts, the texts of each class, and the classes of the lines.
 */
function preview(doc: string, selection = EditorSelection.single(doc.length)): Shown {
  const state = EditorState.create({ doc, selection, extensions: editorExtensions(OPTIONS) });
  ensureSyntaxTree(state, doc.length);
  const shown: Shown = { hidden: [], widgets: [], marked: {}, lines: {} };
  livePreviewDecorations(state, [{ from: 0, to: doc.length }]).between(0, doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string; widget?: { constructor: { name: string }; checked?: boolean } };
    if (spec.widget) {
      const checked = spec.widget.checked === undefined ? "" : spec.widget.checked ? " ticked" : " unticked";
      shown.widgets.push(`${spec.widget.constructor.name}${checked}: ${doc.slice(from, to)}`);
    } else if (spec.class === undefined) shown.hidden.push(doc.slice(from, to));
    else if (from === to) {
      const number = state.doc.lineAt(from).number;
      shown.lines[number] = [shown.lines[number], spec.class].filter(Boolean).join(" ");
    } else (shown.marked[spec.class] ??= []).push(doc.slice(from, to));
  });
  return shown;
}

/** A document whose last line is empty, so that the cursor at its end is on no line of the content before it. */
const away = (content: string) => `${content}\n\n`;

describe("live preview of headings", () => {
  it("hides ## and the space after them on another line than the cursor and styles the line", () => {
    const shown = preview(away("## Heading"));
    expect(shown.hidden).toEqual(["## "]);
    expect(shown.lines[1]).toContain("cm-lp-h2");
  });

  it("hides nothing on the line of the cursor, wherever the cursor is on it", () => {
    for (const cursor of [0, 3, 10]) {
      expect(preview("## Heading\n\ntext", EditorSelection.single(cursor)).hidden).toEqual([]);
    }
  });

  it("shows every mark on every line of a selection", () => {
    const doc = "# One\n**two**\n*three*\n\n# Four";
    const shown = preview(doc, EditorSelection.single(0, doc.indexOf("*three*") + 3));
    expect(shown.hidden).toEqual(["# "]);
  });

  it.each([1, 2, 3, 4, 5, 6])("styles a heading of level %i and hides its marks", (level) => {
    const shown = preview(away(`${"#".repeat(level)} Title`));
    expect(shown.hidden).toEqual([`${"#".repeat(level)} `]);
    expect(shown.lines[1]).toContain(`cm-lp-h${level}`);
  });

  it("hides the closing marks of an ATX heading", () => {
    expect(preview(away("## Title ##")).hidden).toEqual(["## ", " ##"]);
  });

  it("styles a setext heading and hides its underline like a fence line", () => {
    const shown = preview(away("Title\n====="));
    expect(shown.lines[1]).toContain("cm-lp-h1");
    expect(shown.lines[2]).toBe("cm-lp-hidden-line");
    expect(shown.hidden).toEqual(["====="]);
  });
});

describe("live preview of inline elements", () => {
  it.each([
    ["bold", "**word**", "cm-lp-strong", ["**", "**"]],
    ["bold with underscores", "__word__", "cm-lp-strong", ["__", "__"]],
    ["italic", "*word*", "cm-lp-emphasis", ["*", "*"]],
    ["strikethrough", "~~word~~", "cm-lp-strikethrough", ["~~", "~~"]],
    ["inline code", "`word`", "cm-lp-code", ["`", "`"]],
    ["an inline link", '[word](https://example.com "Title")', "cm-lp-link", ["[", '](https://example.com "Title")']],
    ["a reference link", "[word][ref]", "cm-lp-link", ["[", "][ref]"]],
    ["an autolink", "<https://word>", "cm-lp-link", ["<", ">"]],
  ])("%s: the marks are hidden and the text is styled", (_name, markdown, className, hidden) => {
    const shown = preview(away(`a ${markdown} b`));
    expect(shown.hidden).toEqual(hidden);
    expect(shown.marked[className]).toHaveLength(1);
    expect(shown.marked[className]?.[0]).toMatch(/word/);
  });

  it("styles a bare address and a www address as a link", () => {
    const shown = preview(away("see https://example.com and www.example.com"));
    expect(shown.marked["cm-lp-link"]).toEqual(["https://example.com", "www.example.com"]);
    expect(shown.hidden).toEqual([]);
  });

  it("styles nested elements each", () => {
    const shown = preview(away("***word***"));
    expect(shown.marked["cm-lp-strong"]).toHaveLength(1);
    expect(shown.marked["cm-lp-emphasis"]).toHaveLength(1);
    expect(shown.hidden.join("")).toBe("******");
  });

  it("leaves the marks of an element on the line of the cursor", () => {
    const doc = "**bold** and *italic*";
    expect(preview(doc, EditorSelection.single(doc.length)).hidden).toEqual([]);
  });
});

describe("what live preview leaves as text", () => {
  it.each([
    ["an image", "![alt](/x.png)"],
    ["an image with a link inside", "[![alt](/x.png)](/target)"],
    ["raw HTML", "<b>x</b> <script>alert(1)</script> <img src=x onerror=alert(1)>"],
    ["a link to javascript:", "[a](javascript:alert(1))"],
    ["a link to javascript: written with an entity", "[a](&#x6A;avascript:alert(1))"],
    ["an autolink to javascript:", "<javascript:alert(1)>"],
  ])("%s gets no decoration", (_name, markdown) => {
    const shown = preview(away(markdown));
    if (markdown.startsWith("[![")) {
      // The outer link is a link; its text, the image, stays Markdown.
      expect(shown.hidden).toEqual(["[", "](/target)"]);
      return;
    }
    expect(shown).toEqual({ hidden: [], widgets: [], marked: {}, lines: {} });
  });
});

describe("live preview of blocks", () => {
  it("replaces the mark of a bullet item by a bullet and styles the number of a numbered item", () => {
    expect(preview(away("- one\n* two")).widgets).toEqual(["BulletWidget: -", "BulletWidget: *"]);
    const numbered = preview(away("1. one\n2. two"));
    expect(numbered.marked["cm-lp-list-mark"]).toEqual(["1.", "2."]);
    expect(numbered.hidden).toEqual([]);
  });

  it("replaces the box of a task item by a checkbox, ticked as in the text, in the place of the bullet", () => {
    const shown = preview(away("- [ ] open\n- [x] done\n- [X] done too\n1. [ ] numbered"));
    expect(shown.widgets).toEqual([
      "TaskWidget unticked: [ ]",
      "TaskWidget ticked: [x]",
      "TaskWidget ticked: [X]",
      "TaskWidget unticked: [ ]",
    ]);
    expect(shown.hidden).toEqual(["- ", "- ", "- "]);
    expect(shown.marked["cm-lp-list-mark"]).toEqual(["1."]);
  });

  it("decorates the items of a nested list", () => {
    expect(preview(away("- a\n  - b\n    1. c")).widgets).toEqual(["BulletWidget: -", "BulletWidget: -"]);
  });

  it("hides the marks of a quote and gives its lines one bar per level", () => {
    const shown = preview(away("> one\n> > two\n> three"));
    expect(shown.hidden).toEqual(["> ", "> ", "> ", "> "]);
    expect(shown.lines[1]).toBe("cm-lp-quote");
    expect(shown.lines[2]).toBe("cm-lp-quote");
    const depths = livePreviewDepths(away("> one\n> > two"));
    expect(depths).toEqual({ 1: "1", 2: "2" });
  });

  it("boxes the lines of a fenced code block and hides its fence lines", () => {
    const shown = preview(away("```js\nlet a = '**b**';\n```"));
    expect(shown.lines).toEqual({ 1: "cm-lp-hidden-line", 2: "cm-lp-code-block", 3: "cm-lp-hidden-line" });
    expect(shown.hidden).toEqual(["```js", "```"]);
    expect(shown.marked).toEqual({});
  });

  it("boxes the lines of an indented code block", () => {
    const shown = preview(away("text\n\n    code\n    more"));
    expect(shown.lines).toEqual({ 3: "cm-lp-code-block", 4: "cm-lp-code-block" });
  });

  it("replaces a horizontal rule by a line", () => {
    expect(preview(away("a\n\n---\n\nb")).widgets).toEqual(["RuleWidget: ---"]);
  });

  it("decorates no block on the lines of the cursor", () => {
    const doc = "- [ ] task\n- item\n1. one\n> quote\n---\n```\ncode\n```\n    indented";
    const shown = preview(doc, EditorSelection.single(0, doc.length));
    expect(shown).toEqual({ hidden: [], widgets: [], marked: {}, lines: {} });
  });
});

/** The depth of quotes of each decorated line, as its style sets it. */
function livePreviewDepths(doc: string): Record<number, string> {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(doc.length),
    extensions: editorExtensions(OPTIONS),
  });
  ensureSyntaxTree(state, doc.length);
  const depths: Record<number, string> = {};
  livePreviewDecorations(state, [{ from: 0, to: doc.length }]).between(0, doc.length, (from, _to, value) => {
    const style = (value.spec as { attributes?: { style?: string } }).attributes?.style;
    const depth = style && /--quote-depth: (\d+)/.exec(style)?.[1];
    if (depth) depths[state.doc.lineAt(from).number] = depth;
  });
  return depths;
}

describe("the box of a task item", () => {
  it("ticks and unticks the box in the text, as one entry of the history", () => {
    const state = EditorState.create({ doc: "- [ ] a", extensions: editorExtensions(OPTIONS) });
    const ticked = state.update(toggleTask(state, 2) ?? {}).state;
    expect(ticked.doc.toString()).toBe("- [x] a");
    const unticked = ticked.update(toggleTask(ticked, 2) ?? {}).state;
    expect(unticked.doc.toString()).toBe("- [ ] a");
    let undone = unticked;
    undo({ state: unticked, dispatch: (tr) => (undone = tr.state) });
    expect(undone.doc.toString()).toBe("- [x] a");
  });

  it("does nothing where no box starts", () => {
    expect(toggleTask(EditorState.create({ doc: "- a" }), 2)).toBeNull();
  });
});

describe("live preview of wiki links", () => {
  /**
   * What live preview shows of `doc` with the cursor at its end: the hidden texts, and each shown text with the class
   * and the hint of its decoration, or the title a widget shows in the place of the target.
   */
  function wikiPreview(doc: string, selection = EditorSelection.single(doc.length), options: EditorOptions = OPTIONS) {
    const state = EditorState.create({ doc, selection, extensions: editorExtensions(options) });
    ensureSyntaxTree(state, doc.length);
    const hidden: string[] = [];
    const shown: string[] = [];
    livePreviewDecorations(state, [{ from: 0, to: doc.length }]).between(0, doc.length, (from, to, value) => {
      const spec = value.spec as {
        class?: string;
        attributes?: { title?: string };
        widget?: { title?: string; toDOM?: unknown };
      };
      if (spec.widget?.title !== undefined) shown.push(`widget "${spec.widget.title}" for ${doc.slice(from, to)}`);
      else if (spec.class === undefined && !spec.widget) hidden.push(doc.slice(from, to));
      else if (spec.class && from < to) {
        const hint = spec.attributes?.title ? ` (${spec.attributes.title})` : "";
        shown.push(`${spec.class}: ${doc.slice(from, to)}${hint}`);
      }
    });
    return { hidden, shown };
  }

  it("shows the title of the page in place of a target without a label, with the brackets hidden", () => {
    expect(wikiPreview(away("See [[guides/setup]]."))).toEqual({
      hidden: ["[[", "]]"],
      shown: ['widget "Setup guide" for guides/setup'],
    });
  });

  it("shows the label of a link as a link, with the target and the brackets hidden", () => {
    expect(wikiPreview(away("[[guides/setup|the setup]]"))).toEqual({
      hidden: ["[[guides/setup|", "]]"],
      shown: ["cm-lp-link: the setup"],
    });
  });

  it("shows the Markdown of a wiki link on the line of the cursor", () => {
    expect(wikiPreview("[[guides/setup]] and [[faq|FAQ]]", EditorSelection.single(3))).toEqual({
      hidden: [],
      shown: [],
    });
  });

  it("marks a link to a missing page, with the hint of the page view", () => {
    expect(wikiPreview(away("[[no-such-page]] [[guides/faq|FAQ]]")).shown).toEqual([
      "cm-lp-missing-link: no-such-page (Page does not exist)",
      "cm-lp-missing-link: FAQ (Page does not exist)",
    ]);
  });

  it("marks a target that breaks the name rule and one in a tab that does not exist", () => {
    expect(wikiPreview(away("[[Setup Guide]] [[nosuchtab/setup]] [[setup#install]]")).shown).toEqual([
      "cm-lp-missing-link: Setup Guide (Not a valid page name)",
      "cm-lp-missing-link: nosuchtab/setup (Tab does not exist)",
      "cm-lp-missing-link: setup#install (Not a valid page name)",
    ]);
  });

  it("makes no wiki link in code, after a backslash or in the text of a Markdown link", () => {
    for (const doc of ["`[[guides/setup]]`", "\\[[guides/setup]]", "[a [[guides/setup]]](https://x.org)"]) {
      const { hidden, shown } = wikiPreview(away(doc));
      expect(hidden).not.toContain("[[");
      expect(shown.filter((text) => text.startsWith("widget") || text.includes("guides/setup ("))).toEqual([]);
    }
    expect(wikiPreview(away("[a [[guides/setup]]](https://x.org)")).shown).toEqual(["cm-lp-link: a [[guides/setup]]"]);
  });

  it("shows ! before a wiki link as text", () => {
    expect(wikiPreview(away("![[guides/setup]]"))).toEqual({
      hidden: ["[[", "]]"],
      shown: ['widget "Setup guide" for guides/setup'],
    });
  });

  /** The options with the image `guides/diagram.png` and the PDF `report.pdf` in the page list. */
  const WITH_FILES = {
    ...OPTIONS,
    pageList: {
      ...PAGE_LIST,
      files: [
        {
          tab: "guides",
          name: "diagram.png",
          address: "/files/f/guides/diagram.png",
          image: { width: 640, height: 480 },
        },
        { tab: null, name: "report.pdf", address: "/files/f/report.pdf", image: null },
      ],
    },
  };

  it("hides the embed of an image, whose image shows under its line, and shows its Markdown on the line of the cursor", () => {
    const doc = "![[guides/diagram.png|The network]]";
    expect(wikiPreview(away(doc), undefined, WITH_FILES)).toEqual({ hidden: [doc], shown: [] });
    expect(wikiPreview(doc, EditorSelection.single(3), WITH_FILES)).toEqual({ hidden: [], shown: [] });
  });

  it("shows a link of a file and an embed of a PDF as links with the name or the label", () => {
    expect(wikiPreview(away("[[guides/diagram.png]] ![[report.pdf|Manual]]"), undefined, WITH_FILES)).toEqual({
      hidden: ["[[", "]]", "![[report.pdf|", "]]"],
      shown: ['widget "diagram.png" for guides/diagram.png', "cm-lp-link: Manual"],
    });
  });

  it("marks a link and an embed of a missing file with the hint of the page view", () => {
    expect(wikiPreview(away("[[guides/manual.pdf]] ![[faq.png]]"), undefined, WITH_FILES).shown).toEqual([
      "cm-lp-missing-link: guides/manual.pdf (File does not exist)",
      "cm-lp-missing-link: faq.png (File does not exist)",
    ]);
  });
});
