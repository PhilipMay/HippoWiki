import { describe, expect, it } from "vitest";

import { parseGiveRoleFormData } from "@/features/folder-roles/forms";

function formData(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("parseGiveRoleFormData", () => {
  it("returns the trimmed user name and the role", () => {
    expect(parseGiveRoleFormData(formData({ user: " bob ", role: "writer" }))).toEqual({
      success: true,
      data: { user: "bob", role: "writer" },
    });
  });

  it("refuses a missing user and a missing role", () => {
    expect(parseGiveRoleFormData(formData({}))).toEqual({
      success: false,
      fieldErrors: { user: ["Choose a user"], role: ["Choose a role"] },
    });
  });

  it("refuses an unknown role and files in place of the fields", () => {
    expect(parseGiveRoleFormData(formData({ user: "bob", role: "admin" }))).toEqual({
      success: false,
      fieldErrors: { role: ["Choose a role"] },
    });
    expect(parseGiveRoleFormData(formData({ user: new Blob(["bob"]), role: new Blob(["owner"]) }))).toEqual({
      success: false,
      fieldErrors: { user: ["Choose a user"], role: ["Choose a role"] },
    });
  });
});
