import { describe, expect, it } from "vitest";

import { CONTENT_MAX_LENGTH, TITLE_MAX_LENGTH } from "@/features/pages/limits";
import {
  parseNewPageFormData,
  parsePageContentFormData,
  parsePageId,
  parsePageMoveOrRenameFormData,
  TITLE_HEADING_MISSING_MESSAGE,
} from "@/features/pages/schema";
import { NAME_MAX_LENGTH } from "@/lib/names";

describe("parsePageId", () => {
  it("accepts well-formed UUIDs", () => {
    expect(parsePageId("7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c0001")).toBe("7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c0001");
    const random = crypto.randomUUID();
    expect(parsePageId(random)).toBe(random);
  });

  it("rejects malformed ids", () => {
    for (const id of [
      "",
      "abc",
      "not-a-uuid",
      "7c0b6a2e-3f5d-4c1a-9e2b",
      "1' OR '1'='1",
      "7c0b6a2e3f5d4c1a9e2b1a4f8d6c0001",
    ]) {
      expect(parsePageId(id)).toBeNull();
    }
  });
});

function formData(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

describe("parsePageContentFormData", () => {
  it("derives the title from the content's first heading", () => {
    expect(parsePageContentFormData(formData({ content: "# Hello *world*\n\n- item" }))).toEqual({
      success: true,
      data: { title: "Hello world", content: "# Hello *world*\n\n- item" },
    });
  });

  it("ignores a submitted title and name", () => {
    const fields = { title: "Typed title", name: "typed-name", content: "# From content" };
    expect(parsePageContentFormData(formData(fields))).toEqual({
      success: true,
      data: { title: "From content", content: "# From content" },
    });
  });

  it("refuses content without a title heading at the content field", () => {
    for (const content of ["", "Text first\n\n# Title", "## Section", "Title\n=====", "#", "# **"]) {
      expect(parsePageContentFormData(formData({ content }))).toEqual({
        success: false,
        fieldErrors: { content: [TITLE_HEADING_MISSING_MESSAGE] },
      });
    }
    expect(TITLE_HEADING_MISSING_MESSAGE).toBe("Content must start with a title heading: # Title");
  });

  it("cuts a long heading to the title limit", () => {
    const result = parsePageContentFormData(formData({ content: `# ${"a".repeat(TITLE_MAX_LENGTH + 50)}` }));
    expect(result).toMatchObject({ success: true, data: { title: "a".repeat(TITLE_MAX_LENGTH) } });
  });

  it("limits the content length", () => {
    const longest = `# Long\n\n${"a".repeat(CONTENT_MAX_LENGTH - 8)}`;
    expect(longest).toHaveLength(CONTENT_MAX_LENGTH);
    expect(parsePageContentFormData(formData({ content: longest }))).toMatchObject({ success: true });
    expect(parsePageContentFormData(formData({ content: `${longest}a` }))).toEqual({
      success: false,
      fieldErrors: { content: ["Content must be at most 100,000 characters"] },
    });
  });

  it("normalizes line breaks in the content", () => {
    expect(parsePageContentFormData(formData({ content: "# Lines\r\none\rtwo\nthree" }))).toEqual({
      success: true,
      data: { title: "Lines", content: "# Lines\none\ntwo\nthree" },
    });
  });

  it("treats a missing content field as empty", () => {
    expect(parsePageContentFormData(new FormData())).toEqual({
      success: false,
      fieldErrors: { content: [TITLE_HEADING_MISSING_MESSAGE] },
    });
  });

  it("rejects a file instead of text", () => {
    expect(parsePageContentFormData(formData({ content: new Blob(["# Title"]) }))).toMatchObject({
      success: false,
      fieldErrors: { content: [expect.any(String)] },
    });
  });
});

describe("parseNewPageFormData", () => {
  it("returns the name, the content and the derived title", () => {
    expect(parseNewPageFormData(formData({ name: "welcome", content: "# Hello *world*\n\n- item" }))).toEqual({
      success: true,
      data: { title: "Hello world", name: "welcome", content: "# Hello *world*\n\n- item" },
    });
  });

  it("ignores a submitted title", () => {
    expect(parseNewPageFormData(formData({ title: "Typed title", name: "a", content: "# From content" }))).toEqual({
      success: true,
      data: { title: "From content", name: "a", content: "# From content" },
    });
  });

  it("trims the name", () => {
    const result = parseNewPageFormData(formData({ name: " welcome\t", content: "# Welcome" }));
    expect(result).toEqual({ success: true, data: { title: "Welcome", name: "welcome", content: "# Welcome" } });
  });

  it("accepts the name new: no name is reserved", () => {
    expect(parseNewPageFormData(formData({ name: "new", content: "# New" }))).toMatchObject({
      success: true,
      data: { name: "new" },
    });
  });

  it("rejects an empty, malformed or too long name", () => {
    for (const [name, error] of [
      ["", "Name is required"],
      ["  ", "Name is required"],
      ["Bad Name", "Use lowercase letters, digits and single hyphens"],
      ["overview.md", "Use lowercase letters, digits and single hyphens"],
      ["a".repeat(NAME_MAX_LENGTH + 1), "Name must be at most 80 characters"],
    ] as const) {
      expect(parseNewPageFormData(formData({ name, content: "# Title" }))).toEqual({
        success: false,
        fieldErrors: { name: [error] },
      });
    }
  });

  it("refuses content without a title heading at the content field", () => {
    expect(parseNewPageFormData(formData({ name: "a", content: "No heading" }))).toEqual({
      success: false,
      fieldErrors: { content: [TITLE_HEADING_MISSING_MESSAGE] },
    });
  });

  it("reports errors at name and content together", () => {
    const content = `# Long\n\n${"a".repeat(CONTENT_MAX_LENGTH)}`;
    expect(parseNewPageFormData(formData({ name: "Bad Name", content }))).toEqual({
      success: false,
      fieldErrors: {
        name: ["Use lowercase letters, digits and single hyphens"],
        content: ["Content must be at most 100,000 characters"],
      },
    });
  });

  it("normalizes line breaks in the content", () => {
    expect(parseNewPageFormData(formData({ name: "lines", content: "# Lines\r\none\rtwo\nthree" }))).toEqual({
      success: true,
      data: { title: "Lines", name: "lines", content: "# Lines\none\ntwo\nthree" },
    });
  });

  it("treats missing fields as empty", () => {
    expect(parseNewPageFormData(new FormData())).toEqual({
      success: false,
      fieldErrors: { name: ["Name is required"] },
    });
    expect(parseNewPageFormData(formData({ name: "a" }))).toEqual({
      success: false,
      fieldErrors: { content: [TITLE_HEADING_MISSING_MESSAGE] },
    });
  });

  it("rejects files instead of text", () => {
    const result = parseNewPageFormData(formData({ name: new Blob(["a"]), content: new Blob(["# Title"]) }));
    expect(result).toMatchObject({
      success: false,
      fieldErrors: { name: [expect.any(String)], content: [expect.any(String)] },
    });
  });
});

describe("parsePageMoveOrRenameFormData", () => {
  const tabId = crypto.randomUUID();

  it("returns the name and the tab id of the target", () => {
    expect(parsePageMoveOrRenameFormData(formData({ name: "release-notes", target: tabId }))).toEqual({
      success: true,
      data: { name: "release-notes", tabId },
    });
  });

  it("returns no tab for the folder itself: an empty or missing target", () => {
    expect(parsePageMoveOrRenameFormData(formData({ name: "release-notes", target: "" }))).toEqual({
      success: true,
      data: { name: "release-notes", tabId: null },
    });
    expect(parsePageMoveOrRenameFormData(formData({ name: "release-notes" }))).toEqual({
      success: true,
      data: { name: "release-notes", tabId: null },
    });
  });

  it("trims the name", () => {
    expect(parsePageMoveOrRenameFormData(formData({ name: " release-notes ", target: tabId }))).toEqual({
      success: true,
      data: { name: "release-notes", tabId },
    });
  });

  it("reports a missing, empty or invalid name at the name field", () => {
    expect(parsePageMoveOrRenameFormData(formData({ target: tabId }))).toEqual({
      success: false,
      fieldErrors: { name: ["Name is required"] },
      targetInvalid: false,
    });
    expect(parsePageMoveOrRenameFormData(formData({ name: " ", target: tabId }))).toEqual({
      success: false,
      fieldErrors: { name: ["Name is required"] },
      targetInvalid: false,
    });
    expect(parsePageMoveOrRenameFormData(formData({ name: "Release Notes", target: "" }))).toEqual({
      success: false,
      fieldErrors: { name: ["Use lowercase letters, digits and single hyphens"] },
      targetInvalid: false,
    });
    expect(parsePageMoveOrRenameFormData(formData({ name: "a".repeat(NAME_MAX_LENGTH + 1) }))).toEqual({
      success: false,
      fieldErrors: { name: [`Name must be at most ${NAME_MAX_LENGTH} characters`] },
      targetInvalid: false,
    });
  });

  it("refuses a malformed tab id and a file as target", () => {
    for (const target of ["guides", "not-a-uuid", " ", "folder", `${crypto.randomUUID()}x`]) {
      expect(parsePageMoveOrRenameFormData(formData({ name: "release-notes", target }))).toEqual({
        success: false,
        fieldErrors: {},
        targetInvalid: true,
      });
    }
    expect(parsePageMoveOrRenameFormData(formData({ name: "release-notes", target: new Blob(["x"]) }))).toEqual({
      success: false,
      fieldErrors: {},
      targetInvalid: true,
    });
  });

  it("reports an invalid name and an invalid target together", () => {
    expect(parsePageMoveOrRenameFormData(formData({ name: "", target: "guides" }))).toEqual({
      success: false,
      fieldErrors: { name: ["Name is required"] },
      targetInvalid: true,
    });
  });

  it("ignores the content and other fields, so that no content rule can block a save", () => {
    const fields = {
      name: "release-notes",
      target: tabId,
      content: "x".repeat(CONTENT_MAX_LENGTH + 1),
      title: "Typed",
      folderId: "x",
    };
    expect(parsePageMoveOrRenameFormData(formData(fields))).toEqual({
      success: true,
      data: { name: "release-notes", tabId },
    });
  });
});
