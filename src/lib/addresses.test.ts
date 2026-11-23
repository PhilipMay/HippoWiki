import { describe, expect, it } from "vitest";

import {
  CHANGED_NOTICE,
  accountNoticePath,
  accountPath,
  allPagesPath,
  changePasswordPath,
  deletedPageComparePath,
  deletedPageHistoryPath,
  deletedItemPath,
  deletedPageRevisionPath,
  deletedItemsPath,
  deletedItemsRootPath,
  fileContentPath,
  fileLinkPath,
  filePath,
  isFileLinkRequest,
  parseFileSegment,
  parseUploadName,
  uploadFilePath,
  folderMcpPath,
  folderPath,
  hasSearchWords,
  homePath,
  folderRolesOverviewPath,
  folderRolesPath,
  foldersPath,
  landingPath,
  loginPath,
  mcpFolderPath,
  oauthAuthorizePath,
  oauthRegisterPath,
  oauthTokenPath,
  PAGE_NOTICES,
  pageComparePath,
  pageHistoryPath,
  pageLabel,
  pagePath,
  pageRevertPath,
  pageRevisionPath,
  uploadPath,
  uploadLinkPath,
  parseAccountNotice,
  parseAction,
  parseChoice,
  parsePageSegment,
  parseSearchWords,
  parseView,
  protectedResourceMetadataPath,
  revokeAppPath,
  safeNextPath,
  searchPath,
  tabPath,
  newPagePath,
  parseNewPageName,
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

  it("builds the address of the overview of the folder roles", () => {
    expect(folderRolesOverviewPath()).toBe("/folder-roles");
  });

  it("builds the address of the roles of a folder", () => {
    expect(folderRolesPath("handbook")).toBe("/folders/handbook?view=roles");
  });

  it("builds the address of the results of a search in a folder, with the words encoded as typed", () => {
    expect(searchPath("handbook", "backup")).toBe("/folders/handbook?view=search&q=backup");
    expect(searchPath("handbook", ' "backup server" -old & more ')).toBe(
      "/folders/handbook?view=search&q=%20%22backup%20server%22%20-old%20%26%20more%20",
    );
    expect(searchPath("handbook", "Häuser #1 ?")).toBe("/folders/handbook?view=search&q=H%C3%A4user%20%231%20%3F");
  });

  it("builds the address of a tab", () => {
    expect(tabPath("handbook", "guides")).toBe("/folders/handbook/guides");
    expect(tabPath("handbook", "guides", "new")).toBe("/folders/handbook/guides?action=new");
  });

  it("builds the address of the editor of a new page, with and without a preset name", () => {
    expect(newPagePath("handbook", null)).toBe("/folders/handbook?action=new");
    expect(newPagePath("handbook", null, "faq")).toBe("/folders/handbook?action=new&name=faq");
    expect(newPagePath("handbook", "guides")).toBe("/folders/handbook/guides?action=new");
    expect(newPagePath("handbook", "guides", "faq")).toBe("/folders/handbook/guides?action=new&name=faq");
  });

  it("reads the preset name of a new page", () => {
    expect(parseNewPageName({})).toBeNull();
    expect(parseNewPageName({ name: "faq" })).toBe("faq");
    for (const name of ["", " faq", "FAQ", "faq.md", "a/b", "x".repeat(81)]) {
      expect(parseNewPageName({ name }), name).toBe("invalid");
    }
    expect(parseNewPageName({ name: ["faq", "faq"] })).toBe("invalid");
  });

  it("builds the address of a page placed directly in a folder", () => {
    expect(pagePath("handbook", null, "overview")).toBe("/folders/handbook/overview.md");
    expect(pagePath("handbook", null, "overview", "edit")).toBe("/folders/handbook/overview.md?action=edit");
  });

  it("builds the address of a page in a tab", () => {
    expect(pagePath("handbook", "guides", "overview")).toBe("/folders/handbook/guides/overview.md");
    expect(pagePath("handbook", "guides", "overview", "move")).toBe("/folders/handbook/guides/overview.md?action=move");
  });

  it("builds the address of a page with an action and a notice", () => {
    expect(pagePath("handbook", null, "overview", "edit", CHANGED_NOTICE)).toBe(
      "/folders/handbook/overview.md?action=edit&notice=changed",
    );
    expect(pagePath("handbook", "guides", "overview", "delete", "changed")).toBe(
      "/folders/handbook/guides/overview.md?action=delete&notice=changed",
    );
    expect(pagePath("handbook", null, "overview", undefined, "changed")).toBe(
      "/folders/handbook/overview.md?notice=changed",
    );
    expect(PAGE_NOTICES).toEqual(["changed"]);
  });

  it("builds the address of the details page of a file, placed directly in a folder and in a tab", () => {
    expect(filePath("handbook", null, "diagram.png")).toBe("/folders/handbook/diagram.png");
    expect(filePath("handbook", "guides", "manual.pdf")).toBe("/folders/handbook/guides/manual.pdf");
    expect(filePath("handbook", "guides", "manual.pdf", "upload-version")).toBe(
      "/folders/handbook/guides/manual.pdf?action=upload-version",
    );
  });

  it("builds the address of the upload dialog of a folder and of a tab, with a preset name", () => {
    expect(uploadFilePath("handbook", null)).toBe("/folders/handbook?action=upload");
    expect(uploadFilePath("handbook", "guides", "manual.pdf")).toBe(
      "/folders/handbook/guides?action=upload&name=manual.pdf",
    );
  });

  it("reads the preset name of the upload dialog by the rule of file names", () => {
    expect(parseUploadName({})).toBeNull();
    expect(parseUploadName({ name: "manual.pdf" })).toBe("manual.pdf");
    for (const name of ["manual", "Manual.pdf", "photo.jpeg", "", " a.png", ["a.png", "a.png"]]) {
      expect(parseUploadName({ name }), JSON.stringify(name)).toBe("invalid");
    }
  });

  it("reads a segment as a file name only with the extension of a type", () => {
    expect(parseFileSegment("diagram.png")).toBe("diagram.png");
    expect(parseFileSegment("manual.pdf")).toBe("manual.pdf");
    for (const segment of ["diagram", "setup.md", "Diagram.png", "photo.jpeg", "a.b.png", "guides"]) {
      expect(parseFileSegment(segment), segment).toBeNull();
    }
  });

  it("builds the address of a file itself, of a version of it and of its download", () => {
    expect(fileContentPath("handbook", null, "diagram.png")).toBe("/files/handbook/diagram.png");
    expect(fileContentPath("handbook", "guides", "diagram.png")).toBe("/files/handbook/guides/diagram.png");
    expect(fileContentPath("handbook", "guides", "diagram.png", { version: 2 })).toBe(
      "/files/handbook/guides/diagram.png?version=2",
    );
    expect(fileContentPath("handbook", null, "manual.pdf", { download: true })).toBe(
      "/files/handbook/manual.pdf?download",
    );
    expect(fileContentPath("handbook", null, "manual.pdf", { version: 1, download: true })).toBe(
      "/files/handbook/manual.pdf?version=1&download",
    );
  });

  it("builds the address of a file with the token of a signed link as its only query", () => {
    expect(fileLinkPath("handbook", null, "diagram.png", "abc.def")).toBe("/files/handbook/diagram.png?token=abc.def");
    expect(fileLinkPath("handbook", "guides", "manual.pdf", "a-b_c.d")).toBe(
      "/files/handbook/guides/manual.pdf?token=a-b_c.d",
    );
  });

  it("tells a read of a file by a signed link by the query token below /files/", () => {
    const query = (value: string) => new URLSearchParams(value);
    expect(isFileLinkRequest("/files/handbook/diagram.png", query("token=x"))).toBe(true);
    expect(isFileLinkRequest("/files/handbook/guides/diagram.png", query("token=&download"))).toBe(true);
    expect(isFileLinkRequest("/files/handbook/diagram.png", query("download"))).toBe(false);
    expect(isFileLinkRequest("/folders/handbook/diagram.png", query("token=x"))).toBe(false);
    expect(isFileLinkRequest("/files", query("token=x"))).toBe(false);
    expect(isFileLinkRequest("/filesx/a.png", query("token=x"))).toBe(false);
  });

  it("builds the upload address of a file, with the metadata kept and as a new version", () => {
    expect(uploadPath("handbook", null, "diagram.png")).toBe("/api/uploads/handbook/diagram.png");
    expect(uploadPath("handbook", "guides", "photo.jpg", { keepMetadata: true })).toBe(
      "/api/uploads/handbook/guides/photo.jpg?strip=0",
    );
    expect(uploadPath("handbook", "guides", "photo.jpg", { keepMetadata: true, replace: 4 })).toBe(
      "/api/uploads/handbook/guides/photo.jpg?strip=0&replace=4",
    );
    expect(uploadPath("handbook", null, "manual.pdf", { replace: 2 })).toBe(
      "/api/uploads/handbook/manual.pdf?replace=2",
    );
  });

  it("builds the upload address of a signed upload link with the token as its only query", () => {
    expect(uploadLinkPath("handbook", null, "diagram.png", "abc.def")).toBe(
      "/api/uploads/handbook/diagram.png?token=abc.def",
    );
    expect(uploadLinkPath("handbook", "guides", "manual.pdf", "a-b_c.d")).toBe(
      "/api/uploads/handbook/guides/manual.pdf?token=a-b_c.d",
    );
  });

  it("builds the address of the deleted items of a folder", () => {
    expect(deletedItemsPath("handbook")).toBe("/deleted-items/handbook");
  });

  it("builds the address of a deleted page by its id", () => {
    const id = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
    expect(deletedItemPath("handbook", id)).toBe(`/deleted-items/handbook/${id}`);
    expect(deletedItemPath("handbook", id, "restore")).toBe(`/deleted-items/handbook/${id}?action=restore`);
  });

  it("builds the address of the view AI apps of a folder", () => {
    expect(folderMcpPath("handbook")).toBe("/folders/handbook?view=mcp");
  });

  it("builds the MCP address of a folder for a role", () => {
    const id = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
    expect(mcpFolderPath(id, "reader")).toBe(`/mcp/${id}/reader`);
    expect(mcpFolderPath(id, "writer")).toBe(`/mcp/${id}/writer`);
  });

  it("builds the addresses of OAuth", () => {
    expect(oauthAuthorizePath()).toBe("/oauth/authorize");
    expect(oauthTokenPath()).toBe("/oauth/token");
    expect(oauthRegisterPath()).toBe("/oauth/register");
    const id = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
    expect(protectedResourceMetadataPath(id, "writer")).toBe(`/.well-known/oauth-protected-resource/mcp/${id}/writer`);
  });

  it("builds the roots of the addresses: the home page, the folders and the deleted items", () => {
    expect(homePath()).toBe("/");
    expect(foldersPath()).toBe("/folders");
    expect(deletedItemsRootPath()).toBe("/deleted-items");
    expect(deletedItemsPath("handbook").startsWith(`${deletedItemsRootPath()}/`)).toBe(true);
  });

  it("builds the address of the own account", () => {
    expect(accountPath()).toBe("/account");
    expect(accountPath("revoke")).toBe("/account?action=revoke");
    expect(accountPath("change-password")).toBe("/account?action=change-password");
    expect(accountNoticePath("password-changed")).toBe("/account?notice=password-changed");
    expect(accountPath("log-out-others")).toBe("/account?action=log-out-others");
    expect(accountNoticePath("other-browsers-logged-out")).toBe("/account?notice=other-browsers-logged-out");
  });

  it("builds the address of the history of a page, with the revisions before a number", () => {
    expect(pageHistoryPath("handbook", null, "intro")).toBe("/folders/handbook/intro.md?view=history");
    expect(pageHistoryPath("handbook", "guides", "setup", 151)).toBe(
      "/folders/handbook/guides/setup.md?view=history&before=151",
    );
  });

  it("builds the address of a revision of a page, rendered and raw", () => {
    expect(pageRevisionPath("handbook", null, "intro", 5)).toBe("/folders/handbook/intro.md?view=revision&revision=5");
    expect(pageRevisionPath("handbook", "guides", "setup", 1, true)).toBe(
      "/folders/handbook/guides/setup.md?view=revision&revision=1&format=raw",
    );
  });

  it("builds the address of the comparison of two revisions of a page", () => {
    expect(pageComparePath("handbook", null, "intro", 4, 5)).toBe(
      "/folders/handbook/intro.md?view=compare&from=4&to=5",
    );
    expect(pageComparePath("handbook", "guides", "setup", 5, 2)).toBe(
      "/folders/handbook/guides/setup.md?view=compare&from=5&to=2",
    );
  });

  it("builds the address of the Revert page dialog of a revision, with a notice after it", () => {
    expect(pageRevertPath("handbook", null, "intro", 2)).toBe("/folders/handbook/intro.md?action=revert&revision=2");
    expect(pageRevertPath("handbook", "guides", "setup", 3, CHANGED_NOTICE)).toBe(
      "/folders/handbook/guides/setup.md?action=revert&revision=3&notice=changed",
    );
  });

  it("builds the addresses of the history, a revision and a comparison of a deleted page", () => {
    const id = "9c4d2b7e-1a3f-4c5d-8e6f-7a8b9c0d1e22";
    expect(deletedPageHistoryPath("handbook", id)).toBe(`/deleted-items/handbook/${id}?view=history`);
    expect(deletedPageHistoryPath("handbook", id, 151)).toBe(`/deleted-items/handbook/${id}?view=history&before=151`);
    expect(deletedPageRevisionPath("handbook", id, 2)).toBe(`/deleted-items/handbook/${id}?view=revision&revision=2`);
    expect(deletedPageRevisionPath("handbook", id, 2, true)).toBe(
      `/deleted-items/handbook/${id}?view=revision&revision=2&format=raw`,
    );
    expect(deletedPageComparePath("handbook", id, 1, 3)).toBe(`/deleted-items/handbook/${id}?view=compare&from=1&to=3`);
  });

  it("builds the address of the dialog that revokes a connected app", () => {
    const id = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
    expect(revokeAppPath(id)).toBe(`/account?action=revoke&app=${id}`);
  });
});

describe("pageLabel", () => {
  it("names a page with .md after its name, as its address does", () => {
    expect(pageLabel("overview")).toBe("overview.md");
    expect(parsePageSegment(pageLabel("release-notes"))).toBe("release-notes");
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

describe("parseAccountNotice", () => {
  it("returns null without a notice", () => {
    expect(parseAccountNotice({})).toBeNull();
    expect(parseAccountNotice({ action: "change-password" })).toBeNull();
  });

  it("reads a known notice without an action", () => {
    expect(parseAccountNotice({ notice: "password-changed" })).toBe("password-changed");
  });

  it.each([
    ["an unknown notice", { notice: "anything" }],
    ["an empty notice", { notice: "" }],
    ["a repeated notice", { notice: ["password-changed", "password-changed"] }],
    ["a notice with an action", { notice: "password-changed", action: "change-password" }],
  ])("finds %s invalid", (_case, query) => {
    expect(parseAccountNotice(query)).toBe("invalid");
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

describe("landingPath", () => {
  const ADMIN = { type: "admin" } as const;
  const USER = { type: "user" } as const;

  it.each([
    "/",
    "/folders",
    "/folders/team",
    "/folders/team/guides",
    "/folders/team/intro.md?action=edit",
    "/folders/team?action=create",
    "/folders?view=all",
    "/files/team/diagram.png",
    "/deleted-items",
    "/deleted-items/team",
    "/deleted-items/team/7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002?action=restore",
    "/?next=/users",
    "/folders#top",
  ])("leads an admin from the home page or the content %j to the user list", (next) => {
    expect(landingPath(next, ADMIN)).toBe("/users");
  });

  it.each([
    "/folderstuff",
    "/deleted-items-old",
    "/users",
    "/users?action=create",
    "/account",
    "/account?action=create",
    "/oauth/authorize?client_id=abc&state=x%2Fy&redirect_uri=%2Ffolders",
    "/users?next=/folders",
  ])("keeps every other way back %j of an admin", (next) => {
    expect(landingPath(next, ADMIN)).toBe(next);
  });

  it.each([
    "/",
    "/folders",
    "/folders/team",
    "/folders/team?action=create",
    "/deleted-items/team",
    "/folderstuff",
    "/users",
    "/account",
    "/oauth/authorize?client_id=abc&state=x%2Fy",
  ])("keeps every way back %j of a user", (next) => {
    expect(landingPath(next, USER)).toBe(next);
  });
});

describe("the words of a search", () => {
  it("tells whether the query string holds them in any form", () => {
    expect(hasSearchWords({})).toBe(false);
    expect(hasSearchWords({ view: "search" })).toBe(false);
    expect(hasSearchWords({ q: "" })).toBe(true);
    expect(hasSearchWords({ q: ["a", "b"] })).toBe(true);
  });

  it("reads them as typed when given once with more than spaces", () => {
    expect(parseSearchWords({ q: " backup  server " })).toBe(" backup  server ");
    expect(parseSearchWords({})).toBeNull();
    expect(parseSearchWords({ q: "" })).toBeNull();
    expect(parseSearchWords({ q: " \t " })).toBeNull();
    expect(parseSearchWords({ q: ["backup", "backup"] })).toBeNull();
  });
});
