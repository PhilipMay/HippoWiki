import { describe, expect, it } from "vitest";

import { pageTitle, siteName } from "@/lib/site";

describe("pageTitle", () => {
  it("returns the site name without a title", () => {
    expect(pageTitle()).toBe(siteName);
    expect(pageTitle("   ")).toBe(siteName);
  });

  it("prefixes the site name with a trimmed title", () => {
    expect(pageTitle("  Welcome ")).toBe("Welcome – HippoWiki");
  });
});
