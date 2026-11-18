// The unit tests of the pages service: the writes of pages, each on its own. The mocked database and logger are those of
// `src/test/pages-service.ts`; the integration tests in `integration/page-service.test.ts` prove the queries.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPage,
  deletePage,
  moveOrRenamePage,
  restorePage,
  revertPage,
  updatePageContent,
} from "@/features/pages/service";
import type { ContentActor } from "@/features/folder-roles/actors";
import { CONTENT_MAX_TABLE_CELLS } from "@/features/pages/limits";
import { CONTENT_TABLE_CELLS_MESSAGE } from "@/features/pages/schema";
import {
  mocks,
  databaseWrites,
  expectDatabaseUntouched,
  NAME_TAKEN,
  FAILED,
  FOLDER_NOT_FOUND,
  TAB_NOT_FOUND,
  PAGE_NOT_FOUND,
  NAME_REQUIRED,
  TITLE_MISSING,
  placeKeyErrors,
  nameTakenErrors,
  otherErrors,
  resetPagesServiceMocks,
} from "@/test/pages-service";
import {
  dataOf,
  foreignKeyViolation,
  uniqueViolation,
  FOLDER_ID,
  TAB_ID,
  PAGE_ID,
  ACTOR_ID,
  MALFORMED_ID,
  ACTOR,
  MCP_ACTOR,
} from "@/test/unit";
import { CONTENT } from "@/test/content-writes";

vi.mock("@/lib/db", async () => ({ getDb: (await import("@/test/pages-service")).pagesDb }));
vi.mock("@/lib/logger", async () => ({ logger: (await import("@/test/pages-service")).logger }));

beforeEach(resetPagesServiceMocks);

describe("a write through MCP", () => {
  const STORED = { id: PAGE_ID, name: "plan", version: 2, folder: { name: "projects" }, tab: null };

  it("logs the channel mcp and the grant of the connection, and stores the user as the last editor", async () => {
    mocks.create.mockResolvedValue({ ...STORED, version: 1 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);
    const grantId = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";

    await expect(
      createPage(MCP_ACTOR, FOLDER_ID, { name: "plan", content: CONTENT, tabId: null }),
    ).resolves.toMatchObject({ ok: true });
    await expect(updatePageContent(MCP_ACTOR, PAGE_ID, { content: CONTENT, version: 1 })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      moveOrRenamePage(MCP_ACTOR, PAGE_ID, { name: "plan", tabId: null, version: 2 }),
    ).resolves.toMatchObject({ ok: true });

    expect(mocks.info.mock.calls).toEqual([
      [{ pageId: PAGE_ID, channel: "mcp", grantId }, "page created"],
      [{ pageId: PAGE_ID, channel: "mcp", grantId }, "page updated"],
      [{ pageId: PAGE_ID, tabId: null, channel: "mcp", grantId }, "page moved or renamed"],
    ]);
    expect(dataOf(mocks.create)).toMatchObject({
      lastEditedById: ACTOR_ID,
      lastEditedVia: "mcp",
      revisions: { create: { number: 1, userId: ACTOR_ID, via: "mcp" } },
    });
    expect(dataOf(mocks.updateMany)).toMatchObject({ lastEditedById: ACTOR_ID, lastEditedVia: "mcp" });
    expect(dataOf(mocks.revisionCreate)).toMatchObject({ number: 4, userId: ACTOR_ID, via: "mcp" });
  });

  it("is not allowed for a Reader connection, for another folder and without a role, and writes nothing", async () => {
    const reader: ContentActor = {
      ...MCP_ACTOR,
      connection: { ...MCP_ACTOR.connection, role: "reader" },
    } as ContentActor;

    mocks.roleFindFirst.mockResolvedValue({ role: "owner" });
    await expect(createPage(reader, FOLDER_ID, { name: "plan", content: CONTENT, tabId: null })).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    await expect(
      createPage(MCP_ACTOR, "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e55", { name: "plan", content: CONTENT, tabId: null }),
    ).resolves.toEqual({ ok: false, error: { code: "not-allowed" } });
    mocks.roleFindFirst.mockResolvedValue({ role: "reader" });
    await expect(updatePageContent(MCP_ACTOR, PAGE_ID, { content: CONTENT, version: 1 })).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("deletes a page through a Manager connection and logs the channel mcp and the grant", async () => {
    const manager = { ...MCP_ACTOR, connection: { ...MCP_ACTOR.connection, role: "manager" } } as ContentActor;
    mocks.findFirst.mockResolvedValue({ folder: { name: "projects" }, tab: null });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(manager, PAGE_ID, { version: 2 })).resolves.toMatchObject({ ok: true });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { pageId: PAGE_ID, channel: "mcp", grantId: "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01" },
      "page deleted",
    );
    expect(dataOf(mocks.updateMany)).toMatchObject({ lastEditedById: ACTOR_ID, lastEditedVia: "mcp" });
  });

  it("refuses a delete through a Writer connection of an Owner and writes nothing", async () => {
    await expect(deletePage(MCP_ACTOR, PAGE_ID, { version: 2 })).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("createPage", () => {
  const VALID = { name: " my-page ", content: CONTENT, tabId: null };
  const IN_TAB = { ...VALID, tabId: TAB_ID };
  /** A taken name of a new page, with the name, given or derived. */
  const NEW_NAME_TAKEN = { ok: false, error: { ...NAME_TAKEN.error, name: "my-page" } };

  it.each([
    ["valid", VALID],
    ["invalid", { name: "", content: CONTENT, tabId: null }],
  ])("returns folder-not-found for a malformed folder id, with %s input", async (_name, input) => {
    await expect(createPage(ACTOR, MALFORMED_ID, input)).resolves.toEqual(FOLDER_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it.each([
    ["valid", { ...VALID, tabId: MALFORMED_ID }],
    ["an empty tab id and valid", { ...VALID, tabId: "" }],
    ["invalid", { name: "", content: CONTENT, tabId: MALFORMED_ID }],
  ])("returns tab-not-found for a malformed tab id, with %s input", async (_name, input) => {
    await expect(createPage(ACTOR, FOLDER_ID, input)).resolves.toEqual(TAB_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it("returns the field errors of invalid input without writing anything", async () => {
    await expect(createPage(ACTOR, FOLDER_ID, { name: "", content: CONTENT, tabId: null })).resolves.toEqual(
      NAME_REQUIRED,
    );
    await expect(createPage(ACTOR, FOLDER_ID, { name: "a", content: "Text", tabId: null })).resolves.toEqual(
      TITLE_MISSING,
    );
    expectDatabaseUntouched();
  });

  it("stores the page directly in the folder with the derived title and returns it as stored", async () => {
    const stored = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: null };
    mocks.create.mockResolvedValue(stored);

    // A title is never part of the input; the content is its only source.
    const input = { ...VALID, title: "Given title" };
    await expect(createPage(ACTOR, FOLDER_ID, input)).resolves.toEqual({ ok: true, value: stored });

    // No version: a new page gets the default of the database, 1.
    expect(dataOf(mocks.create)).toEqual({
      title: "My page",
      name: "my-page",
      content: CONTENT,
      folderId: FOLDER_ID,
      tabId: null,
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
      revisions: { create: { number: 1, title: "My page", content: CONTENT, userId: ACTOR_ID, via: "web" } },
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID, channel: "web" }, "page created");
  });

  it("stores a page without a name under the name derived from its title", async () => {
    const stored = { id: PAGE_ID, name: "release-notes", title: "Release Notes", folder: { name: "f" }, tab: null };
    mocks.create.mockResolvedValue(stored);

    await expect(createPage(ACTOR, FOLDER_ID, { content: "# Release Notes\n\nText", tabId: null })).resolves.toEqual({
      ok: true,
      value: stored,
    });

    expect(dataOf(mocks.create)).toMatchObject({ name: "release-notes", title: "Release Notes" });
  });

  it("returns name-taken with the derived name when it is taken", async () => {
    mocks.create.mockRejectedValue(uniqueViolation({ index: "Page_folderId_name_key" }));

    await expect(createPage(ACTOR, FOLDER_ID, { content: CONTENT, tabId: null })).resolves.toEqual(NEW_NAME_TAKEN);
  });

  it.each([
    ["a title in another script", "# 日本語"],
    ["a title in another alphabet", "# Привет"],
  ])("returns no-suggested-name without a name for %s, and stores nothing", async (_case, content) => {
    await expect(createPage(ACTOR, FOLDER_ID, { content, tabId: null })).resolves.toEqual({
      ok: false,
      error: { code: "no-suggested-name" },
    });
    expectDatabaseUntouched();
  });

  it("returns the field errors of the content without a name, and derives no name", async () => {
    await expect(createPage(ACTOR, FOLDER_ID, { content: "Text", tabId: null })).resolves.toEqual(TITLE_MISSING);
    expectDatabaseUntouched();
  });

  it("stores the content with plain line feeds", async () => {
    mocks.create.mockResolvedValue({ id: PAGE_ID, name: "n", folder: { name: "f" }, tab: null });

    await createPage(ACTOR, FOLDER_ID, { ...VALID, content: "# My page\r\n\r\nText" });

    expect(dataOf(mocks.create)).toMatchObject({ content: CONTENT });
  });

  it("stores a page in a tab and returns it as stored", async () => {
    const stored = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: { name: "stored-tab" } };
    mocks.create.mockResolvedValue(stored);

    await expect(createPage(ACTOR, FOLDER_ID, IN_TAB)).resolves.toEqual({ ok: true, value: stored });

    expect(dataOf(mocks.create)).toMatchObject({ folderId: FOLDER_ID, tabId: TAB_ID });
  });

  it.each(nameTakenErrors)("returns name-taken for a unique violation %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(ACTOR, FOLDER_ID, VALID)).resolves.toEqual(NEW_NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith(
      { folderId: FOLDER_ID, tabId: null, name: "my-page" },
      "name of new page already in use",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("returns name-taken for a taken name in a tab", async () => {
    mocks.create.mockRejectedValue(uniqueViolation({ index: "Page_tabId_name_key" }));

    await expect(createPage(ACTOR, FOLDER_ID, IN_TAB)).resolves.toEqual(NEW_NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith(
      { folderId: FOLDER_ID, tabId: TAB_ID, name: "my-page" },
      "name of new page already in use",
    );
  });

  it.each(placeKeyErrors)("returns folder-not-found for a foreign key violation %s without a tab", async (_n, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(ACTOR, FOLDER_ID, VALID)).resolves.toEqual(FOLDER_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith(
      { folderId: FOLDER_ID, tabId: null },
      "folder or tab of new page not found",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(placeKeyErrors)("returns tab-not-found for a foreign key violation %s with a tab", async (_n, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(ACTOR, FOLDER_ID, IN_TAB)).resolves.toEqual(TAB_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith(
      { folderId: FOLDER_ID, tabId: TAB_ID },
      "folder or tab of new page not found",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(ACTOR, FOLDER_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, folderId: FOLDER_ID, tabId: null }, "failed to create page");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("updatePageContent", () => {
  const VERSION = 4;
  const VALID = { content: CONTENT, version: VERSION };
  const INVALID = { content: "No heading", version: VERSION };
  const STORED = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: null };

  it.each([
    ["valid", VALID],
    ["invalid", INVALID],
  ])("returns page-not-found for a malformed id, with %s input", async (_name, input) => {
    await expect(updatePageContent(ACTOR, MALFORMED_ID, input)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it("returns the field errors of invalid content without writing anything", async () => {
    await expect(updatePageContent(ACTOR, PAGE_ID, INVALID)).resolves.toEqual(TITLE_MISSING);
    expectDatabaseUntouched();
  });

  // Invalid content is reported before the version, so that a stale editor shows the error of its content first.
  it("reports invalid content before a missing version", async () => {
    await expect(updatePageContent(ACTOR, PAGE_ID, { ...INVALID, version: null })).resolves.toEqual(TITLE_MISSING);
    expectDatabaseUntouched();
  });

  it("stores content and derived title only, counts the version up, and returns the page as stored", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);

    const input = { ...VALID, title: "Given title", name: "given-name" };
    await expect(updatePageContent(ACTOR, PAGE_ID, input)).resolves.toEqual({ ok: true, value: STORED });

    expect(dataOf(mocks.updateMany)).toEqual({
      title: "My page",
      content: CONTENT,
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
      version: { increment: 1 },
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID, channel: "web" }, "page updated");
  });

  it("records a revision with the next number, the title, the content, the actor and the channel", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: STORED });

    expect(dataOf(mocks.revisionCreate)).toEqual({
      pageId: PAGE_ID,
      number: 4,
      title: "My page",
      content: CONTENT,
      userId: ACTOR_ID,
      via: "web",
      revertedTo: null,
    });
  });

  it("records revision 1 for a page without revisions", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);
    mocks.revisionFindFirst.mockResolvedValue(null);

    await updatePageContent(ACTOR, PAGE_ID, VALID);

    expect(dataOf(mocks.revisionCreate)).toMatchObject({ number: 1 });
  });

  // A content save is stored once its content differs from the stored content, whatever the newest revision holds.
  it("records a revision also when the newest revision has the content of the save", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);
    mocks.revisionFindFirst.mockResolvedValue({ number: 3 });

    await updatePageContent(ACTOR, PAGE_ID, VALID);

    expect(dataOf(mocks.revisionCreate)).toMatchObject({ number: 4, revertedTo: null });
  });

  // A save of the stored content, based on the version of the page, leaves the page as it is.
  it.each([
    ["in the browser", ACTOR, { channel: "web" }],
    ["through MCP", MCP_ACTOR, { channel: "mcp", grantId: MCP_ACTOR.connection?.grantId }],
  ] as const)(
    "stores nothing and records no revision for the stored content %s, and logs it apart",
    async (_name, actor, channel) => {
      const unchanged = { ...STORED, version: VERSION };
      mocks.updateMany.mockResolvedValue({ count: 0 });
      mocks.findFirst.mockResolvedValue(unchanged);

      await expect(updatePageContent(actor, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: unchanged });

      expect(mocks.revisionCreate).not.toHaveBeenCalled();
      expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
        { pageId: PAGE_ID, ...channel },
        "page not changed: content is the same",
      );
      expect(mocks.warn).not.toHaveBeenCalled();
    },
  );

  // The stored content based on another version is refused like every other save.
  it("returns page-changed for the stored content when the page has another version", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns page-not-found for the stored content of a deleted page", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(null);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // Content over a limit is refused before the version is looked at, also when it is the stored content.
  it("returns the field errors of stored content that breaks a limit now, without reading the page", async () => {
    const table = `# Table\n\n| a |\n| - |\n${"| x |\n".repeat(CONTENT_MAX_TABLE_CELLS)}`;

    await expect(updatePageContent(ACTOR, PAGE_ID, { content: table, version: VERSION })).resolves.toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { content: [CONTENT_TABLE_CELLS_MESSAGE] } },
    });
    expectDatabaseUntouched();
  });

  it("returns failed and logs it when the revision cannot be stored", async () => {
    const err = new Error("connection lost");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.revisionCreate.mockRejectedValue(err);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to update page");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // The row lock keeps this from happening; if another write took the number all the same, it changed the page.
  it("returns page-changed when another write took the number of the revision, logged as a warning", async () => {
    const err = uniqueViolation({ index: "PageRevision_pageId_number_key" });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.revisionCreate.mockRejectedValue(err);
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.warn).toHaveBeenCalledWith(
      { err, pageId: PAGE_ID, version: VALID.version },
      "revision number of the content change already taken: the change is refused",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  // The update matches neither a deleted page nor one with another version; the page as stored tells them apart.
  it("returns page-changed with the page as stored when the update matches no page but the page is stored", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, version: VERSION },
      "page to update changed after the version the write is based on",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a page that no longer exists or is deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to update not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // A change that states no version, or a malformed one, is based on no known state of the page.
  it.each([null, 0, -1, 1.5, Number.NaN, 2_147_483_648])(
    "writes nothing and returns page-changed for the version %j",
    async (version) => {
      mocks.findUnique.mockResolvedValue(STORED);

      await expect(updatePageContent(ACTOR, PAGE_ID, { ...VALID, version })).resolves.toEqual({
        ok: false,
        error: { code: "page-changed", page: STORED },
      });

      expect(mocks.updateMany).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledWith(
        { pageId: PAGE_ID, version },
        "page to update changed after the version the write is based on",
      );
    },
  );

  it("returns page-not-found for a missing version of a page that no longer exists", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(updatePageContent(ACTOR, PAGE_ID, { ...VALID, version: null })).resolves.toEqual(PAGE_NOT_FOUND);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a page that disappears right after the update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to update not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to update page");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns failed when the stored page cannot be read", async () => {
    const err = new Error("connection lost");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockRejectedValue(err);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to update page");
  });

  it("returns failed when the page of a refused update cannot be read", async () => {
    const err = new Error("connection lost");
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockRejectedValue(err);

    await expect(updatePageContent(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to update page");
  });
});

describe("revertPage", () => {
  const VERSION = 4;
  const VALID = { revision: 2, version: VERSION };
  const OLD = "# Old title\n\nOld text";
  const STORED = { id: PAGE_ID, name: "stored-name", version: 5, folder: { name: "stored-folder" }, tab: null };
  const REVISION_NOT_FOUND = { ok: false, error: { code: "revision-not-found" } };
  const NOT_ALLOWED = { ok: false, error: { code: "not-allowed" } };

  /** The page as the revert reads it: its content now and the content of the chosen revision, if it has it. */
  function pageWith(revision: string | null, content = CONTENT) {
    return { content, revisions: revision === null ? [] : [{ content: revision }] };
  }

  /** Nothing is stored: no update of the page and no revision. */
  function expectNothingStored(): void {
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  }

  it("stores the content of the revision and records a new revision that names it", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: STORED });

    expect(dataOf(mocks.updateMany)).toEqual({
      title: "Old title",
      content: OLD,
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
      version: { increment: 1 },
    });
    expect(dataOf(mocks.revisionCreate)).toEqual({
      pageId: PAGE_ID,
      number: 4,
      title: "Old title",
      content: OLD,
      userId: ACTOR_ID,
      via: "web",
      revertedTo: 2,
    });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { pageId: PAGE_ID, revision: 2, channel: "web" },
      "page reverted",
    );
  });

  // A revert always records a revision, also when the newest revision has the same content as the chosen one.
  it("records a revision also when the newest revision has the content of the chosen one", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.revisionFindFirst.mockResolvedValue({ number: 3, content: OLD });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(STORED);

    await revertPage(ACTOR, PAGE_ID, VALID);

    expect(dataOf(mocks.revisionCreate)).toMatchObject({ number: 4, revertedTo: 2 });
  });

  it("is not allowed for an admin, without a role and for a Reader, before anything else is read", async () => {
    await expect(
      revertPage({ ...ACTOR, type: "admin" }, MALFORMED_ID, { revision: 0, version: null }),
    ).resolves.toEqual(NOT_ALLOWED);
    expect(mocks.roleFindFirst).not.toHaveBeenCalled();

    mocks.roleFindFirst.mockResolvedValue(null);
    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(NOT_ALLOWED);
    mocks.roleFindFirst.mockResolvedValue({ role: "reader" });
    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(NOT_ALLOWED);

    expect(mocks.findFirst).not.toHaveBeenCalled();
    expectNothingStored();
    expect(mocks.warn).toHaveBeenLastCalledWith(
      { actorId: ACTOR_ID, pageId: PAGE_ID, role: "reader" },
      "page not reverted: the role of the actor does not allow it",
    );
  });

  it("returns page-not-found for a malformed id without reading the database", async () => {
    await expect(revertPage(ACTOR, MALFORMED_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it.each([0, -1, 1.5, Number.NaN, 2_147_483_648])(
    "returns revision-not-found for the malformed revision number %j without reading the page",
    async (revision) => {
      await expect(revertPage(ACTOR, PAGE_ID, { ...VALID, revision })).resolves.toEqual(REVISION_NOT_FOUND);
      expect(mocks.findFirst).not.toHaveBeenCalled();
      expectNothingStored();
    },
  );

  it("returns revision-not-found for a revision the page does not have", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(null));

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(REVISION_NOT_FOUND);
    expectNothingStored();
  });

  it("returns revision-not-found for a revision with the content of the page now", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(CONTENT));

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(REVISION_NOT_FOUND);
    expectNothingStored();
  });

  it("returns page-not-found for a page that does not exist or is deleted", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);
    expectNothingStored();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to revert not found");
  });

  // The limits in force now apply, which a revision stored before a limit existed may break.
  it("returns the field errors of content that breaks a limit now, and stores nothing", async () => {
    const table = `# Table\n\n| a |\n| - |\n${"| x |\n".repeat(CONTENT_MAX_TABLE_CELLS)}`;
    mocks.findFirst.mockResolvedValue(pageWith(table));

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { content: [CONTENT_TABLE_CELLS_MESSAGE] } },
    });
    expectNothingStored();
  });

  it.each([null, 0, 1.5])("stores nothing and returns page-changed for the version %j", async (version) => {
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(revertPage(ACTOR, PAGE_ID, { ...VALID, version })).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });
    expectNothingStored();
  });

  it("returns page-changed with the page as stored for an older version, and records nothing", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, version: VERSION },
      "page to revert changed after the version the write is based on",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns failed and logs it for an error in the transaction", async () => {
    const err = new Error("connection lost");
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.revisionCreate.mockRejectedValue(err);

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to revert page");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns failed and logs it when the page cannot be read", async () => {
    const err = new Error("connection lost");
    mocks.findFirst.mockRejectedValue(err);

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to revert page");
    expectNothingStored();
  });

  it("returns failed for an actor that does not exist", async () => {
    mocks.findFirst.mockResolvedValue(pageWith(OLD));
    mocks.updateMany.mockRejectedValue(foreignKeyViolation({ index: "Page_lastEditedById_fkey" }));

    await expect(revertPage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR_ID }),
      "actor of write not found",
    );
  });
});

describe("moveOrRenamePage", () => {
  const VERSION = 4;
  const VALID = { name: " new-name ", tabId: TAB_ID, version: VERSION };
  const STORED = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: null };

  it.each([
    ["valid input", VALID],
    ["the folder as place", { name: "new-name", tabId: null, version: VERSION }],
    ["invalid input", { name: "", tabId: MALFORMED_ID, version: VERSION }],
  ])("returns page-not-found for a malformed page id, with %s", async (_name, input) => {
    await expect(moveOrRenamePage(ACTOR, MALFORMED_ID, input)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it.each([MALFORMED_ID, "guides", " ", ""])(
    "returns tab-not-found for the malformed tab id %j without writing anything",
    async (tabId) => {
      await expect(moveOrRenamePage(ACTOR, PAGE_ID, { name: "new-name", tabId, version: VERSION })).resolves.toEqual(
        TAB_NOT_FOUND,
      );
      await expect(moveOrRenamePage(ACTOR, PAGE_ID, { name: "", tabId, version: VERSION })).resolves.toEqual(
        TAB_NOT_FOUND,
      );
      expectDatabaseUntouched();
    },
  );

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(moveOrRenamePage(ACTOR, PAGE_ID, { name: "", tabId: TAB_ID, version: VERSION })).resolves.toEqual(
      NAME_REQUIRED,
    );
    expectDatabaseUntouched();
  });

  it("stores name and tab only and returns the page as stored", async () => {
    const stored = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: { name: "stored-tab" } };
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(stored);

    // Content and other fields are ignored: no content rule can block a move.
    const input = { ...VALID, content: "No heading", title: "Given title", folderId: crypto.randomUUID() };
    await expect(moveOrRenamePage(ACTOR, PAGE_ID, input)).resolves.toEqual({ ok: true, value: stored });

    expect(dataOf(mocks.updateMany)).toEqual({
      name: "new-name",
      tabId: TAB_ID,
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
      version: { increment: 1 },
    });
    expect(mocks.info).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tabId: TAB_ID, channel: "web" },
      "page moved or renamed",
    );
  });

  it("places the page directly in its folder without a tab", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ id: PAGE_ID, name: "n", folder: { name: "f" }, tab: null });

    await moveOrRenamePage(ACTOR, PAGE_ID, { name: "new-name", tabId: null, version: VERSION });

    expect(dataOf(mocks.updateMany)).toMatchObject({ name: "new-name", tabId: null });
  });

  // The update matches no row when name and place are the stored ones; the read in the same version tells it apart.
  it.each([
    ["in a tab", TAB_ID, { name: "stored-tab" }],
    ["directly in the folder", null, null],
  ])("stores nothing for the stored name and place %s and returns the page as stored", async (_n, tabId, tab) => {
    const stored = { id: PAGE_ID, name: "new-name", folder: { name: "stored-folder" }, tab };
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(stored);

    // Surrounding spaces are trimmed before the comparison, as for every name.
    await expect(moveOrRenamePage(ACTOR, PAGE_ID, { name: " new-name ", tabId, version: VERSION })).resolves.toEqual({
      ok: true,
      value: stored,
    });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { pageId: PAGE_ID, channel: "web" },
      "page not changed: name and place are the same",
    );
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("logs the channel mcp for a move to the stored name and place through MCP", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(STORED);

    await expect(moveOrRenamePage(MCP_ACTOR, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: STORED });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pageId: PAGE_ID, channel: "mcp" }),
      "page not changed: name and place are the same",
    );
  });

  it.each(nameTakenErrors)("returns name-taken for a unique violation %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tabId: TAB_ID, name: "new-name" },
      "name of moved or renamed page already in use at the target",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(placeKeyErrors)("returns tab-not-found for a foreign key violation %s", async (_n, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(TAB_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tabId: TAB_ID },
      "target tab of moved or renamed page not found in the page's folder",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  // The update matches neither a deleted page nor one with another version; the page as stored tells them apart.
  it("returns page-not-found for a page that no longer exists or is deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to move or rename not found");
  });

  // A stale version matches no row, so a name taken at the target is never checked: the result is page-changed. The
  // same holds for the stored name and place based on a stale version: the read of the unchanged page finds none.
  it("returns page-changed with the page as stored when the update matches no page but the page is stored", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, version: VERSION },
      "page to move or rename changed after the version the write is based on",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // The checks of every move come before the comparison, so the stored name and place change none of their answers.
  it("refuses an admin, an actor without a role, a Reader and a malformed tab also for the stored name and place", async () => {
    const unchanged = { name: "stored-name", tabId: null, version: VERSION };
    await expect(moveOrRenamePage({ ...ACTOR, type: "admin" }, PAGE_ID, unchanged)).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    mocks.roleFindFirst.mockResolvedValue(null);
    await expect(moveOrRenamePage(ACTOR, PAGE_ID, unchanged)).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    mocks.roleFindFirst.mockResolvedValue({ role: "reader" });
    await expect(moveOrRenamePage(ACTOR, PAGE_ID, unchanged)).resolves.toEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    mocks.roleFindFirst.mockResolvedValue({ role: "writer" });
    await expect(moveOrRenamePage(ACTOR, PAGE_ID, { ...unchanged, tabId: MALFORMED_ID })).resolves.toEqual(
      TAB_NOT_FOUND,
    );

    for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each([null, 0, -1, 1.5])("writes nothing and returns page-changed for the version %j", async (version) => {
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, { ...VALID, version })).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a missing version of a page that no longer exists", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, { ...VALID, version: null })).resolves.toEqual(PAGE_NOT_FOUND);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a page that disappears right after the update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to move or rename not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(moveOrRenamePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID, tabId: TAB_ID }, "failed to move or rename page");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("deletePage", () => {
  const VERSION = 4;
  const VALID = { version: VERSION };
  const STORED = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: null };

  it("returns page-not-found for a malformed id", async () => {
    await expect(deletePage(ACTOR, MALFORMED_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it("marks the page as deleted, forgets its tab, counts the version up and returns the place it was in", async () => {
    const place = { folder: { name: "stored-folder" }, tab: { name: "stored-tab" } };
    mocks.findFirst.mockResolvedValue(place);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: place });

    expect(dataOf(mocks.updateMany)).toEqual({
      deletedAt: expect.any(Date),
      tabId: null,
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
      version: { increment: 1 },
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID, channel: "web" }, "page deleted");
  });

  it("returns the folder as the place of a page placed directly in it", async () => {
    const place = { folder: { name: "stored-folder" }, tab: null };
    mocks.findFirst.mockResolvedValue(place);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({ ok: true, value: place });
  });

  it("returns page-not-found for a page that no longer exists or is already deleted", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(null);

    await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to delete not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a page that was deleted between reading and updating it", async () => {
    mocks.findFirst.mockResolvedValue({ folder: { name: "stored-folder" }, tab: null });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "page to delete not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // The read and the update match neither a deleted page nor one with another version; the page as stored tells them
  // apart.
  it.each([
    ["matches no page", () => mocks.findFirst.mockResolvedValue(null)],
    [
      "was changed between reading and updating it",
      () => {
        mocks.findFirst.mockResolvedValue({ folder: { name: "stored-folder" }, tab: null });
        mocks.updateMany.mockResolvedValue({ count: 0 });
      },
    ],
  ])(
    "returns page-changed with the page as stored when the delete %s but the page is stored",
    async (_name, arrange) => {
      arrange();
      mocks.findUnique.mockResolvedValue(STORED);

      await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual({
        ok: false,
        error: { code: "page-changed", page: STORED },
      });

      expect(mocks.warn).toHaveBeenCalledWith(
        { pageId: PAGE_ID, version: VERSION },
        "page to delete changed after the version the write is based on",
      );
      expect(mocks.info).not.toHaveBeenCalled();
    },
  );

  it.each([null, 0, -1, 1.5])("deletes nothing and returns page-changed for the version %j", async (version) => {
    mocks.findUnique.mockResolvedValue(STORED);

    await expect(deletePage(ACTOR, PAGE_ID, { version })).resolves.toEqual({
      ok: false,
      error: { code: "page-changed", page: STORED },
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns page-not-found for a missing version of a page that no longer exists", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(deletePage(ACTOR, PAGE_ID, { version: null })).resolves.toEqual(PAGE_NOT_FOUND);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.transaction.mockRejectedValue(err);

    await expect(deletePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID }, "failed to delete page");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("restorePage", () => {
  const VALID = { name: " new-name ", tabId: TAB_ID };

  it.each([
    ["valid input", VALID],
    ["invalid input", { name: "", tabId: MALFORMED_ID }],
  ])("returns page-not-found for a malformed page id, with %s", async (_name, input) => {
    await expect(restorePage(ACTOR, MALFORMED_ID, input)).resolves.toEqual(PAGE_NOT_FOUND);
    expectDatabaseUntouched();
  });

  it.each([MALFORMED_ID, "guides", " ", ""])(
    "returns tab-not-found for the malformed tab id %j without writing anything",
    async (tabId) => {
      await expect(restorePage(ACTOR, PAGE_ID, { name: "new-name", tabId })).resolves.toEqual(TAB_NOT_FOUND);
      await expect(restorePage(ACTOR, PAGE_ID, { name: "", tabId })).resolves.toEqual(TAB_NOT_FOUND);
      expectDatabaseUntouched();
    },
  );

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(restorePage(ACTOR, PAGE_ID, { name: "", tabId: null })).resolves.toEqual(NAME_REQUIRED);
    expectDatabaseUntouched();
  });

  it("restores the page with name and tab and returns it as stored", async () => {
    const stored = { id: PAGE_ID, name: "stored-name", folder: { name: "stored-folder" }, tab: { name: "stored-tab" } };
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(stored);

    const input = { ...VALID, content: "No heading", title: "Given title" };
    await expect(restorePage(ACTOR, PAGE_ID, input)).resolves.toEqual({ ok: true, value: stored });

    expect(dataOf(mocks.updateMany)).toEqual({
      deletedAt: null,
      name: "new-name",
      tabId: TAB_ID,
      lastEditedById: ACTOR_ID,
      lastEditedVia: "web",
      version: { increment: 1 },
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: PAGE_ID, tabId: TAB_ID, channel: "web" }, "page restored");
  });

  it("restores the page directly into its folder without a tab", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ id: PAGE_ID, name: "n", folder: { name: "f" }, tab: null });

    await restorePage(ACTOR, PAGE_ID, { name: "new-name", tabId: null });

    expect(dataOf(mocks.updateMany)).toMatchObject({ deletedAt: null, name: "new-name", tabId: null });
  });

  it.each(nameTakenErrors)("returns name-taken for a unique violation %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(restorePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tabId: TAB_ID, name: "new-name" },
      "name of restored page already in use at the target",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(placeKeyErrors)("returns tab-not-found for a foreign key violation %s", async (_n, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(restorePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(TAB_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tabId: TAB_ID },
      "target tab of restored page not found in the page's folder",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  // The update only matches a deleted page, so a page that is not deleted counts as missing as well.
  it("returns page-not-found for a page that no longer exists or is not deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(restorePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "deleted page to restore not found");
  });

  it("returns page-not-found for a page that disappears right after the update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(restorePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(PAGE_NOT_FOUND);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: PAGE_ID }, "deleted page to restore not found");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each(otherErrors)("returns failed for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(restorePage(ACTOR, PAGE_ID, VALID)).resolves.toEqual(FAILED);

    expect(mocks.error).toHaveBeenCalledWith({ err, pageId: PAGE_ID, tabId: TAB_ID }, "failed to restore page");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
