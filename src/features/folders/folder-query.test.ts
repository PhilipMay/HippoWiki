import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "@/features/folder-roles/roles";
import {
  folderAddressOf,
  mayDoFolderAction,
  mayDoTabAction,
  tabAddressOf,
  type FolderAction,
  type TabAction,
} from "@/features/folders/folder-query";
import type { SearchParams } from "@/lib/addresses";

/** Whether each role, from Reader to Owner, has the action, given its lowest role. */
function expectFrom(may: (role: Role | null) => boolean, lowestRole: Role) {
  const from = ROLES.indexOf(lowestRole);
  for (const [index, role] of ROLES.entries()) expect(may(role), role).toBe(index >= from);
  expect(may(null), "no role").toBe(false);
}

describe("mayDoFolderAction", () => {
  it.each<[FolderAction, Role]>([
    ["new", "writer"],
    ["new-tab", "manager"],
    ["rename", "owner"],
    ["give-role", "owner"],
    ["upload", "writer"],
  ])("allows %s from %s up", (action, lowestRole) => {
    expectFrom((role) => mayDoFolderAction(role, action), lowestRole);
  });
});

describe("mayDoTabAction", () => {
  it.each<[TabAction, Role]>([
    ["new", "writer"],
    ["rename", "manager"],
    ["delete", "manager"],
    ["upload", "writer"],
  ])("allows %s from %s up", (action, lowestRole) => {
    expectFrom((role) => mayDoTabAction(role, action), lowestRole);
  });
});

describe("folderAddressOf", () => {
  const owner = { name: "handbook", role: "owner" as const };

  it.each<[SearchParams, string]>([
    [{}, "handbook"],
    [{ action: "new" }, "New page"],
    [{ action: "rename" }, "handbook"],
    [{ action: "new-tab" }, "handbook"],
    [{ action: "give-role" }, "handbook"],
    [{ view: "all" }, "All pages – handbook"],
    [{ view: "roles" }, "Roles – handbook"],
    [{ view: "mcp" }, "AI apps – handbook"],
    [{ view: "search", q: "backup server" }, "Search – handbook"],
  ])("gives %o the title %s", (searchParams, title) => {
    expect(folderAddressOf(owner, searchParams, true, true)?.title).toBe(title);
  });

  it("reads the action and the view", () => {
    expect(folderAddressOf(owner, { action: "new-tab" }, true, true)).toMatchObject({ action: "new-tab", view: null });
    expect(folderAddressOf(owner, { view: "roles" }, true, true)).toMatchObject({ action: null, view: "roles" });
  });

  it.each<SearchParams>([
    { action: "delete" },
    { action: "" },
    { action: ["new", "new"] },
    { view: "history" },
    { view: "All" },
    { view: "" },
    { view: ["all", "all"] },
    { action: "new", view: "all" },
    { view: "search" },
    { view: "search", q: "" },
    { view: "search", q: "   " },
    { view: "search", q: ["backup", "backup"] },
    { view: "search", q: "backup", action: "new" },
    { view: "search", q: "backup", action: "rename" },
    { q: "backup" },
    { q: "" },
    { view: "all", q: "backup" },
    { view: "roles", q: "backup" },
    { action: "new", q: "backup" },
  ])("shows the not-found page for %o", (searchParams) => {
    expect(folderAddressOf(owner, searchParams, true, true)).toBeNull();
  });

  it("reads the words of the view search as typed, and none for the other views", () => {
    expect(folderAddressOf(owner, { view: "search", q: "  backup  -old " }, true, true)).toMatchObject({
      action: null,
      view: "search",
      words: "  backup  -old ",
    });
    // A search that is too long is no address error: the view tells the user.
    expect(folderAddressOf(owner, { view: "search", q: "x".repeat(500) }, true, true)?.words).toHaveLength(500);
    expect(folderAddressOf(owner, { view: "all" }, true, true)?.words).toBeNull();
    expect(folderAddressOf(owner, {}, true, true)?.words).toBeNull();
  });

  it("shows the not-found page for an action beyond the role, but every view to every role", () => {
    const reader = { name: "handbook", role: "reader" as const };
    for (const action of ["new", "rename", "new-tab", "give-role"]) {
      expect(folderAddressOf(reader, { action }, true, true), action).toBeNull();
    }
    for (const view of ["all", "roles", "mcp"]) {
      expect(folderAddressOf(reader, { view }, true, true), view).not.toBeNull();
    }
    expect(folderAddressOf(reader, { view: "search", q: "backup" }, true, true)).not.toBeNull();
  });

  it("reads the preset name of a new page, and none without one", () => {
    expect(folderAddressOf(owner, { action: "new", name: "faq" }, true, true)).toMatchObject({
      action: "new",
      name: "faq",
      title: "New page",
    });
    expect(folderAddressOf(owner, { action: "new" }, true, true)?.name).toBeNull();
    expect(folderAddressOf(owner, {}, true, true)?.name).toBeNull();
  });

  it.each<SearchParams>([
    { action: "new", name: "FAQ" },
    { action: "new", name: "faq.md" },
    { action: "new", name: "" },
    { action: "new", name: ["faq", "faq"] },
    { action: "rename", name: "faq" },
    { view: "all", name: "faq" },
    { name: "faq" },
  ])("shows the not-found page for the preset name in %o", (searchParams) => {
    expect(folderAddressOf(owner, searchParams, true, true)).toBeNull();
  });

  it("reads the upload dialog with the preset name of a file, and only while the files are on", () => {
    expect(folderAddressOf(owner, { action: "upload" }, true, true)).toMatchObject({ action: "upload", name: null });
    expect(folderAddressOf(owner, { action: "upload", name: "manual.pdf" }, true, true)).toMatchObject({
      action: "upload",
      name: "manual.pdf",
      title: "handbook",
    });
    expect(folderAddressOf(owner, { action: "upload" }, true, false)).toBeNull();
    expect(folderAddressOf(owner, {}, true, false)).not.toBeNull();
    const reader = { name: "handbook", role: "reader" as const };
    expect(folderAddressOf(reader, { action: "upload" }, true, true)).toBeNull();
  });

  it.each<SearchParams>([
    { action: "upload", name: "manual" },
    { action: "upload", name: "Manual.pdf" },
    { action: "upload", name: "photo.jpeg" },
    { action: "upload", name: ["a.png", "a.png"] },
    { action: "new", name: "manual.pdf" },
  ])("shows the not-found page for the preset name in %o", (searchParams) => {
    expect(folderAddressOf(owner, searchParams, true, true)).toBeNull();
  });

  it("shows the not-found page for the view of the AI apps without an MCP server", () => {
    expect(folderAddressOf(owner, { view: "mcp" }, false, true)).toBeNull();
    expect(folderAddressOf(owner, {}, false, true)?.title).toBe("handbook");
  });
});

describe("tabAddressOf", () => {
  const manager = { name: "guides", folder: { name: "handbook" }, role: "manager" as const };

  it.each<[SearchParams, string]>([
    [{}, "guides – handbook"],
    [{ action: "new" }, "New page"],
    [{ action: "rename" }, "guides – handbook"],
    [{ action: "delete" }, "guides – handbook"],
  ])("gives %o the title %s", (searchParams, title) => {
    expect(tabAddressOf(manager, searchParams, true)?.title).toBe(title);
  });

  it.each<SearchParams>([
    { view: "all" },
    { view: "" },
    { action: "give-role" },
    { action: ["new", "new"] },
    { action: "new", view: "all" },
    { view: "search", q: "backup" },
    { q: "backup" },
    { q: "" },
    { action: "rename", q: "backup" },
  ])("shows the not-found page for %o", (searchParams) => {
    expect(tabAddressOf(manager, searchParams, true)).toBeNull();
  });

  it("reads the preset name of a new page, and none without one", () => {
    expect(tabAddressOf(manager, { action: "new", name: "faq" }, true)).toMatchObject({ action: "new", name: "faq" });
    expect(tabAddressOf(manager, { action: "new" }, true)?.name).toBeNull();
    expect(tabAddressOf(manager, {}, true)?.name).toBeNull();
  });

  it.each<SearchParams>([
    { action: "new", name: "Faq" },
    { action: "new", name: "" },
    { action: "new", name: ["faq", "faq"] },
    { action: "delete", name: "faq" },
    { name: "faq" },
  ])("shows the not-found page for the preset name in %o", (searchParams) => {
    expect(tabAddressOf(manager, searchParams, true)).toBeNull();
  });

  it("reads the upload dialog of a tab with the preset name of a file, and only while the files are on", () => {
    expect(tabAddressOf(manager, { action: "upload", name: "diagram.png" }, true)).toMatchObject({
      action: "upload",
      name: "diagram.png",
    });
    expect(tabAddressOf(manager, { action: "upload" }, false)).toBeNull();
    expect(tabAddressOf(manager, { action: "upload", name: "diagram" }, true)).toBeNull();
    expect(tabAddressOf({ ...manager, role: "reader" }, { action: "upload" }, true)).toBeNull();
  });

  it("shows the not-found page for an action beyond the role", () => {
    const writer = { ...manager, role: "writer" as const };
    expect(tabAddressOf(writer, { action: "new" }, true)).not.toBeNull();
    expect(tabAddressOf(writer, { action: "rename" }, true)).toBeNull();
    expect(tabAddressOf(writer, { action: "delete" }, true)).toBeNull();
  });
});
