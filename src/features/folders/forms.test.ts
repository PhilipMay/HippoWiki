import { describe, expect, it } from "vitest";

import { parseFolderFormData, parseTabFormData } from "@/features/folders/forms";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("parseFolderFormData", () => {
  it("returns the trimmed name", () => {
    expect(parseFolderFormData(formData({ name: " handbook " }))).toEqual({
      success: true,
      data: { name: "handbook" },
    });
  });

  it("ignores other fields", () => {
    expect(parseFolderFormData(formData({ name: "handbook", id: "x", createdAt: "2026-01-01" }))).toEqual({
      success: true,
      data: { name: "handbook" },
    });
  });

  it("reports a missing or empty name", () => {
    const required = { success: false, fieldErrors: { name: ["Name is required"] } };
    expect(parseFolderFormData(formData({}))).toEqual(required);
    expect(parseFolderFormData(formData({ name: "  " }))).toEqual(required);
  });

  it("reports an invalid name", () => {
    expect(parseFolderFormData(formData({ name: "Hand Book" }))).toEqual({
      success: false,
      fieldErrors: { name: ["Use lowercase letters, digits and single hyphens"] },
    });
  });
});

describe("parseTabFormData", () => {
  it("returns the trimmed name and ignores other fields", () => {
    expect(parseTabFormData(formData({ name: " guides ", folderId: "x" }))).toEqual({
      success: true,
      data: { name: "guides" },
    });
  });

  it("reports a missing or empty name", () => {
    const required = { success: false, fieldErrors: { name: ["Name is required"] } };
    expect(parseTabFormData(formData({}))).toEqual(required);
    expect(parseTabFormData(formData({ name: "  " }))).toEqual(required);
  });

  it("reports an invalid name", () => {
    for (const name of ["Guides", "guides.md", "a--b"]) {
      expect(parseTabFormData(formData({ name }))).toEqual({
        success: false,
        fieldErrors: { name: ["Use lowercase letters, digits and single hyphens"] },
      });
    }
  });
});
