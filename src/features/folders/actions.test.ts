import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFolder, createTab, renameFolder, renameTab } from "@/features/folders/actions";
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
  tabCreate: vi.fn(),
  tabUpdateMany: vi.fn(),
  tabFindUnique: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    folder: { create: mocks.create, updateMany: mocks.updateMany },
    tab: { create: mocks.tabCreate, updateMany: mocks.tabUpdateMany, findUnique: mocks.tabFindUnique },
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
});

const SAVE_FAILED = { message: "The folder could not be saved. Please try again." };
const FOLDER_GONE = { message: "This folder no longer exists." };
const TAB_SAVE_FAILED = { message: "The tab could not be saved. Please try again." };
const TAB_GONE = { message: "This tab no longer exists." };
const NAME_TAKEN = { fieldErrors: { name: ["Name is already in use"] } };
const NAME_REQUIRED = { fieldErrors: { name: ["Name is required"] } };

const VALID = " handbook ";
const INVALID = "";
const MALFORMED_ID = "not-a-uuid";

function formData(name: string): FormData {
  const data = new FormData();
  data.set("name", name);
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
  ["on the name index", uniqueViolation({ index: "Folder_name_key" })],
  ["on the name field", uniqueViolation({ fields: ["name"] })],
] as const;

const otherErrors = [
  ["a unique violation on another index", uniqueViolation({ index: "Folder_other_key" })],
  ["a unique violation on another field", uniqueViolation({ fields: ["other"] })],
  ["a unique violation without details", knownError("P2002")],
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

describe("createFolder", () => {
  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(createFolder({}, formData(INVALID))).resolves.toEqual(NAME_REQUIRED);
    expect(mocks.create).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores the folder and redirects to its address", async () => {
    const id = crypto.randomUUID();
    mocks.create.mockResolvedValue({ id, name: "stored-name" });

    await expect(createFolder({}, formData(VALID))).rejects.toMatchObject({ path: "/folders/stored-name" });

    expect(mocks.create).toHaveBeenCalledWith({ data: { name: "handbook" }, select: { id: true, name: true } });
    expect(mocks.info).toHaveBeenCalledWith({ folderId: id }, "folder created");
    expectContentRevalidated();
  });

  it.each(nameTakenErrors)("reports a taken name for a unique violation %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createFolder({}, formData(VALID))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ name: "handbook" }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createFolder({}, formData(VALID))).resolves.toEqual(SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});

describe("renameFolder", () => {
  const id = crypto.randomUUID();

  it.each([
    ["a valid", VALID],
    ["an invalid", INVALID],
  ])("reports a malformed id as a missing folder, with %s name", async (_name, name) => {
    await expect(renameFolder(MALFORMED_ID, {}, formData(name))).resolves.toEqual(FOLDER_GONE);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(renameFolder(id, {}, formData(INVALID))).resolves.toEqual(NAME_REQUIRED);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores the name and redirects to the new address", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(renameFolder(id, {}, formData(VALID))).rejects.toMatchObject({ path: "/folders/handbook" });

    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id }, data: { name: "handbook" } });
    expect(mocks.info).toHaveBeenCalledWith({ folderId: id }, "folder renamed");
    expectContentRevalidated();
  });

  it("reports a folder that no longer exists", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(renameFolder(id, {}, formData(VALID))).resolves.toEqual(FOLDER_GONE);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId: id }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it.each(nameTakenErrors)("reports a taken name for a unique violation %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(renameFolder(id, {}, formData(VALID))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId: id, name: "handbook" }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(renameFolder(id, {}, formData(VALID))).resolves.toEqual(SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});

const tabNameTakenErrors = [
  ["on the name index", uniqueViolation({ index: "Tab_folderId_name_key" })],
  ["on the folder and name fields", uniqueViolation({ fields: ["folderId", "name"] })],
] as const;

const otherTabErrors = [
  ["a unique violation on another index", uniqueViolation({ index: "Tab_id_folderId_key" })],
  ["another Prisma error", knownError("P2000")],
  ["any other error", new Error("connection lost")],
] as const;

describe("createTab", () => {
  const folderId = crypto.randomUUID();
  const TAB_VALID = " guides ";

  it.each([
    ["a valid", TAB_VALID],
    ["an invalid", INVALID],
  ])("reports a malformed folder id as a missing folder, with %s name", async (_name, name) => {
    await expect(createTab(MALFORMED_ID, {}, formData(name))).resolves.toEqual(FOLDER_GONE);
    expect(mocks.tabCreate).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(createTab(folderId, {}, formData(INVALID))).resolves.toEqual(NAME_REQUIRED);
    expect(mocks.tabCreate).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores the tab in the folder and redirects to its address", async () => {
    const id = crypto.randomUUID();
    mocks.tabCreate.mockResolvedValue({ id, name: "stored-tab", folder: { name: "stored-folder" } });

    await expect(createTab(folderId, {}, formData(TAB_VALID))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab",
    });

    expect(mocks.tabCreate).toHaveBeenCalledWith({
      data: { name: "guides", folderId },
      select: { id: true, name: true, folder: { select: { name: true } } },
    });
    expect(mocks.info).toHaveBeenCalledWith({ tabId: id }, "tab created");
    expectContentRevalidated();
  });

  it.each(tabNameTakenErrors)("reports a taken name for a unique violation %s", async (_name, err) => {
    mocks.tabCreate.mockRejectedValue(err);

    await expect(createTab(folderId, {}, formData(TAB_VALID))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId, name: "guides" }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports a folder that no longer exists for a foreign key violation", async () => {
    mocks.tabCreate.mockRejectedValue(knownError("P2003"));

    await expect(createTab(folderId, {}, formData(TAB_VALID))).resolves.toEqual(FOLDER_GONE);

    expect(mocks.warn).toHaveBeenCalledWith({ folderId }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherTabErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.tabCreate.mockRejectedValue(err);

    await expect(createTab(folderId, {}, formData(TAB_VALID))).resolves.toEqual(TAB_SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});

describe("renameTab", () => {
  const id = crypto.randomUUID();
  const TAB_VALID = " guides ";

  it.each([
    ["a valid", TAB_VALID],
    ["an invalid", INVALID],
  ])("reports a malformed id as a missing tab, with %s name", async (_name, name) => {
    await expect(renameTab(MALFORMED_ID, {}, formData(name))).resolves.toEqual(TAB_GONE);
    expect(mocks.tabUpdateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of an invalid name without writing anything", async () => {
    await expect(renameTab(id, {}, formData(INVALID))).resolves.toEqual(NAME_REQUIRED);
    expect(mocks.tabUpdateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores the name and redirects to the stored address", async () => {
    mocks.tabUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tabFindUnique.mockResolvedValue({ name: "stored-tab", folder: { name: "stored-folder" } });

    await expect(renameTab(id, {}, formData(TAB_VALID))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab",
    });

    expect(mocks.tabUpdateMany).toHaveBeenCalledWith({ where: { id }, data: { name: "guides" } });
    expect(mocks.tabFindUnique).toHaveBeenCalledWith({
      where: { id },
      select: { name: true, folder: { select: { name: true } } },
    });
    expect(mocks.info).toHaveBeenCalledWith({ tabId: id }, "tab renamed");
    expectContentRevalidated();
  });

  it("reports a tab that no longer exists", async () => {
    mocks.tabUpdateMany.mockResolvedValue({ count: 0 });

    await expect(renameTab(id, {}, formData(TAB_VALID))).resolves.toEqual(TAB_GONE);

    expect(mocks.tabFindUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ tabId: id }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it.each(tabNameTakenErrors)("reports a taken name for a unique violation %s", async (_name, err) => {
    mocks.tabUpdateMany.mockRejectedValue(err);

    await expect(renameTab(id, {}, formData(TAB_VALID))).resolves.toEqual(NAME_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ tabId: id, name: "guides" }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherTabErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.tabUpdateMany.mockRejectedValue(err);

    await expect(renameTab(id, {}, formData(TAB_VALID))).resolves.toEqual(TAB_SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});
