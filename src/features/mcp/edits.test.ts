import { describe, expect, it } from "vitest";

import { applyEdits, type Edit } from "@/features/mcp/edits";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

const CONTENT = "# Release\n\nThe release is on 2026-03-01.\n\n- one\n- two\n- three\n";

describe("applyEdits", () => {
  it("changes the one place of a replacement and leaves the rest of the content character for character", () => {
    const result = applyEdits(CONTENT, [{ oldText: "2026-03-01", newText: "2026-04-15" }]);

    expect(result).toStrictEqual({
      ok: true,
      content: "# Release\n\nThe release is on 2026-04-15.\n\n- one\n- two\n- three\n",
      counts: [1],
    });
  });

  it("applies three replacements in one call and counts one place for each", () => {
    const result = applyEdits(CONTENT, [
      { oldText: "- one", newText: "- first" },
      { oldText: "- two", newText: "- second" },
      { oldText: "- three", newText: "- third" },
    ]);

    expect(result).toStrictEqual({
      ok: true,
      content: "# Release\n\nThe release is on 2026-03-01.\n\n- first\n- second\n- third\n",
      counts: [1, 1, 1],
    });
  });

  it("finds and changes in a second replacement the text that the first one inserted", () => {
    const result = applyEdits(CONTENT, [
      { oldText: "- two", newText: "- two and a half" },
      { oldText: "and a half", newText: "and three quarters" },
    ]);

    expect(result).toMatchObject({ ok: true, counts: [1, 1] });
    expect(result.ok && result.content).toContain("- two and three quarters\n");
  });

  it("refuses a text that appears twice with the number 2 and the position; replaceAll changes both", () => {
    const twice = "# T\n\nfoo and foo\n";

    expect(
      applyEdits(twice, [
        { oldText: "and", newText: "&" },
        { oldText: "foo", newText: "bar" },
      ]),
    ).toStrictEqual({ ok: false, position: 2, oldText: "foo", reason: { code: "found-several-times", count: 2 } });
    expect(applyEdits(twice, [{ oldText: "foo", newText: "bar", replaceAll: true }])).toStrictEqual({
      ok: true,
      content: "# T\n\nbar and bar\n",
      counts: [2],
    });
  });

  it("counts places that overlap as several, and replaceAll changes them as String.prototype.replaceAll does", () => {
    expect(applyEdits("# T\n\naaa", [{ oldText: "aa", newText: "b" }])).toMatchObject({
      ok: false,
      reason: { code: "found-several-times", count: 2 },
    });
    expect(applyEdits("# T\n\naaaa", [{ oldText: "aa", newText: "b" }])).toMatchObject({
      reason: { code: "found-several-times", count: 3 },
    });
    expect(applyEdits("# T\n\naaa", [{ oldText: "aa", newText: "b", replaceAll: true }])).toStrictEqual({
      ok: true,
      content: "# T\n\nba",
      counts: [1],
    });
  });

  it.each([
    ["case", "the release is on"],
    ["one space", "The release  is on"],
    ["indentation", "  - two"],
  ])("does not find a text that differs only in %s, with the plain not-found failure", (_kind, oldText) => {
    expect(applyEdits(CONTENT, [{ oldText, newText: "x" }])).toStrictEqual({
      ok: false,
      position: 1,
      oldText,
      reason: { code: "not-found" },
    });
  });

  it.each([
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("matches texts sent with %s line breaks and inserts them as LF", (_kind, lineBreak) => {
    const result = applyEdits(CONTENT, [
      { oldText: `- one${lineBreak}- two`, newText: `- one${lineBreak}- one and a half${lineBreak}- two` },
    ]);

    expect(result).toMatchObject({ ok: true, counts: [1] });
    expect(result.ok && result.content).toContain("- one\n- one and a half\n- two\n");
    expect(result.ok && result.content).not.toContain("\r");
  });

  it.each<[string, Edit, string]>([
    ["an empty oldText", { oldText: "", newText: "x" }, "empty-old-text"],
    ["a newText equal to its oldText", { oldText: "- one", newText: "- one" }, "no-change"],
    [
      "a newText equal once the line breaks are plain",
      { oldText: "- one\n- two", newText: "- one\r\n- two" },
      "no-change",
    ],
  ])("refuses %s before anything is applied, also when the other replacements match", (_kind, edit, code) => {
    const result = applyEdits(CONTENT, [
      { oldText: "- three", newText: "- 3" },
      edit,
      { oldText: "nowhere", newText: "x" },
    ]);

    expect(result).toMatchObject({ ok: false, position: 2, reason: { code } });
  });

  it("refuses an empty list", () => {
    expect(applyEdits(CONTENT, [])).toStrictEqual({
      ok: false,
      position: 0,
      oldText: "",
      reason: { code: "no-edits" },
    });
  });

  it("names the first replacement that fails, also when a later one fails as well", () => {
    const result = applyEdits(CONTENT, [
      { oldText: "- one", newText: "- 1" },
      { oldText: "- four", newText: "- 4" },
      { oldText: "- five", newText: "- 5" },
    ]);

    expect(result).toStrictEqual({ ok: false, position: 2, oldText: "- four", reason: { code: "not-found" } });
  });

  it("inserts a newText with $&, $1 and $$ as it is", () => {
    const newText = "costs $$5, $& and $1 $` $'";

    expect(applyEdits("# T\n\nprice\n", [{ oldText: "price", newText }])).toMatchObject({
      content: `# T\n\n${newText}\n`,
    });
    expect(applyEdits("# T\n\nprice price\n", [{ oldText: "price", newText, replaceAll: true }])).toMatchObject({
      content: `# T\n\n${newText} ${newText}\n`,
    });
  });

  it("applies 200 small replacements in one call", () => {
    const items = Array.from({ length: 200 }, (_, index) => `- item ${index}.\n`).join("");
    const edits = Array.from({ length: 200 }, (_, index) => ({
      oldText: `item ${index}.`,
      newText: `entry ${index}.`,
    }));

    const result = applyEdits(`# List\n\n${items}`, edits);

    expect(result).toMatchObject({ ok: true, counts: Array.from({ length: 200 }, () => 1) });
    expect(result.ok && result.content).toBe(`# List\n\n${items.replaceAll("item ", "entry ")}`);
  });

  describe("the length limit", () => {
    /** Content of the given length that has the text "x" once and "y" in ten places. */
    function contentOf(length: number): string {
      const start = `# T\n\nx${"y".repeat(10)}`;
      return start + "-".repeat(length - start.length);
    }

    it("refuses a replacement whose result would be longer than the limit, as too long", () => {
      expect(applyEdits(contentOf(CONTENT_MAX_LENGTH), [{ oldText: "x", newText: "xx" }])).toStrictEqual({
        ok: false,
        position: 1,
        oldText: "x",
        reason: { code: "too-long" },
      });
    });

    it("refuses a replaceAll whose result would be longer than the limit, as too long", () => {
      expect(
        applyEdits(contentOf(CONTENT_MAX_LENGTH - 9), [{ oldText: "y", newText: "yy", replaceAll: true }]),
      ).toMatchObject({ ok: false, reason: { code: "too-long" } });
    });

    it("applies a result of exactly the limit", () => {
      const once = applyEdits(contentOf(CONTENT_MAX_LENGTH - 1), [{ oldText: "x", newText: "xx" }]);
      const all = applyEdits(contentOf(CONTENT_MAX_LENGTH - 10), [{ oldText: "y", newText: "yy", replaceAll: true }]);

      expect(once.ok && once.content.length).toBe(CONTENT_MAX_LENGTH);
      expect(all.ok && all.content.length).toBe(CONTENT_MAX_LENGTH);
      expect(all).toMatchObject({ counts: [10] });
    });
  });
});
