import { describe, expect, it } from "vitest";

import { DIFF_MAX_EDIT_LENGTH, diffRevisions } from "@/features/pages/diff";

describe("diffRevisions", () => {
  it("marks the added, removed and unchanged lines in one column, older to newer", () => {
    expect(diffRevisions("# Title\nkept\nold\nend\n", "# Title\nkept\nnew\nmore\nend\n")).toEqual({
      kind: "lines",
      lines: [
        { kind: "unchanged", text: "# Title" },
        { kind: "unchanged", text: "kept" },
        { kind: "removed", text: "old" },
        { kind: "added", text: "new" },
        { kind: "added", text: "more" },
        { kind: "unchanged", text: "end" },
      ],
    });
  });

  it("does not mark the last line as changed when a line is added after it without a line break at the end", () => {
    expect(diffRevisions("# Title\nlast", "# Title\nlast\nadded")).toEqual({
      kind: "lines",
      lines: [
        { kind: "unchanged", text: "# Title" },
        { kind: "unchanged", text: "last" },
        { kind: "added", text: "added" },
      ],
    });
  });

  it("keeps empty lines", () => {
    expect(diffRevisions("# Title\n\nText", "# Title\n\nOther")).toEqual({
      kind: "lines",
      lines: [
        { kind: "unchanged", text: "# Title" },
        { kind: "unchanged", text: "" },
        { kind: "removed", text: "Text" },
        { kind: "added", text: "Other" },
      ],
    });
  });

  it("says same for equal content, and for content that differs only in the line break at its end", () => {
    expect(diffRevisions("# Title\nText", "# Title\nText")).toEqual({ kind: "same" });
    expect(diffRevisions("# Title\nText", "# Title\nText\n")).toEqual({ kind: "same" });
    expect(diffRevisions("", "")).toEqual({ kind: "same" });
  });

  it("compares empty content with content", () => {
    expect(diffRevisions("", "# Title\nText")).toEqual({
      kind: "lines",
      lines: [
        { kind: "added", text: "# Title" },
        { kind: "added", text: "Text" },
      ],
    });
    expect(diffRevisions("# Title", "")).toEqual({ kind: "lines", lines: [{ kind: "removed", text: "# Title" }] });
  });

  it("says too-different when more lines changed than the cap", () => {
    const older = Array.from({ length: DIFF_MAX_EDIT_LENGTH }, (_, index) => `a${index}`).join("\n");
    const newer = Array.from({ length: DIFF_MAX_EDIT_LENGTH }, (_, index) => `b${index}`).join("\n");

    expect(diffRevisions(older, newer)).toEqual({ kind: "too-different" });
  });

  it("still compares content just below the cap", () => {
    const count = DIFF_MAX_EDIT_LENGTH / 2 - 1;
    const older = Array.from({ length: count }, (_, index) => `a${index}`).join("\n");
    const newer = Array.from({ length: count }, (_, index) => `b${index}`).join("\n");

    expect(diffRevisions(older, newer)).toMatchObject({ kind: "lines" });
  });
});
