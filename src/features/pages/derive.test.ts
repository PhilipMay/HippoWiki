import { describe, expect, it } from "vitest";

import { deriveName, titleFromContent } from "@/features/pages/derive";
import { TITLE_MAX_LENGTH } from "@/features/pages/limits";
import { NAME_MAX_LENGTH, parseName } from "@/lib/names";

describe("titleFromContent", () => {
  it("takes the text of a leading level-one heading", () => {
    expect(titleFromContent("# Title")).toBe("Title");
    expect(titleFromContent("# Title\n\nSome text\n\n# Later")).toBe("Title");
  });

  it("allows blank lines before the heading", () => {
    expect(titleFromContent("\n\n  \n# Title")).toBe("Title");
  });

  it("allows up to three leading spaces and a tab after the hash", () => {
    expect(titleFromContent("   # Indented")).toBe("Indented");
    expect(titleFromContent("#\tTabbed")).toBe("Tabbed");
  });

  it("removes a closing sequence", () => {
    expect(titleFromContent("# Title #")).toBe("Title");
    expect(titleFromContent("# Title ###   ")).toBe("Title");
    // Without a space before it, the # belongs to the text.
    expect(titleFromContent("# C#")).toBe("C#");
  });

  it("reduces inline Markdown to its text", () => {
    expect(titleFromContent("# *Emphasis* and **strong**")).toBe("Emphasis and strong");
    expect(titleFromContent("# ~~Struck~~ text")).toBe("Struck text");
    expect(titleFromContent("# The `npm run` command")).toBe("The npm run command");
    expect(titleFromContent("# Read [the guide](https://example.com)")).toBe("Read the guide");
    expect(titleFromContent("# Logo ![HippoWiki](logo.png)")).toBe("Logo HippoWiki");
  });

  it("keeps raw HTML as typed text", () => {
    expect(titleFromContent("# A <b>bold</b> title")).toBe("A <b>bold</b> title");
  });

  it("collapses whitespace inside the heading", () => {
    expect(titleFromContent("#   Lots \t of   space   ")).toBe("Lots of space");
  });

  it("cuts a long heading to the title limit", () => {
    expect(titleFromContent(`# ${"a".repeat(300)}`)).toBe("a".repeat(TITLE_MAX_LENGTH));
  });

  it("does not split a surrogate pair at the cut", () => {
    expect(titleFromContent(`# ${"a".repeat(TITLE_MAX_LENGTH - 1)}😀`)).toBe("a".repeat(TITLE_MAX_LENGTH - 1));
  });

  it("handles CRLF line breaks", () => {
    expect(titleFromContent("\r\n# Title\r\nMore text\r\n")).toBe("Title");
  });

  it("returns null for empty content", () => {
    expect(titleFromContent("")).toBeNull();
    expect(titleFromContent("\n \n\t\n")).toBeNull();
  });

  it("returns null when another block comes before the heading", () => {
    expect(titleFromContent("Intro text\n\n# Title")).toBeNull();
    expect(titleFromContent("- item\n\n# Title")).toBeNull();
    expect(titleFromContent("```\ncode\n```\n\n# Title")).toBeNull();
    expect(titleFromContent("```\n# Not a title\n```")).toBeNull();
    expect(titleFromContent("> quote\n\n# Title")).toBeNull();
    expect(titleFromContent("<div>html</div>\n\n# Title")).toBeNull();
  });

  it("returns null for headings that are not a level-one ATX heading", () => {
    expect(titleFromContent("## Section\n\n# Title")).toBeNull();
    expect(titleFromContent("Title\n=====")).toBeNull();
    expect(titleFromContent("#NoSpace")).toBeNull();
    expect(titleFromContent("\\# Title")).toBeNull();
    expect(titleFromContent("    # Title")).toBeNull();
  });

  it("returns null for a heading without a letter or digit", () => {
    expect(titleFromContent("#")).toBeNull();
    expect(titleFromContent("#   \nText")).toBeNull();
    expect(titleFromContent("# **")).toBeNull();
    expect(titleFromContent("# ##")).toBeNull();
    expect(titleFromContent("# ...")).toBeNull();
    expect(titleFromContent("# 🎉")).toBeNull();
    expect(titleFromContent("# ![](logo.png)")).toBeNull();
  });

  it("accepts a title with a letter or digit in any script", () => {
    expect(titleFromContent("# 2026")).toBe("2026");
    expect(titleFromContent("# Über Größen")).toBe("Über Größen");
    expect(titleFromContent("# 日本語")).toBe("日本語");
    expect(titleFromContent("# 🎉 Party")).toBe("🎉 Party");
  });
});

describe("deriveName", () => {
  it("spells out German umlauts and ß", () => {
    expect(deriveName("Übersicht Größen")).toBe("uebersicht-groessen");
  });

  it("drops other accents", () => {
    expect(deriveName("Café & Crème")).toBe("cafe-creme");
  });

  it("collapses separators and trims hyphens", () => {
    expect(deriveName("  --Hello,   World!--  ")).toBe("hello-world");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(deriveName("日本語")).toBe("");
    expect(deriveName("")).toBe("");
    expect(deriveName("!?")).toBe("");
  });

  it("cuts a long name at a word boundary", () => {
    const title = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    expect(title.length).toBeGreaterThanOrEqual(120);
    const name = deriveName(title);
    expect(name.length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
    expect(name).not.toMatch(/-$/);
    // The name is a prefix of the uncut name that ends where a word ends.
    const uncut = title.replaceAll(" ", "-");
    expect(uncut.startsWith(name)).toBe(true);
    expect(uncut[name.length]).toBe("-");
  });

  it("keeps an exactly fitting last word", () => {
    const title = `${"a".repeat(39)} ${"b".repeat(40)} c`;
    expect(deriveName(title)).toBe(`${"a".repeat(39)}-${"b".repeat(40)}`);
  });

  it("cuts hard when there is no word boundary", () => {
    expect(deriveName("a".repeat(120))).toBe("a".repeat(NAME_MAX_LENGTH));
  });

  it("always produces a valid name or an empty string", () => {
    for (const title of [
      "Getting started",
      "Über Größen",
      "C++ & C# — a comparison",
      "  ---  ",
      "Ångström ﬁle ①",
      "İstanbul",
      "日本語 and English",
      "x".repeat(200),
      `${"word ".repeat(40)}`,
    ]) {
      const name = deriveName(title);
      if (name !== "") expect(parseName(name)).toBe(name);
      expect(name.length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
    }
  });
});
