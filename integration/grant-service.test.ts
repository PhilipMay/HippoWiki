// Runs the token service against the test database, to check its reads and writes of grants on real data.
import { afterEach, describe, expect, it, vi } from "vitest";

import * as authService from "@/features/auth/service";
import * as grantService from "@/features/grants/service";
import type { Actor } from "@/features/users/service";

import { createGrant, createUser, getTestDb, TEST_PASSWORD } from "../e2e/support/database";

/** A user of the test database as the actor of the service. */
async function createActor() {
  const user = await createUser({ mustChangePassword: false });
  return { id: user.id, name: user.name, type: user.type };
}

describe("listGrants", () => {
  it("lists only the actor's grants, newest first, with the fields of the list and nothing else", async () => {
    const [alice, bob] = [await createActor(), await createActor()];
    const older = await createGrant({ owner: alice, createdAt: new Date(Date.now() - 1000) });
    const newer = await createGrant({ owner: alice, lastUsedAt: new Date() });
    await createGrant({ owner: bob });

    const apps = await grantService.listGrants(alice);

    expect(apps).toStrictEqual(
      [newer.grant, older.grant].map(({ id, name, createdAt, expiresAt, lastUsedAt }) => ({
        id,
        name,
        createdAt,
        expiresAt,
        lastUsedAt,
      })),
    );
    // No hash and no client leaves the service.
    expect(JSON.stringify(apps)).not.toContain(newer.grant.accessTokenHash);
    expect(JSON.stringify(apps)).not.toContain(newer.client.id);
  });

  it("lists no apps for a user without grants", async () => {
    await createGrant({ owner: await createActor() });

    await expect(grantService.listGrants(await createActor())).resolves.toEqual([]);
  });
});

describe("revokeGrant", () => {
  it("deletes the actor's grant and keeps the client", async () => {
    const alice = await createActor();
    const { grant } = await createGrant({ owner: alice });
    const other = await createGrant({ owner: alice });

    await expect(grantService.revokeGrant(alice, grant.id)).resolves.toEqual({ ok: true, value: { id: grant.id } });

    expect(await getTestDb().oAuthGrant.findMany({ select: { id: true } })).toEqual([{ id: other.grant.id }]);
    // The client stays: another user may have a grant to it.
    expect(await getTestDb().oAuthClient.count()).toBe(2);
    await expect(grantService.revokeGrant(alice, grant.id)).resolves.toEqual({
      ok: false,
      error: { code: "grant-not-found" },
    });
  });

  it("does not revoke the grant of another user", async () => {
    const [alice, bob] = [await createActor(), await createActor()];
    const { grant } = await createGrant({ owner: bob });

    await expect(grantService.revokeGrant(alice, grant.id)).resolves.toEqual({
      ok: false,
      error: { code: "grant-not-found" },
    });
    expect(await getTestDb().oAuthGrant.count()).toBe(1);
  });
});

describe("deleting a user", () => {
  it("deletes the user's grants and no others", async () => {
    const [alice, bob] = [await createActor(), await createActor()];
    await createGrant({ owner: alice });
    const bobs = await createGrant({ owner: bob });

    await getTestDb().user.delete({ where: { id: alice.id } });

    expect(await getTestDb().oAuthGrant.findMany({ select: { id: true } })).toEqual([{ id: bobs.grant.id }]);
  });
});

describe("authenticateAccessToken", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Request headers that carry the value as a bearer token. */
  function bearer(secret: string): Headers {
    return new Headers({ authorization: `Bearer ${secret}` });
  }

  it("returns the same actor as the session of the grant's user", async () => {
    const alice = await createActor();
    const { accessToken } = await createGrant({ owner: alice });
    const login = await authService.logIn({ name: alice.name, password: TEST_PASSWORD }, new Headers(), "shared");
    if (!login.ok) return expect.fail(`login failed: ${login.error.code}`);

    await expect(grantService.authenticateAccessToken(bearer(accessToken), "read")).resolves.toStrictEqual({
      ok: true,
      value: { id: login.value.user.id, name: login.value.user.name, type: login.value.user.type },
    });
  });

  it("refuses a former API token as missing", async () => {
    await createGrant({ owner: await createActor() });

    await expect(grantService.authenticateAccessToken(bearer(`hw_${"A".repeat(43)}`), "read")).resolves.toEqual({
      ok: false,
      error: { code: "missing-token" },
    });
  });

  it("refuses the access token of a grant that was revoked", async () => {
    const alice = await createActor();
    const { grant, accessToken } = await createGrant({ owner: alice });
    await grantService.revokeGrant(alice, grant.id);

    await expect(grantService.authenticateAccessToken(bearer(accessToken), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses an access token once the clock is past its end", async () => {
    const { grant, accessToken } = await createGrant({ owner: await createActor() });
    await expect(grantService.authenticateAccessToken(bearer(accessToken), "read")).resolves.toMatchObject({
      ok: true,
    });

    vi.useFakeTimers({ now: (grant.accessTokenExpiresAt?.getTime() ?? 0) + 1, toFake: ["Date"] });

    await expect(grantService.authenticateAccessToken(bearer(accessToken), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses an access token whose grant has expired", async () => {
    const { accessToken } = await createGrant({ owner: await createActor(), expiresAt: new Date(Date.now() - 1000) });

    await expect(grantService.authenticateAccessToken(bearer(accessToken), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses the access token of a user who still has the first password", async () => {
    const user = await createUser({ mustChangePassword: false });
    const { accessToken } = await createGrant({ owner: user });
    await getTestDb().user.update({ where: { id: user.id }, data: { mustChangePassword: true } });

    await expect(grantService.authenticateAccessToken(bearer(accessToken), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses the access token of a grant of an admin", async () => {
    const maria = await createUser({ name: "maria", type: "admin", mustChangePassword: false });
    const { accessToken } = await createGrant({ owner: maria });

    await expect(grantService.authenticateAccessToken(bearer(accessToken), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses a scope the grant lacks", async () => {
    const { accessToken } = await createGrant({ owner: await createActor(), scopes: ["write"] });

    await expect(grantService.authenticateAccessToken(bearer(accessToken), "read")).resolves.toEqual({
      ok: false,
      error: { code: "insufficient-scope" },
    });
  });

  it("refuses an access token that is not stored, and a value that is no access token", async () => {
    await createGrant({ owner: await createActor() });

    await expect(grantService.authenticateAccessToken(bearer(`hwa_${"x".repeat(43)}`), "read")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
    await expect(grantService.authenticateAccessToken(bearer("x".repeat(46)), "read")).resolves.toEqual({
      ok: false,
      error: { code: "missing-token" },
    });
  });

  it("sets the last use on the first use and not again within the minute", async () => {
    const alice = await createActor();
    const { grant, accessToken } = await createGrant({ owner: alice });
    const lastUse = async () =>
      (await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { id: grant.id } })).lastUsedAt;
    const start = Date.now();
    vi.useFakeTimers({ now: start, toFake: ["Date"] });

    await grantService.authenticateAccessToken(bearer(accessToken), "read");
    expect(await lastUse()).toEqual(new Date(start));

    vi.setSystemTime(start + 59_000);
    await grantService.authenticateAccessToken(bearer(accessToken), "read");
    expect(await lastUse()).toEqual(new Date(start));

    vi.setSystemTime(start + 60_000);
    await grantService.authenticateAccessToken(bearer(accessToken), "read");
    expect(await lastUse()).toEqual(new Date(start + 60_000));
    expect((await grantService.listGrants(alice))?.[0]?.lastUsedAt).toEqual(new Date(start + 60_000));
  });
});

describe("an admin", () => {
  it("has no list of apps and cannot revoke a grant", async () => {
    const maria = await createUser({ name: "maria", type: "admin", mustChangePassword: false });
    const admin: Actor = { id: maria.id, name: maria.username, type: maria.type };
    // Admins have no grants; one inserted directly stands for a grant that should not exist.
    const { grant } = await createGrant({ owner: maria });

    await expect(grantService.listGrants(admin)).resolves.toBeNull();
    await expect(grantService.revokeGrant(admin, grant.id)).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });

    expect(await getTestDb().oAuthGrant.count({ where: { userId: maria.id } })).toBe(1);
  });
});
