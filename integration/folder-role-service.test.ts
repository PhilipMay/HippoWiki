// Runs the folder roles service against the test database, to check its reads and writes on real data.
import { beforeEach, describe, expect, it } from "vitest";

import * as folderRoleService from "@/features/folder-roles/service";
import type { User } from "@/generated/prisma/client";

import { createFolder, createUser } from "../e2e/support/database";

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
