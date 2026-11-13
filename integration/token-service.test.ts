// Runs the token service against the test database, to check its reads and writes on real data.
import { describe, expect, it } from "vitest";

import { hashToken } from "@/features/tokens/secret";
import * as tokenService from "@/features/tokens/service";

import { createUser, getTestDb } from "../e2e/support/database";

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
