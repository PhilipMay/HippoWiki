import { beforeEach, describe, expect, it, vi } from "vitest";

import { searchPages } from "@/features/search/service";
import { ACTOR, ADMIN, FOLDER_ID, MALFORMED_ID } from "@/test/unit";

const mocks = vi.hoisted(() => ({
  roleFindFirst: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  findMany: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ folderRole: { findFirst: mocks.roleFindFirst }, $transaction: mocks.transaction }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.roleFindFirst.mockResolvedValue({ role: "reader" });
  mocks.queryRaw.mockResolvedValue([]);
  mocks.findMany.mockResolvedValue([]);
  // An interactive transaction runs its callback with a client of its own.
  mocks.transaction.mockImplementation((run: (tx: unknown) => Promise<unknown>) =>
    run({ $queryRaw: mocks.queryRaw, page: { findMany: mocks.findMany } }),
  );
});

/** Whether any call reached the database. */
function reachedDatabase(): boolean {
  return mocks.roleFindFirst.mock.calls.length > 0 || mocks.transaction.mock.calls.length > 0;
}

describe("searchPages", () => {
  it("gives null to an admin without asking the database", async () => {
    expect(await searchPages(ADMIN, FOLDER_ID, "backup")).toBeNull();
    expect(reachedDatabase()).toBe(false);
  });

  it("gives null for a malformed folder id without asking the database", async () => {
    expect(await searchPages(ACTOR, MALFORMED_ID, "backup")).toBeNull();
    expect(reachedDatabase()).toBe(false);
  });

  it("gives null for a folder without a role of the actor, before the search", async () => {
    mocks.roleFindFirst.mockResolvedValue(null);

    expect(await searchPages(ACTOR, FOLDER_ID, "backup")).toBeNull();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns the error of the words without a search", async () => {
    expect(await searchPages(ACTOR, FOLDER_ID, "  ")).toEqual({ ok: false, error: { code: "no-words" } });
    expect(await searchPages(ACTOR, FOLDER_ID, "x".repeat(201))).toEqual({ ok: false, error: { code: "too-long" } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("throws a database error", async () => {
    const error = new Error("connection lost");
    mocks.queryRaw.mockRejectedValue(error);

    await expect(searchPages(ACTOR, FOLDER_ID, "backup")).rejects.toBe(error);
  });
});
