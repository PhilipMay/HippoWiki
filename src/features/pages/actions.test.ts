import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPage, deletePage, moveOrRenamePage, restorePage, updatePageContent } from "@/features/pages/actions";
import { Prisma } from "@/generated/prisma/client";

/** Thrown by the mocked `redirect`, like the real one throws, so that code after it never runs. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  transaction: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    page: { create: mocks.create, updateMany: mocks.updateMany, findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new RedirectError(path);
  });
  // An interactive transaction runs its callback with a client of its own.
  mocks.transaction.mockImplementation((run: (tx: unknown) => Promise<unknown>) =>
    run({ page: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } }),
  );
});

const SAVE_FAILED = { message: "The page could not be saved. Please try again." };
const PAGE_GONE = { message: "This page no longer exists." };
const FOLDER_GONE = { message: "This folder no longer exists." };
const TAB_GONE = { message: "This tab no longer exists." };
const NAME_TAKEN = { fieldErrors: { name: ["Name is already in use"] } };
const NAME_REQUIRED = { fieldErrors: { name: ["Name is required"] } };
const TITLE_MISSING = { fieldErrors: { content: ["Content must start with a title heading: # Title"] } };

const CONTENT = "# My page\n\nText";
const MALFORMED_ID = "not-a-uuid";
/** What the address of a page is built from, as the actions select it. */
const ADDRESS_SELECT = { name: true, folder: { select: { name: true } }, tab: { select: { name: true } } };

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** A Prisma error as the client reports it, e.g. `P2002` for a unique violation. */
function knownError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("database error", { code, clientVersion: "test", meta });
}

/** A unique violation as reported with the `pg` adapter, on the given index or fields. */
function uniqueViolation(constraint: { index?: string; fields?: string[] }): Prisma.PrismaClientKnownRequestError {
  return knownError("P2002", { driverAdapterError: { cause: { constraint } } });
}

const nameTakenErrors = [
  ["on the index of pages placed directly in a folder", uniqueViolation({ index: "Page_folderId_name_key" })],
  ["on the index of pages in a tab", uniqueViolation({ index: "Page_tabId_name_key" })],
  ["on the folder and name fields", uniqueViolation({ fields: ["folderId", "name"] })],
  ["on the tab and name fields", uniqueViolation({ fields: ["tabId", "name"] })],
] as const;

const otherErrors = [
  ["a unique violation on another constraint", uniqueViolation({ index: "Page_other_key" })],
  ["another Prisma error", knownError("P2000")],
  ["any other error", new Error("connection lost")],
] as const;

/** Both prefixes are refreshed: a write can change addresses under `/folders` and under `/deleted-pages`. */
function expectContentRevalidated(): void {
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/folders", "layout");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/deleted-pages", "layout");
}

function expectNotRevalidatedOrRedirected(): void {
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
}

describe("createPage", () => {
  const folderId = crypto.randomUUID();
  const tabId = crypto.randomUUID();
  const VALID = { name: " my-page ", content: CONTENT };
  const IN_TAB = { ...VALID, place: tabId };

  it.each([
    ["valid", VALID],
    ["invalid", { name: "", content: CONTENT }],
  ])("reports a malformed folder id as a missing folder, with %s input", async (_name, fields) => {
    await expect(createPage(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(FOLDER_GONE);
    expect(mocks.create).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of invalid input without writing anything", async () => {
    await expect(createPage(folderId, {}, formData({ name: "", content: CONTENT }))).resolves.toEqual(NAME_REQUIRED);
    await expect(createPage(folderId, {}, formData({ name: "a", content: "Text" }))).resolves.toEqual(TITLE_MISSING);
    expect(mocks.create).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores the page in the folder with the derived title and redirects to its address", async () => {
    const id = crypto.randomUUID();
    mocks.create.mockResolvedValue({ id, name: "stored-name", folder: { name: "stored-folder" }, tab: null });

    const fields = { ...VALID, title: "Submitted title" };
    await expect(createPage(folderId, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: { title: "My page", name: "my-page", content: CONTENT, folderId, tabId: null },
      select: { id: true, ...ADDRESS_SELECT },
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id }, "page created");
    expectContentRevalidated();
  });

  it.each(nameTakenErrors)("reports a taken name for a unique violation %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(folderId, {}, formData(VALID))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId, tabId: null, name: "my-page" }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports a folder that no longer exists for a foreign key violation", async () => {
    mocks.create.mockRejectedValue(knownError("P2003"));

    await expect(createPage(folderId, {}, formData(VALID))).resolves.toEqual(FOLDER_GONE);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId, tabId: null }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores a page in a tab and redirects to its address in the tab", async () => {
    const id = crypto.randomUUID();
    mocks.create.mockResolvedValue({
      id,
      name: "stored-name",
      folder: { name: "stored-folder" },
      tab: { name: "stored-tab" },
    });

    await expect(createPage(folderId, {}, formData(IN_TAB))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: { title: "My page", name: "my-page", content: CONTENT, folderId, tabId },
      select: { id: true, ...ADDRESS_SELECT },
    });
    expectContentRevalidated();
  });

  it.each([
    ["a malformed tab id", { ...VALID, place: MALFORMED_ID }],
    ["a blank place", { ...VALID, place: " " }],
  ])("reports %s as a missing tab without writing anything", async (_name, fields) => {
    await expect(createPage(folderId, {}, formData(fields))).resolves.toEqual(TAB_GONE);
    expect(mocks.create).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports an invalid place together with the field errors", async () => {
    await expect(
      createPage(folderId, {}, formData({ name: "", content: CONTENT, place: MALFORMED_ID })),
    ).resolves.toEqual({ ...NAME_REQUIRED, ...TAB_GONE });
    expect(mocks.create).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores a page with an empty place directly in the folder", async () => {
    mocks.create.mockResolvedValue({ id: crypto.randomUUID(), name: "n", folder: { name: "f" }, tab: null });

    await expect(createPage(folderId, {}, formData({ ...VALID, place: "" }))).rejects.toMatchObject({
      path: "/folders/f/n.md",
    });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tabId: null }) }),
    );
  });

  it("reports a missing tab or a tab of another folder for a foreign key violation", async () => {
    mocks.create.mockRejectedValue(knownError("P2003"));

    await expect(createPage(folderId, {}, formData(IN_TAB))).resolves.toEqual(TAB_GONE);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId, tabId }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports a taken name in a tab", async () => {
    mocks.create.mockRejectedValue(uniqueViolation({ index: "Page_tabId_name_key" }));

    await expect(createPage(folderId, {}, formData(IN_TAB))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId, tabId, name: "my-page" }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(folderId, {}, formData(VALID))).resolves.toEqual(SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});

describe("updatePageContent", () => {
  const id = crypto.randomUUID();
  const VALID = { content: CONTENT };
  const INVALID = { content: "No heading" };

  it.each([
    ["valid", VALID],
    ["invalid", INVALID],
  ])("reports a malformed id as a missing page, with %s input", async (_name, fields) => {
    await expect(updatePageContent(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(PAGE_GONE);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of invalid content without writing anything", async () => {
    await expect(updatePageContent(id, {}, formData(INVALID))).resolves.toEqual(TITLE_MISSING);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores content and derived title only and redirects to the stored address", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ name: "stored-name", folder: { name: "stored-folder" }, tab: null });

    const fields = { ...VALID, title: "Submitted title", name: "submitted-name" };
    await expect(updatePageContent(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id, deletedAt: null },
      data: { title: "My page", content: CONTENT },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id, deletedAt: null }, select: ADDRESS_SELECT });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id }, "page updated");
    expectContentRevalidated();
  });

  // The update only matches a page that is not deleted, so a deleted page counts as missing as well.
  it("reports a page that no longer exists or is deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(updatePageContent(id, {}, formData(VALID))).resolves.toEqual(PAGE_GONE);

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it("reports a page that disappeared right after the update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(updatePageContent(id, {}, formData(VALID))).resolves.toEqual(PAGE_GONE);
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(updatePageContent(id, {}, formData(VALID))).resolves.toEqual(SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it("reports a failed save when the address cannot be read", async () => {
    const err = new Error("connection lost");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockRejectedValue(err);

    await expect(updatePageContent(id, {}, formData(VALID))).resolves.toEqual(SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});

describe("moveOrRenamePage", () => {
  const id = crypto.randomUUID();
  const tabId = crypto.randomUUID();
  const VALID = { name: " new-name ", place: tabId };

  it.each([
    ["valid input", VALID],
    ["the folder as place", { name: "new-name", place: "" }],
    ["invalid input", { name: "", place: MALFORMED_ID }],
  ])("reports a malformed page id as a missing page, with %s", async (_name, fields) => {
    await expect(moveOrRenamePage(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(PAGE_GONE);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the errors of an invalid name and a malformed place without writing anything", async () => {
    await expect(moveOrRenamePage(id, {}, formData({ name: "", place: tabId }))).resolves.toEqual(NAME_REQUIRED);
    for (const place of [MALFORMED_ID, "guides", " "]) {
      await expect(moveOrRenamePage(id, {}, formData({ name: "new-name", place }))).resolves.toEqual(TAB_GONE);
    }
    await expect(moveOrRenamePage(id, {}, formData({ name: "", place: "guides" }))).resolves.toEqual({
      ...NAME_REQUIRED,
      ...TAB_GONE,
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores name and tab only and redirects to the stored address in the tab", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({
      name: "stored-name",
      folder: { name: "stored-folder" },
      tab: { name: "stored-tab" },
    });

    // Submitted content and other fields are ignored: no content rule can block a save.
    const fields = { ...VALID, content: "No heading", title: "Submitted title", folderId: crypto.randomUUID() };
    await expect(moveOrRenamePage(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id, deletedAt: null },
      data: { name: "new-name", tabId },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id, deletedAt: null }, select: ADDRESS_SELECT });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id, tabId }, "page moved or renamed");
    expectContentRevalidated();
  });

  it.each([
    ["an empty place", { name: "new-name", place: "" }],
    ["no place", { name: "new-name" }],
  ])("places the page directly in its folder with %s", async (_name, fields) => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ name: "stored-name", folder: { name: "stored-folder" }, tab: null });

    await expect(moveOrRenamePage(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id, deletedAt: null },
      data: { name: "new-name", tabId: null },
    });
  });

  it.each(nameTakenErrors)("reports a taken name at the name field for a unique violation %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(moveOrRenamePage(id, {}, formData(VALID))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id, tabId, name: "new-name" }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports a missing tab or a tab of another folder for a foreign key violation", async () => {
    mocks.updateMany.mockRejectedValue(knownError("P2003"));

    await expect(moveOrRenamePage(id, {}, formData(VALID))).resolves.toEqual(TAB_GONE);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id, tabId }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  // The update only matches a page that is not deleted, so a deleted page counts as missing as well.
  it("reports a page that no longer exists or is deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(moveOrRenamePage(id, {}, formData(VALID))).resolves.toEqual(PAGE_GONE);

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it("reports a page that disappeared right after the update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(moveOrRenamePage(id, {}, formData(VALID))).resolves.toEqual(PAGE_GONE);
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(moveOrRenamePage(id, {}, formData(VALID))).resolves.toEqual(SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});

describe("deletePage", () => {
  const id = crypto.randomUUID();
  const DELETE_FAILED = { message: "The page could not be deleted. Please try again." };

  it("reports a malformed id as a missing page", async () => {
    await expect(deletePage(MALFORMED_ID)).resolves.toEqual(PAGE_GONE);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("marks the page as deleted, forgets its tab and redirects to the tab it was in", async () => {
    mocks.findFirst.mockResolvedValue({ folder: { name: "stored-folder" }, tab: { name: "stored-tab" } });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(id)).rejects.toMatchObject({ path: "/folders/stored-folder/stored-tab" });

    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, deletedAt: null } }));
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id, deletedAt: null },
      data: { deletedAt: expect.any(Date), tabId: null },
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id }, "page deleted");
    expectContentRevalidated();
  });

  it("redirects to the folder for a page placed directly in it", async () => {
    mocks.findFirst.mockResolvedValue({ folder: { name: "stored-folder" }, tab: null });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(id)).rejects.toMatchObject({ path: "/folders/stored-folder" });
    expectContentRevalidated();
  });

  it("reports a page that no longer exists or is already deleted", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(deletePage(id)).resolves.toEqual(PAGE_GONE);

    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it("reports a page that was deleted between reading and updating it", async () => {
    mocks.findFirst.mockResolvedValue({ folder: { name: "stored-folder" }, tab: null });
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(deletePage(id)).resolves.toEqual(PAGE_GONE);
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed delete for %s", async (_name, err) => {
    mocks.transaction.mockRejectedValue(err);

    await expect(deletePage(id)).resolves.toEqual(DELETE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err, pageId: id }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});

describe("restorePage", () => {
  const id = crypto.randomUUID();
  const tabId = crypto.randomUUID();
  const VALID = { name: " new-name ", place: tabId };
  const RESTORE_FAILED = { message: "The page could not be restored. Please try again." };
  const CHOOSE_PLACE = { fieldErrors: { place: ["Choose a place"] } };

  it.each([
    ["valid input", VALID],
    ["invalid input", { name: "" }],
  ])("reports a malformed page id as a missing page, with %s", async (_name, fields) => {
    await expect(restorePage(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(PAGE_GONE);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("asks for a place together with the errors of the name, without writing anything", async () => {
    await expect(restorePage(id, {}, formData({ name: "new-name" }))).resolves.toEqual(CHOOSE_PLACE);
    await expect(restorePage(id, {}, formData({ name: "" }))).resolves.toEqual({
      fieldErrors: { name: ["Name is required"], place: ["Choose a place"] },
    });
    await expect(restorePage(id, {}, formData({ name: "", place: "guides" }))).resolves.toEqual({
      ...NAME_REQUIRED,
      ...TAB_GONE,
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("restores the page with name and tab and redirects to its stored address", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({
      name: "stored-name",
      folder: { name: "stored-folder" },
      tab: { name: "stored-tab" },
    });

    const fields = { ...VALID, content: "No heading", title: "Submitted title" };
    await expect(restorePage(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null, name: "new-name", tabId },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id, deletedAt: null }, select: ADDRESS_SELECT });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id, tabId }, "page restored");
    expectContentRevalidated();
  });

  it("restores the page directly into its folder for an empty place", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ name: "stored-name", folder: { name: "stored-folder" }, tab: null });

    await expect(restorePage(id, {}, formData({ name: "new-name", place: "" }))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: null, name: "new-name", tabId: null } }),
    );
  });

  it.each(nameTakenErrors)("reports a taken name at the name field for a unique violation %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(restorePage(id, {}, formData(VALID))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id, tabId, name: "new-name" }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it("reports a missing tab or a tab of another folder for a foreign key violation", async () => {
    mocks.updateMany.mockRejectedValue(knownError("P2003"));

    await expect(restorePage(id, {}, formData(VALID))).resolves.toEqual(TAB_GONE);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id, tabId }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  // The update only matches a deleted page, so a page that is not deleted counts as missing as well.
  it("reports a page that no longer exists or is not deleted", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(restorePage(id, {}, formData(VALID))).resolves.toEqual(PAGE_GONE);

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed restore for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(restorePage(id, {}, formData(VALID))).resolves.toEqual(RESTORE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});
