import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "@/features/tokens/secret";
import {
  authenticateToken,
  createToken,
  LAST_USE_INTERVAL_MS,
  listTokens,
  MAX_TOKENS_PER_USER,
  revokeToken,
} from "@/features/tokens/service";
import type { Actor } from "@/features/users/service";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
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
    apiToken: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      deleteMany: mocks.deleteMany,
    },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));
vi.mock(import("@/features/tokens/secret"), async (importOriginal) => ({
  ...(await importOriginal()),
  generateToken: mocks.generateToken,
}));

const SECRET = `hw_${"A".repeat(43)}`;
/** The access token of a grant, the only bearer token that `authenticateToken` looks up. */
const ACCESS_TOKEN = `hwa_${"B".repeat(43)}`;
const HOUR_MS = 60 * 60 * 1000;
const ALICE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";
const TOKEN_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
const ALICE: Actor = { id: ALICE_ID, name: "alice", type: "user" };
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
    // A token of the account page has no client.
    clientId: null,
    ...data,
  };
}

/** The summary that the service makes of a stored row: the client is told as whether the row is a grant. */
function summaryOf({ clientId, ...row }: ReturnType<typeof storedRow>) {
  return { ...row, isGrant: clientId !== null };
}

/**
 * A grant with its user as `authenticateToken` reads it: valid, with the scope `read`, never used, and with an access
 * token that works for another hour.
 */
function tokenWithUser({ user = {}, ...data }: { user?: Record<string, unknown> } & Record<string, unknown> = {}) {
  return {
    id: TOKEN_ID,
    scopes: ["read"],
    expiresAt: new Date("2026-05-30T12:00:00.000Z"),
    accessTokenExpiresAt: new Date(NOW.getTime() + HOUR_MS),
    lastUsedAt: null,
    user: { id: ALICE_ID, username: "alice", type: "user", mustChangePassword: false, ...user },
    ...data,
  };
}

/** Request headers with the given `Authorization` value. */
function authorization(value: string): Headers {
  return new Headers({ authorization: value });
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
  for (const secret of [SECRET, ACCESS_TOKEN]) {
    expect(logged()).not.toContain(secret);
    expect(logged()).not.toContain(hashToken(secret));
  }
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
  mocks.findUnique.mockResolvedValue(tokenWithUser());
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("listTokens", () => {
  it("reads the actor's tokens, newest first, with the fields of the list only", async () => {
    const row = storedRow({ lastUsedAt: NOW });
    mocks.findMany.mockResolvedValue([row]);

    await expect(listTokens(ALICE)).resolves.toStrictEqual([summaryOf(row)]);

    expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: ALICE_ID },
      select: {
        id: true,
        name: true,
        scopes: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
        clientId: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("says which rows are grants to OAuth clients, and never passes on the client or a hash", async () => {
    const grant = storedRow({
      id: "1d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a02",
      name: "Example connector",
      clientId: "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10",
    });
    mocks.findMany.mockResolvedValue([grant, storedRow()]);

    const tokens = (await listTokens(ALICE)) ?? [];

    expect(tokens.map(({ name, isGrant }) => [name, isGrant])).toEqual([
      ["Example connector", true],
      ["MCP client", false],
    ]);
    expect(Object.keys(tokens[0] ?? {}).sort()).toEqual(
      ["createdAt", "expiresAt", "id", "isGrant", "lastUsedAt", "name", "scopes"].sort(),
    );
    // The grant is read like every other token: one read, for the user's rows.
    expect(mocks.findMany.mock.calls[0]?.[0].where).toEqual({ userId: ALICE_ID });
  });

  it("leaves out scopes it does not know", async () => {
    mocks.findMany.mockResolvedValue([storedRow({ scopes: ["read", "admin", "write"] })]);

    await expect(listTokens(ALICE)).resolves.toMatchObject([{ scopes: ["read", "write"] }]);
  });

  it("returns no tokens for a malformed actor id, without asking the database", async () => {
    await expect(listTokens({ id: "not-a-uuid", name: "alice", type: "user" })).resolves.toEqual([]);

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

    expect(result).toStrictEqual({ ok: true, value: { token: summaryOf(storedRow()), secret: SECRET } });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        userId: ALICE_ID,
        name: "MCP client",
        scopes: ["read"],
        tokenHash: hashToken(SECRET),
        expiresAt: new Date("2026-05-30T12:00:00.000Z"),
      },
      select: {
        id: true,
        name: true,
        scopes: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
        clientId: true,
      },
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
    await expect(createToken({ id: "not-a-uuid", name: "alice", type: "user" }, INPUT)).resolves.toEqual({
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
    await expect(revokeToken({ id: "not-a-uuid", name: "alice", type: "user" }, TOKEN_ID)).resolves.toEqual({
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

describe("authenticateToken", () => {
  /** Request headers with the access token as the bearer token. */
  const BEARER = () => authorization(`Bearer ${ACCESS_TOKEN}`);

  it("refuses the access token of a grant of an admin as invalid, logs the reason and writes no last use", async () => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ user: { name: "maria", username: "maria", type: "admin" } }));

    await expect(authenticateToken(BEARER(), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ reason: "admin", tokenId: TOKEN_ID }, "token refused");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("refuses the access token of an admin for every scope", async () => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ scopes: ["read", "write"], user: { type: "admin" } }));

    for (const scope of ["read", "write"] as const) {
      await expect(authenticateToken(BEARER(), scope)).resolves.toEqual({
        ok: false,
        error: { code: "invalid-token" },
      });
    }
  });

  it("returns the actor of the grant's user for a valid access token, looked up by its hash", async () => {
    await expect(authenticateToken(BEARER(), "read")).resolves.toStrictEqual({
      ok: true,
      value: { id: ALICE_ID, name: "alice", type: "user" },
    });

    expect(mocks.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { accessTokenHash: hashToken(ACCESS_TOKEN) },
      select: {
        id: true,
        scopes: true,
        expiresAt: true,
        accessTokenExpiresAt: true,
        lastUsedAt: true,
        user: { select: { id: true, username: true, type: true, mustChangePassword: true } },
      },
    });
    expectNothingLogged();
  });

  it.each([
    ["the lowercase scheme", `bearer ${ACCESS_TOKEN}`],
    ["the uppercase scheme", `BEARER ${ACCESS_TOKEN}`],
    ["more than one space after the scheme", `Bearer    ${ACCESS_TOKEN}`],
    ["spaces around the value", `  Bearer ${ACCESS_TOKEN}  `],
  ])("reads an access token with %s", async (_case, value) => {
    await expect(authenticateToken(authorization(value), "read")).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["no header", new Headers()],
    ["an empty header", authorization("")],
    ["another scheme", authorization(`Basic ${ACCESS_TOKEN}`)],
    ["the scheme alone", authorization("Bearer")],
    ["no space after the scheme", authorization(`Bearer${ACCESS_TOKEN}`)],
    ["a value without the prefix", authorization(`Bearer ${ACCESS_TOKEN.slice(4)}`)],
    ["a value that is too short", authorization(`Bearer ${ACCESS_TOKEN.slice(0, -1)}`)],
    ["a value with other characters", authorization(`Bearer ${ACCESS_TOKEN.slice(0, -1)}=`)],
    ["two values", authorization(`Bearer ${ACCESS_TOKEN} ${ACCESS_TOKEN}`)],
    ["a former API token", authorization(`Bearer ${SECRET}`)],
    ["a refresh token", authorization(`Bearer hwr_0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01.${"C".repeat(43)}`)],
    ["an authorization code", authorization(`Bearer hwc_${"C".repeat(43)}`)],
  ])("reports %s as a missing token, without asking the database or logging", async (_case, headers) => {
    await expect(authenticateToken(headers, "read")).resolves.toEqual({
      ok: false,
      error: { code: "missing-token" },
    });

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it("reports an unknown access token as invalid, and logs the reason without the token", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(authenticateToken(BEARER(), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ reason: "unknown" }, "token refused");
    expectNoSecretLogged();
  });

  it("reports an expired grant as invalid, also at the moment it expires, and logs the grant id", async () => {
    for (const expiresAt of [new Date(NOW.getTime() - 1), NOW]) {
      mocks.findUnique.mockResolvedValue(tokenWithUser({ expiresAt }));

      await expect(authenticateToken(BEARER(), "read")).resolves.toEqual({
        ok: false,
        error: { code: "invalid-token" },
      });
    }

    expect(mocks.warn).toHaveBeenCalledWith({ reason: "expired", tokenId: TOKEN_ID }, "token refused");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNoSecretLogged();
  });

  it("accepts a grant a millisecond before it expires", async () => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ expiresAt: new Date(NOW.getTime() + 1) }));

    await expect(authenticateToken(BEARER(), "read")).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["a millisecond after its end", -1],
    ["at the moment it ends", 0],
  ])("refuses an access token %s, although its grant lasts on, and logs the grant id", async (_case, offset) => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ accessTokenExpiresAt: new Date(NOW.getTime() + offset) }));

    await expect(authenticateToken(BEARER(), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { reason: "access-token-expired", tokenId: TOKEN_ID },
      "token refused",
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNoSecretLogged();
  });

  it("refuses an access token without an end of its own, which only a broken row has", async () => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ accessTokenExpiresAt: null }));

    await expect(authenticateToken(BEARER(), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("reports the access token of a user with the first password as invalid", async () => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ user: { mustChangePassword: true } }));

    await expect(authenticateToken(BEARER(), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { reason: "first-password", tokenId: TOKEN_ID },
      "token refused",
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["read", ["write"]],
    ["write", ["read"]],
  ] as const)("reports a grant without the scope %s as insufficient", async (scope, scopes) => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ scopes }));

    await expect(authenticateToken(BEARER(), scope)).resolves.toEqual({
      ok: false,
      error: { code: "insufficient-scope" },
    });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { reason: "insufficient-scope", tokenId: TOKEN_ID, scope },
      "token refused",
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNoSecretLogged();
  });

  it("reports failed when the database cannot be read, and logs it without the token", async () => {
    const err = new Error("connection lost");
    mocks.findUnique.mockRejectedValue(err);

    await expect(authenticateToken(BEARER(), "read")).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err }, "failed to look up token");
    expectNoSecretLogged();
  });

  describe("the last use", () => {
    it("is written for a grant that was never used", async () => {
      expect(LAST_USE_INTERVAL_MS).toBe(60_000);

      await authenticateToken(BEARER(), "read");

      const usedBefore = new Date(NOW.getTime() - 60_000);
      expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { id: TOKEN_ID, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: usedBefore } }] },
        data: { lastUsedAt: NOW },
      });
    });

    it("is not written again within a minute", async () => {
      mocks.findUnique.mockResolvedValue(tokenWithUser({ lastUsedAt: new Date(NOW.getTime() - 59_999) }));

      await expect(authenticateToken(BEARER(), "read")).resolves.toMatchObject({ ok: true });

      expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it("is written again once a minute has passed", async () => {
      mocks.findUnique.mockResolvedValue(tokenWithUser({ lastUsedAt: NOW }));
      await authenticateToken(BEARER(), "read");
      expect(mocks.updateMany).not.toHaveBeenCalled();

      vi.setSystemTime(NOW.getTime() + 60_000);
      await authenticateToken(BEARER(), "read");

      expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ data: { lastUsedAt: new Date(NOW.getTime() + 60_000) } }),
      );
    });

    it("does not refuse the request when it cannot be written, and is logged without the token", async () => {
      const err = new Error("connection lost");
      mocks.updateMany.mockRejectedValue(err);

      await expect(authenticateToken(BEARER(), "read")).resolves.toStrictEqual({
        ok: true,
        value: { id: ALICE_ID, name: "alice", type: "user" },
      });

      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        { err, tokenId: TOKEN_ID },
        "failed to write the last use of a token",
      );
      expectNoSecretLogged();
    });
  });
});

describe("an admin", () => {
  /** An admin, who has no tokens and no grants; named like a user, so that only the type decides. */
  const ADMIN: Actor = { id: ALICE_ID, name: "alice", type: "admin" };

  /** Whether the database was read or written. */
  function expectDatabaseUntouched(): void {
    for (const call of [
      mocks.findMany,
      mocks.findUnique,
      mocks.updateMany,
      mocks.count,
      mocks.create,
      mocks.deleteMany,
      mocks.queryRaw,
      mocks.transaction,
    ]) {
      expect(call).not.toHaveBeenCalled();
    }
  }

  it("gets null from listTokens, without asking the database", async () => {
    await expect(listTokens(ADMIN)).resolves.toBeNull();

    expectDatabaseUntouched();
    expectNothingLogged();
  });

  it("gets not-allowed from createToken, logged, before the input is checked and without a write", async () => {
    await expect(createToken(ADMIN, INPUT)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });
    await expect(createToken(ADMIN, { name: "", scopes: [], expiry: "7d" })).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });

    expectDatabaseUntouched();
    expect(mocks.generateToken).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ actorId: ALICE_ID }, "token not created: the actor is an admin");
  });

  it("gets not-allowed from revokeToken, logged, without a write", async () => {
    await expect(revokeToken(ADMIN, TOKEN_ID)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

    expectDatabaseUntouched();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { actorId: ALICE_ID },
      "token not revoked: the actor is an admin",
    );
  });
});
