import { describe, expect, it } from "vitest";

import { changedPageForm } from "@/features/pages/changed-page";
import { formatDateTime } from "@/lib/format";

const updatedAt = new Date("2026-11-18T10:15:00Z");
const page = { version: 4, updatedAt, lastEditedBy: { name: "mike", via: "mcp" as const } };

describe("changedPageForm", () => {
  it("names who changed the page last, how and when, with the notice changed", () => {
    expect(changedPageForm(page, "changed")).toEqual({
      key: "4-changed",
      changedMessage: `This page was changed by mike via mcp at ${formatDateTime(updatedAt)} after you opened it.`,
    });
  });

  it("has no message without the notice", () => {
    expect(changedPageForm(page, null)).toEqual({ key: "4-", changedMessage: undefined });
  });

  it("gives a new key for a new version and for the notice", () => {
    const keys = new Set([
      changedPageForm(page, null).key,
      changedPageForm(page, "changed").key,
      changedPageForm({ ...page, version: 5 }, null).key,
    ]);
    expect(keys.size).toBe(3);
  });
});
