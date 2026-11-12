import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPage, deletePage, moveOrRenamePage, restorePage, updatePageContent } from "@/features/pages/actions";

/** Thrown by the mocked `redirect`, like the real one throws, so that code after it never runs. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

const mocks = vi.hoisted(() => ({
  createPage: vi.fn(),
  updatePageContent: vi.fn(),
  moveOrRenamePage: vi.fn(),
  deletePage: vi.fn(),
  restorePage: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/features/pages/service", () => ({
  createPage: mocks.createPage,
  updatePageContent: mocks.updatePageContent,
  moveOrRenamePage: mocks.moveOrRenamePage,
  deletePage: mocks.deletePage,
  restorePage: mocks.restorePage,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const serviceWrites = [
  mocks.createPage,
  mocks.updatePageContent,
  mocks.moveOrRenamePage,
  mocks.deletePage,
  mocks.restorePage,
];

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
/** Field errors that only the service reports, to tell them apart from the ones of the form parser. */
const SERVICE_FIELD_ERRORS = { name: ["Reported by the service"] };

const CONTENT = "# My page\n\nText";
const MALFORMED_ID = "not-a-uuid";

/** A page as the service returns it after a write: placed directly in its folder, or in a tab. */
const STORED_DIRECT = { id: crypto.randomUUID(), name: "stored-name", folder: { name: "stored-folder" }, tab: null };
const STORED_IN_TAB = { ...STORED_DIRECT, tab: { name: "stored-tab" } };

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
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

describe("createPage", () => {
  const folderId = crypto.randomUUID();
  const tabId = crypto.randomUUID();
  const VALID = { name: " my-page ", content: CONTENT };
  const IN_TAB = { ...VALID, place: tabId };

  it.each([
    ["valid", VALID],
    ["invalid", { name: "", content: CONTENT }],
  ])(
    "reports a malformed folder id as a missing folder without calling the service, with %s input",
    async (_name, fields) => {
      await expect(createPage(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(FOLDER_GONE);
      expectServiceNotCalled();
      expectNotRevalidatedOrRedirected();
    },
  );

  it("returns the field errors of an invalid form without calling the service", async () => {
    await expect(createPage(folderId, {}, formData({ name: "", content: CONTENT }))).resolves.toEqual(NAME_REQUIRED);
    await expect(createPage(folderId, {}, formData({ name: "a", content: "Text" }))).resolves.toEqual(TITLE_MISSING);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it.each([
    ["a malformed tab id", { ...VALID, place: MALFORMED_ID }],
    ["a blank place", { ...VALID, place: " " }],
  ])("reports %s as a missing tab without calling the service", async (_name, fields) => {
    await expect(createPage(folderId, {}, formData(fields))).resolves.toEqual(TAB_GONE);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("reports an invalid place together with the field errors", async () => {
    await expect(
      createPage(folderId, {}, formData({ name: "", content: CONTENT, place: MALFORMED_ID })),
    ).resolves.toEqual({ ...NAME_REQUIRED, ...TAB_GONE });
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("passes name, content and the folder as place to the service and redirects to the stored address", async () => {
    mocks.createPage.mockResolvedValue({ ok: true, value: STORED_DIRECT });

    // A submitted title is not passed on; the service derives it from the content.
    const fields = { ...VALID, title: "Submitted title" };
    await expect(createPage(folderId, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.createPage).toHaveBeenCalledWith(folderId, { name: "my-page", content: CONTENT, tabId: null });
    expectContentRevalidated();
  });

  it("passes an empty place as the folder itself", async () => {
    mocks.createPage.mockResolvedValue({ ok: true, value: STORED_DIRECT });

    await expect(createPage(folderId, {}, formData({ ...VALID, place: "" }))).rejects.toBeInstanceOf(RedirectError);

    expect(mocks.createPage).toHaveBeenCalledWith(folderId, expect.objectContaining({ tabId: null }));
  });

  it("passes the chosen tab to the service and redirects to the stored address in the tab", async () => {
    mocks.createPage.mockResolvedValue({ ok: true, value: STORED_IN_TAB });

    await expect(createPage(folderId, {}, formData(IN_TAB))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.createPage).toHaveBeenCalledWith(folderId, { name: "my-page", content: CONTENT, tabId });
    expectContentRevalidated();
  });

  it.each([
    ["folder-not-found", failure("folder-not-found"), FOLDER_GONE],
    ["tab-not-found", failure("tab-not-found"), TAB_GONE],
    ["invalid-input", failure("invalid-input", SERVICE_FIELD_ERRORS), { fieldErrors: SERVICE_FIELD_ERRORS }],
    ["name-taken", failure("name-taken"), NAME_TAKEN],
    ["failed", failure("failed"), SAVE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.createPage.mockResolvedValue(result);

    await expect(createPage(folderId, {}, formData(IN_TAB))).resolves.toEqual(state);
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
  ])("reports a malformed id as a missing page without calling the service, with %s input", async (_name, fields) => {
    await expect(updatePageContent(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(PAGE_GONE);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of an invalid form without calling the service", async () => {
    await expect(updatePageContent(id, {}, formData(INVALID))).resolves.toEqual(TITLE_MISSING);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("passes the content only to the service and redirects to the stored address", async () => {
    mocks.updatePageContent.mockResolvedValue({ ok: true, value: STORED_DIRECT });

    const fields = { ...VALID, title: "Submitted title", name: "submitted-name" };
    await expect(updatePageContent(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.updatePageContent).toHaveBeenCalledWith(id, { content: CONTENT });
    expectContentRevalidated();
  });

  it.each([
    ["page-not-found", failure("page-not-found"), PAGE_GONE],
    ["invalid-input", failure("invalid-input", SERVICE_FIELD_ERRORS), { fieldErrors: SERVICE_FIELD_ERRORS }],
    ["failed", failure("failed"), SAVE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.updatePageContent.mockResolvedValue(result);

    await expect(updatePageContent(id, {}, formData(VALID))).resolves.toEqual(state);
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
  ])("reports a malformed page id as a missing page without calling the service, with %s", async (_name, fields) => {
    await expect(moveOrRenamePage(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(PAGE_GONE);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("returns the errors of an invalid name and a malformed place without calling the service", async () => {
    await expect(moveOrRenamePage(id, {}, formData({ name: "", place: tabId }))).resolves.toEqual(NAME_REQUIRED);
    for (const place of [MALFORMED_ID, "guides", " "]) {
      await expect(moveOrRenamePage(id, {}, formData({ name: "new-name", place }))).resolves.toEqual(TAB_GONE);
    }
    await expect(moveOrRenamePage(id, {}, formData({ name: "", place: "guides" }))).resolves.toEqual({
      ...NAME_REQUIRED,
      ...TAB_GONE,
    });
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("passes name and tab only to the service and redirects to the stored address in the tab", async () => {
    mocks.moveOrRenamePage.mockResolvedValue({ ok: true, value: STORED_IN_TAB });

    // Submitted content and other fields are ignored: no content rule can block a save.
    const fields = { ...VALID, content: "No heading", title: "Submitted title", folderId: crypto.randomUUID() };
    await expect(moveOrRenamePage(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.moveOrRenamePage).toHaveBeenCalledWith(id, { name: "new-name", tabId });
    expectContentRevalidated();
  });

  it.each([
    ["an empty place", { name: "new-name", place: "" }],
    ["no place", { name: "new-name" }],
  ])("passes the folder itself as the place with %s", async (_name, fields) => {
    mocks.moveOrRenamePage.mockResolvedValue({ ok: true, value: STORED_DIRECT });

    await expect(moveOrRenamePage(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.moveOrRenamePage).toHaveBeenCalledWith(id, { name: "new-name", tabId: null });
  });

  it.each([
    ["page-not-found", failure("page-not-found"), PAGE_GONE],
    ["tab-not-found", failure("tab-not-found"), TAB_GONE],
    ["invalid-input", failure("invalid-input", SERVICE_FIELD_ERRORS), { fieldErrors: SERVICE_FIELD_ERRORS }],
    ["name-taken", failure("name-taken"), NAME_TAKEN],
    ["failed", failure("failed"), SAVE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.moveOrRenamePage.mockResolvedValue(result);

    await expect(moveOrRenamePage(id, {}, formData(VALID))).resolves.toEqual(state);
    expectNotRevalidatedOrRedirected();
  });
});

describe("deletePage", () => {
  const id = crypto.randomUUID();
  const DELETE_FAILED = { message: "The page could not be deleted. Please try again." };

  it("reports a malformed id as a missing page without calling the service", async () => {
    await expect(deletePage(MALFORMED_ID)).resolves.toEqual(PAGE_GONE);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("redirects to the tab the deleted page was in", async () => {
    mocks.deletePage.mockResolvedValue({
      ok: true,
      value: { folder: { name: "stored-folder" }, tab: { name: "stored-tab" } },
    });

    await expect(deletePage(id)).rejects.toMatchObject({ path: "/folders/stored-folder/stored-tab" });

    expect(mocks.deletePage).toHaveBeenCalledWith(id);
    expectContentRevalidated();
  });

  it("redirects to the folder for a page placed directly in it", async () => {
    mocks.deletePage.mockResolvedValue({ ok: true, value: { folder: { name: "stored-folder" }, tab: null } });

    await expect(deletePage(id)).rejects.toMatchObject({ path: "/folders/stored-folder" });
    expectContentRevalidated();
  });

  it.each([
    ["page-not-found", failure("page-not-found"), PAGE_GONE],
    ["failed", failure("failed"), DELETE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.deletePage.mockResolvedValue(result);

    await expect(deletePage(id)).resolves.toEqual(state);
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
  ])("reports a malformed page id as a missing page without calling the service, with %s", async (_name, fields) => {
    await expect(restorePage(MALFORMED_ID, {}, formData(fields))).resolves.toEqual(PAGE_GONE);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("asks for a place together with the errors of the name, without calling the service", async () => {
    await expect(restorePage(id, {}, formData({ name: "new-name" }))).resolves.toEqual(CHOOSE_PLACE);
    await expect(restorePage(id, {}, formData({ name: "" }))).resolves.toEqual({
      fieldErrors: { name: ["Name is required"], place: ["Choose a place"] },
    });
    await expect(restorePage(id, {}, formData({ name: "", place: "guides" }))).resolves.toEqual({
      ...NAME_REQUIRED,
      ...TAB_GONE,
    });
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("passes name and tab only to the service and redirects to the stored address", async () => {
    mocks.restorePage.mockResolvedValue({ ok: true, value: STORED_IN_TAB });

    const fields = { ...VALID, content: "No heading", title: "Submitted title" };
    await expect(restorePage(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.restorePage).toHaveBeenCalledWith(id, { name: "new-name", tabId });
    expectContentRevalidated();
  });

  it("passes the folder itself as the place for an empty place", async () => {
    mocks.restorePage.mockResolvedValue({ ok: true, value: STORED_DIRECT });

    await expect(restorePage(id, {}, formData({ name: "new-name", place: "" }))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.restorePage).toHaveBeenCalledWith(id, { name: "new-name", tabId: null });
  });

  it.each([
    ["page-not-found", failure("page-not-found"), PAGE_GONE],
    ["tab-not-found", failure("tab-not-found"), TAB_GONE],
    ["invalid-input", failure("invalid-input", SERVICE_FIELD_ERRORS), { fieldErrors: SERVICE_FIELD_ERRORS }],
    ["name-taken", failure("name-taken"), NAME_TAKEN],
    ["failed", failure("failed"), RESTORE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.restorePage.mockResolvedValue(result);

    await expect(restorePage(id, {}, formData(VALID))).resolves.toEqual(state);
    expectNotRevalidatedOrRedirected();
  });
});
