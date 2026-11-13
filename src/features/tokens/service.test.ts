import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "@/features/tokens/secret";
import { createToken, listTokens, MAX_TOKENS_PER_USER, revokeToken } from "@/features/tokens/service";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  generateToken: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    apiToken: { findMany: mocks.findMany, deleteMany: mocks.deleteMany },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));
vi.mock(import("@/features/tokens/secret"), async (importOriginal) => ({
  ...(await importOriginal()),
  generateToken: mocks.generateToken,
}));

const SECRET = `hw_${"A".repeat(43)}`;
const ALICE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";
const TOKEN_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
const ALICE = { id: ALICE_ID, name: "alice" };
const NOW = new Date("2026-03-01T12:00:00.000Z");
const INPUT = { name: "MCP client", scopes: ["read"], expiry: "90d" };

/** A token row as the database returns it for the declared columns. */
function storedRow(data: Record<string, unknown> = {}) {
  return {
    id: TOKEN_ID,
    name: "MCP client",
    scopes: ["read"],
    createdAt: NOW,
    expiresAt: new Date("2026-05-30T12:00:00.000Z"),
    lastUsedAt: null,
    ...data,
  };
}

function knownError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("database error", { code, clientVersion: "test", meta });
}

/** Everything that was passed to the logger, as one string. */
function logged(): string {
  return JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls]);
}

function expectNothingLogged(): void {
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.warn).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
}

function expectNoSecretLogged(): void {
  expect(logged()).not.toContain(SECRET);
  expect(logged()).not.toContain(hashToken(SECRET));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mocks.generateToken.mockReturnValue(SECRET);
  // The transaction client of `createToken`: the reads and writes it makes inside the transaction.
  const tx = { $queryRaw: mocks.queryRaw, apiToken: { count: mocks.count, create: mocks.create } };
  mocks.transaction.mockImplementation((write: (client: typeof tx) => Promise<unknown>) => write(tx));
  mocks.queryRaw.mockResolvedValue([{ id: ALICE_ID }]);
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue(storedRow());
  mocks.findMany.mockResolvedValue([]);
  mocks.deleteMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("listTokens", () => {
  it("reads the actor's tokens, newest first, with the fields of the list only", async () => {
    const row = storedRow({ lastUsedAt: NOW });
    mocks.findMany.mockResolvedValue([row]);

    await expect(listTokens(ALICE)).resolves.toStrictEqual([row]);

    expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: ALICE_ID },
      select: { id: true, name: true, scopes: true, createdAt: true, expiresAt: true, lastUsedAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("leaves out scopes it does not know", async () => {
    mocks.findMany.mockResolvedValue([storedRow({ scopes: ["read", "admin", "write"] })]);

    await expect(listTokens(ALICE)).resolves.toMatchObject([{ scopes: ["read", "write"] }]);
  });

  it("returns no tokens for a malformed actor id, without asking the database", async () => {
    await expect(listTokens({ id: "not-a-uuid", name: "alice" })).resolves.toEqual([]);

    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("throws a database error", async () => {
    mocks.findMany.mockRejectedValue(new Error("connection lost"));

    await expect(listTokens(ALICE)).rejects.toThrow("connection lost");
  });
});

describe("createToken", () => {
  it("stores the hash of a new token and returns the token as stored together with the token itself", async () => {
    const result = await createToken(ALICE, { ...INPUT, name: "  MCP client  " });

    expect(result).toStrictEqual({ ok: true, value: { token: storedRow(), secret: SECRET } });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        userId: ALICE_ID,
        name: "MCP client",
        scopes: ["read"],
        tokenHash: hashToken(SECRET),
        expiresAt: new Date("2026-05-30T12:00:00.000Z"),
      },
      select: { id: true, name: true, scopes: true, createdAt: true, expiresAt: true, lastUsedAt: true },
    });
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(SECRET);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ userId: ALICE_ID, tokenId: TOKEN_ID }, "token created");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expectNoSecretLogged();
  });

  it.each([
    ["30d", "2026-03-31T12:00:00.000Z"],
    ["90d", "2026-05-30T12:00:00.000Z"],
    ["365d", "2027-03-01T12:00:00.000Z"],
  ])("lets a token of %s expire at %s", async (expiry, expiresAt) => {
    await createToken(ALICE, { ...INPUT, expiry });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expiresAt: new Date(expiresAt) }) as unknown }),
    );
  });

  it("stores both scopes", async () => {
    await createToken(ALICE, { ...INPUT, scopes: ["write", "read"] });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scopes: ["write", "read"] }) as unknown }),
    );
  });

  it("locks the actor's row and counts the actor's tokens in the same transaction as the write", async () => {
    await createToken(ALICE, INPUT);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    const [sql, id] = mocks.queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join("?")).toContain("FOR UPDATE");
    expect(id).toBe(ALICE_ID);
    expect(mocks.count).toHaveBeenCalledExactlyOnceWith({ where: { userId: ALICE_ID } });
  });

  it("reports invalid input with its field errors, and writes and logs nothing", async () => {
    const result = await createToken(ALICE, { name: "", scopes: [], expiry: "7d" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid-input",
        fieldErrors: {
          name: ["Name is required"],
          scopes: ["Choose at least one scope"],
          expiry: ["Choose when the token expires"],
        },
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it("refuses a malformed actor id before it asks the database, and logs it", async () => {
    await expect(createToken({ id: "not-a-uuid", name: "alice" }, INPUT)).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ actorId: "not-a-uuid" }, "malformed actor id");
  });

  it(`refuses a token when the actor holds ${MAX_TOKENS_PER_USER} tokens, and writes nothing`, async () => {
    expect(MAX_TOKENS_PER_USER).toBe(20);
    mocks.count.mockResolvedValue(20);

    await expect(createToken(ALICE, INPUT)).resolves.toEqual({ ok: false, error: { code: "limit-reached" } });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: ALICE_ID },
      "token not created: the user holds the most tokens allowed",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("creates the 20th token", async () => {
    mocks.count.mockResolvedValue(19);

    await expect(createToken(ALICE, INPUT)).resolves.toMatchObject({ ok: true });
  });

  it("reports failed for an actor that does not exist, and writes nothing", async () => {
    mocks.queryRaw.mockResolvedValue([]);

    await expect(createToken(ALICE, INPUT)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ userId: ALICE_ID }, "actor of new token not found");
  });

  it("reports failed for a hash that is already stored, without logging the error with its values", async () => {
    mocks.create.mockRejectedValue(
      knownError("P2002", { driverAdapterError: { cause: { constraint: { index: "ApiToken_tokenHash_key" } } } }),
    );

    await expect(createToken(ALICE, INPUT)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ userId: ALICE_ID }, "hash of new token already in use");
    expectNoSecretLogged();
  });

  it("reports failed for any other database error, and logs it", async () => {
    const err = new Error("connection lost");
    mocks.create.mockRejectedValue(err);

    await expect(createToken(ALICE, INPUT)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, userId: ALICE_ID }, "failed to create token");
    expectNoSecretLogged();
  });
});

describe("revokeToken", () => {
  it("deletes the token only if it belongs to the actor", async () => {
    await expect(revokeToken(ALICE, TOKEN_ID)).resolves.toEqual({ ok: true, value: { id: TOKEN_ID } });

    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id: TOKEN_ID, userId: ALICE_ID } });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ userId: ALICE_ID, tokenId: TOKEN_ID }, "token revoked");
  });

  it("reports a token that is not the actor's or does not exist as not found, and logs it", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });

    await expect(revokeToken(ALICE, TOKEN_ID)).resolves.toEqual({ ok: false, error: { code: "token-not-found" } });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: ALICE_ID, tokenId: TOKEN_ID },
      "token to revoke not found",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("reports a malformed id as not found without asking the database or logging", async () => {
    for (const id of ["", "not-a-uuid", `${TOKEN_ID}x`]) {
      await expect(revokeToken(ALICE, id)).resolves.toEqual({ ok: false, error: { code: "token-not-found" } });
    }

    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it("refuses a malformed actor id before it asks the database, and logs it", async () => {
    await expect(revokeToken({ id: "not-a-uuid", name: "alice" }, TOKEN_ID)).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });

    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ actorId: "not-a-uuid" }, "malformed actor id");
  });

  it("reports failed for a database error, and logs it", async () => {
    const err = new Error("connection lost");
    mocks.deleteMany.mockRejectedValue(err);

    await expect(revokeToken(ALICE, TOKEN_ID)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, userId: ALICE_ID, tokenId: TOKEN_ID },
      "failed to revoke token",
    );
  });
});
