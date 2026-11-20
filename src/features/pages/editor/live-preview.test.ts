import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "@/features/pages/editor/extensions";
import { livePreviewDecorations } from "@/features/pages/editor/live-preview";

const OPTIONS = { newPage: false, labelId: "label", descriptionId: "description" };

/** What a decoration does: hides text, styles text with a class, or styles a line with a class. */
type Shown = { hidden: string[]; marked: Record<string, string[]>; lines: Record<number, string> };

/**
 * The decorations of live preview for `doc` with the cursor at `cursor` (the end of the document by default, on a line
 * of its own), or with the given selection: the hidden texts, the texts of each class, and the classes of the lines.
 */
function preview(doc: string, selection = EditorSelection.single(doc.length)): Shown {
  const state = EditorState.create({ doc, selection, extensions: editorExtensions(OPTIONS) });
  ensureSyntaxTree(state, doc.length);
  const shown: Shown = { hidden: [], marked: {}, lines: {} };
  livePreviewDecorations(state, [{ from: 0, to: doc.length }]).between(0, doc.length, (from, to, value) => {
    const className = (value.spec as { class?: string }).class;
    if (className === undefined) shown.hidden.push(doc.slice(from, to));
    else if (from === to) shown.lines[state.doc.lineAt(from).number] = className;
    else (shown.marked[className] ??= []).push(doc.slice(from, to));
  });
  return shown;
}

/** A document whose last line is empty, so that the cursor at its end is on no line of the content before it. */
const away = (content: string) => `${content}\n\n`;

describe("live preview of headings (R3, R6)", () => {
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

describe("live preview of inline elements (R6, R7)", () => {
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

describe("what live preview leaves as text (R9, R10, R31)", () => {
  it.each([
    ["an image", "![alt](/x.png)"],
    ["an image with a link inside", "[![alt](/x.png)](/target)"],
    ["raw HTML", "<b>x</b> <script>alert(1)</script> <img src=x onerror=alert(1)>"],
    ["a link to javascript:", "[a](javascript:alert(1))"],
    ["an autolink to javascript:", "<javascript:alert(1)>"],
  ])("%s gets no decoration", (_name, markdown) => {
    const shown = preview(away(markdown));
    if (markdown.startsWith("[![")) {
      // The outer link is a link; its text, the image, stays Markdown.
      expect(shown.hidden).toEqual(["[", "](/target)"]);
      return;
    }
    expect(shown).toEqual({ hidden: [], marked: {}, lines: {} });
  });
});
