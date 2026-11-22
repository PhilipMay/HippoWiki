import { describe, expect, it } from "vitest";

import { fileAddressOf, mayDoFileAction, type FileAction } from "@/features/files/file-query";
import { ROLES, type Role } from "@/features/folder-roles/roles";
import type { SearchParams } from "@/lib/addresses";

/** A file with three versions, of which version 3 is the current one. */
const FILE = {
  name: "diagram.png",
  folder: { name: "handbook" },
  versions: [{ number: 3 }, { number: 2 }, { number: 1 }],
};

describe("mayDoFileAction", () => {
  it.each<[FileAction, Role]>([
    ["upload-version", "writer"],
    ["revert", "writer"],
    ["move-or-rename", "writer"],
  ])("allows %s from %s up", (action, lowest) => {
    for (const role of ROLES) {
      expect(mayDoFileAction(role, action), role).toBe(ROLES.indexOf(role) >= ROLES.indexOf(lowest));
    }
    expect(mayDoFileAction(null, action)).toBe(false);
  });
});

describe("fileAddressOf", () => {
  it("shows the details page to every role, with the name and the folder as its title", () => {
    for (const role of ROLES) {
      expect(fileAddressOf({ ...FILE, role }, {}, true), role).toEqual({
        action: null,
        version: null,
        notice: null,
        title: "diagram.png – handbook",
      });
    }
  });

  it("reads the actions with the version of a revert and the notice", () => {
    const owner = { ...FILE, role: "owner" as const };
    expect(fileAddressOf(owner, { action: "upload-version" }, true)).toMatchObject({ action: "upload-version" });
    expect(fileAddressOf(owner, { action: "revert", version: "1" }, true)).toMatchObject({
      action: "revert",
      version: 1,
    });
    expect(fileAddressOf(owner, { action: "revert", version: "2", notice: "changed" }, true)).toMatchObject({
      version: 2,
      notice: "changed",
    });
    expect(fileAddressOf(owner, { action: "upload-version", notice: "changed" }, true)).toMatchObject({
      notice: "changed",
    });
    expect(fileAddressOf(owner, { action: "move-or-rename", notice: "changed" }, true)).toMatchObject({
      action: "move-or-rename",
      notice: "changed",
    });
  });

  it("shows a Reader no action", () => {
    const reader = { ...FILE, role: "reader" as const };
    expect(fileAddressOf(reader, { action: "upload-version" }, true)).toBeNull();
    expect(fileAddressOf(reader, { action: "revert", version: "1" }, true)).toBeNull();
    expect(fileAddressOf(reader, { action: "move-or-rename" }, true)).toBeNull();
    expect(fileAddressOf(reader, {}, true)).not.toBeNull();
  });

  it("offers no new version while the files are off, but a revert", () => {
    const owner = { ...FILE, role: "owner" as const };
    expect(fileAddressOf(owner, { action: "upload-version" }, false)).toBeNull();
    expect(fileAddressOf(owner, { action: "revert", version: "1" }, false)).not.toBeNull();
    expect(fileAddressOf(owner, { action: "move-or-rename" }, false)).not.toBeNull();
  });

  it.each<SearchParams>([
    { action: "edit" },
    { action: "delete" },
    { action: "" },
    { action: ["revert", "revert"], version: "1" },
    { action: "revert" },
    { action: "revert", version: "3" },
    { action: "revert", version: "4" },
    { action: "revert", version: "0" },
    { action: "revert", version: "01" },
    { action: "revert", version: ["1", "1"] },
    { version: "1" },
    { action: "upload-version", version: "1" },
    { notice: "changed" },
    { action: "revert", version: "1", notice: "other" },
    { view: "history" },
    { q: "diagram" },
  ])("shows the not-found page for %o", (searchParams) => {
    expect(fileAddressOf({ ...FILE, role: "owner" }, searchParams, true)).toBeNull();
  });
});
