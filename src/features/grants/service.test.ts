import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "@/features/oauth/secret";
import {
  authenticateAccessToken,
  LAST_USE_INTERVAL_MS,
  listGrants,
  revokeAllGrants,
  revokeGrant,
} from "@/features/grants/service";
import type { Actor } from "@/features/users/service";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  isOAuthOn: vi.fn(),
  folderRoleOf: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    oAuthGrant: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      deleteMany: mocks.deleteMany,
    },
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));
vi.mock("@/features/oauth/issuer", () => ({ isOAuthOn: mocks.isOAuthOn }));
vi.mock("@/features/folder-roles/service", () => ({ folderRoleOf: mocks.folderRoleOf }));

/** A value of the shape of a former API token, which is never looked up. */
const FORMER_API_TOKEN = `hw_${"A".repeat(43)}`;
/** The access token of a grant, the only bearer token that `authenticateAccessToken` looks up. */
const ACCESS_TOKEN = `hwa_${"B".repeat(43)}`;
const HOUR_MS = 60 * 60 * 1000;
const ALICE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";
const GRANT_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
const ALICE: Actor = { id: ALICE_ID, name: "alice", type: "user" };
const NOW = new Date("2026-03-01T12:00:00.000Z");
const FOLDER_ID = "3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e11";
/** The MCP address of the grant of the tests: the Writer address of its folder. */
const ADDRESS = { folderId: FOLDER_ID, role: "writer" } as const;
/** What a valid access token gives: the actor of the grant's user and the connection of the grant. */
const CALLER = {
  actor: { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", type: "user" },
  connection: { grantId: "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01", folderId: FOLDER_ID, role: "writer" },
};

/** A grant as the database returns it for the columns of the list. */
function storedRow(data: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID,
    name: "Example connector",
    folder: { name: "projects" },
    role: "writer",
    createdAt: NOW,
    expiresAt: new Date("2026-05-30T12:00:00.000Z"),
    lastUsedAt: null,
    ...data,
  };
}

/**
 * A grant with its user as `authenticateAccessToken` reads it: valid, never used, and with an access token that works
 * for another hour.
 */
function tokenWithUser({ user = {}, ...data }: { user?: Record<string, unknown> } & Record<string, unknown> = {}) {
  return {
    id: GRANT_ID,
    folderId: FOLDER_ID,
    role: "writer",
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
  expect(logged()).not.toContain(ACCESS_TOKEN);
  expect(logged()).not.toContain(hashSecret(ACCESS_TOKEN));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mocks.isOAuthOn.mockReturnValue(true);
  mocks.findMany.mockResolvedValue([]);
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.findUnique.mockResolvedValue(tokenWithUser());
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.folderRoleOf.mockResolvedValue("writer");
});

afterEach(() => {
  vi.useRealTimers();
});

/** Whether the database was read or written. */
function expectDatabaseUntouched(): void {
  for (const call of [mocks.findMany, mocks.findUnique, mocks.updateMany, mocks.deleteMany]) {
    expect(call).not.toHaveBeenCalled();
  }
}

describe("listGrants", () => {
  it("reads only the actor's grants, newest first, with the fields of the list only", async () => {
    const row = storedRow({ lastUsedAt: NOW });
    mocks.findMany.mockResolvedValue([row]);

    await expect(listGrants(ALICE)).resolves.toStrictEqual([
      {
        id: GRANT_ID,
        name: "Example connector",
        folderName: "projects",
        role: "writer",
        createdAt: NOW,
        expiresAt: row.expiresAt,
        lastUsedAt: NOW,
      },
    ]);

    expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: ALICE_ID },
      select: {
        id: true,
        name: true,
        folder: { select: { name: true } },
        role: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("returns null without a public URL, without asking the database", async () => {
    mocks.isOAuthOn.mockReturnValue(false);

    await expect(listGrants(ALICE)).resolves.toBeNull();

    expectDatabaseUntouched();
    expectNothingLogged();
  });

  it("returns no apps for a malformed actor id, without asking the database", async () => {
    await expect(listGrants({ id: "not-a-uuid", name: "alice", type: "user" })).resolves.toEqual([]);

    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("throws a database error", async () => {
    mocks.findMany.mockRejectedValue(new Error("connection lost"));

    await expect(listGrants(ALICE)).rejects.toThrow("connection lost");
  });
});

describe("revokeAllGrants", () => {
  it("deletes all grants of the actor and none of another user in one write, returns their number and logs it", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 3 });

    await expect(revokeAllGrants(ALICE)).resolves.toEqual({ ok: true, value: { count: 3 } });

    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { userId: ALICE_ID } });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ actorId: ALICE_ID, count: 3 }, "all grants revoked");
  });

  it("returns 0 for an actor without grants", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });

    await expect(revokeAllGrants(ALICE)).resolves.toEqual({ ok: true, value: { count: 0 } });
  });

  it("refuses an admin, logged, without a write", async () => {
    await expect(revokeAllGrants({ ...ALICE, type: "admin" })).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });

    expectDatabaseUntouched();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { actorId: ALICE_ID },
      "grants not revoked: the actor is an admin",
    );
  });

  it("refuses without a public URL, logged, without a write", async () => {
    mocks.isOAuthOn.mockReturnValue(false);

    await expect(revokeAllGrants(ALICE)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

    expectDatabaseUntouched();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ actorId: ALICE_ID }, "grants not revoked: OAuth is off");
  });

  it("refuses a malformed actor id before it asks the database, and logs it", async () => {
    await expect(revokeAllGrants({ id: "not-a-uuid", name: "alice", type: "user" })).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });

    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("reports failed for a database error, and logs it", async () => {
    const err = new Error("connection lost");
    mocks.deleteMany.mockRejectedValue(err);

    await expect(revokeAllGrants(ALICE)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, actorId: ALICE_ID }, "failed to revoke all grants");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("revokeGrant", () => {
  it("deletes the grant only if it belongs to the actor", async () => {
    await expect(revokeGrant(ALICE, GRANT_ID)).resolves.toEqual({ ok: true, value: { id: GRANT_ID } });

    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: GRANT_ID, userId: ALICE_ID },
    });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ actorId: ALICE_ID, grantId: GRANT_ID }, "grant revoked");
  });

  it("reports a grant that is not the actor's or does not exist as not found, and logs it", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });

    await expect(revokeGrant(ALICE, GRANT_ID)).resolves.toEqual({ ok: false, error: { code: "grant-not-found" } });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { actorId: ALICE_ID, grantId: GRANT_ID },
      "grant to revoke not found",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("refuses without a public URL, logged, without a write", async () => {
    mocks.isOAuthOn.mockReturnValue(false);

    await expect(revokeGrant(ALICE, GRANT_ID)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

    expectDatabaseUntouched();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ actorId: ALICE_ID }, "grant not revoked: OAuth is off");
  });

  it("reports a malformed id as not found without asking the database or logging", async () => {
    for (const id of ["", "not-a-uuid", `${GRANT_ID}x`]) {
      await expect(revokeGrant(ALICE, id)).resolves.toEqual({ ok: false, error: { code: "grant-not-found" } });
    }

    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it("refuses a malformed actor id before it asks the database, and logs it", async () => {
    await expect(revokeGrant({ id: "not-a-uuid", name: "alice", type: "user" }, GRANT_ID)).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });

    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ actorId: "not-a-uuid" }, "malformed actor id");
  });

  it("reports failed for a database error, and logs it", async () => {
    const err = new Error("connection lost");
    mocks.deleteMany.mockRejectedValue(err);

    await expect(revokeGrant(ALICE, GRANT_ID)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, actorId: ALICE_ID, grantId: GRANT_ID },
      "failed to revoke grant",
    );
  });
});

describe("authenticateAccessToken", () => {
  /** Request headers with the access token as the bearer token. */
  const BEARER = () => authorization(`Bearer ${ACCESS_TOKEN}`);

  it.each([
    ["another role", { folderId: FOLDER_ID, role: "reader" }],
    ["another folder", { folderId: "4b6d8f01-2c3e-4a5b-9d1f-3e5a7b9d1f22", role: "writer" }],
  ] as const)(
    "refuses the access token at an address of %s as invalid, without reading a role or writing a last use",
    async (_case, address) => {
      await expect(authenticateAccessToken(BEARER(), address)).resolves.toEqual({
        ok: false,
        error: { code: "invalid-token" },
      });

      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { reason: "other-address", grantId: GRANT_ID },
        "access token refused",
      );
      expect(mocks.folderRoleOf).not.toHaveBeenCalled();
      expect(mocks.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["no role on the folder", null],
    ["a role below the role of the address", "reader"],
  ])("reports a user with %s as role-too-low, logs it and writes no last use", async (_case, role) => {
    mocks.folderRoleOf.mockResolvedValue(role);

    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toEqual({
      ok: false,
      error: { code: "role-too-low" },
    });

    expect(mocks.folderRoleOf).toHaveBeenCalledExactlyOnceWith(CALLER.actor, FOLDER_ID);
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { reason: "role-too-low", grantId: GRANT_ID, folderId: FOLDER_ID, grantRole: "writer", userRole: role },
      "access token refused",
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNoSecretLogged();
  });

  it.each(["writer", "manager", "owner"])("accepts a user whose role %s allows the address", async (role) => {
    mocks.folderRoleOf.mockResolvedValue(role);

    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toStrictEqual({ ok: true, value: CALLER });
  });

  it("reports failed when the role cannot be read", async () => {
    mocks.folderRoleOf.mockRejectedValue(new Error("connection lost"));

    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("refuses the access token of a grant of an admin as invalid, logs the reason and writes no last use", async () => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ user: { name: "maria", username: "maria", type: "admin" } }));

    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ reason: "admin", grantId: GRANT_ID }, "access token refused");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns the actor of the grant's user for a valid access token, looked up by its hash", async () => {
    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toStrictEqual({
      ok: true,
      value: CALLER,
    });

    expect(mocks.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { accessTokenHash: hashSecret(ACCESS_TOKEN) },
      select: {
        id: true,
        folderId: true,
        role: true,
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
    await expect(authenticateAccessToken(authorization(value), ADDRESS)).resolves.toMatchObject({ ok: true });
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
    ["a former API token", authorization(`Bearer ${FORMER_API_TOKEN}`)],
    ["a refresh token", authorization(`Bearer hwr_0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01.${"C".repeat(43)}`)],
    ["an authorization code", authorization(`Bearer hwc_${"C".repeat(43)}`)],
  ])("reports %s as a missing token, without asking the database or logging", async (_case, headers) => {
    await expect(authenticateAccessToken(headers, ADDRESS)).resolves.toEqual({
      ok: false,
      error: { code: "missing-token" },
    });

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it("reports an unknown access token as invalid, and logs the reason without the token", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ reason: "unknown" }, "access token refused");
    expectNoSecretLogged();
  });

  it("reports an expired grant as invalid, also at the moment it expires, and logs the grant id", async () => {
    for (const expiresAt of [new Date(NOW.getTime() - 1), NOW]) {
      mocks.findUnique.mockResolvedValue(tokenWithUser({ expiresAt }));

      await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toEqual({
        ok: false,
        error: { code: "invalid-token" },
      });
    }

    expect(mocks.warn).toHaveBeenCalledWith({ reason: "expired", grantId: GRANT_ID }, "access token refused");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNoSecretLogged();
  });

  it("accepts a grant a millisecond before it expires", async () => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ expiresAt: new Date(NOW.getTime() + 1) }));

    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["a millisecond after its end", -1],
    ["at the moment it ends", 0],
  ])("refuses an access token %s, although its grant lasts on, and logs the grant id", async (_case, offset) => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ accessTokenExpiresAt: new Date(NOW.getTime() + offset) }));

    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { reason: "access-token-expired", grantId: GRANT_ID },
      "access token refused",
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNoSecretLogged();
  });

  it("refuses an access token without an end of its own, which only a broken row has", async () => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ accessTokenExpiresAt: null }));

    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("reports the access token of a user with the first password as invalid", async () => {
    mocks.findUnique.mockResolvedValue(tokenWithUser({ user: { mustChangePassword: true } }));

    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { reason: "first-password", grantId: GRANT_ID },
      "access token refused",
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("reports failed when the database cannot be read, and logs it without the token", async () => {
    const err = new Error("connection lost");
    mocks.findUnique.mockRejectedValue(err);

    await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err }, "failed to look up access token");
    expectNoSecretLogged();
  });

  describe("the last use", () => {
    it("is written for a grant that was never used", async () => {
      expect(LAST_USE_INTERVAL_MS).toBe(60_000);

      await authenticateAccessToken(BEARER(), ADDRESS);

      const usedBefore = new Date(NOW.getTime() - 60_000);
      expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { id: GRANT_ID, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: usedBefore } }] },
        data: { lastUsedAt: NOW },
      });
    });

    it("is not written again within a minute", async () => {
      mocks.findUnique.mockResolvedValue(tokenWithUser({ lastUsedAt: new Date(NOW.getTime() - 59_999) }));

      await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toMatchObject({ ok: true });

      expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it("is written again once a minute has passed", async () => {
      mocks.findUnique.mockResolvedValue(tokenWithUser({ lastUsedAt: NOW }));
      await authenticateAccessToken(BEARER(), ADDRESS);
      expect(mocks.updateMany).not.toHaveBeenCalled();

      vi.setSystemTime(NOW.getTime() + 60_000);
      await authenticateAccessToken(BEARER(), ADDRESS);

      expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ data: { lastUsedAt: new Date(NOW.getTime() + 60_000) } }),
      );
    });

    it("does not refuse the request when it cannot be written, and is logged without the token", async () => {
      const err = new Error("connection lost");
      mocks.updateMany.mockRejectedValue(err);

      await expect(authenticateAccessToken(BEARER(), ADDRESS)).resolves.toStrictEqual({
        ok: true,
        value: CALLER,
      });

      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        { err, grantId: GRANT_ID },
        "failed to write the last use of a grant",
      );
      expectNoSecretLogged();
    });
  });
});

describe("an admin", () => {
  /** An admin, who has no grants; named like a user, so that only the type decides. */
  const ADMIN: Actor = { id: ALICE_ID, name: "alice", type: "admin" };

  it("gets null from listGrants, without asking the database", async () => {
    await expect(listGrants(ADMIN)).resolves.toBeNull();

    expectDatabaseUntouched();
    expectNothingLogged();
  });

  it("gets not-allowed from revokeGrant, logged, without a write", async () => {
    await expect(revokeGrant(ADMIN, GRANT_ID)).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

    expectDatabaseUntouched();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { actorId: ALICE_ID },
      "grant not revoked: the actor is an admin",
    );
  });
});
