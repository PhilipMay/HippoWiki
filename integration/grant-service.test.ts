// Runs the token service against the test database, to check its reads and writes of grants on real data.
import { afterEach, describe, expect, it, vi } from "vitest";

import * as authService from "@/features/auth/service";
import { isMcpRole } from "@/features/folder-roles/roles";
import * as grantService from "@/features/grants/service";
import { generateRefreshToken, hashSecret } from "@/features/oauth/secret";
import * as tokenService from "@/features/oauth/token-service";
import type { McpAddress } from "@/features/oauth/schema";
import type { Actor } from "@/features/users/service";

import { createFolder, createGrant, createUser, getTestDb, TEST_PASSWORD } from "../e2e/support/database";

/** A user of the test database as the actor of the service. */
async function createActor() {
  const user = await createUser({ mustChangePassword: false });
  return { id: user.id, name: user.name, type: user.type };
}

/** The fields of a grant that every entry of the list has, besides its folder name and its role. */
function summaryOf({
  id,
  name,
  createdAt,
  expiresAt,
  lastUsedAt,
}: {
  id: string;
  name: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
}) {
  return { id, name, createdAt, expiresAt, lastUsedAt };
}

/** The MCP address of the grant whose access token the value is, or another one if no grant has it. */
async function addressOfToken(secret: string): Promise<McpAddress> {
  const grant = await getTestDb().oAuthGrant.findUnique({ where: { accessTokenHash: hashSecret(secret) } });
  return grant && isMcpRole(grant.role)
    ? { folderId: grant.folderId, role: grant.role }
    : { folderId: crypto.randomUUID(), role: "reader" };
}

/** Checks the access token as MCP does at the given address, by default the address of its own grant. */
async function authenticate(secret: string, address?: McpAddress) {
  return grantService.authenticateAccessToken(
    new Headers({ authorization: `Bearer ${secret}` }),
    address ?? (await addressOfToken(secret)),
  );
}

describe("listGrants", () => {
  it("lists only the actor's grants, newest first, with the fields of the list, the folder name and the role", async () => {
    const [alice, bob] = [await createActor(), await createActor()];
    const projects = await createFolder({ name: "projects", roles: [{ user: alice, role: "writer" }] });
    const notes = await createFolder({ name: "notes", roles: [{ user: alice, role: "reader" }] });
    const older = await createGrant({
      owner: alice,
      folder: projects,
      role: "writer",
      createdAt: new Date(Date.now() - 1000),
    });
    const newer = await createGrant({ owner: alice, folder: notes, lastUsedAt: new Date() });
    await createGrant({ owner: bob });

    const apps = await grantService.listGrants(alice);

    expect(apps).toStrictEqual([
      { ...summaryOf(newer.grant), folderName: "notes", role: "reader" },
      { ...summaryOf(older.grant), folderName: "projects", role: "writer" },
    ]);
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

describe("revokeAllGrants", () => {
  /** A grant of the owner with an access token and a refresh token, as the token endpoint gives them. */
  async function grantWithTokens(owner: Actor) {
    const id = crypto.randomUUID();
    const refreshToken = generateRefreshToken(id);
    const created = await createGrant({ owner, id, refreshTokenHash: hashSecret(refreshToken) });
    return { ...created, refreshToken };
  }

  it("deletes every grant of the actor and none of another user, and their tokens are refused afterwards", async () => {
    const [alice, bob] = [await createActor(), await createActor()];
    const alices = [await grantWithTokens(alice), await grantWithTokens(alice)];
    const bobs = await grantWithTokens(bob);

    await expect(grantService.revokeAllGrants(alice)).resolves.toEqual({ ok: true, value: { count: 2 } });

    expect(await getTestDb().oAuthGrant.findMany({ select: { id: true } })).toEqual([{ id: bobs.grant.id }]);
    for (const { accessToken, refreshToken, client } of alices) {
      await expect(authenticate(accessToken)).resolves.toMatchObject({ ok: false, error: { code: "invalid-token" } });
      await expect(tokenService.refreshGrant({ refreshToken, clientId: client.id })).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid-grant" },
      });
    }
    await expect(authenticate(bobs.accessToken)).resolves.toMatchObject({ ok: true });
    await expect(
      tokenService.refreshGrant({ refreshToken: bobs.refreshToken, clientId: bobs.client.id }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("returns 0 for an actor without grants", async () => {
    await expect(grantService.revokeAllGrants(await createActor())).resolves.toEqual({ ok: true, value: { count: 0 } });
  });
});

describe("deleting a user", () => {
  it("deletes the user's grants and no others", async () => {
    const [alice, bob] = [await createActor(), await createActor()];
    // A folder without a role of the user: a role keeps a user from being deleted.
    await createGrant({ owner: alice, folder: await createFolder({ roles: [] }) });
    const bobs = await createGrant({ owner: bob });

    await getTestDb().user.delete({ where: { id: alice.id } });

    expect(await getTestDb().oAuthGrant.findMany({ select: { id: true } })).toEqual([{ id: bobs.grant.id }]);
  });
});

describe("authenticateAccessToken", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses the access token of a connection at another folder and at another role", async () => {
    const alice = await createActor();
    const [a, b] = [
      await createFolder({ roles: [{ user: alice, role: "owner" }] }),
      await createFolder({ roles: [{ user: alice, role: "owner" }] }),
    ];
    const { grant, accessToken } = await createGrant({ owner: alice, folder: a, role: "reader" });

    for (const address of [
      { folderId: a.id, role: "writer" },
      { folderId: b.id, role: "reader" },
    ] as const) {
      await expect(authenticate(accessToken, address)).resolves.toEqual({
        ok: false,
        error: { code: "invalid-token" },
      });
    }
    await expect(authenticate(accessToken, { folderId: a.id, role: "reader" })).resolves.toMatchObject({
      ok: true,
      value: { connection: { grantId: grant.id, folderId: a.id, role: "reader" } },
    });
  });

  it("refuses a connection above the current role while that lasts, names its user and grant, keeps the grant and writes no last use", async () => {
    const alice = await createActor();
    const folder = await createFolder({ roles: [{ user: alice, role: "writer" }] });
    const { grant, accessToken } = await createGrant({ owner: alice, folder, role: "writer" });
    const where = { folderId_userId: { folderId: folder.id, userId: alice.id } };
    // The error names the user and the grant of the token, so that the MCP route counts the request all the same.
    const refused = { ok: false, error: { code: "role-too-low", userId: alice.id, grantId: grant.id } };

    await getTestDb().folderRole.update({ where, data: { role: "reader" } });
    await expect(authenticate(accessToken)).resolves.toEqual(refused);
    await getTestDb().folderRole.delete({ where });
    await expect(authenticate(accessToken)).resolves.toEqual(refused);

    const stored = await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(stored.lastUsedAt).toBeNull();

    await getTestDb().folderRole.create({ data: { folderId: folder.id, userId: alice.id, role: "manager" } });
    await expect(authenticate(accessToken)).resolves.toMatchObject({ ok: true });
    expect((await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { id: grant.id } })).lastUsedAt).not.toBeNull();
  });

  it("accepts a Manager connection only while the user is Manager or Owner, and again once that holds again", async () => {
    const alice = await createActor();
    const folder = await createFolder({ roles: [{ user: alice, role: "manager" }] });
    const { grant, accessToken } = await createGrant({ owner: alice, folder, role: "manager" });
    const where = { folderId_userId: { folderId: folder.id, userId: alice.id } };
    const accepted = { ok: true, value: { connection: { grantId: grant.id, folderId: folder.id, role: "manager" } } };
    const refused = { ok: false, error: { code: "role-too-low", userId: alice.id, grantId: grant.id } };

    await expect(authenticate(accessToken)).resolves.toMatchObject(accepted);
    await getTestDb().folderRole.update({ where, data: { role: "owner" } });
    await expect(authenticate(accessToken)).resolves.toMatchObject(accepted);
    for (const role of ["writer", "reader"] as const) {
      await getTestDb().folderRole.update({ where, data: { role } });
      await expect(authenticate(accessToken)).resolves.toEqual(refused);
    }
    await getTestDb().folderRole.delete({ where });
    await expect(authenticate(accessToken)).resolves.toEqual(refused);

    await getTestDb().folderRole.create({ data: { folderId: folder.id, userId: alice.id, role: "manager" } });
    await expect(authenticate(accessToken)).resolves.toMatchObject(accepted);
  });

  it("returns the same actor as the session of the grant's user", async () => {
    const alice = await createActor();
    const { accessToken } = await createGrant({ owner: alice });
    const login = await authService.logIn({ name: alice.name, password: TEST_PASSWORD }, new Headers(), "shared");
    if (!login.ok) return expect.fail(`login failed: ${login.error.code}`);

    await expect(authenticate(accessToken)).resolves.toMatchObject({
      ok: true,
      value: { actor: { id: login.value.user.id, name: login.value.user.name, type: login.value.user.type } },
    });
  });

  it("refuses a former API token as missing", async () => {
    await createGrant({ owner: await createActor() });

    await expect(authenticate(`hw_${"A".repeat(43)}`)).resolves.toEqual({
      ok: false,
      error: { code: "missing-token" },
    });
  });

  it("refuses the access token of a grant that was revoked", async () => {
    const alice = await createActor();
    const { grant, accessToken } = await createGrant({ owner: alice });
    await grantService.revokeGrant(alice, grant.id);

    await expect(authenticate(accessToken)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses an access token once the clock is past its end", async () => {
    const { grant, accessToken } = await createGrant({ owner: await createActor() });
    await expect(authenticate(accessToken)).resolves.toMatchObject({
      ok: true,
    });

    vi.useFakeTimers({ now: (grant.accessTokenExpiresAt?.getTime() ?? 0) + 1, toFake: ["Date"] });

    await expect(authenticate(accessToken)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses an access token whose grant has expired", async () => {
    const { accessToken } = await createGrant({ owner: await createActor(), expiresAt: new Date(Date.now() - 1000) });

    await expect(authenticate(accessToken)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses the access token of a user who still has the first password", async () => {
    const user = await createUser({ mustChangePassword: false });
    const { accessToken } = await createGrant({ owner: user });
    await getTestDb().user.update({ where: { id: user.id }, data: { mustChangePassword: true } });

    await expect(authenticate(accessToken)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses the access token of a grant of an admin", async () => {
    const maria = await createUser({ name: "maria", type: "admin", mustChangePassword: false });
    const { accessToken } = await createGrant({ owner: maria });

    await expect(authenticate(accessToken)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
  });

  it("refuses an access token that is not stored, and a value that is no access token", async () => {
    await createGrant({ owner: await createActor() });

    await expect(authenticate(`hwa_${"x".repeat(43)}`)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-token" },
    });
    await expect(authenticate("x".repeat(46))).resolves.toEqual({
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

    await authenticate(accessToken);
    expect(await lastUse()).toEqual(new Date(start));

    vi.setSystemTime(start + 59_000);
    await authenticate(accessToken);
    expect(await lastUse()).toEqual(new Date(start));

    vi.setSystemTime(start + 60_000);
    await authenticate(accessToken);
    expect(await lastUse()).toEqual(new Date(start + 60_000));
    expect((await grantService.listGrants(alice))?.[0]?.lastUsedAt).toEqual(new Date(start + 60_000));
  });
});

describe("callerOfGrant", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A user with a role on a new folder and a grant at its address of the given role. */
  async function connected(role: "reader" | "writer" | "manager" = "writer", userRole = role) {
    const alice = await createActor();
    const folder = await createFolder({ roles: [{ user: alice, role: userRole }] });
    const { grant } = await createGrant({ owner: alice, folder, role });
    return { alice, folder, grant };
  }

  it("accepts a valid grant with the actor and the connection of the grant", async () => {
    const { alice, folder, grant } = await connected();

    await expect(grantService.callerOfGrant(grant.id)).resolves.toStrictEqual({
      actor: alice,
      connection: { grantId: grant.id, folderId: folder.id, role: "writer" },
    });
  });

  it("writes no last use", async () => {
    const { grant } = await connected();

    await grantService.callerOfGrant(grant.id);

    expect((await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { id: grant.id } })).lastUsedAt).toBeNull();
  });

  it("accepts a grant whose access token has ended, while the grant lasts", async () => {
    const { grant } = await connected("reader");
    vi.useFakeTimers({ now: (grant.accessTokenExpiresAt?.getTime() ?? 0) + 1, toFake: ["Date"] });

    await expect(grantService.callerOfGrant(grant.id)).resolves.toMatchObject({ connection: { grantId: grant.id } });
  });

  it("refuses a grant once the app is revoked", async () => {
    const { alice, grant } = await connected();
    await grantService.revokeGrant(alice, grant.id);

    await expect(grantService.callerOfGrant(grant.id)).resolves.toBeNull();
  });

  it("refuses a grant once all apps are revoked", async () => {
    const { alice, grant } = await connected();
    await grantService.revokeAllGrants(alice);

    await expect(grantService.callerOfGrant(grant.id)).resolves.toBeNull();
  });

  it("refuses a grant once the user changed the own password and disconnected the apps", async () => {
    const { alice, grant } = await connected();
    const login = await authService.logIn({ name: alice.name, password: TEST_PASSWORD }, new Headers(), "shared");
    if (!login.ok) return expect.fail(`login failed: ${login.error.code}`);
    const cookies = login.value.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
    const password = "my-new-password";

    const changed = await authService.changeOwnPassword(
      { currentPassword: TEST_PASSWORD, newPassword: password, repeatPassword: password },
      new Headers({ cookie: cookies.join("; ") }),
      "shared",
      true,
    );

    expect(changed.ok).toBe(true);
    await expect(grantService.callerOfGrant(grant.id)).resolves.toBeNull();
  });

  it("refuses a grant once its user is deleted", async () => {
    const alice = await createActor();
    // A folder without a role of the user: a role keeps a user from being deleted.
    const { grant } = await createGrant({ owner: alice, folder: await createFolder({ roles: [] }) });

    await getTestDb().user.delete({ where: { id: alice.id } });

    await expect(grantService.callerOfGrant(grant.id)).resolves.toBeNull();
  });

  it("refuses a grant at the end of the grant", async () => {
    const { grant } = await connected();
    await expect(grantService.callerOfGrant(grant.id)).resolves.not.toBeNull();

    vi.useFakeTimers({ now: grant.expiresAt.getTime(), toFake: ["Date"] });

    await expect(grantService.callerOfGrant(grant.id)).resolves.toBeNull();
  });

  it("refuses a grant while the role on the folder is below the role of the grant or taken away, and accepts it again once it is high enough", async () => {
    const { alice, folder, grant } = await connected("writer");
    const where = { folderId_userId: { folderId: folder.id, userId: alice.id } };

    await getTestDb().folderRole.update({ where, data: { role: "reader" } });
    await expect(grantService.callerOfGrant(grant.id)).resolves.toBeNull();
    await getTestDb().folderRole.delete({ where });
    await expect(grantService.callerOfGrant(grant.id)).resolves.toBeNull();

    await getTestDb().folderRole.create({ data: { folderId: folder.id, userId: alice.id, role: "owner" } });
    await expect(grantService.callerOfGrant(grant.id)).resolves.not.toBeNull();
  });

  it("refuses the grant of a user who still has the first password", async () => {
    const { alice, grant } = await connected();
    await getTestDb().user.update({ where: { id: alice.id }, data: { mustChangePassword: true } });

    await expect(grantService.callerOfGrant(grant.id)).resolves.toBeNull();
  });

  it("refuses a grant of an admin", async () => {
    const maria = await createUser({ name: "maria", type: "admin", mustChangePassword: false });
    const { grant } = await createGrant({ owner: maria });

    await expect(grantService.callerOfGrant(grant.id)).resolves.toBeNull();
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
