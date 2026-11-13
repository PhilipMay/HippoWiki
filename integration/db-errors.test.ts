// Checks `db-errors.ts` against the errors that Prisma and its `pg` adapter really report for the constraints of the
// schema, so that a Prisma upgrade that changes their shape or the index names fails here.
import { describe, expect, it } from "vitest";

import { newUserData } from "@/features/users/records";
import {
  FOLDER_NAME,
  isForeignKeyViolation,
  isUniqueViolation,
  LAST_EDITOR,
  PAGE_NAME,
  TAB_NAME,
  USER_NAME,
  type UniqueConstraint,
} from "@/lib/db-errors";

import { createFolder, createPage, createTab, createUser, getTestDb } from "../e2e/support/database";

const NAME_CONSTRAINTS = { FOLDER_NAME, TAB_NAME, PAGE_NAME, USER_NAME } as const;

/** Creates a user with the given name directly in the test database; other fields of the row can be overridden. */
function createUserRow(name: string, data: { username?: string; email?: string } = {}) {
  return getTestDb().user.create({
    data: { ...newUserData({ name, passwordHash: "not-a-hash", mustChangePassword: false }), ...data },
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
      },
    });

    expectForeignKeyViolation(await errorOf(write));
  });

  it("reports deleting a folder that still has a tab", async () => {
    const tab = await createTab();

    expectForeignKeyViolation(await errorOf(getTestDb().folder.delete({ where: { id: tab.folderId } })));
  });

  it("reports deleting a folder that still has a page", async () => {
    const page = await createPage();

    expectForeignKeyViolation(await errorOf(getTestDb().folder.delete({ where: { id: page.folderId } })));
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
