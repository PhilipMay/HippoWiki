// Checks `db-errors.ts` against the errors that Prisma and its `pg` adapter really report for the constraints of the
// schema, so that a Prisma upgrade that changes their shape or the index names fails here.
import { describe, expect, it } from "vitest";

import { newUserData } from "@/features/users/records";
import type { FileVersion } from "@/generated/prisma/client";
import {
  FILE_NAME,
  FILE_VERSION_NUMBER,
  FOLDER_NAME,
  FOLDER_ROLE_USER,
  isAdminRoleViolation,
  isForeignKeyViolation,
  isStatementTimeout,
  isUniqueViolation,
  LAST_EDITOR,
  OAUTH_CLIENT_METADATA_URL,
  PAGE_NAME,
  PAGE_REVISION_NUMBER,
  TAB_NAME,
  USER_NAME,
  type UniqueConstraint,
} from "@/lib/db-errors";

import {
  createFile,
  createFolder,
  createFolderRole,
  createPage,
  createTab,
  createUser,
  getTestDb,
} from "../e2e/support/database";

const NAME_CONSTRAINTS = {
  FOLDER_NAME,
  TAB_NAME,
  PAGE_NAME,
  PAGE_REVISION_NUMBER,
  FILE_NAME,
  FILE_VERSION_NUMBER,
  USER_NAME,
  OAUTH_CLIENT_METADATA_URL,
  FOLDER_ROLE_USER,
} as const;

/** The columns of a stored file version without its id, to store it again. */
function versionRow({ fileId, number, sha256, size, width, height, userId, via, revertedTo }: FileVersion) {
  return { fileId, number, sha256, size, width, height, userId, via, revertedTo };
}

/** Creates an OAuth client directly in the test database. */
function createClientRow(data: { metadataUrl?: string } = {}) {
  return getTestDb().oAuthClient.create({
    data: { name: "Example", redirectUris: ["https://client.example/callback"], ...data },
  });
}

/** Creates a user with the given name directly in the test database; other fields of the row can be overridden. */
function createUserRow(name: string, data: { username?: string; email?: string } = {}) {
  return getTestDb().user.create({
    data: { ...newUserData({ name, type: "user", passwordHash: "not-a-hash", mustChangePassword: false }), ...data },
  });
}

/** The error the given write rejects with; fails the test if it succeeds. */
async function errorOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (err) {
    return err;
  }
  return expect.fail("expected the write to fail");
}

/** Asserts that the error violates exactly the given name constraint and is no foreign key violation. */
function expectUniqueViolationOf(err: unknown, expected: UniqueConstraint): void {
  for (const [name, constraint] of Object.entries(NAME_CONSTRAINTS)) {
    expect(isUniqueViolation(err, constraint), name).toBe(constraint === expected);
  }
  expect(isForeignKeyViolation(err)).toBe(false);
  expect(isAdminRoleViolation(err)).toBe(false);
}

/**
 * Asserts that the error is a foreign key violation and no unique violation, and whether it is a violation of the key
 * of the last editor.
 */
function expectForeignKeyViolation(err: unknown, { ofLastEditor = false } = {}): void {
  expect(isForeignKeyViolation(err)).toBe(true);
  expect(isForeignKeyViolation(err, LAST_EDITOR)).toBe(ofLastEditor);
  for (const [name, constraint] of Object.entries(NAME_CONSTRAINTS)) {
    expect(isUniqueViolation(err, constraint), name).toBe(false);
  }
}

describe("unique violations", () => {
  it("reports a taken folder name as a violation of FOLDER_NAME", async () => {
    await createFolder({ name: "docs" });

    expectUniqueViolationOf(await errorOf(createFolder({ name: "docs" })), FOLDER_NAME);
  });

  it("reports a taken tab name in the same folder as a violation of TAB_NAME", async () => {
    const folder = await createFolder();
    await createTab({ folder, name: "guides" });

    expectUniqueViolationOf(await errorOf(createTab({ folder, name: "guides" })), TAB_NAME);
  });

  it("allows the same tab name in another folder", async () => {
    await createTab({ name: "guides" });

    await expect(createTab({ name: "guides" })).resolves.toMatchObject({ name: "guides" });
  });

  it("reports a taken name among the pages placed directly in a folder as a violation of PAGE_NAME", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "intro" });

    expectUniqueViolationOf(await errorOf(createPage({ folder, name: "intro" })), PAGE_NAME);
  });

  it("allows a page placed directly in a folder with the name of a deleted page of the folder", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "intro", deletedAt: new Date() });
    await createPage({ folder, name: "intro", deletedAt: new Date() });

    await expect(createPage({ folder, name: "intro" })).resolves.toMatchObject({ deletedAt: null });
  });

  it("still reports two pages of the same name placed directly in a folder next to a deleted one", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "intro", deletedAt: new Date() });
    await createPage({ folder, name: "intro" });

    expectUniqueViolationOf(await errorOf(createPage({ folder, name: "intro" })), PAGE_NAME);
  });

  it("reports a taken page name in the same tab as a violation of PAGE_NAME", async () => {
    const tab = await createTab();
    await createPage({ tab, name: "intro" });

    expectUniqueViolationOf(await errorOf(createPage({ tab, name: "intro" })), PAGE_NAME);
  });

  it("allows the same page name directly in a folder, in one of its tabs and in another tab", async () => {
    const folder = await createFolder();
    const [first, second] = [await createTab({ folder }), await createTab({ folder })];
    await createPage({ folder, name: "intro" });

    await expect(createPage({ tab: first, name: "intro" })).resolves.toMatchObject({ tabId: first.id });
    await expect(createPage({ tab: second, name: "intro" })).resolves.toMatchObject({ tabId: second.id });
  });

  it("reports a revision number that the page already has as a violation of PAGE_REVISION_NUMBER", async () => {
    const page = await createPage();
    const revision = { pageId: page.id, number: 1, title: "Again", content: "# Again", userId: page.lastEditedById };

    expectUniqueViolationOf(
      await errorOf(getTestDb().pageRevision.create({ data: { ...revision, via: "web" } })),
      PAGE_REVISION_NUMBER,
    );
  });

  it("allows the same revision number for another page", async () => {
    const [first, second] = [await createPage(), await createPage()];

    const numbers = await getTestDb().pageRevision.findMany({
      where: { pageId: { in: [first.id, second.id] } },
      select: { number: true },
    });
    expect(numbers).toEqual([{ number: 1 }, { number: 1 }]);
  });

  it("reports a taken name among the files placed directly in a folder and in a tab as a violation of FILE_NAME", async () => {
    const folder = await createFolder();
    const tab = await createTab({ folder });
    await createFile({ folder, name: "diagram.png" });
    await createFile({ tab, name: "diagram.png" });

    expectUniqueViolationOf(await errorOf(createFile({ folder, name: "diagram.png" })), FILE_NAME);
    expectUniqueViolationOf(await errorOf(createFile({ tab, name: "diagram.png" })), FILE_NAME);
  });

  it("allows a file next to a page of its name without the extension, and next to deleted files of its name", async () => {
    const folder = await createFolder();
    await createPage({ folder, name: "setup" });
    await createFile({ folder, name: "setup.png", deletedAt: new Date() });

    await expect(createFile({ folder, name: "setup.png" })).resolves.toMatchObject({ deletedAt: null });
  });

  it("reports a version number that the file already has as a violation of FILE_VERSION_NUMBER", async () => {
    const file = await createFile();
    const version = file.versions[0];
    if (!version) throw new Error("no version");
    const again = versionRow(version);

    expectUniqueViolationOf(await errorOf(getTestDb().fileVersion.create({ data: again })), FILE_VERSION_NUMBER);
  });

  it("refuses a version whose SHA-256 is no name of a blob", async () => {
    const file = await createFile();
    const version = file.versions[0];
    if (!version) throw new Error("no version");
    const again = versionRow(version);

    for (const sha256 of ["../../etc/passwd", "A".repeat(64), "a".repeat(63)]) {
      await expect(getTestDb().fileVersion.create({ data: { ...again, number: 2, sha256 } }), sha256).rejects.toThrow();
    }
  });

  it("reports a taken user name as a violation of USER_NAME", async () => {
    await createUserRow("alice");

    expectUniqueViolationOf(await errorOf(createUserRow("alice")), USER_NAME);
  });

  it("reports a taken user name with another email as a violation of USER_NAME", async () => {
    await createUserRow("alice");

    expectUniqueViolationOf(await errorOf(createUserRow("alice", { email: "other@example.invalid" })), USER_NAME);
  });

  it("reports a taken email with another user name as a violation of USER_NAME", async () => {
    const alice = await createUserRow("alice");

    expectUniqueViolationOf(await errorOf(createUserRow("bob", { email: alice.email })), USER_NAME);
  });

  it("allows many grants without an access token hash", async () => {
    const [alice, client] = [await createUser(), await createClientRow()];
    const grant = {
      name: "Example",
      folderId: (await createFolder()).id,
      role: "reader" as const,
      clientId: client.id,
      expiresAt: new Date(),
      userId: alice.id,
    };

    await getTestDb().oAuthGrant.create({ data: grant });
    await getTestDb().oAuthGrant.create({ data: grant });

    expect(await getTestDb().oAuthGrant.count()).toBe(2);
  });

  it("reports a metadata URL that is already stored as a violation of OAUTH_CLIENT_METADATA_URL", async () => {
    await createClientRow({ metadataUrl: "https://client.example/metadata.json" });

    expectUniqueViolationOf(
      await errorOf(createClientRow({ metadataUrl: "https://client.example/metadata.json" })),
      OAUTH_CLIENT_METADATA_URL,
    );
  });

  it("allows many registered clients, which have no metadata URL", async () => {
    await createClientRow();
    await createClientRow();

    expect(await getTestDb().oAuthClient.count()).toBe(2);
  });
});

describe("the role of an MCP address", () => {
  it.each(["reader", "writer", "manager"] as const)("may be %s, for a grant and for a code", async (role) => {
    const [alice, client, folder] = [await createUser(), await createClientRow(), await createFolder()];

    await expect(
      getTestDb().oAuthGrant.create({
        data: {
          name: "Example",
          folderId: folder.id,
          role,
          clientId: client.id,
          expiresAt: new Date(),
          userId: alice.id,
        },
      }),
    ).resolves.toMatchObject({ role });
    await expect(
      getTestDb().oAuthCode.create({
        data: {
          codeHash: "d".repeat(64),
          clientId: client.id,
          userId: alice.id,
          redirectUri: "https://client.example/callback",
          codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
          folderId: folder.id,
          role,
          lifetime: "90d",
          expiresAt: new Date(),
        },
      }),
    ).resolves.toMatchObject({ role });
  });

  it("is never owner, for a grant and for a code", async () => {
    const role = "owner";
    const [alice, client, folder] = [await createUser(), await createClientRow(), await createFolder()];

    await expect(
      getTestDb().oAuthGrant.create({
        data: {
          name: "Example",
          folderId: folder.id,
          role,
          clientId: client.id,
          expiresAt: new Date(),
          userId: alice.id,
        },
      }),
    ).rejects.toThrow(/OAuthGrant_mcp_role/);
    await expect(
      getTestDb().oAuthCode.create({
        data: {
          codeHash: "d".repeat(64),
          clientId: client.id,
          userId: alice.id,
          redirectUri: "https://client.example/callback",
          codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
          folderId: folder.id,
          role,
          lifetime: "90d",
          expiresAt: new Date(),
        },
      }),
    ).rejects.toThrow(/OAuthCode_mcp_role/);
  });

  it("goes with its folder: deleting the folder deletes its grants and codes", async () => {
    const [alice, client, folder] = [await createUser(), await createClientRow(), await createFolder()];
    await getTestDb().oAuthGrant.create({
      data: {
        name: "Example",
        folderId: folder.id,
        role: "writer",
        clientId: client.id,
        expiresAt: new Date(),
        userId: alice.id,
      },
    });
    await getTestDb().folderRole.deleteMany({ where: { folderId: folder.id } });

    await getTestDb().folder.delete({ where: { id: folder.id } });

    expect(await getTestDb().oAuthGrant.count()).toBe(0);
  });
});

describe("roles on folders", () => {
  it("reports a second role of the same user on the same folder as a violation of FOLDER_ROLE_USER", async () => {
    const [folder, user] = [await createFolder(), await createUser()];
    await createFolderRole({ folder, user, role: "reader" });

    expectUniqueViolationOf(await errorOf(createFolderRole({ folder, user, role: "owner" })), FOLDER_ROLE_USER);
  });

  it("stores a role of a user who is not an admin, and roles of one user on several folders", async () => {
    const user = await createUser();
    const [first, second] = [await createFolder(), await createFolder()];

    await createFolderRole({ folder: first, user, role: "writer" });
    await createFolderRole({ folder: second, user, role: "owner" });

    expect(await getTestDb().folderRole.findMany({ where: { userId: user.id }, orderBy: { role: "asc" } })).toEqual([
      expect.objectContaining({ folderId: first.id, role: "writer" }),
      expect.objectContaining({ folderId: second.id, role: "owner" }),
    ]);
  });

  it("refuses to insert a role of an admin, and the refusal is recognised", async () => {
    const [folder, admin] = [await createFolder(), await createUser({ type: "admin" })];

    const err = await errorOf(createFolderRole({ folder, user: admin, role: "reader" }));

    expect(isAdminRoleViolation(err)).toBe(true);
    for (const [name, constraint] of Object.entries(NAME_CONSTRAINTS)) {
      expect(isUniqueViolation(err, constraint), name).toBe(false);
    }
    expect(isForeignKeyViolation(err)).toBe(false);
    expect(await getTestDb().folderRole.count()).toBe(0);
  });

  it("refuses to move a role to an admin, with update and with updateMany, and changes nothing", async () => {
    const [folder, user, admin] = [await createFolder(), await createUser(), await createUser({ type: "admin" })];
    const role = await createFolderRole({ folder, user, role: "owner" });

    expect(
      isAdminRoleViolation(
        await errorOf(getTestDb().folderRole.update({ where: { id: role.id }, data: { userId: admin.id } })),
      ),
    ).toBe(true);
    expect(isAdminRoleViolation(await errorOf(getTestDb().folderRole.updateMany({ data: { userId: admin.id } })))).toBe(
      true,
    );
    expect(await getTestDb().folderRole.findUniqueOrThrow({ where: { id: role.id } })).toStrictEqual(role);
  });

  it("does not take other errors for the refusal of an admin", async () => {
    const folder = await createFolder();
    const user = { id: crypto.randomUUID() };

    const err = await errorOf(createFolderRole({ folder, user, role: "reader" }));

    expect(isForeignKeyViolation(err)).toBe(true);
    expect(isAdminRoleViolation(err)).toBe(false);
    expect(isAdminRoleViolation(new Error("an admin cannot have a role on a folder"))).toBe(false);
  });

  it("reports deleting a folder or a user that still has a role", async () => {
    const [folder, user] = [await createFolder(), await createUser()];
    await createFolderRole({ folder, user, role: "reader" });

    expectForeignKeyViolation(await errorOf(getTestDb().folder.delete({ where: { id: folder.id } })));
    expectForeignKeyViolation(await errorOf(getTestDb().user.delete({ where: { id: user.id } })));
  });
});

describe("foreign key violations", () => {
  it("reports a tab in a folder that does not exist", async () => {
    const folder = { ...(await createFolder()), id: crypto.randomUUID() };

    expectForeignKeyViolation(await errorOf(createTab({ folder })));
  });

  it("reports a page in a folder that does not exist", async () => {
    const folder = { ...(await createFolder()), id: crypto.randomUUID() };

    expectForeignKeyViolation(await errorOf(createPage({ folder })));
  });

  it("reports a page in a tab that does not exist", async () => {
    const tab = { ...(await createTab()), id: crypto.randomUUID() };

    expectForeignKeyViolation(await errorOf(createPage({ tab })));
  });

  it("reports a page whose tab belongs to another folder", async () => {
    const tab = await createTab();
    const otherFolder = await createFolder();

    const write = getTestDb().page.create({
      data: {
        name: "intro",
        title: "Intro",
        content: "# Intro",
        folderId: otherFolder.id,
        tabId: tab.id,
        lastEditedById: tab.lastEditedById,
        lastEditedVia: "web",
      },
    });

    expectForeignKeyViolation(await errorOf(write));
  });

  it("reports a file whose tab belongs to another folder, and deleting a tab or a file that still has a file or version", async () => {
    const tab = await createTab();
    const otherFolder = await createFolder();
    const write = getTestDb().file.create({
      data: {
        name: "diagram.png",
        type: "png",
        folderId: otherFolder.id,
        tabId: tab.id,
        lastEditedById: tab.lastEditedById,
        lastEditedVia: "web",
      },
    });
    expectForeignKeyViolation(await errorOf(write));

    const file = await createFile({ tab });
    expectForeignKeyViolation(await errorOf(getTestDb().tab.delete({ where: { id: tab.id } })));
    expectForeignKeyViolation(await errorOf(getTestDb().file.delete({ where: { id: file.id } })));
  });

  it("reports deleting a folder that still has a tab", async () => {
    const tab = await createTab();

    expectForeignKeyViolation(await errorOf(getTestDb().folder.delete({ where: { id: tab.folderId } })));
  });

  it("reports deleting a folder that still has a page", async () => {
    const page = await createPage();

    expectForeignKeyViolation(await errorOf(getTestDb().folder.delete({ where: { id: page.folderId } })));
  });

  it("reports deleting a page that still has revisions", async () => {
    const page = await createPage();

    expectForeignKeyViolation(await errorOf(getTestDb().page.delete({ where: { id: page.id } })));
  });
});

describe("foreign key violations of the last editor", () => {
  /** A user that does not exist: a well-formed id that no user has. */
  const editor = { id: crypto.randomUUID() } as Awaited<ReturnType<typeof createUser>>;

  it("reports a folder whose last editor does not exist", async () => {
    expectForeignKeyViolation(await errorOf(createFolder({ editor })), { ofLastEditor: true });
  });

  it("reports a tab whose last editor does not exist", async () => {
    const folder = await createFolder();

    expectForeignKeyViolation(await errorOf(createTab({ folder, editor })), { ofLastEditor: true });
  });

  it("reports a page whose last editor does not exist, in a folder and in a tab", async () => {
    const tab = await createTab();

    expectForeignKeyViolation(await errorOf(createPage({ folder: await createFolder(), editor })), {
      ofLastEditor: true,
    });
    expectForeignKeyViolation(await errorOf(createPage({ tab, editor })), { ofLastEditor: true });
  });

  it("reports a revision whose user does not exist", async () => {
    const page = await createPage();

    const write = getTestDb().pageRevision.create({
      data: { pageId: page.id, number: 2, title: "Next", content: "# Next", userId: editor.id, via: "web" },
    });

    expectForeignKeyViolation(await errorOf(write), { ofLastEditor: true });
  });

  it("reports a file and a version of a file whose user does not exist", async () => {
    expectForeignKeyViolation(await errorOf(createFile({ folder: await createFolder(), editor })), {
      ofLastEditor: true,
    });
    const file = await createFile();
    const version = file.versions[0];
    if (!version) throw new Error("no version");
    const again = versionRow(version);

    expectForeignKeyViolation(
      await errorOf(getTestDb().fileVersion.create({ data: { ...again, number: 2, userId: editor.id } })),
      { ofLastEditor: true },
    );
  });

  it("reports a change of the last editor to a user that does not exist", async () => {
    const page = await createPage();

    const write = getTestDb().page.update({ where: { id: page.id }, data: { lastEditedById: editor.id } });

    expectForeignKeyViolation(await errorOf(write), { ofLastEditor: true });
  });

  it("reports deleting a user who still is the last editor of a folder", async () => {
    const user = await createUser();
    await createFolder({ editor: user });

    expectForeignKeyViolation(await errorOf(getTestDb().user.delete({ where: { id: user.id } })), {
      ofLastEditor: true,
    });
  });
});

describe("a statement stopped by its time limit", () => {
  /** The error of a statement that runs longer than the time limit of its transaction. */
  async function stoppedStatement(): Promise<unknown> {
    try {
      await getTestDb().$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('statement_timeout', '50', true)`;
        await tx.$queryRaw`SELECT pg_sleep(2)`;
      });
    } catch (err) {
      return err;
    }
    throw new Error("the statement was not stopped");
  }

  it("is recognised by isStatementTimeout()", async () => {
    expect(isStatementTimeout(await stoppedStatement())).toBe(true);
  });

  it("is told apart from other errors", async () => {
    const folder = await createFolder();
    const taken = await getTestDb()
      .folder.create({ data: { name: folder.name, lastEditedById: folder.lastEditedById, lastEditedVia: "web" } })
      .catch((err: unknown) => err);
    expect(isStatementTimeout(taken)).toBe(false);
    expect(isStatementTimeout(new Error("canceling statement due to statement timeout"))).toBe(false);
  });
});
