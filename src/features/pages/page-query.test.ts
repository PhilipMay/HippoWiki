import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "@/features/folder-roles/roles";
import { deletedPageAddressOf, mayDoPageAction, pageAddressOf, type PageAction } from "@/features/pages/page-query";
import type { SearchParams } from "@/lib/addresses";

const writer = { title: "Guide", role: "writer" as const };
const owner = { title: "Guide", role: "owner" as const };

describe("mayDoPageAction", () => {
  // The lowest role of each action; the page itself needs only a role.
  const lowest: [PageAction | null, Role][] = [
    [null, "reader"],
    ["edit", "writer"],
    ["revert", "writer"],
    ["move-or-rename", "writer"],
    ["delete", "manager"],
  ];

  it.each(lowest)("allows %s from %s up", (action, lowestRole) => {
    const from = ROLES.indexOf(lowestRole);
    for (const [index, role] of ROLES.entries()) {
      expect(mayDoPageAction(role, action), `${action} as ${role}`).toBe(index >= from);
    }
  });

  it("allows nothing without a role", () => {
    for (const [action] of lowest) {
      expect(mayDoPageAction(null, action)).toBe(action === null);
    }
  });
});

describe("pageAddressOf", () => {
  it("shows the page itself without a query", () => {
    expect(pageAddressOf(writer, {})).toEqual({
      query: { action: null, notice: null, view: null, revision: null },
      title: "Guide",
    });
  });

  it.each<[SearchParams, string]>([
    [{ action: "edit" }, "Edit Guide"],
    [{ action: "move-or-rename" }, "Guide"],
    [{ action: "delete" }, "Guide"],
    [{ action: "revert", revision: "2" }, "Revert Guide"],
    [{ view: "history" }, "History of Guide"],
    [{ view: "history", before: "2" }, "History of Guide"],
    [{ view: "revision", revision: "3" }, "Revision 3 of Guide"],
    [{ view: "revision", revision: "3", format: "raw" }, "Revision 3 of Guide"],
    [{ view: "compare", from: "5", to: "2" }, "Revisions 2 and 5 of Guide"],
  ])("gives %o the title %s", (searchParams, title) => {
    expect(pageAddressOf(owner, searchParams)?.title).toBe(title);
  });

  it("reads the action with its notice, and the revision of a revert", () => {
    expect(pageAddressOf(writer, { action: "edit", notice: "changed" })?.query).toEqual({
      action: "edit",
      notice: "changed",
      view: null,
      revision: null,
    });
    expect(pageAddressOf(writer, { action: "revert", revision: "4", notice: "changed" })?.query).toEqual({
      action: "revert",
      notice: "changed",
      view: null,
      revision: 4,
    });
  });

  it("reads the parameters of each view", () => {
    expect(pageAddressOf(writer, { view: "history" })?.query.view).toEqual({ name: "history", before: null });
    expect(pageAddressOf(writer, { view: "history", before: "7" })?.query.view).toEqual({ name: "history", before: 7 });
    expect(pageAddressOf(writer, { view: "revision", revision: "3" })?.query.view).toEqual({
      name: "revision",
      revision: 3,
      raw: false,
    });
    expect(pageAddressOf(writer, { view: "revision", revision: "3", format: "raw" })?.query.view).toEqual({
      name: "revision",
      revision: 3,
      raw: true,
    });
    expect(pageAddressOf(writer, { view: "compare", from: "1", to: "2" })?.query.view).toEqual({
      name: "compare",
      from: 1,
      to: 2,
    });
  });

  it.each<SearchParams>([
    // Unknown, empty or repeated actions, notices and views.
    { action: "rename" },
    { action: "" },
    { action: ["edit", "edit"] },
    { view: "all" },
    { view: ["history", "history"] },
    { action: "edit", notice: "gone" },
    // A notice belongs to an action.
    { notice: "changed" },
    { view: "history", notice: "changed" },
    // An action together with a view.
    { action: "edit", view: "history" },
    // `before` from 2 up, as a revision number.
    { view: "history", before: "1" },
    { view: "history", before: "0" },
    { view: "history", before: "02" },
    { view: "history", before: "x" },
    // Missing or malformed revisions.
    { view: "revision" },
    { view: "revision", revision: "-1" },
    { view: "revision", revision: "3", format: "html" },
    { view: "compare", from: "1" },
    { view: "compare", from: "1", to: "b" },
    { action: "revert" },
    { action: "revert", revision: "0" },
    // A parameter belongs only to its own view or action.
    { before: "2" },
    { revision: "2" },
    { format: "raw" },
    { from: "1", to: "2" },
    { view: "history", revision: "2" },
    { view: "revision", revision: "2", before: "3" },
    { view: "compare", from: "1", to: "2", format: "raw" },
    { action: "edit", revision: "2" },
    { action: "revert", revision: "2", format: "raw" },
    // The words of a search belong to the folder address.
    { q: "backup" },
    { q: "" },
    { view: "search", q: "backup" },
    { view: "history", q: "backup" },
    { action: "edit", q: "backup" },
  ])("shows the not-found page for %o", (searchParams) => {
    expect(pageAddressOf(owner, searchParams)).toBeNull();
  });

  it("shows the not-found page for an action beyond the role, with no title of its own", () => {
    const reader = { title: "Guide", role: "reader" as const };
    expect(pageAddressOf(reader, { action: "edit" })).toBeNull();
    expect(pageAddressOf(reader, { action: "revert", revision: "2" })).toBeNull();
    expect(pageAddressOf(writer, { action: "delete" })).toBeNull();
    expect(pageAddressOf(reader, { view: "history" })?.title).toBe("History of Guide");
  });
});

describe("deletedPageAddressOf", () => {
  const deleted = { title: "Old guide" };

  it("shows the deleted page, its restore dialog and the views of its history", () => {
    expect(deletedPageAddressOf(deleted, {})).toEqual({ action: null, view: null, title: "Deleted: Old guide" });
    expect(deletedPageAddressOf(deleted, { action: "restore" })).toEqual({
      action: "restore",
      view: null,
      title: "Deleted: Old guide",
    });
    expect(deletedPageAddressOf(deleted, { view: "revision", revision: "2" })).toEqual({
      action: null,
      view: { name: "revision", revision: 2, raw: false },
      title: "Revision 2 of Deleted: Old guide",
    });
  });

  it.each<SearchParams>([
    { action: "revert", revision: "2" },
    { action: "edit" },
    { action: "restore", view: "history" },
    { revision: "2" },
    { view: "history", before: "1" },
    { q: "backup" },
    { view: "search", q: "backup" },
    { action: "restore", q: "backup" },
  ])("shows the not-found page for %o", (searchParams) => {
    expect(deletedPageAddressOf(deleted, searchParams)).toBeNull();
  });
});
