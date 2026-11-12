import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFolder, createTab, renameFolder, renameTab } from "@/features/folders/actions";

/** Thrown by the mocked `redirect`, like the real one throws, so that code after it never runs. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

const mocks = vi.hoisted(() => ({
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  createTab: vi.fn(),
  renameTab: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/features/folders/service", () => ({
  createFolder: mocks.createFolder,
  renameFolder: mocks.renameFolder,
  createTab: mocks.createTab,
  renameTab: mocks.renameTab,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const serviceWrites = [mocks.createFolder, mocks.renameFolder, mocks.createTab, mocks.renameTab];

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
/** Field errors that only the service reports, to tell them apart from the ones of the form parser. */
const SERVICE_FIELD_ERRORS = { name: ["Reported by the service"] };

const VALID = " handbook ";
const INVALID = "";
const MALFORMED_ID = "not-a-uuid";

function formData(name: string): FormData {
  const data = new FormData();
  data.set("name", name);
  return data;
}

function failure(code: string, fieldErrors?: Record<string, string[]>) {
  return { ok: false, error: { code, ...(fieldErrors && { fieldErrors }) } };
}

/** Both prefixes are refreshed: a write can change addresses under `/folders` and under `/deleted-pages`. */
function expectContentRevalidated(): void {
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/folders", "layout");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/deleted-pages", "layout");
}

function expectNotRevalidatedOrRedirected(): void {
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
}

function expectServiceNotCalled(): void {
  for (const write of serviceWrites) expect(write).not.toHaveBeenCalled();
}

describe("createFolder", () => {
  it("returns the field errors of an invalid form without calling the service", async () => {
    await expect(createFolder({}, formData(INVALID))).resolves.toEqual(NAME_REQUIRED);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("passes the parsed name to the service, revalidates and redirects to the stored address", async () => {
    mocks.createFolder.mockResolvedValue({ ok: true, value: { id: crypto.randomUUID(), name: "stored-name" } });

    await expect(createFolder({}, formData(VALID))).rejects.toMatchObject({ path: "/folders/stored-name" });

    expect(mocks.createFolder).toHaveBeenCalledWith({ name: "handbook" });
    expectContentRevalidated();
  });

  it.each([
    ["invalid-input", failure("invalid-input", SERVICE_FIELD_ERRORS), { fieldErrors: SERVICE_FIELD_ERRORS }],
    ["name-taken", failure("name-taken"), NAME_TAKEN],
    ["failed", failure("failed"), SAVE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.createFolder.mockResolvedValue(result);

    await expect(createFolder({}, formData(VALID))).resolves.toEqual(state);
    expectNotRevalidatedOrRedirected();
  });
});

describe("renameFolder", () => {
  const id = crypto.randomUUID();

  it.each([
    ["a valid", VALID],
    ["an invalid", INVALID],
  ])("reports a malformed id as a missing folder without calling the service, with %s name", async (_name, name) => {
    await expect(renameFolder(MALFORMED_ID, {}, formData(name))).resolves.toEqual(FOLDER_GONE);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of an invalid form without calling the service", async () => {
    await expect(renameFolder(id, {}, formData(INVALID))).resolves.toEqual(NAME_REQUIRED);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("passes id and parsed name to the service, revalidates and redirects to the stored address", async () => {
    mocks.renameFolder.mockResolvedValue({ ok: true, value: { id, name: "stored-name" } });

    await expect(renameFolder(id, {}, formData(VALID))).rejects.toMatchObject({ path: "/folders/stored-name" });

    expect(mocks.renameFolder).toHaveBeenCalledWith(id, { name: "handbook" });
    expectContentRevalidated();
  });

  it.each([
    ["folder-not-found", failure("folder-not-found"), FOLDER_GONE],
    ["invalid-input", failure("invalid-input", SERVICE_FIELD_ERRORS), { fieldErrors: SERVICE_FIELD_ERRORS }],
    ["name-taken", failure("name-taken"), NAME_TAKEN],
    ["failed", failure("failed"), SAVE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.renameFolder.mockResolvedValue(result);

    await expect(renameFolder(id, {}, formData(VALID))).resolves.toEqual(state);
    expectNotRevalidatedOrRedirected();
  });
});

describe("createTab", () => {
  const folderId = crypto.randomUUID();
  const TAB_VALID = " guides ";

  it.each([
    ["a valid", TAB_VALID],
    ["an invalid", INVALID],
  ])(
    "reports a malformed folder id as a missing folder without calling the service, with %s name",
    async (_name, name) => {
      await expect(createTab(MALFORMED_ID, {}, formData(name))).resolves.toEqual(FOLDER_GONE);
      expectServiceNotCalled();
      expectNotRevalidatedOrRedirected();
    },
  );

  it("returns the field errors of an invalid form without calling the service", async () => {
    await expect(createTab(folderId, {}, formData(INVALID))).resolves.toEqual(NAME_REQUIRED);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("passes folder id and parsed name to the service, revalidates and redirects to the stored address", async () => {
    mocks.createTab.mockResolvedValue({
      ok: true,
      value: { id: crypto.randomUUID(), name: "stored-tab", folder: { name: "stored-folder" } },
    });

    await expect(createTab(folderId, {}, formData(TAB_VALID))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab",
    });

    expect(mocks.createTab).toHaveBeenCalledWith(folderId, { name: "guides" });
    expectContentRevalidated();
  });

  it.each([
    ["folder-not-found", failure("folder-not-found"), FOLDER_GONE],
    ["invalid-input", failure("invalid-input", SERVICE_FIELD_ERRORS), { fieldErrors: SERVICE_FIELD_ERRORS }],
    ["name-taken", failure("name-taken"), NAME_TAKEN],
    ["failed", failure("failed"), TAB_SAVE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.createTab.mockResolvedValue(result);

    await expect(createTab(folderId, {}, formData(TAB_VALID))).resolves.toEqual(state);
    expectNotRevalidatedOrRedirected();
  });
});

describe("renameTab", () => {
  const id = crypto.randomUUID();
  const TAB_VALID = " guides ";

  it.each([
    ["a valid", TAB_VALID],
    ["an invalid", INVALID],
  ])("reports a malformed id as a missing tab without calling the service, with %s name", async (_name, name) => {
    await expect(renameTab(MALFORMED_ID, {}, formData(name))).resolves.toEqual(TAB_GONE);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of an invalid form without calling the service", async () => {
    await expect(renameTab(id, {}, formData(INVALID))).resolves.toEqual(NAME_REQUIRED);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("passes id and parsed name to the service, revalidates and redirects to the stored address", async () => {
    mocks.renameTab.mockResolvedValue({
      ok: true,
      value: { id, name: "stored-tab", folder: { name: "stored-folder" } },
    });

    await expect(renameTab(id, {}, formData(TAB_VALID))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab",
    });

    expect(mocks.renameTab).toHaveBeenCalledWith(id, { name: "guides" });
    expectContentRevalidated();
  });

  it.each([
    ["tab-not-found", failure("tab-not-found"), TAB_GONE],
    ["invalid-input", failure("invalid-input", SERVICE_FIELD_ERRORS), { fieldErrors: SERVICE_FIELD_ERRORS }],
    ["name-taken", failure("name-taken"), NAME_TAKEN],
    ["failed", failure("failed"), TAB_SAVE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.renameTab.mockResolvedValue(result);

    await expect(renameTab(id, {}, formData(TAB_VALID))).resolves.toEqual(state);
    expectNotRevalidatedOrRedirected();
  });
});
