import { describe, expect, it } from "vitest";

import { FILE_EXTENSIONS, FILE_NAME_PATTERN, NAME_MAX_LENGTH, NAME_PATTERN } from "@/lib/name-limits";
import {
  FILE_NAME_RULE_MESSAGE,
  fileNameSchema,
  nameSchema,
  nameSchemaWith,
  parseExact,
  parseFileName,
  parseName,
} from "@/lib/names";

function nameErrors(name: string): string[] {
  const result = nameSchema.safeParse(name);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("nameSchema", () => {
  it("accepts lowercase letters, digits and single hyphens", () => {
    for (const name of ["a", "a-1", "release-notes", "2026", "a".repeat(NAME_MAX_LENGTH)]) {
      expect(nameSchema.parse(name)).toBe(name);
    }
  });

  it("trims the name", () => {
    expect(nameSchema.parse(" a-1 \n")).toBe("a-1");
  });

  it("requires a name", () => {
    expect(nameErrors("")).toEqual(["Name is required"]);
    expect(nameErrors("   ")).toEqual(["Name is required"]);
  });

  it("limits the name length", () => {
    expect(nameErrors("a".repeat(NAME_MAX_LENGTH + 1))).toEqual(["Name must be at most 80 characters"]);
  });

  it("rejects uppercase letters, dots and other characters outside the pattern", () => {
    for (const name of ["A", "Guides", "guides.md", "a.b", "a_b", "a b", "ä", "a/b"]) {
      expect(nameErrors(name)).toEqual(["Use lowercase letters, digits and single hyphens"]);
    }
  });

  it("rejects double, leading and trailing hyphens", () => {
    for (const name of ["a--b", "-a", "a-", "-"]) {
      expect(nameErrors(name)).toEqual(["Use lowercase letters, digits and single hyphens"]);
    }
  });
});

describe("parseName", () => {
  it("returns a valid name", () => {
    expect(parseName("release-notes")).toBe("release-notes");
    expect(parseName("new")).toBe("new");
  });

  it("returns null for an invalid name", () => {
    for (const segment of ["", "Guides", "a--b", "guides.md", "a".repeat(NAME_MAX_LENGTH + 1)]) {
      expect(parseName(segment)).toBeNull();
    }
  });

  it("returns null for a name with surrounding whitespace", () => {
    for (const segment of [" guides", "guides ", "guides\n", "\tguides"]) {
      expect(parseName(segment)).toBeNull();
    }
  });
});

describe("nameSchemaWith", () => {
  it("reports required alone, then the lower limit, the upper limit and the pattern, in this order", () => {
    const schema = nameSchemaWith({ minLength: 3, maxLength: 5 });
    const messages = (value: string) => schema.safeParse(value).error?.issues.map((issue) => issue.message);

    expect(messages(" ")).toEqual(["Name is required"]);
    expect(messages("A")).toEqual([
      "Name must be at least 3 characters",
      "Use lowercase letters, digits and single hyphens",
    ]);
    expect(messages("Abcdef")).toEqual([
      "Name must be at most 5 characters",
      "Use lowercase letters, digits and single hyphens",
    ]);
    expect(schema.safeParse(" abc ").data).toBe("abc");
  });

  it("has no lower limit of its own without one", () => {
    expect(nameSchemaWith({ maxLength: 5 }).safeParse("a").success).toBe(true);
  });
});

describe("parseExact", () => {
  it("gives the text only when the schema accepts it as it is", () => {
    const schema = nameSchemaWith({ maxLength: 5 });

    expect(parseExact(schema, "abc")).toBe("abc");
    expect(parseExact(schema, " abc")).toBeNull();
    expect(parseExact(schema, "Abc")).toBeNull();
  });
});

function fileNameErrors(name: string): string[] {
  const result = fileNameSchema.safeParse(name);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("FILE_NAME_PATTERN", () => {
  it("is a name of the name rule followed by a dot and one of the extensions", () => {
    for (const extension of FILE_EXTENSIONS) {
      expect(FILE_NAME_PATTERN.test(`network-diagram-v2.${extension}`)).toBe(true);
    }
    expect(FILE_NAME_PATTERN.source).toContain(NAME_PATTERN.source.slice(1, -1));
    expect(FILE_EXTENSIONS).toEqual(["png", "jpg", "gif", "webp", "pdf"]);
  });

  it("refuses every other extension and a name without one", () => {
    for (const name of ["photo.jpeg", "photo.svg", "notes.md", "notes.txt", "photo", "photo.", ".png"]) {
      expect(FILE_NAME_PATTERN.test(name), name).toBe(false);
    }
  });
});

describe("fileNameSchema", () => {
  it("accepts a name with the extension of its type and trims it", () => {
    expect(fileNameSchema.parse("setup.png")).toBe("setup.png");
    expect(fileNameSchema.parse(" report-2026.pdf\n")).toBe("report-2026.pdf");
    expect(fileNameSchema.parse(`${"a".repeat(NAME_MAX_LENGTH)}.webp`)).toBe(`${"a".repeat(NAME_MAX_LENGTH)}.webp`);
  });

  it("requires a name", () => {
    expect(fileNameErrors("")).toEqual(["Name is required"]);
    expect(fileNameErrors("  ")).toEqual(["Name is required"]);
  });

  it("refuses upper case, a space, a second dot and .jpeg with the rule", () => {
    for (const name of ["Setup.png", "setup.PNG", "my file.png", "a.b.png", "photo.jpeg", "a--b.png", "a_b.gif"]) {
      expect(fileNameErrors(name), name).toEqual([FILE_NAME_RULE_MESSAGE]);
    }
  });

  it("limits the part before the extension to the length of a name", () => {
    expect(fileNameErrors(`${"a".repeat(NAME_MAX_LENGTH + 1)}.png`)).toEqual([
      "Name must be at most 80 characters before its extension",
    ]);
  });
});

describe("parseFileName", () => {
  it("reads the name, the part before the dot and the extension", () => {
    expect(parseFileName("network-diagram.png")).toEqual({
      name: "network-diagram.png",
      base: "network-diagram",
      extension: "png",
    });
    expect(parseFileName("manual.pdf")).toEqual({ name: "manual.pdf", base: "manual", extension: "pdf" });
  });

  it("returns null for a name that breaks the rule or has surrounding whitespace", () => {
    for (const text of ["", "setup", "setup.md", "Setup.png", "a.b.png", "photo.jpeg", " setup.png", "setup.png\n"]) {
      expect(parseFileName(text), text).toBeNull();
    }
  });
});
