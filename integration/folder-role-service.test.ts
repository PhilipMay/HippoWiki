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
