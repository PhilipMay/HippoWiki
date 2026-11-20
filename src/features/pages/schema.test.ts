import { describe, expect, it } from "vitest";

import {
  CONTENT_MAX_DEPTH,
  CONTENT_MAX_LENGTH,
  CONTENT_MAX_TABLE_CELLS,
  CONTENT_MAX_WIKI_LINKS,
} from "@/features/pages/limits";
import {
  CONTENT_DEPTH_MESSAGE,
  CONTENT_NUL_MESSAGE,
  CONTENT_TABLE_CELLS_MESSAGE,
  CONTENT_WIKI_LINKS_MESSAGE,
  newPageInputSchema,
  pageContentInputSchema,
  parsePageId,
  parsePageVersion,
  parseRevisionNumber,
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

/** Content with a title and lists nested `depth` deep. */
function nestedLists(depth: number): string {
  return `# Deep\n\n${"- ".repeat(depth)}item`;
}

/** Content with a title and a table of `columns` columns in its header and `rows` rows of one cell. */
function tableWithCells(columns: number, rows: number): string {
  return `# Table\n\n|${" h |".repeat(columns)}\n|${" - |".repeat(columns)}\n${"| a |\n".repeat(rows)}`;
}

describe("the limits of the Markdown of a page", () => {
  it("accepts lists and quotes nested to the limit", () => {
    expect(pageContentInputSchema.safeParse({ content: nestedLists(CONTENT_MAX_DEPTH) }).success).toBe(true);
    const quotes = `# Deep\n\n${">".repeat(CONTENT_MAX_DEPTH)} quote`;
    expect(newPageInputSchema.safeParse({ name: "deep", content: quotes }).success).toBe(true);
  });

  it("refuses lists or quotes nested one level deeper at the content field", () => {
    expect(fieldErrorsOf(pageContentInputSchema.safeParse({ content: nestedLists(CONTENT_MAX_DEPTH + 1) }))).toEqual({
      content: [CONTENT_DEPTH_MESSAGE],
    });
    const quotes = `# Deep\n\n${">".repeat(CONTENT_MAX_DEPTH + 1)} quote`;
    expect(fieldErrorsOf(newPageInputSchema.safeParse({ name: "deep", content: quotes }))).toEqual({
      content: [CONTENT_DEPTH_MESSAGE],
    });
  });

  it("accepts tables with cells up to the limit", () => {
    // 100 columns in the header and 99 rows filled up to 100 cells each.
    expect(pageContentInputSchema.safeParse({ content: tableWithCells(100, 99) }).success).toBe(true);
  });

  it("refuses one table cell more at the content field", () => {
    const content = `${tableWithCells(100, 99)}\n| one |\n| --- |`;
    expect(fieldErrorsOf(pageContentInputSchema.safeParse({ content }))).toEqual({
      content: [CONTENT_TABLE_CELLS_MESSAGE],
    });
    expect(CONTENT_TABLE_CELLS_MESSAGE).toContain(CONTENT_MAX_TABLE_CELLS.toLocaleString("en-US"));
  });

  it("accepts 5,000 wiki links (R26)", () => {
    const content = `# Links\n\n${"[[a]] ".repeat(CONTENT_MAX_WIKI_LINKS)}`;
    expect(pageContentInputSchema.safeParse({ content }).success).toBe(true);
    expect(newPageInputSchema.safeParse({ name: "links", content }).success).toBe(true);
  });

  it("refuses 5,001 wiki links at the content field (R26)", () => {
    const content = `# Links\n\n${"[[a]] ".repeat(CONTENT_MAX_WIKI_LINKS + 1)}`;
    expect(fieldErrorsOf(pageContentInputSchema.safeParse({ content }))).toEqual({
      content: [CONTENT_WIKI_LINKS_MESSAGE],
    });
    expect(fieldErrorsOf(newPageInputSchema.safeParse({ name: "links", content }))).toEqual({
      content: [CONTENT_WIKI_LINKS_MESSAGE],
    });
    expect(CONTENT_WIKI_LINKS_MESSAGE).toBe("A page may hold at most 5,000 wiki links.");
  });

  it("reports every limit and the missing title together", () => {
    const content = `${"- ".repeat(CONTENT_MAX_DEPTH + 1)}item\n\n${tableWithCells(101, 99).replace("# Table\n\n", "")}`;
    expect(fieldErrorsOf(pageContentInputSchema.safeParse({ content }))).toEqual({
      content: [TITLE_HEADING_MISSING_MESSAGE, CONTENT_DEPTH_MESSAGE, CONTENT_TABLE_CELLS_MESSAGE],
    });
  });

  it("reports only the length error for too long content nested too deep", () => {
    const content = `${nestedLists(CONTENT_MAX_DEPTH + 1)}\n\n${"a".repeat(CONTENT_MAX_LENGTH)}`;
    expect(fieldErrorsOf(pageContentInputSchema.safeParse({ content }))).toEqual({ content: [LENGTH_MESSAGE] });
  });
});

describe("parseRevisionNumber", () => {
  it.each([
    ["1", 1],
    ["5", 5],
    ["250", 250],
    ["2147483647", 2_147_483_647],
  ])("accepts %j as %d", (value, number) => {
    expect(parseRevisionNumber(value)).toBe(number);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["zero", "0"],
    ["a leading zero", "05"],
    ["a plus sign", "+5"],
    ["a minus sign", "-5"],
    ["a decimal point", "5.0"],
    ["an exponent", "1e3"],
    ["a space", " 5"],
    ["letters", "abc"],
    ["a hex number", "0x10"],
    ["too large for the column", "2147483648"],
    ["far too large", "99999999999999999999"],
    ["repeated", ["3", "4"]],
  ])("refuses %s", (_name, value) => {
    expect(parseRevisionNumber(value)).toBeNull();
  });
});
