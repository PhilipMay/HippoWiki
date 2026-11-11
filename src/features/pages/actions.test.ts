import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPage, deletePage, updatePage } from "@/features/pages/actions";
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
  deleteMany: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ page: { create: mocks.create, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany } }),
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
const DELETE_FAILED = { message: "The page could not be deleted. Please try again." };
const PAGE_GONE = { message: "This page no longer exists. It may have been deleted." };
const SLUG_TAKEN = { fieldErrors: { slug: ["Slug is already in use"] } };
const SLUG_REQUIRED = { fieldErrors: { slug: ["Slug is required"] } };

const VALID = { slug: " my-page ", content: "# My page\n\nText" };
const STORED = { title: "My page", slug: "my-page", content: "# My page\n\nText" };
const INVALID = { slug: "", content: "# My page" };
const MALFORMED_ID = "not-a-uuid";

function formData(fields: { slug: string; content: string; title?: string }): FormData {
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

const slugTakenErrors = [
  ["on the slug index", uniqueViolation({ index: "Page_slug_key" })],
  ["on the slug field", uniqueViolation({ fields: ["slug"] })],
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
  it("returns the field errors of invalid input without writing anything", async () => {
    await expect(createPage({}, formData(INVALID))).resolves.toEqual(SLUG_REQUIRED);
    expect(mocks.create).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores the page with the derived title and redirects to its address", async () => {
    const id = crypto.randomUUID();
    mocks.create.mockResolvedValue({ id, slug: "stored-slug" });

    await expect(createPage({}, formData({ ...VALID, title: "Submitted title" }))).rejects.toMatchObject({
      path: "/pages/stored-slug",
    });

    expect(mocks.create).toHaveBeenCalledWith({ data: STORED, select: { id: true, slug: true } });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id }, "page created");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pages", "layout");
  });

  it.each(slugTakenErrors)("reports a taken slug for a unique violation %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage({}, formData(VALID))).resolves.toEqual(SLUG_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ slug: "my-page" }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.create.mockRejectedValue(err);

    await expect(createPage({}, formData(VALID))).resolves.toEqual(SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});

describe("updatePage", () => {
  const id = crypto.randomUUID();

  it.each([
    ["valid", VALID],
    ["invalid", INVALID],
  ])("reports a malformed id as a missing page, with %s input", async (_name, fields) => {
    await expect(updatePage(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(PAGE_GONE);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of invalid input without writing anything", async () => {
    await expect(updatePage(id, {}, formData(INVALID))).resolves.toEqual(SLUG_REQUIRED);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("stores the page and redirects to its new address", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(updatePage(id, {}, formData({ ...VALID, title: "Submitted title" }))).rejects.toMatchObject({
      path: "/pages/my-page",
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id }, data: STORED });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id }, "page updated");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pages", "layout");
  });

  it("reports a page that no longer exists", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(updatePage(id, {}, formData(VALID))).resolves.toEqual(PAGE_GONE);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id }, expect.any(String));
    expectNotRevalidatedOrRedirected();
  });

  it.each(slugTakenErrors)("reports a taken slug for a unique violation %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(updatePage(id, {}, formData(VALID))).resolves.toEqual(SLUG_TAKEN);

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id, slug: "my-page" }, expect.any(String));
    expect(mocks.error).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it.each(otherErrors)("reports a failed save for %s", async (_name, err) => {
    mocks.updateMany.mockRejectedValue(err);

    await expect(updatePage(id, {}, formData(VALID))).resolves.toEqual(SAVE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});

describe("deletePage", () => {
  const id = crypto.randomUUID();

  it("deletes the page and redirects to the list", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });

    await expect(deletePage(id)).rejects.toMatchObject({ path: "/pages" });

    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id } });
    expect(mocks.info).toHaveBeenCalledWith({ pageId: id }, "page deleted");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pages", "layout");
  });

  it("treats a page that no longer exists as deleted", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });

    await expect(deletePage(id)).rejects.toMatchObject({ path: "/pages" });

    expect(mocks.warn).toHaveBeenCalledWith({ pageId: id }, expect.any(String));
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pages", "layout");
  });

  it("redirects to the list for a malformed id without touching the database", async () => {
    await expect(deletePage(MALFORMED_ID)).rejects.toMatchObject({ path: "/pages" });

    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ pageId: MALFORMED_ID }, expect.any(String));
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a failed delete without redirecting", async () => {
    const err = new Error("connection lost");
    mocks.deleteMany.mockRejectedValue(err);

    await expect(deletePage(id)).resolves.toEqual(DELETE_FAILED);

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
    expectNotRevalidatedOrRedirected();
  });
});
