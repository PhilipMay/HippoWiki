import { describe, expect, it } from "vitest";

import { linkDestination } from "@/features/pages/editor/link-address";
import { parseMarkdown } from "@/features/pages/markdown";

/** The address that the page view links to for a link with the destination, or `null` where it makes no link. */
function pageViewAddress(destination: string): string | null {
  const tokens = parseMarkdown(`[a](${destination})`);
  const inline = tokens.find((token) => token.type === "inline");
  const open = inline?.children?.find((token) => token.type === "link_open");
  const href = open?.attrGet("href");
  return typeof href === "string" ? href : null;
}

describe("linkDestination", () => {
  it("decodes backslash escapes", () => {
    expect(linkDestination("/folders/handbook/a\\_b.md")).toBe("/folders/handbook/a_b.md");
    expect(linkDestination("a\\\\b")).toBe("a\\b");
  });

  it("decodes named and numeric entities, strictly with their semicolon", () => {
    expect(linkDestination("/folders/handbook/c&amp;d.md")).toBe("/folders/handbook/c&d.md");
    expect(linkDestination("&#x6A;avascript:alert(3)")).toBe("javascript:alert(3)");
    expect(linkDestination("&#106;avascript:x")).toBe("javascript:x");
    expect(linkDestination("a&ampb")).toBe("a&ampb");
    expect(linkDestination("a&nosuchentity;b")).toBe("a&nosuchentity;b");
  });

  it("keeps a numeric entity of a code point that markdown-it does not decode", () => {
    expect(linkDestination("a&#0;b")).toBe("a&#0;b");
    expect(linkDestination("a&#xD800;b")).toBe("a&#xD800;b");
  });

  it("does not decode an entity that a backslash escapes", () => {
    expect(linkDestination("a\\&amp;b")).toBe("a&amp;b");
  });

  it("takes the address out of angle brackets", () => {
    expect(linkDestination("<a b.md>")).toBe("a b.md");
  });

  it("gives the address of the page view, before its percent-encoding", () => {
    for (const destination of ["/folders/handbook/a\\_b.md", "/folders/handbook/c&amp;d.md", "https://example.com/x"]) {
      expect(pageViewAddress(destination)).toBe(linkDestination(destination));
    }
    expect(pageViewAddress("&#x6A;avascript:alert(3)")).toBeNull();
  });
});
