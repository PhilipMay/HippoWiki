import { describe, expect, it } from "vitest";

import {
  CONTENT_MAX_LENGTH,
  parsePageFormData,
  parsePageId,
  parsePageSlug,
  SLUG_MAX_LENGTH,
  slugSchema,
  TITLE_MAX_LENGTH,
} from "@/features/pages/schema";

function slugErrors(slug: string): string[] {
  const result = slugSchema.safeParse(slug);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("slugSchema", () => {
  it("accepts lowercase letters, digits and single hyphens", () => {
    for (const slug of ["a", "a-1", "getting-started", "2026", "a".repeat(SLUG_MAX_LENGTH)]) {
      expect(slugSchema.parse(slug)).toBe(slug);
    }
  });

  it("trims the slug", () => {
    expect(slugSchema.parse(" a-1 \n")).toBe("a-1");
  });

  it("requires a slug", () => {
    expect(slugErrors("")).toEqual(["Slug is required"]);
    expect(slugErrors("   ")).toEqual(["Slug is required"]);
  });

  it("rejects characters and hyphens outside the pattern", () => {
    for (const slug of ["A", "a--b", "-a", "a-", "a_b", "a b", "ä", "a/b"]) {
      expect(slugErrors(slug)).toEqual(["Use lowercase letters, digits and single hyphens"]);
    }
  });

  it("limits the slug length", () => {
    expect(slugErrors("a".repeat(SLUG_MAX_LENGTH + 1))).toEqual(["Slug must be at most 80 characters"]);
  });

  it("rejects reserved slugs", () => {
    expect(slugErrors("new")).toEqual(["This slug is reserved"]);
  });
});

describe("parsePageSlug", () => {
  it("returns valid slugs", () => {
    expect(parsePageSlug("getting-started")).toBe("getting-started");
  });

  it("rejects malformed, reserved and untrimmed slugs", () => {
    for (const slug of ["", "Bad_Slug", "a--b", "new", " a", "a ", "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c000Z"]) {
      expect(parsePageSlug(slug)).toBeNull();
    }
  });
});

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

describe("parsePageFormData", () => {
  it("accepts a title and Markdown content", () => {
    expect(parsePageFormData(formData({ title: "Welcome", content: "# Hello\n\n- item" }))).toEqual({
      success: true,
      data: { title: "Welcome", content: "# Hello\n\n- item" },
    });
  });

  it("trims the title", () => {
    const result = parsePageFormData(formData({ title: "  Welcome \n", content: "" }));
    expect(result).toEqual({ success: true, data: { title: "Welcome", content: "" } });
  });

  it("rejects an empty or whitespace-only title", () => {
    for (const title of ["", "   ", "\t\n"]) {
      expect(parsePageFormData(formData({ title, content: "Some content" }))).toEqual({
        success: false,
        fieldErrors: { title: ["Title is required"] },
      });
    }
  });

  it("limits the title length", () => {
    const longest = "a".repeat(TITLE_MAX_LENGTH);
    expect(parsePageFormData(formData({ title: longest, content: "" }))).toMatchObject({ success: true });
    expect(parsePageFormData(formData({ title: `${longest}a`, content: "" }))).toEqual({
      success: false,
      fieldErrors: { title: ["Title must be at most 200 characters"] },
    });
  });

  it("accepts empty content", () => {
    expect(parsePageFormData(formData({ title: "Empty", content: "" }))).toMatchObject({ success: true });
  });

  it("limits the content length", () => {
    const longest = "a".repeat(CONTENT_MAX_LENGTH);
    expect(parsePageFormData(formData({ title: "Long", content: longest }))).toMatchObject({ success: true });
    expect(parsePageFormData(formData({ title: "Long", content: `${longest}a` }))).toEqual({
      success: false,
      fieldErrors: { content: ["Content must be at most 100,000 characters"] },
    });
  });

  it("normalizes line breaks in the content", () => {
    const result = parsePageFormData(formData({ title: "Lines", content: "one\r\ntwo\rthree\nfour" }));
    expect(result).toEqual({ success: true, data: { title: "Lines", content: "one\ntwo\nthree\nfour" } });
  });

  it("treats missing fields as empty", () => {
    expect(parsePageFormData(new FormData())).toEqual({
      success: false,
      fieldErrors: { title: ["Title is required"] },
    });
  });

  it("rejects files instead of text", () => {
    const result = parsePageFormData(formData({ title: new Blob(["x"]), content: "" }));
    expect(result).toMatchObject({ success: false, fieldErrors: { title: [expect.any(String)] } });
  });
});
