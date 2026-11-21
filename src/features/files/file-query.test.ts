import { describe, expect, it } from "vitest";

import { fileAddressOf } from "@/features/files/file-query";
import { ROLES } from "@/features/folder-roles/roles";
import type { SearchParams } from "@/lib/addresses";

const FILE = { name: "diagram.png", folder: { name: "handbook" } };

describe("fileAddressOf", () => {
  it("shows the details page to every role, with the name and the folder as its title", () => {
    for (const role of ROLES) {
      expect(fileAddressOf({ ...FILE, role }, {}), role).toEqual({ title: "diagram.png – handbook" });
    }
  });

  it.each<SearchParams>([
    { action: "edit" },
    { action: "delete" },
    { action: "upload-version" },
    { action: "" },
    { view: "history" },
    { view: "all" },
    { q: "diagram" },
    { view: "search", q: "diagram" },
  ])("shows the not-found page for %o", (searchParams) => {
    expect(fileAddressOf({ ...FILE, role: "owner" }, searchParams)).toBeNull();
  });
});
