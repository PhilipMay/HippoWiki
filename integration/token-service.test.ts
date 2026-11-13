// Runs the token service against the test database, to check its reads and writes on real data.
import { afterEach, describe, expect, it, vi } from "vitest";

import * as authService from "@/features/auth/service";
import { hashToken } from "@/features/tokens/secret";
import * as tokenService from "@/features/tokens/service";

import { createUser, getTestDb, TEST_PASSWORD } from "../e2e/support/database";

const INPUT = { name: "MCP client", scopes: ["read"], expiry: "90d" };

/** A user of the test database as the actor of the service. */
async function createActor() {
  const user = await createUser({ mustChangePassword: false });
  return { id: user.id, name: user.name };
}

/** Creates a token through the service and fails the test if that does not succeed. */
async function createToken(actor: { id: string; name: string }, input: Partial<typeof INPUT> = {}) {
  const result = await tokenService.createToken(actor, { ...INPUT, ...input });
  if (!result.ok) return expect.fail(`token not created: ${result.error.code}`);
  return result.value;
}

describe("createToken", () => {
  it("stores the token's hash, never the token, and returns the token as stored", async () => {
    const alice = await createActor();

    const { token, secret } = await createToken(alice, { name: "  Laptop  ", scopes: ["read", "write"] });

    const rows = await getTestDb().apiToken.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      id: token.id,
      userId: alice.id,
      name: "Laptop",
      scopes: ["read", "write"],
      tokenHash: hashToken(secret),
      lastUsedAt: null,
    });
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(token).toStrictEqual({
      id: row?.id,
      name: "Laptop",
      scopes: ["read", "write"],
      createdAt: row?.createdAt,
      expiresAt: row?.expiresAt,
      lastUsedAt: null,
    });
  });

  it("lets the token expire after the chosen days", async () => {
    const alice = await createActor();
    const before = Date.now();

    const { token } = await createToken(alice, { expiry: "30d" });

    const days = (token.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThanOrEqual(30);
    expect(days).toBeLessThan(30 + 1 / 24);
  });

  it(`refuses the ${tokenService.MAX_TOKENS_PER_USER + 1}st token of a user, expired ones included`, async () => {
    const [alice, bob] = [await createActor(), await createActor()];
    await getTestDb().apiToken.create({
      data: { userId: alice.id, name: "old", scopes: ["read"], tokenHash: "e".repeat(64), expiresAt: new Date(0) },
    });
    for (let index = 1; index < tokenService.MAX_TOKENS_PER_USER; index += 1) await createToken(alice);

    await expect(tokenService.createToken(alice, INPUT)).resolves.toEqual({
      ok: false,
      error: { code: "limit-reached" },
    });
    expect(await getTestDb().apiToken.count({ where: { userId: alice.id } })).toBe(20);
    // The limit is per user.
    await createToken(bob);
  });

  it("refuses 21 tokens created at the same time beyond the limit", async () => {
    const alice = await createActor();

    const results = await Promise.all(
      Array.from({ length: tokenService.MAX_TOKENS_PER_USER + 3 }, () => tokenService.createToken(alice, INPUT)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(20);
    expect(results.filter((result) => !result.ok && result.error.code === "limit-reached")).toHaveLength(3);
    expect(await getTestDb().apiToken.count({ where: { userId: alice.id } })).toBe(20);
  });

  it("reports failed for an actor that does not exist", async () => {
    const ghost = { id: crypto.randomUUID(), name: "ghost" };

    await expect(tokenService.createToken(ghost, INPUT)).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(await getTestDb().apiToken.count()).toBe(0);
  });
});

describe("listTokens", () => {
  it("lists the actor's own tokens only, newest first, with exactly the declared fields", async () => {
    const [alice, bob] = [await createActor(), await createActor()];
    const first = await createToken(alice, { name: "first" });
    const second = await createToken(alice, { name: "second" });
    await createToken(bob, { name: "bob's" });
    await getTestDb().apiToken.update({ where: { id: first.token.id }, data: { lastUsedAt: new Date() } });
    const stored = await getTestDb().apiToken.findUniqueOrThrow({ where: { id: first.token.id } });

    const tokens = await tokenService.listTokens(alice);

    expect(tokens).toStrictEqual([
      second.token,
      {
        id: stored.id,
        name: "first",
        scopes: ["read"],
        createdAt: stored.createdAt,
        expiresAt: stored.expiresAt,
        lastUsedAt: stored.lastUsedAt,
      },
    ]);
    expect(await tokenService.listTokens(bob)).toMatchObject([{ name: "bob's" }]);
  });

  it("lists no tokens for a user without tokens", async () => {
    await createToken(await createActor());

    await expect(tokenService.listTokens(await createActor())).resolves.toEqual([]);
  });
});

describe("revokeToken", () => {
  it("deletes the actor's token", async () => {
    const alice = await createActor();
    const { token } = await createToken(alice);
    const other = await createToken(alice, { name: "other" });

    await expect(tokenService.revokeToken(alice, token.id)).resolves.toEqual({ ok: true, value: { id: token.id } });

    expect(await tokenService.listTokens(alice)).toStrictEqual([other.token]);
    await expect(tokenService.revokeToken(alice, token.id)).resolves.toEqual({
      ok: false,
      error: { code: "token-not-found" },
    });
  });

  it("does not revoke the token of another user", async () => {
    const [alice, bob] = [await createActor(), await createActor()];
    const { token } = await createToken(bob);

    await expect(tokenService.revokeToken(alice, token.id)).resolves.toEqual({
      ok: false,
      error: { code: "token-not-found" },
    });
    expect(await tokenService.listTokens(bob)).toStrictEqual([token]);
  });
});

describe("deleting a user", () => {
  it("deletes the user's tokens and no others", async () => {
    const [alice, bob] = [await createActor(), await createActor()];
    await createToken(alice);
    const bobsToken = await createToken(bob);

    await getTestDb().user.delete({ where: { id: alice.id } });

    expect(await getTestDb().apiToken.findMany({ select: { id: true } })).toEqual([{ id: bobsToken.token.id }]);
  });
});

describe("authenticateToken", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Request headers that carry the token as a bearer token. */
  function bearer(secret: string): Headers {
    return new Headers({ authorization: `Bearer ${secret}` });
  }

  it("returns the same actor as the session of the token's user", async () => {
    const alice = await createActor();
    const { secret } = await createToken(alice, { scopes: ["read", "write"] });
    const login = await authService.logIn({ name: alice.name, password: TEST_PASSWORD }, new Headers(), "shared");
    if (!login.ok) return expect.fail(`login failed: ${login.error.code}`);

    for (const scope of ["read", "write"] as const) {
      await expect(tokenService.authenticateToken(bearer(secret), scope)).resolves.toStrictEqual({
        ok: true,
        value: { id: login.value.user.id, name: login.value.user.name },
      });
    }
  });

  it("refuses a token that was revoked", async () => {
    const alice = await createActor();
    const { token, secret } = await createToken(alice);
    await tokenService.revokeToken(alice, token.id);

    await expect(tokenService.authenticateToken(bearer(secret), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses a token once the clock is past its expiry", async () => {
    const { token, secret } = await createToken(await createActor(), { expiry: "30d" });
    await expect(tokenService.authenticateToken(bearer(secret), "read")).resolves.toMatchObject({ ok: true });

    vi.useFakeTimers({ now: token.expiresAt.getTime() + 1, toFake: ["Date"] });

    await expect(tokenService.authenticateToken(bearer(secret), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses the token of a user who still has the first password", async () => {
    const user = await createUser({ mustChangePassword: false });
    const { secret } = await createToken({ id: user.id, name: user.name });
    await getTestDb().user.update({ where: { id: user.id }, data: { mustChangePassword: true } });

    await expect(tokenService.authenticateToken(bearer(secret), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses a scope the token lacks", async () => {
    const { secret } = await createToken(await createActor(), { scopes: ["write"] });

    await expect(tokenService.authenticateToken(bearer(secret), "read")).resolves.toEqual({
      ok: false,
      error: { code: "insufficient-scope" },
    });
  });

  it("refuses a token that is not stored, and a value that is no token", async () => {
    await createToken(await createActor());

    await expect(tokenService.authenticateToken(bearer(`hw_${"x".repeat(43)}`), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
    await expect(tokenService.authenticateToken(bearer("x".repeat(46)), "read")).resolves.toEqual({
      ok: false,
      error: { code: "missing-token" },
    });
  });

  it("sets the last use on the first use and not again within the minute", async () => {
    const alice = await createActor();
    const { token, secret } = await createToken(alice);
    const lastUse = async () => (await getTestDb().apiToken.findUniqueOrThrow({ where: { id: token.id } })).lastUsedAt;
    const start = Date.now();
    vi.useFakeTimers({ now: start, toFake: ["Date"] });

    await tokenService.authenticateToken(bearer(secret), "read");
    expect(await lastUse()).toEqual(new Date(start));

    vi.setSystemTime(start + 59_000);
    await tokenService.authenticateToken(bearer(secret), "read");
    expect(await lastUse()).toEqual(new Date(start));

    vi.setSystemTime(start + 60_000);
    await tokenService.authenticateToken(bearer(secret), "read");
    expect(await lastUse()).toEqual(new Date(start + 60_000));
    expect((await tokenService.listTokens(alice))[0]?.lastUsedAt).toEqual(new Date(start + 60_000));
  });
});
