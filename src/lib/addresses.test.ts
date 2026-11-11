import { describe, expect, it } from "vitest";

import {
  allPagesPath,
  folderPath,
  foldersPath,
  pagePath,
  parseAction,
  parseChoice,
  parsePageSegment,
  parseView,
  tabPath,
} from "@/lib/addresses";

describe("paths", () => {
  it("builds the address of the folder list", () => {
    expect(foldersPath()).toBe("/folders");
    expect(foldersPath("new")).toBe("/folders?action=new");
  });

  it("builds the address of a folder", () => {
    expect(folderPath("handbook")).toBe("/folders/handbook");
    expect(folderPath("handbook", "rename")).toBe("/folders/handbook?action=rename");
  });

  it("builds the address of the list of all pages of a folder", () => {
    expect(allPagesPath("handbook")).toBe("/folders/handbook?view=all");
  });

  it("builds the address of a tab", () => {
    expect(tabPath("handbook", "guides")).toBe("/folders/handbook/guides");
    expect(tabPath("handbook", "guides", "new")).toBe("/folders/handbook/guides?action=new");
  });

  it("builds the address of a page placed directly in a folder", () => {
    expect(pagePath("handbook", null, "overview")).toBe("/folders/handbook/overview.md");
    expect(pagePath("handbook", null, "overview", "edit")).toBe("/folders/handbook/overview.md?action=edit");
  });

  it("builds the address of a page in a tab", () => {
    expect(pagePath("handbook", "guides", "overview")).toBe("/folders/handbook/guides/overview.md");
    expect(pagePath("handbook", "guides", "overview", "move")).toBe("/folders/handbook/guides/overview.md?action=move");
  });
});

describe("parsePageSegment", () => {
  it("returns the name of a segment that ends in .md", () => {
    expect(parsePageSegment("overview.md")).toBe("overview");
    expect(parsePageSegment("release-notes-2026.md")).toBe("release-notes-2026");
    expect(parsePageSegment("md.md")).toBe("md");
  });

  it("returns null without the suffix", () => {
    expect(parsePageSegment("overview")).toBeNull();
    expect(parsePageSegment("overviewmd")).toBeNull();
  });

  it("accepts only the lowercase suffix", () => {
    expect(parsePageSegment("overview.MD")).toBeNull();
    expect(parsePageSegment("overview.Md")).toBeNull();
  });

  it("returns null for a repeated suffix", () => {
    expect(parsePageSegment("overview.md.md")).toBeNull();
  });

  it("returns null for an invalid name", () => {
    for (const segment of [".md", "Overview.md", "a--b.md", "a b.md", " overview.md", "overview.md "]) {
      expect(parsePageSegment(segment)).toBeNull();
    }
  });
});

describe("parseAction", () => {
  const allowed = ["new", "rename"] as const;

  it("returns null without an action", () => {
    expect(parseAction({}, allowed)).toBeNull();
    expect(parseAction({ other: "new" }, allowed)).toBeNull();
  });

  it("returns an allowed action", () => {
    expect(parseAction({ action: "new" }, allowed)).toBe("new");
    expect(parseAction({ action: "rename", other: "x" }, allowed)).toBe("rename");
  });

  it("reports an unknown action as invalid", () => {
    for (const action of ["delete", "New", "new ", ""]) {
      expect(parseAction({ action }, allowed)).toBe("invalid");
    }
    expect(parseAction({ action: "new" }, [])).toBe("invalid");
  });

  it("reports a repeated action as invalid", () => {
    expect(parseAction({ action: ["new", "new"] }, allowed)).toBe("invalid");
    expect(parseAction({ action: ["new", "rename"] }, allowed)).toBe("invalid");
  });
});

describe("parseChoice", () => {
  it("reads the given search parameter", () => {
    expect(parseChoice({ view: "all" }, "view", ["all"])).toBe("all");
    expect(parseChoice({ action: "all" }, "view", ["all"])).toBeNull();
    expect(parseChoice({ view: "some" }, "view", ["all"])).toBe("invalid");
  });
});

describe("parseView", () => {
  it("returns null without a view", () => {
    expect(parseView({}, ["all"])).toBeNull();
    expect(parseView({ action: "all" }, ["all"])).toBeNull();
    expect(parseView({})).toBeNull();
  });

  it("returns an allowed view", () => {
    expect(parseView({ view: "all" }, ["all"])).toBe("all");
  });

  it("reports an unknown, empty or repeated view as invalid", () => {
    for (const view of ["some", "All", ""]) expect(parseView({ view }, ["all"])).toBe("invalid");
    expect(parseView({ view: ["all", "all"] }, ["all"])).toBe("invalid");
  });

  it("reports any view as invalid on an address without views", () => {
    expect(parseView({ view: "all" })).toBe("invalid");
  });
});
