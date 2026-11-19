import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEARCH_MAX_RUNNING } from "@/features/search/limits";
import { searchPages } from "@/features/search/service";
import { ACTOR, ADMIN, FOLDER_ID, GRANT_ID, knownError, MALFORMED_ID, mcpActor } from "@/test/unit";

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

/** The error of a statement that the database stopped after its time limit, as Prisma reports it. */
const STATEMENT_TIMEOUT = knownError("P2010", { driverAdapterError: { cause: { code: "57014" } } });

/** A word that must never be logged. */
const SECRET = "incidentmallory";

/** The fields of the log lines of the searches, as one text to look for a word in. */
function loggedText(): string {
  return JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls]);
}

describe("the outcomes of a search", () => {
  it("returns no results as found and logs them without a word", async () => {
    expect(await searchPages(ACTOR, FOLDER_ID, `${SECRET} "backup server"`)).toEqual({
      ok: true,
      value: { results: [], total: 0, more: false },
    });
    expect(mocks.info).toHaveBeenCalledWith(
      {
        actorId: ACTOR.id,
        channel: "web",
        folderId: FOLDER_ID,
        outcome: "found",
        results: 0,
        durationMs: expect.any(Number) as number,
        characters: SECRET.length + 16,
        words: 3,
      },
      "search",
    );
    expect(loggedText()).not.toContain(SECRET);
  });

  it("names the grant of a search through MCP", async () => {
    await searchPages(mcpActor("reader"), FOLDER_ID, SECRET);
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "mcp", grantId: GRANT_ID, outcome: "found" }),
      "search",
    );
    expect(loggedText()).not.toContain(SECRET);
  });

  it.each([
    ["no-words", " - "],
    ["too-long", `${SECRET} `.repeat(20)],
    ["too-long", Array.from({ length: 11 }, (_, index) => `${SECRET}${index}`).join(" ")],
  ])("logs %s without a word, and searches nothing", async (code, input) => {
    expect(await searchPages(ACTOR, FOLDER_ID, input)).toEqual({ ok: false, error: { code } });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: code, results: null, words: null, characters: [...input.trim()].length }),
      "search",
    );
    expect(loggedText()).not.toContain(SECRET);
  });

  it("answers a search that the database stopped as too broad, and logs it without a word", async () => {
    mocks.queryRaw.mockRejectedValue(STATEMENT_TIMEOUT);

    expect(await searchPages(ACTOR, FOLDER_ID, SECRET)).toEqual({ ok: false, error: { code: "too-broad" } });
    expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ outcome: "too-broad", words: 1 }), "search");
    expect(loggedText()).not.toContain(SECRET);
  });

  it("logs a database error without a word", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("connection lost"));

    await expect(searchPages(ACTOR, FOLDER_ID, SECRET)).rejects.toThrow("connection lost");
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR.id, folderId: FOLDER_ID }),
      "search failed",
    );
    expect(loggedText()).not.toContain(SECRET);
  });

  it("answers a search beyond the running ones as busy at once, and runs the next one after", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => {
      await held;
      return run({ $queryRaw: mocks.queryRaw, page: { findMany: mocks.findMany } });
    });
    const running = Array.from({ length: SEARCH_MAX_RUNNING }, () => searchPages(ACTOR, FOLDER_ID, "backup"));
    // The role of the actor is read before a search takes its slot.
    await vi.waitFor(() => expect(mocks.transaction).toHaveBeenCalledTimes(SEARCH_MAX_RUNNING));

    expect(await searchPages(ACTOR, FOLDER_ID, SECRET)).toEqual({ ok: false, error: { code: "busy" } });
    expect(mocks.transaction).toHaveBeenCalledTimes(SEARCH_MAX_RUNNING);
    expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ outcome: "busy", words: 1 }), "search");
    expect(loggedText()).not.toContain(SECRET);

    release();
    for (const result of await Promise.all(running)) expect(result?.ok).toBe(true);
    expect((await searchPages(ACTOR, FOLDER_ID, "backup"))?.ok).toBe(true);
  });

  it("frees the slot of a search that failed", async () => {
    mocks.queryRaw.mockRejectedValue(STATEMENT_TIMEOUT);
    for (let index = 0; index <= SEARCH_MAX_RUNNING; index++) {
      expect(await searchPages(ACTOR, FOLDER_ID, "backup")).toEqual({ ok: false, error: { code: "too-broad" } });
    }
    mocks.queryRaw.mockRejectedValue(new Error("connection lost"));
    for (let index = 0; index <= SEARCH_MAX_RUNNING; index++) {
      await expect(searchPages(ACTOR, FOLDER_ID, "backup")).rejects.toThrow("connection lost");
    }
  });
});
