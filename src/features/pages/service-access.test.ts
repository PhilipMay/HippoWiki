// The unit tests of the pages service: who may read and write, that is the actor, an admin and the roles of each read
// and write. The mocked database and logger are those of `src/test/pages-service.ts`; the integration tests in
// `integration/page-service.test.ts` prove the queries.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPage,
  deletePage,
  getDeletedPage,
  getPage,
  listAllFolderPages,
  listDeletedPages,
  listFolderPages,
  listTabPages,
  moveOrRenamePage,
  restorePage,
  revertPage,
  updatePageContent,
} from "@/features/pages/service";
import type { ContentActor } from "@/features/folder-roles/actors";
import {
  mocks,
  readCount,
  databaseWrites,
  expectDatabaseUntouched,
  FAILED,
  NOT_ALLOWED,
  EDITOR_ROW,
  resetPagesServiceMocks,
} from "@/test/pages-service";
import {
  foreignKeyViolation,
  FOLDER_ID,
  TAB_ID,
  PAGE_ID,
  ACTOR_ID,
  MALFORMED_ID,
  ACTOR,
  MALFORMED_ACTOR,
  MCP_ACTOR,
  ADMIN,
} from "@/test/unit";
import { allows, CONTENT, contentWritesOf, ROLES } from "@/test/content-writes";

vi.mock("@/lib/db", async () => ({ getDb: (await import("@/test/pages-service")).pagesDb }));
vi.mock("@/lib/logger", async () => ({ logger: (await import("@/test/pages-service")).logger }));

beforeEach(resetPagesServiceMocks);

/** The content writes of the pages service, from the table of all content writes. */
const WRITES = contentWritesOf("pages");

/** The call of the database that each write stores with, so that a test can make it fail. */
const STORING_CALL: Record<string, ReturnType<typeof vi.fn>> = {
  createPage: mocks.create,
  updatePageContent: mocks.updateMany,
  moveOrRenamePage: mocks.updateMany,
  deletePage: mocks.updateMany,
  restorePage: mocks.updateMany,
  revertPage: mocks.updateMany,
};

/**
 * The code each write gives when its role allows it and the database answers as in "the lowest role of each
 * function": the create fails, and every update matches no page.
 */
const ALLOWED_OUTCOME: Record<string, string> = {
  createPage: "failed",
  updatePageContent: "page-not-found",
  moveOrRenamePage: "page-not-found",
  deletePage: "page-not-found",
  restorePage: "page-not-found",
  revertPage: "page-not-found",
};

describe("the actor of a write", () => {
  it.each(WRITES)("$name returns failed for a malformed actor id without touching the database", async ({ call }) => {
    await expect(call(MALFORMED_ACTOR)).resolves.toEqual(FAILED);

    for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
    expect(readCount()).toBe(0);
    expect(mocks.error).toHaveBeenCalledWith({ actorId: MALFORMED_ID }, "malformed actor id");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // Also in the writes that report other foreign key violations as a missing folder or tab.
  it.each(
    WRITES.flatMap(({ name, call, editorKey }) => [
      [name, "on the editor key", call, foreignKeyViolation({ index: editorKey })] as const,
      [name, "on the editor field", call, foreignKeyViolation({ fields: ["lastEditedById"] })] as const,
    ]),
  )("%s returns failed for a foreign key violation %s", async (name, _kind, write, err) => {
    // `deletePage` and `revertPage` read the page before they write: its place, and the revision to go back to.
    mocks.findFirst.mockResolvedValue({
      folder: { name: "handbook" },
      tab: null,
      content: "# Old",
      revisions: [{ content: CONTENT }],
    });
    STORING_CALL[name]?.mockRejectedValue(err);

    await expect(write(ACTOR)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, actorId: ACTOR_ID }, "actor of write not found");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("an admin", () => {
  const MCP_ADMIN: ContentActor = { ...MCP_ACTOR, type: "admin" };

  it.each([
    ["listFolderPages", () => listFolderPages(ADMIN, FOLDER_ID)],
    ["listTabPages", () => listTabPages(ADMIN, TAB_ID)],
    ["listAllFolderPages", () => listAllFolderPages(ADMIN, FOLDER_ID)],
    ["getPage", () => getPage(ADMIN, "handbook", null, "overview")],
    ["listDeletedPages", () => listDeletedPages(ADMIN, FOLDER_ID)],
    ["getDeletedPage", () => getDeletedPage(ADMIN, "handbook", PAGE_ID)],
    ["listFolderPages through MCP", () => listFolderPages(MCP_ADMIN, FOLDER_ID)],
    ["listTabPages through MCP", () => listTabPages(MCP_ADMIN, TAB_ID)],
    ["getPage through MCP", () => getPage(MCP_ADMIN, "handbook", null, "overview")],
  ])("gets null from %s, without asking the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();

    expectDatabaseUntouched();
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
  });

  it.each(WRITES)("gets not-allowed from $name, logged, without touching the database", async ({ call, what }) => {
    await expect(call(ADMIN)).resolves.toEqual(NOT_ALLOWED);

    for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
    expect(readCount()).toBe(0);
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ actorId: ACTOR_ID }, `${what}: the actor is an admin`);
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("is refused before the ids and the input are checked", async () => {
    const results = [
      await createPage(ADMIN, MALFORMED_ID, { name: "", content: "", tabId: MALFORMED_ID }),
      await updatePageContent(ADMIN, MALFORMED_ID, { content: "", version: null }),
      await moveOrRenamePage(ADMIN, MALFORMED_ID, { name: "", tabId: MALFORMED_ID, version: null }),
      await deletePage(ADMIN, MALFORMED_ID, { version: 1 }),
      await restorePage(ADMIN, MALFORMED_ID, { name: "", tabId: MALFORMED_ID }),
      await revertPage(ADMIN, MALFORMED_ID, { revision: 0, version: null }),
      await deletePage({ ...ADMIN, id: MALFORMED_ID }, PAGE_ID, { version: 1 }),
    ];

    for (const result of results) expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
    for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
    expect(readCount()).toBe(0);
    expect(mocks.error).not.toHaveBeenCalled();
  });
});

describe("the role of the actor", () => {
  it.each([
    ["listFolderPages", () => listFolderPages(ACTOR, FOLDER_ID)],
    ["listTabPages", () => listTabPages(ACTOR, TAB_ID)],
    ["listAllFolderPages", () => listAllFolderPages(ACTOR, FOLDER_ID)],
    ["listDeletedPages", () => listDeletedPages(ACTOR, FOLDER_ID)],
  ] as const)("%s returns null without a role, without reading the pages", async (_name, read) => {
    mocks.roleFindFirst.mockResolvedValue(null);

    await expect(read()).resolves.toBeNull();

    expect(readCount()).toBe(0);
  });

  it.each([
    ["listFolderPages", () => listFolderPages(MCP_ACTOR, FOLDER_ID)],
    ["listTabPages", () => listTabPages(MCP_ACTOR, TAB_ID)],
    ["listAllFolderPages", () => listAllFolderPages(MCP_ACTOR, FOLDER_ID)],
  ])(
    "%s through MCP reads the pages with a role on the folder of the connection, and nothing without one",
    async (_name, read) => {
      mocks.roleFindFirst.mockResolvedValueOnce({ role: "owner" }).mockResolvedValueOnce(null);

      await expect(read()).resolves.toEqual([]);
      await expect(read()).resolves.toBeNull();
    },
  );

  it("listDeletedPages through a Writer connection reads nothing, because a Writer sees no deleted pages", async () => {
    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });

    await expect(listDeletedPages(MCP_ACTOR, FOLDER_ID)).resolves.toBeNull();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("listFolderPages through MCP reads every other folder as one without a role, without asking the database", async () => {
    await expect(listFolderPages(MCP_ACTOR, "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e55")).resolves.toBeNull();

    expect(mocks.roleFindFirst).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("getPage returns null for a malformed actor id in the browser, logged, without reading the database", async () => {
    await expect(getPage(MALFORMED_ACTOR, "handbook", null, "overview")).resolves.toBeNull();

    expect(readCount()).toBe(0);
    expect(mocks.error).toHaveBeenCalledWith({ actorId: MALFORMED_ID }, "malformed actor id");
  });

  it.each(WRITES)(
    "$name without a role gets not-allowed, logged, and touches no page",
    async ({ call, target, what }) => {
      mocks.roleFindFirst.mockResolvedValue(null);

      await expect(call(ACTOR)).resolves.toEqual(NOT_ALLOWED);

      for (const write of databaseWrites) expect(write).not.toHaveBeenCalled();
      expect(readCount()).toBe(0);
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { actorId: ACTOR_ID, ...target },
        `${what}: the actor has no role on the folder`,
      );
      expect(mocks.info).not.toHaveBeenCalled();
    },
  );

  it.each(WRITES.filter((write) => write.lowest !== null))(
    "$name gets failed for an error of the database while the role is read, logged with the ids, and writes nothing",
    async ({ call, target, failure }) => {
      const err = new Error("connection lost");
      mocks.roleFindFirst.mockRejectedValue(err);

      await expect(call(ACTOR)).resolves.toEqual({ ok: false, error: { code: "failed" } });

      for (const write of databaseWrites) expect(write).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, ...target }, failure);
      expect(mocks.info).not.toHaveBeenCalled();
    },
  );
});

// The role is checked before the version and the content (optimistic-locking.md, "Which changes are refused"), so
// that a refusal for the role never reads the stored page, which a missing or old version would give back.
describe("the role before the version and the input", () => {
  const writesWithVersion = [
    ["updatePageContent", () => updatePageContent(ACTOR, PAGE_ID, { content: "No heading", version: null })],
    ["moveOrRenamePage", () => moveOrRenamePage(ACTOR, PAGE_ID, { name: "Not A Name", tabId: null, version: null })],
    ["deletePage", () => deletePage(ACTOR, PAGE_ID, { version: null })],
    ["revertPage", () => revertPage(ACTOR, PAGE_ID, { revision: 0, version: null })],
  ] as const;
  const cases = writesWithVersion.flatMap(([name, write]) =>
    [
      ["no role", null],
      ["the role Reader", { role: "reader" }],
    ].map(([who, role]) => [name, who, role, write] as const),
  );

  it.each(cases)(
    "%s with %s gets not-allowed for invalid input and no version, without reading the page",
    async (_name, _who, role, write) => {
      mocks.roleFindFirst.mockResolvedValue(role);

      await expect(write()).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });

      for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
      expect(readCount()).toBe(0);
    },
  );
});

describe("the lowest role of each function", () => {
  const cases = WRITES.flatMap((write) =>
    ROLES.map((role) => [write.name, role, write.call, allows(write, role), write.target, write.what] as const),
  );

  it.each(cases)("%s as %s", async (name, role, write, allowed, target, what) => {
    mocks.roleFindFirst.mockResolvedValue({ role });
    // A write that is allowed goes on to the database; these answers end it as a missing page.
    mocks.create.mockRejectedValue(new Error("stop"));
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(null);

    const result = await write(ACTOR);

    if (allowed) {
      expect(result).toEqual({ ok: false, error: { code: ALLOWED_OUTCOME[name] } });
      expect(mocks.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        `${what}: the role of the actor does not allow it`,
      );
    } else {
      expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
      for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { actorId: ACTOR_ID, ...target, role },
        `${what}: the role of the actor does not allow it`,
      );
    }
  });

  it.each(ROLES)("listDeletedPages as %s", async (role) => {
    mocks.roleFindFirst.mockResolvedValue({ role });

    const pages = await listDeletedPages(ACTOR, FOLDER_ID);

    if (role === "manager" || role === "owner") expect(pages).toEqual([]);
    else {
      expect(pages).toBeNull();
      expect(readCount()).toBe(0);
    }
  });

  it.each(ROLES)("listFolderPages, listTabPages, listAllFolderPages and getPage as %s", async (role) => {
    mocks.roleFindFirst.mockResolvedValue({ role });
    mocks.findFirst.mockResolvedValue({
      id: PAGE_ID,
      name: "overview",
      version: 1,
      folder: { id: FOLDER_ID, name: "handbook", roles: [{ role }] },
      tab: null,
      ...EDITOR_ROW,
    });

    await expect(listFolderPages(ACTOR, FOLDER_ID)).resolves.toEqual([]);
    await expect(listTabPages(ACTOR, TAB_ID)).resolves.toEqual([]);
    await expect(listAllFolderPages(ACTOR, FOLDER_ID)).resolves.toEqual([]);
    await expect(getPage(ACTOR, "handbook", null, "overview")).resolves.toMatchObject({ id: PAGE_ID, role });
  });
});
