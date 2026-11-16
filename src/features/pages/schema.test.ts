import { describe, expect, it } from "vitest";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import {
  CONTENT_NUL_MESSAGE,
  newPageInputSchema,
  pageContentInputSchema,
  parsePageId,
  parsePageVersion,
  TITLE_HEADING_MISSING_MESSAGE,
} from "@/features/pages/schema";

/** The field errors of a failed parse, or `undefined` for a successful one. */
function fieldErrorsOf(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  if (result.success) return undefined;
  const errors: Record<string, string[]> = {};
  for (const issue of result.error?.issues ?? []) {
    const field = String(issue.path[0]);
    (errors[field] ??= []).push(issue.message);
  }
  return errors;
}

const LENGTH_MESSAGE = "Content must be at most 100,000 characters";

/** Content of `length` characters with plain line breaks, but longer when the line breaks are CRLF. */
function contentWithLineBreaks(length: number, lineBreak: string): string {
  // "# Long" plus `count` lines of "a", each after a line break: 6 + 2 * count characters with LF.
  const count = (length - 6) / 2;
  return `# Long${`${lineBreak}a`.repeat(count)}`;
}

describe("the content of a page", () => {
  it("is measured after CRLF and CR are normalised to LF", () => {
    for (const lineBreak of ["\r\n", "\r"]) {
      const content = contentWithLineBreaks(CONTENT_MAX_LENGTH, lineBreak);
      expect(content.length).toBeGreaterThanOrEqual(CONTENT_MAX_LENGTH);
      const result = pageContentInputSchema.safeParse({ content });
      expect(result.success).toBe(true);
      expect(result.data?.content).toBe(contentWithLineBreaks(CONTENT_MAX_LENGTH, "\n"));
      expect(result.data?.content).toHaveLength(CONTENT_MAX_LENGTH);
    }
  });

  it("is refused with only the length error when it is one character too long", () => {
    const content = `${contentWithLineBreaks(CONTENT_MAX_LENGTH, "\r\n")}a`;
    expect(fieldErrorsOf(pageContentInputSchema.safeParse({ content }))).toEqual({ content: [LENGTH_MESSAGE] });
    expect(fieldErrorsOf(newPageInputSchema.safeParse({ name: "long", content }))).toEqual({
      content: [LENGTH_MESSAGE],
    });
  });

  it("is refused at the content field when it contains a NUL character", () => {
    const content = "# Title\n\nBefore\u0000after";
    expect(fieldErrorsOf(pageContentInputSchema.safeParse({ content }))).toEqual({ content: [CONTENT_NUL_MESSAGE] });
    expect(fieldErrorsOf(newPageInputSchema.safeParse({ name: "title", content }))).toEqual({
      content: [CONTENT_NUL_MESSAGE],
    });
    // Also when it is too long: the NUL character is reported, not the length.
    expect(
      fieldErrorsOf(pageContentInputSchema.safeParse({ content: `${content}${"a".repeat(CONTENT_MAX_LENGTH)}` })),
    ).toEqual({ content: [CONTENT_NUL_MESSAGE] });
  });

  it("reports the missing title when it is empty", () => {
    expect(fieldErrorsOf(pageContentInputSchema.safeParse({ content: "" }))).toEqual({
      content: [TITLE_HEADING_MISSING_MESSAGE],
    });
    expect(fieldErrorsOf(pageContentInputSchema.safeParse({ content: "\r\n\r\n" }))).toEqual({
      content: [TITLE_HEADING_MISSING_MESSAGE],
    });
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

describe("parsePageVersion", () => {
  it("accepts integers from 1 up to the largest value of the column", () => {
    for (const version of [1, 2, 42, 2_147_483_647]) expect(parsePageVersion(version)).toBe(version);
  });

  it("refuses everything else", () => {
    for (const version of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, "3", "", null, undefined]) {
      expect(parsePageVersion(version)).toBeNull();
    }
  });
});
