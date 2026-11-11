import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPage, movePage, renamePage, updatePageContent } from "@/features/pages/actions";
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
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ page: { create: mocks.create, updateMany: mocks.updateMany, findUnique: mocks.findUnique } }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new RedirectError(path);
  });
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

function expectNotRevalidatedOrRedirected(): void {
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
}

describe("createPage", () => {
  const folderId = crypto.randomUUID();
  const tabId = crypto.randomUUID();
  const VALID = { name: " my-page ", content: CONTENT };

  it.each([
    ["valid", VALID],
    ["invalid", { name: "", content: CONTENT }],
  ])("reports a malformed folder id as a missing folder, with %s input", async (_name, fields) => {
    await expect(createPage(MALFORMED_ID, null, {}, formData(fields))).resolves.toEqual(FOLDER_GONE);
    expect(mocks.create).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of invalid input without writing anything", async () => {
    await expect(createPage(folderId, null, {}, formData({ name: "", content: CONTENT }))).resolves.toEqual(
      NAME_REQUIRED,
    );
    await expect(createPage(folderId, null, {}, formData({ name: "a", content: "Text" }))).resolves.toEqual(
      TITLE_MISSING,
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores the page in the folder with the derived title and redirects to its address", async () => {
    const id = crypto.randomUUID();
    mocks.create.mockResolvedValue({ id, name: "stored-name", folder: { name: "stored-folder" }, tab: null });

    const fields = { ...VALID, title: "Submitted title" };
    await expect(createPage(folderId, null, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: { title: "My page", name: "my-page", content: CONTENT, folderId, tabId: null },
      select: { id: true, ...ADDRESS_SELECT },
    });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id }, "page created");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/folders", "layout");
  });

  it.each(nameTakenErrors)("reports a taken name for a unique violation %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(folderId, null, {}, formData(VALID))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId, tabId: null, name: "my-page" }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports a folder that no longer exists for a foreign key violation", async () => {
    mocks.create.mockRejectedValue(knownError("P2003"));

    await expect(createPage(folderId, null, {}, formData(VALID))).resolves.toEqual(FOLDER_GONE);

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

    await expect(createPage(folderId, tabId, {}, formData(VALID))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: { title: "My page", name: "my-page", content: CONTENT, folderId, tabId },
      select: { id: true, ...ADDRESS_SELECT },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/folders", "layout");
  });

  it("reports a malformed tab id as a missing tab without writing anything", async () => {
    await expect(createPage(folderId, MALFORMED_ID, {}, formData(VALID))).resolves.toEqual(TAB_GONE);
    await expect(createPage(folderId, "", {}, formData(VALID))).resolves.toEqual(TAB_GONE);
    expect(mocks.create).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports a missing tab or a tab of another folder for a foreign key violation", async () => {
    mocks.create.mockRejectedValue(knownError("P2003"));

    await expect(createPage(folderId, tabId, {}, formData(VALID))).resolves.toEqual(TAB_GONE);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId, tabId }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports a taken name in a tab", async () => {
    mocks.create.mockRejectedValue(uniqueViolation({ index: "Page_tabId_name_key" }));

    await expect(createPage(folderId, tabId, {}, formData(VALID))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId, tabId, name: "my-page" }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage(folderId, null, {}, formData(VALID))).resolves.toEqual(SAVE_FAILED);

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

    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id }, data: { title: "My page", content: CONTENT } });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id }, select: ADDRESS_SELECT });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id }, "page updated");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/folders", "layout");
  });

  it("reports a page that no longer exists", async () => {
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

describe("renamePage", () => {
  const id = crypto.randomUUID();
  const VALID = { name: " new-name " };
  const INVALID = { name: "" };

  it.each([
    ["valid", VALID],
    ["invalid", INVALID],
  ])("reports a malformed id as a missing page, with %s input", async (_name, fields) => {
    await expect(renamePage(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(PAGE_GONE);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(renamePage(id, {}, formData(INVALID))).resolves.toEqual(NAME_REQUIRED);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores the name only and redirects to the stored address", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ name: "stored-name", folder: { name: "stored-folder" }, tab: null });

    // Submitted content is ignored: no content rule can block a rename.
    await expect(renamePage(id, {}, formData({ ...VALID, content: "No heading" }))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id }, data: { name: "new-name" } });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id }, "page renamed");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/folders", "layout");
  });

  it("redirects a renamed page in a tab to its address in the tab", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({
      name: "stored-name",
      folder: { name: "stored-folder" },
      tab: { name: "stored-tab" },
    });

    await expect(renamePage(id, {}, formData(VALID))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });
  });

  it("reports a page that no longer exists", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(renamePage(id, {}, formData(VALID))).resolves.toEqual(PAGE_GONE);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it.each(nameTakenErrors)("reports a taken name for a unique violation %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(renamePage(id, {}, formData(VALID))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id, name: "new-name" }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(renamePage(id, {}, formData(VALID))).resolves.toEqual(SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});

describe("movePage", () => {
  const id = crypto.randomUUID();
  const tabId = crypto.randomUUID();
  const MOVE_FAILED = { message: "The page could not be moved. Please try again." };
  const NAME_TAKEN_THERE = { fieldErrors: { target: ["A page with this name already exists there"] } };

  it.each([
    ["a tab as target", { target: tabId }],
    ["the folder as target", { target: "" }],
    ["a malformed target", { target: MALFORMED_ID }],
  ])("reports a malformed page id as a missing page, with %s", async (_name, fields) => {
    await expect(movePage(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(PAGE_GONE);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports a malformed tab id as a missing tab without writing anything", async () => {
    for (const target of [MALFORMED_ID, "guides", " "]) {
      await expect(movePage(id, {}, formData({ target }))).resolves.toEqual(TAB_GONE);
    }
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("moves the page into the tab and redirects to its new address", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({
      name: "stored-name",
      folder: { name: "stored-folder" },
      tab: { name: "stored-tab" },
    });

    // Submitted content and name are ignored: only the place changes.
    const fields = { target: tabId, content: "No heading", name: "submitted-name", folderId: crypto.randomUUID() };
    await expect(movePage(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id }, data: { tabId } });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id }, select: ADDRESS_SELECT });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id, tabId }, "page moved");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/folders", "layout");
  });

  it.each([
    ["an empty target", { target: "" }],
    ["no target", {}],
  ])("moves the page directly into its folder with %s", async (_name, fields) => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({ name: "stored-name", folder: { name: "stored-folder" }, tab: null });

    await expect(movePage(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id }, data: { tabId: null } });
  });

  it.each(nameTakenErrors)("reports a taken name at the target for a unique violation %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(movePage(id, {}, formData({ target: tabId }))).resolves.toEqual(NAME_TAKEN_THERE);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id, tabId }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports a missing tab or a tab of another folder for a foreign key violation", async () => {
    mocks.updateMany.mockRejectedValue(knownError("P2003"));

    await expect(movePage(id, {}, formData({ target: tabId }))).resolves.toEqual(TAB_GONE);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id, tabId }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports a page that no longer exists", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(movePage(id, {}, formData({ target: tabId }))).resolves.toEqual(PAGE_GONE);

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed move for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(movePage(id, {}, formData({ target: tabId }))).resolves.toEqual(MOVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});
