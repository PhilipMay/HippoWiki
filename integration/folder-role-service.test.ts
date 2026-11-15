// Runs the folder roles service against the test database, to check its reads and writes on real data.
import { beforeEach, describe, expect, it } from "vitest";

import * as folderRoleService from "@/features/folder-roles/service";
import type { User } from "@/generated/prisma/client";

import { createFolder, createUser, getTestDb } from "../e2e/support/database";

/** The user who reads, unless a test says otherwise; created anew for every test. */
let actor: User;

beforeEach(async () => {
  actor = await createUser({ name: "carla" });
});

describe("listFolderRoles", () => {
  it("lists Owners first, then Managers, Writers and Readers, each group by user name", async () => {
    const [zoe, anna, ben, dave] = [
      await createUser({ name: "zoe" }),
      await createUser({ name: "anna" }),
      await createUser({ name: "ben" }),
      await createUser({ name: "dave" }),
    ];
    const folder = await createFolder({
      roles: [
        { user: actor, role: "reader" },
        { user: zoe, role: "owner" },
        { user: ben, role: "writer" },
        { user: anna, role: "owner" },
        { user: dave, role: "reader" },
      ],
    });
    await createFolder({ roles: [{ user: anna, role: "manager" }] });

    expect(
      (await folderRoleService.listFolderRoles(actor, folder.id))?.map(({ user, role }) => [user.name, role]),
    ).toEqual([
      ["anna", "owner"],
      ["zoe", "owner"],
      ["ben", "writer"],
      ["carla", "reader"],
      ["dave", "reader"],
    ]);
  });

  it("returns exactly the declared fields", async () => {
    const folder = await createFolder({ roles: [{ user: actor, role: "manager" }] });

    await expect(folderRoleService.listFolderRoles(actor, folder.id)).resolves.toStrictEqual([
      { user: { id: actor.id, name: "carla" }, role: "manager" },
    ]);
  });

  it("returns null without a role of the actor on the folder, and for an admin", async () => {
    const bob = await createUser({ name: "bob" });
    const admin = await createUser({ name: "maria", type: "admin" });
    const folder = await createFolder({ roles: [{ user: bob, role: "owner" }] });

    await expect(folderRoleService.listFolderRoles(actor, folder.id)).resolves.toBeNull();
    await expect(folderRoleService.listFolderRoles(admin, folder.id)).resolves.toBeNull();
  });
});

describe("giveRole", () => {
  it("stores the role and lists the user in the roles", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ name: "docs", roles: [{ user: actor, role: "owner" }] });

    await expect(folderRoleService.giveRole(actor, folder.id, { user: "bob", role: "writer" })).resolves.toEqual({
      ok: true,
      value: { folder: { name: "docs" }, user: { id: bob.id, name: "bob" }, role: "writer" },
    });
    expect(
      (await folderRoleService.listFolderRoles(actor, folder.id))?.map(({ user, role }) => [user.name, role]),
    ).toEqual([
      ["carla", "owner"],
      ["bob", "writer"],
    ]);
  });

  it("gives a user who already has a role role-taken and keeps the role", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({
      roles: [
        { user: actor, role: "owner" },
        { user: bob, role: "reader" },
      ],
    });

    await expect(folderRoleService.giveRole(actor, folder.id, { user: "bob", role: "owner" })).resolves.toEqual({
      ok: false,
      error: { code: "role-taken" },
    });
    expect(await getTestDb().folderRole.findMany({ where: { userId: bob.id }, select: { role: true } })).toEqual([
      { role: "reader" },
    ]);
  });

  it("gives the name of an admin user-not-found and stores nothing", async () => {
    await createUser({ name: "maria", type: "admin" });
    const folder = await createFolder({ roles: [{ user: actor, role: "owner" }] });

    await expect(folderRoleService.giveRole(actor, folder.id, { user: "maria", role: "owner" })).resolves.toEqual({
      ok: false,
      error: { code: "user-not-found" },
    });
    expect(await getTestDb().folderRole.count()).toBe(1);
  });

  it("lets a Manager give nothing", async () => {
    await createUser({ name: "bob" });
    const folder = await createFolder({ roles: [{ user: actor, role: "manager" }] });

    await expect(folderRoleService.giveRole(actor, folder.id, { user: "bob", role: "reader" })).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    expect(await getTestDb().folderRole.count()).toBe(1);
  });
});

describe("listRoleCandidates", () => {
  it("lists the users of the type user without a role on the folder by name, never an admin", async () => {
    const [zoe, bob] = [await createUser({ name: "zoe" }), await createUser({ name: "bob" })];
    await createUser({ name: "dave" });
    await createUser({ name: "maria", type: "admin" });
    // The actor is the last editor, so that `createFolder()` creates no other user.
    const folder = await createFolder({
      editor: actor,
      roles: [
        { user: actor, role: "owner" },
        { user: bob, role: "reader" },
      ],
    });
    await createFolder({ editor: actor, roles: [{ user: zoe, role: "owner" }] });

    expect((await folderRoleService.listRoleCandidates(actor, folder.id))?.map(({ name }) => name)).toEqual([
      "dave",
      "zoe",
    ]);
    await expect(folderRoleService.listRoleCandidates(bob, folder.id)).resolves.toBeNull();
  });
});

describe("changeRole and removeRole", () => {
  async function rolesOf(folderId: string) {
    return (
      await getTestDb().folderRole.findMany({
        where: { folderId },
        select: { user: { select: { username: true } }, role: true },
        orderBy: { user: { username: "asc" } },
      })
    ).map(({ user, role }) => [user.username, role]);
  }

  it("stores a change and a removal", async () => {
    const [bob, dave] = [await createUser({ name: "bob" }), await createUser({ name: "dave" })];
    const folder = await createFolder({
      roles: [
        { user: actor, role: "owner" },
        { user: bob, role: "writer" },
        { user: dave, role: "reader" },
      ],
    });

    await expect(folderRoleService.changeRole(actor, folder.id, bob.id, "manager")).resolves.toMatchObject({
      ok: true,
    });
    await expect(folderRoleService.removeRole(actor, folder.id, dave.id)).resolves.toMatchObject({ ok: true });

    expect(await rolesOf(folder.id)).toEqual([
      ["bob", "manager"],
      ["carla", "owner"],
    ]);
  });

  it("refuses the last Owner, who stays Owner", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({
      roles: [
        { user: actor, role: "owner" },
        { user: bob, role: "manager" },
      ],
    });

    await expect(folderRoleService.changeRole(actor, folder.id, actor.id, "writer")).resolves.toEqual({
      ok: false,
      error: { code: "last-owner" },
    });
    await expect(folderRoleService.removeRole(actor, folder.id, actor.id)).resolves.toEqual({
      ok: false,
      error: { code: "last-owner" },
    });
    expect(await rolesOf(folder.id)).toEqual([
      ["bob", "manager"],
      ["carla", "owner"],
    ]);
  });

  it("leaves exactly one Owner when two Owners lower each other at the same time", async () => {
    for (let round = 0; round < 5; round++) {
      const bob = await createUser({ name: `bob-${round}` });
      const folder = await createFolder({
        roles: [
          { user: actor, role: "owner" },
          { user: bob, role: "owner" },
        ],
      });

      const results = await Promise.all([
        folderRoleService.changeRole(actor, folder.id, bob.id, "writer"),
        folderRoleService.changeRole(bob, folder.id, actor.id, "writer"),
      ]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(await getTestDb().folderRole.count({ where: { folderId: folder.id, role: "owner" } })).toBe(1);
    }
  });

  it("lets a Manager change and remove nothing", async () => {
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({
      roles: [
        { user: actor, role: "manager" },
        { user: bob, role: "reader" },
      ],
    });

    await expect(folderRoleService.changeRole(actor, folder.id, bob.id, "owner")).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    await expect(folderRoleService.removeRole(actor, folder.id, bob.id)).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    expect(await rolesOf(folder.id)).toEqual([
      ["bob", "reader"],
      ["carla", "manager"],
    ]);
  });
});

describe("listAllFolderRoles", () => {
  it("lists every folder with its roles in the order of the roles view, also one without roles, for an admin", async () => {
    const admin = await createUser({ name: "maria", type: "admin" });
    const [bob, anna] = [await createUser({ name: "bob" }), await createUser({ name: "anna" })];
    await createFolder({
      name: "zeta",
      editor: actor,
      roles: [
        { user: bob, role: "reader" },
        { user: actor, role: "owner" },
        { user: anna, role: "reader" },
      ],
    });
    await createFolder({ name: "alpha", editor: actor, roles: [] });

    // `toStrictEqual` fails on any further field, such as the time of the last change or the last editor.
    await expect(folderRoleService.listAllFolderRoles(admin)).resolves.toStrictEqual([
      { id: expect.any(String), name: "alpha", roles: [] },
      {
        id: expect.any(String),
        name: "zeta",
        roles: [
          { user: { id: actor.id, name: "carla" }, role: "owner" },
          { user: { id: anna.id, name: "anna" }, role: "reader" },
          { user: { id: bob.id, name: "bob" }, role: "reader" },
        ],
      },
    ]);
    await expect(folderRoleService.listAllFolderRoles(actor)).resolves.toBeNull();
  });

  it("gives an admin no way to change a role or create a folder", async () => {
    const admin = await createUser({ name: "maria", type: "admin" });
    const bob = await createUser({ name: "bob" });
    const folder = await createFolder({ editor: actor, roles: [{ user: bob, role: "owner" }] });
    const notAllowed = { ok: false, error: { code: "not-allowed" } };

    await expect(folderRoleService.giveRole(admin, folder.id, { user: "carla", role: "owner" })).resolves.toEqual(
      notAllowed,
    );
    await expect(folderRoleService.changeRole(admin, folder.id, bob.id, "reader")).resolves.toEqual(notAllowed);
    await expect(folderRoleService.removeRole(admin, folder.id, bob.id)).resolves.toEqual(notAllowed);
    expect(await getTestDb().folderRole.findMany({ select: { userId: true, role: true } })).toEqual([
      { userId: bob.id, role: "owner" },
    ]);
  });
});
