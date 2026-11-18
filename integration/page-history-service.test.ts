// Runs the history service against the test database, to check the reads of the history of a page on real data.
import { beforeEach, describe, expect, it } from "vitest";

import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import * as historyService from "@/features/pages/history-service";
import type { User } from "@/generated/prisma/client";

import {
  createFolder,
  createPage,
  createRevisions,
  createUser,
  getTestDb,
  type FolderRoleData,
} from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";
import { owners } from "./helpers";

/**
 * The user who reads, unless a test says otherwise; created anew for every test. It is the known user `alice`, whom
 * `createFolder()` makes Owner of every folder a test creates without roles of its own.
 */
let user: User;
/** That user as the actor of the browser. */
let actor: BrowserActor;

beforeEach(async () => {
  user = await createUser({ id: KNOWN_USER.id, name: "alice" });
  actor = inBrowser(user);
});

describe("the history of a page", () => {
  it("returns exactly the declared fields of a revision, without its content", async () => {
    const mike = await createUser({ name: "mike" });
    const page = await createPage({ folder: await createFolder(), editor: user, content: "# Intro" });
    const [added] = await createRevisions({ page, count: 1, editor: mike, via: "mcp", revertedTo: () => 1 });

    const history = await historyService.listPageRevisions(actor, page.id, { before: null });

    expect(history?.revisions[0]).toStrictEqual({
      number: 2,
      title: "Intro",
      createdAt: added?.createdAt,
      madeBy: { name: "mike", via: "mcp" },
      revertedTo: 1,
    });
    expect(history?.newest).toBe(2);
  });

  it("lists at most 100 revisions newest first, and the ones before a number", async () => {
    const page = await createPage({ folder: await createFolder(), editor: user });
    await createRevisions({ page, count: 249 });

    const numbers = async (before: number | null) =>
      (await historyService.listPageRevisions(actor, page.id, { before }))?.revisions.map(({ number }) => number);

    expect(await numbers(null)).toEqual(Array.from({ length: 100 }, (_, index) => 250 - index));
    expect(await numbers(151)).toEqual(Array.from({ length: 100 }, (_, index) => 150 - index));
    expect(await numbers(51)).toEqual(Array.from({ length: 50 }, (_, index) => 50 - index));
    expect((await historyService.listPageRevisions(actor, page.id, { before: 51 }))?.newest).toBe(250);
  });
});

describe("the roles of the reads of the history", () => {
  /** The three reads of the history, each of the page with the given id and its revisions 1 and 2. */
  const reads = [
    [
      "listPageRevisions",
      (who: BrowserActor, id: string) => historyService.listPageRevisions(who, id, { before: null }),
    ],
    ["getPageRevision", (who: BrowserActor, id: string) => historyService.getPageRevision(who, id, 1)],
    ["getRevisionComparison", (who: BrowserActor, id: string) => historyService.getRevisionComparison(who, id, 2, 1)],
  ] as const;
  const WHO = ["owner", "manager", "writer", "reader", "stranger", "admin"] as const;
  /** Who reads the history of a page that is not deleted, and of a deleted page. */
  const READERS = { live: ["owner", "manager", "writer", "reader"], deleted: ["owner", "manager"] };
  const cases = reads.flatMap(([name, read]) =>
    WHO.flatMap((who) =>
      (["live", "deleted"] as const).map((state) => [name, who, state, READERS[state].includes(who), read] as const),
    ),
  );

  it.each(cases)("%s as %s on a %s page", async (_name, who, state, allowed, read) => {
    const reader = who === "owner" ? user : await createUser({ name: who, type: who === "admin" ? "admin" : "user" });
    const roles: FolderRoleData[] =
      who === "owner" || who === "stranger" || who === "admin" ? [] : [{ user: reader, role: who }];
    const folder = await createFolder({ roles: [...owners(user), ...roles] });
    const page = await createPage({
      folder,
      editor: user,
      content: "# Intro",
      ...(state === "deleted" ? { deletedAt: new Date() } : {}),
    });
    await createRevisions({ page, count: 1 });

    const result = await read(inBrowser(reader), page.id);

    if (allowed) expect(result).not.toBeNull();
    else expect(result).toBeNull();
  });
});

describe("a revision of a page", () => {
  it("returns exactly the declared fields of an old revision and of the newest one", async () => {
    const mike = await createUser({ name: "mike" });
    const page = await createPage({ folder: await createFolder(), editor: user, content: "# Intro\n\nFirst" });
    const [second] = await createRevisions({
      page,
      count: 1,
      content: () => "# Start\n\nSecond",
      editor: mike,
      via: "mcp",
      revertedTo: () => 1,
    });
    const first = await getTestDb().pageRevision.findUniqueOrThrow({
      where: { pageId_number: { pageId: page.id, number: 1 } },
    });

    await expect(historyService.getPageRevision(actor, page.id, 1)).resolves.toStrictEqual({
      number: 1,
      title: "Intro",
      createdAt: first.createdAt,
      madeBy: { name: "alice", via: "web" },
      revertedTo: null,
      content: "# Intro\n\nFirst",
      newest: 2,
      isCurrent: false,
    });
    await expect(historyService.getPageRevision(actor, page.id, 2)).resolves.toStrictEqual({
      number: 2,
      title: "Start",
      createdAt: second?.createdAt,
      madeBy: { name: "mike", via: "mcp" },
      revertedTo: 1,
      content: "# Start\n\nSecond",
      newest: 2,
      isCurrent: true,
    });
    await expect(historyService.getPageRevision(actor, page.id, 3)).resolves.toBeNull();
  });
});

describe("a comparison of two revisions of a page", () => {
  it("returns exactly the declared fields of both, the older first in either order, and the newest number", async () => {
    const mike = await createUser({ name: "mike" });
    const page = await createPage({ folder: await createFolder(), editor: user, content: "# Intro\n\nFirst" });
    const [, third] = await createRevisions({
      page,
      count: 2,
      content: (number) => `# Start\n\nRevision ${number}`,
      editor: mike,
      via: "mcp",
      revertedTo: (number) => (number === 3 ? 1 : null),
    });
    const first = await getTestDb().pageRevision.findUniqueOrThrow({
      where: { pageId_number: { pageId: page.id, number: 1 } },
    });
    const expected = {
      newest: 3,
      older: {
        number: 1,
        title: "Intro",
        createdAt: first.createdAt,
        madeBy: { name: "alice", via: "web" },
        revertedTo: null,
        content: "# Intro\n\nFirst",
      },
      newer: {
        number: 3,
        title: "Start",
        createdAt: third?.createdAt,
        madeBy: { name: "mike", via: "mcp" },
        revertedTo: 1,
        content: "# Start\n\nRevision 3",
      },
    };

    await expect(historyService.getRevisionComparison(actor, page.id, 1, 3)).resolves.toStrictEqual(expected);
    await expect(historyService.getRevisionComparison(actor, page.id, 3, 1)).resolves.toStrictEqual(expected);
    await expect(historyService.getRevisionComparison(actor, page.id, 3, 3)).resolves.toStrictEqual({
      ...expected,
      older: expected.newer,
    });
    await expect(historyService.getRevisionComparison(actor, page.id, 1, 4)).resolves.toBeNull();
  });
});
