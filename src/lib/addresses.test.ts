import { describe, expect, it } from "vitest";

import {
  accountPath,
  allPagesPath,
  changePasswordPath,
  deletedPagePath,
  deletedPagesPath,
  folderPath,
  foldersPath,
  loginPath,
  pagePath,
  parseAction,
  parseChoice,
  parsePageSegment,
  parseView,
  revokeTokenPath,
  safeNextPath,
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

  it("builds the address of the deleted pages of a folder", () => {
    expect(deletedPagesPath("handbook")).toBe("/deleted-pages/handbook");
  });

  it("builds the address of a deleted page by its id", () => {
    const id = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
    expect(deletedPagePath("handbook", id)).toBe(`/deleted-pages/handbook/${id}`);
    expect(deletedPagePath("handbook", id, "restore")).toBe(`/deleted-pages/handbook/${id}?action=restore`);
  });

  it("builds the address of the own account", () => {
    expect(accountPath()).toBe("/account");
    expect(accountPath("create")).toBe("/account?action=create");
  });

  it("builds the address of the dialog that revokes a token", () => {
    const id = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
    expect(revokeTokenPath(id)).toBe(`/account?action=revoke&token=${id}`);
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

describe("safeNextPath", () => {
  it.each([
    "/",
    "/account",
    "/folders/handbook/overview.md",
    "/folders/handbook?view=all",
    "/oauth/authorize?client_id=https%3A%2F%2Fclient.example%2Fmeta.json&state=a%2Fb#top",
    // Encoded slashes stay part of the path: the browser does not decode them into a host.
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "/folders/https://evil.example",
    "/folders\\evil.example",
  ])("accepts the path %j on this site", (next) => {
    expect(safeNextPath(next)).toBe(next);
  });

  it.each([
    ["another site", "https://evil.example"],
    ["another site with a path", "https://evil.example/folders"],
    ["a scheme-relative address", "//evil.example"],
    ["a scheme-relative address with a path", "//evil.example/folders"],
    ["a backslash that browsers read as a slash", "/\\evil.example"],
    ["a backslash before a slash", "/\\/evil.example"],
    ["two backslashes", "\\\\evil.example"],
    ["a tab that the URL parser drops", "/\t/evil.example"],
    ["a line break that the URL parser drops", "/\n/evil.example"],
    ["a carriage return", "/\r/evil.example"],
    ["a null character", "/folders\u0000"],
    ["the delete character", "/folders\u007f"],
    ["a relative path", "folders"],
    ["a path that starts with a dot", "./folders"],
    ["a script", "javascript:alert(1)"],
    ["a data address", "data:text/html,hello"],
    ["a space before the slash", " /folders"],
    ["an empty value", ""],
  ])("gives the folder list for %s", (_case, next) => {
    expect(safeNextPath(next)).toBe("/folders");
  });

  it("gives the folder list for a missing or repeated value", () => {
    expect(safeNextPath(undefined)).toBe("/folders");
    expect(safeNextPath(null)).toBe("/folders");
    expect(safeNextPath(["/account", "/users"])).toBe("/folders");
    expect(safeNextPath(["/account"])).toBe("/folders");
  });

  it("accepts a path of 2048 characters and gives the folder list for a longer one", () => {
    const longest = `/${"a".repeat(2047)}`;

    expect(safeNextPath(longest)).toBe(longest);
    expect(safeNextPath(`${longest}a`)).toBe("/folders");
  });
});

describe("loginPath and changePasswordPath", () => {
  it("build the plain address without a way back", () => {
    expect(loginPath()).toBe("/login");
    expect(changePasswordPath()).toBe("/change-password");
    expect(loginPath(null)).toBe("/login");
    expect(changePasswordPath(undefined)).toBe("/change-password");
  });

  it("carry the way back as an encoded search parameter", () => {
    expect(loginPath("/account")).toBe("/login?next=%2Faccount");
    expect(changePasswordPath("/account")).toBe("/change-password?next=%2Faccount");
    expect(loginPath("/oauth/authorize?client_id=abc&state=x%2Fy")).toBe(
      "/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dabc%26state%3Dx%252Fy",
    );
  });

  it("the encoded way back reads back as it was", () => {
    const next = "/oauth/authorize?client_id=abc&state=x%2Fy&scope=read write";

    expect(new URL(loginPath(next), "http://localhost").searchParams.get("next")).toBe(next);
  });

  it("leave out the folder list, where a login leads anyway", () => {
    expect(loginPath("/folders")).toBe("/login");
    expect(changePasswordPath("/folders")).toBe("/change-password");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", `/${"a".repeat(2048)}`])(
    "leave out the way back %j to another site or of too many characters",
    (next) => {
      expect(loginPath(next)).toBe("/login");
      expect(changePasswordPath(next)).toBe("/change-password");
    },
  );
});
