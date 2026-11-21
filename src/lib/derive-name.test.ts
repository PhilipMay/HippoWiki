import { describe, expect, it } from "vitest";

import { deriveName } from "@/lib/derive-name";
import { NAME_MAX_LENGTH } from "@/lib/name-limits";
import { parseName } from "@/lib/names";

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
