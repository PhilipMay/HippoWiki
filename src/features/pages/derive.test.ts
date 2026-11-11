import { describe, expect, it } from "vitest";

import { deriveSlug, deriveTitle } from "@/features/pages/derive";
import { SLUG_MAX_LENGTH, SLUG_PATTERN, TITLE_MAX_LENGTH } from "@/features/pages/schema";

describe("deriveTitle", () => {
  it("takes the text of a level-one heading", () => {
    expect(deriveTitle("# Title\n\nSome text")).toBe("Title");
  });

  it("removes a closing sequence", () => {
    expect(deriveTitle("### Title ###")).toBe("Title");
    expect(deriveTitle("## Title #   ")).toBe("Title");
    // Without a space before it, the # belongs to the text.
    expect(deriveTitle("# C#")).toBe("C#");
  });

  it("finds a heading after a paragraph", () => {
    expect(deriveTitle("Intro paragraph.\n\n## Getting started\n\n# Later")).toBe("Getting started");
  });

  it("skips headings inside fenced code blocks", () => {
    expect(deriveTitle("```sh\n# not a title\n```\n\n# Real title")).toBe("Real title");
    expect(deriveTitle("~~~\n# not a title\n~~~\n# Real title")).toBe("Real title");
    // A shorter or different fence does not close the block.
    expect(deriveTitle("````\n```\n~~~~\n# inside\n````\n# Outside")).toBe("Outside");
  });

  it("treats everything after an unclosed fence as code", () => {
    expect(deriveTitle("```\n# inside")).toBe("");
  });

  it("does not treat a backtick line with backticks in its info string as a fence", () => {
    expect(deriveTitle("``` a ` b\n# Title")).toBe("Title");
  });

  it("requires a space after the hashes", () => {
    expect(deriveTitle("#NoSpace")).toBe("");
    expect(deriveTitle("#NoSpace\n# Title")).toBe("Title");
  });

  it("accepts up to three leading spaces", () => {
    expect(deriveTitle("   # Indented")).toBe("Indented");
    expect(deriveTitle("    # Code\n# Title")).toBe("Title");
  });

  it("does not accept more than six hashes", () => {
    expect(deriveTitle("####### Seven\n###### Six")).toBe("Six");
  });

  it("handles CRLF line breaks", () => {
    expect(deriveTitle("Text\r\n# Title\r\nMore")).toBe("Title");
  });

  it("returns an empty string without a heading", () => {
    expect(deriveTitle("")).toBe("");
    expect(deriveTitle("Just text.\n\n- a list")).toBe("");
  });

  it("cuts a long heading to the title limit", () => {
    const title = deriveTitle(`# ${"a".repeat(300)}`);
    expect(title).toBe("a".repeat(TITLE_MAX_LENGTH));
  });

  it("does not split a surrogate pair at the cut", () => {
    const title = deriveTitle(`# ${"a".repeat(TITLE_MAX_LENGTH - 1)}😀`);
    expect(title).toBe("a".repeat(TITLE_MAX_LENGTH - 1));
  });
});

describe("deriveSlug", () => {
  it("spells out German umlauts and ß", () => {
    expect(deriveSlug("Übersicht Größen")).toBe("uebersicht-groessen");
  });

  it("drops other accents", () => {
    expect(deriveSlug("Café & Crème")).toBe("cafe-creme");
  });

  it("collapses separators and trims hyphens", () => {
    expect(deriveSlug("  --Hello,   World!--  ")).toBe("hello-world");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(deriveSlug("日本語")).toBe("");
    expect(deriveSlug("")).toBe("");
    expect(deriveSlug("!?")).toBe("");
  });

  it("cuts a long slug at a word boundary", () => {
    const title = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    expect(title.length).toBeGreaterThanOrEqual(120);
    const slug = deriveSlug(title);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug).not.toMatch(/-$/);
    // The slug is a prefix of the uncut slug that ends where a word ends.
    const uncut = title.replaceAll(" ", "-");
    expect(uncut.startsWith(slug)).toBe(true);
    expect(uncut[slug.length]).toBe("-");
  });

  it("keeps an exactly fitting last word", () => {
    const title = `${"a".repeat(39)} ${"b".repeat(40)} c`;
    expect(deriveSlug(title)).toBe(`${"a".repeat(39)}-${"b".repeat(40)}`);
  });

  it("cuts hard when there is no word boundary", () => {
    expect(deriveSlug("a".repeat(120))).toBe("a".repeat(SLUG_MAX_LENGTH));
  });

  it("always produces a valid slug or an empty string", () => {
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
      const slug = deriveSlug(title);
      if (slug !== "") expect(slug).toMatch(SLUG_PATTERN);
      expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    }
  });
});
