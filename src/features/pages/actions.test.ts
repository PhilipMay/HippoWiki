import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  createPage,
  deletePage,
  moveOrRenamePage,
  restorePage,
  revertPage,
  updatePageContent,
} from "@/features/pages/actions";
import { CONTENT_TABLE_CELLS_MESSAGE } from "@/features/pages/schema";
import { NotFoundError, RedirectError } from "@/test/unit";

const mocks = vi.hoisted(() => ({
  createPage: vi.fn(),
  updatePageContent: vi.fn(),
  moveOrRenamePage: vi.fn(),
  deletePage: vi.fn(),
  restorePage: vi.fn(),
  revertPage: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/features/pages/service", () => ({
  createPage: mocks.createPage,
  updatePageContent: mocks.updatePageContent,
  moveOrRenamePage: mocks.moveOrRenamePage,
  deletePage: mocks.deletePage,
  restorePage: mocks.restorePage,
  revertPage: mocks.revertPage,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));

const serviceWrites = [
  mocks.createPage,
  mocks.updatePageContent,
  mocks.moveOrRenamePage,
  mocks.deletePage,
  mocks.restorePage,
  mocks.revertPage,
];

/** The logged-in user that `requireUser()` returns; every action passes it to its service write as the actor. */
const USER = { id: crypto.randomUUID(), name: "alice", type: "user", mustChangePassword: false };
/** The actor the actions pass to the services: the logged-in user, in the browser. */
const BROWSER_USER = { id: USER.id, name: USER.name, type: USER.type, channel: "web" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new RedirectError(path);
  });
  mocks.notFound.mockImplementation(() => {
    throw new NotFoundError();
  });
  // A logged-in user, unless a test says otherwise.
  mocks.requireUser.mockResolvedValue(USER);
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

    expect(mocks.createPage).toHaveBeenCalledWith(BROWSER_USER, folderId, {
      name: "my-page",
      content: CONTENT,
      tabId: null,
    });
    expectContentRevalidated();
  });

  it("passes an empty place as the folder itself", async () => {
    mocks.createPage.mockResolvedValue({ ok: true, value: STORED_DIRECT });

    await expect(createPage(folderId, {}, formData({ ...VALID, place: "" }))).rejects.toBeInstanceOf(RedirectError);

    expect(mocks.createPage).toHaveBeenCalledWith(BROWSER_USER, folderId, expect.objectContaining({ tabId: null }));
  });

  it("passes the chosen tab to the service and redirects to the stored address in the tab", async () => {
    mocks.createPage.mockResolvedValue({ ok: true, value: STORED_IN_TAB });

    await expect(createPage(folderId, {}, formData(IN_TAB))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.createPage).toHaveBeenCalledWith(BROWSER_USER, folderId, { name: "my-page", content: CONTENT, tabId });
    expectContentRevalidated();
  });

  it.each([
    ["folder-not-found", failure("folder-not-found"), FOLDER_GONE],
    ["tab-not-found", failure("tab-not-found"), TAB_GONE],
    ["invalid-input", failure("invalid-input", SERVICE_FIELD_ERRORS), { fieldErrors: SERVICE_FIELD_ERRORS }],
    ["name-taken", failure("name-taken"), NAME_TAKEN],
    [
      "no-suggested-name",
      failure("no-suggested-name"),
      { fieldErrors: { name: ["The title suggests no name. Enter a name."] } },
    ],
    ["failed", failure("failed"), SAVE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.createPage.mockResolvedValue(result);

    await expect(createPage(folderId, {}, formData(IN_TAB))).resolves.toEqual(state);
    expectNotRevalidatedOrRedirected();
  });
});

describe("updatePageContent", () => {
  const id = crypto.randomUUID();
  const VALID = { content: CONTENT, version: "3" };
  const INVALID = { content: "No heading", version: "3" };

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

  it("passes the content and the version only to the service and redirects to the stored address", async () => {
    mocks.updatePageContent.mockResolvedValue({ ok: true, value: STORED_DIRECT });

    const fields = { ...VALID, title: "Submitted title", name: "submitted-name" };
    await expect(updatePageContent(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.updatePageContent).toHaveBeenCalledWith(BROWSER_USER, id, { content: CONTENT, version: 3 });
    expectContentRevalidated();
  });

  // The service refuses a save without a version, so that the editor shows the current page.
  it.each([
    ["missing", { content: CONTENT }],
    ["malformed", { content: CONTENT, version: "x" }],
  ])("passes a %s version on as null", async (_name, fields) => {
    mocks.updatePageContent.mockResolvedValue({ ok: false, error: { code: "failed" } });

    await updatePageContent(id, {}, formData(fields));

    expect(mocks.updatePageContent).toHaveBeenCalledWith(BROWSER_USER, id, { content: CONTENT, version: null });
  });

  it("shows the editor again at the stored address with the notice when the page was changed", async () => {
    mocks.updatePageContent.mockResolvedValue({ ok: false, error: { code: "page-changed", page: STORED_IN_TAB } });

    await expect(updatePageContent(id, {}, formData(VALID))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md?action=edit&notice=changed",
    });
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
  const VALID = { name: " new-name ", place: tabId, version: "2" };

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

  it("passes name, tab and version only to the service and redirects to the stored address in the tab", async () => {
    mocks.moveOrRenamePage.mockResolvedValue({ ok: true, value: STORED_IN_TAB });

    // Submitted content and other fields are ignored: no content rule can block a save.
    const fields = { ...VALID, content: "No heading", title: "Submitted title", folderId: crypto.randomUUID() };
    await expect(moveOrRenamePage(id, {}, formData(fields))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.moveOrRenamePage).toHaveBeenCalledWith(BROWSER_USER, id, { name: "new-name", tabId, version: 2 });
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

    expect(mocks.moveOrRenamePage).toHaveBeenCalledWith(BROWSER_USER, id, {
      name: "new-name",
      tabId: null,
      version: null,
    });
  });

  it("shows the dialog again at the stored address with the notice when the page was changed", async () => {
    mocks.moveOrRenamePage.mockResolvedValue({ ok: false, error: { code: "page-changed", page: STORED_DIRECT } });

    await expect(moveOrRenamePage(id, {}, formData(VALID))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md?action=move-or-rename&notice=changed",
    });
    expectContentRevalidated();
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
  const VALID = { version: "6" };

  it("reports a malformed id as a missing page without calling the service", async () => {
    await expect(deletePage(MALFORMED_ID, {}, formData(VALID))).resolves.toEqual(PAGE_GONE);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("passes the version to the service and redirects to the tab the deleted page was in", async () => {
    mocks.deletePage.mockResolvedValue({
      ok: true,
      value: { folder: { name: "stored-folder" }, tab: { name: "stored-tab" } },
    });

    await expect(deletePage(id, {}, formData({ ...VALID, name: "other" }))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab",
    });

    expect(mocks.deletePage).toHaveBeenCalledWith(BROWSER_USER, id, { version: 6 });
    expectContentRevalidated();
  });

  it("redirects to the folder for a page placed directly in it", async () => {
    mocks.deletePage.mockResolvedValue({ ok: true, value: { folder: { name: "stored-folder" }, tab: null } });

    await expect(deletePage(id, {}, formData(VALID))).rejects.toMatchObject({ path: "/folders/stored-folder" });
    expectContentRevalidated();
  });

  // The service refuses a delete without a version, so that the dialog shows the current page.
  it.each([
    ["missing", {}],
    ["malformed", { version: "six" }],
  ])("passes a %s version on as null", async (_name, fields) => {
    mocks.deletePage.mockResolvedValue({ ok: false, error: { code: "failed" } });

    await deletePage(id, {}, formData(fields));

    expect(mocks.deletePage).toHaveBeenCalledWith(BROWSER_USER, id, { version: null });
  });

  it("shows the dialog again at the stored address with the notice when the page was changed", async () => {
    mocks.deletePage.mockResolvedValue({ ok: false, error: { code: "page-changed", page: STORED_IN_TAB } });

    await expect(deletePage(id, {}, formData(VALID))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md?action=delete&notice=changed",
    });
    expectContentRevalidated();
  });

  it.each([
    ["page-not-found", failure("page-not-found"), PAGE_GONE],
    ["failed", failure("failed"), DELETE_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.deletePage.mockResolvedValue(result);

    await expect(deletePage(id, {}, formData(VALID))).resolves.toEqual(state);
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

    expect(mocks.restorePage).toHaveBeenCalledWith(BROWSER_USER, id, { name: "new-name", tabId });
    expectContentRevalidated();
  });

  it("passes the folder itself as the place for an empty place", async () => {
    mocks.restorePage.mockResolvedValue({ ok: true, value: STORED_DIRECT });

    await expect(restorePage(id, {}, formData({ name: "new-name", place: "" }))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-name.md",
    });

    expect(mocks.restorePage).toHaveBeenCalledWith(BROWSER_USER, id, { name: "new-name", tabId: null });
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

/** Every action with a call that reaches the service when a user is logged in, and the service write it calls. */
const ACTIONS: [string, () => Promise<unknown>, Mock][] = [
  [
    "createPage",
    () => createPage(crypto.randomUUID(), {}, formData({ name: "my-page", content: CONTENT, place: "" })),
    mocks.createPage,
  ],
  [
    "updatePageContent",
    () => updatePageContent(crypto.randomUUID(), {}, formData({ content: CONTENT })),
    mocks.updatePageContent,
  ],
  [
    "moveOrRenamePage",
    () => moveOrRenamePage(crypto.randomUUID(), {}, formData({ name: "new-name", place: "" })),
    mocks.moveOrRenamePage,
  ],
  ["deletePage", () => deletePage(crypto.randomUUID(), {}, formData({ version: "1" })), mocks.deletePage],
  ["revertPage", () => revertPage(crypto.randomUUID(), 2, {}, formData({ version: "1" })), mocks.revertPage],
  [
    "restorePage",
    () => restorePage(crypto.randomUUID(), {}, formData({ name: "new-name", place: "" })),
    mocks.restorePage,
  ],
];

describe("revertPage", () => {
  const id = crypto.randomUUID();
  const REVERT_FAILED = { message: "The page could not be reverted. Please try again." };
  const VALID = { version: "6" };

  it("reports a malformed id as a missing page without calling the service", async () => {
    await expect(revertPage(MALFORMED_ID, 2, {}, formData(VALID))).resolves.toEqual(PAGE_GONE);
    expectServiceNotCalled();
    expectNotRevalidatedOrRedirected();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "shows the not-found page for the revision number %j without calling the service",
    async (revision) => {
      await expect(revertPage(id, revision, {}, formData(VALID))).rejects.toBeInstanceOf(NotFoundError);
      expectServiceNotCalled();
      expectNotRevalidatedOrRedirected();
    },
  );

  it("passes the revision and the version to the service and redirects to the page as stored", async () => {
    mocks.revertPage.mockResolvedValue({ ok: true, value: STORED_IN_TAB });

    await expect(
      revertPage(id, 2, {}, formData({ ...VALID, content: "# Other", revision: "3" })),
    ).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md",
    });

    expect(mocks.revertPage).toHaveBeenCalledExactlyOnceWith(BROWSER_USER, id, { revision: 2, version: 6 });
    expectContentRevalidated();
  });

  it.each([
    ["missing", {}],
    ["malformed", { version: "six" }],
  ])("passes a %s version on as null", async (_name, fields) => {
    mocks.revertPage.mockResolvedValue({ ok: false, error: { code: "failed" } });

    await revertPage(id, 2, {}, formData(fields));

    expect(mocks.revertPage).toHaveBeenCalledWith(BROWSER_USER, id, { revision: 2, version: null });
  });

  it("shows the dialog again at the stored address with the notice when the page was changed", async () => {
    mocks.revertPage.mockResolvedValue({ ok: false, error: { code: "page-changed", page: STORED_IN_TAB } });

    await expect(revertPage(id, 2, {}, formData(VALID))).rejects.toMatchObject({
      path: "/folders/stored-folder/stored-tab/stored-name.md?action=revert&revision=2&notice=changed",
    });
    expectContentRevalidated();
  });

  it("names the broken limit when the content of the revision breaks one now", async () => {
    mocks.revertPage.mockResolvedValue(failure("invalid-input", { content: [CONTENT_TABLE_CELLS_MESSAGE] }));

    await expect(revertPage(id, 2, {}, formData(VALID))).resolves.toEqual({
      message: `This revision breaks a limit of pages and cannot be restored. Copy its raw form into the editor to fix it: ${CONTENT_TABLE_CELLS_MESSAGE}.`,
    });
    expectNotRevalidatedOrRedirected();
  });

  it("shows the not-found page when there is no revision to revert to", async () => {
    mocks.revertPage.mockResolvedValue(failure("revision-not-found"));

    await expect(revertPage(id, 2, {}, formData(VALID))).rejects.toBeInstanceOf(NotFoundError);
    expectNotRevalidatedOrRedirected();
  });

  it.each([
    ["page-not-found", failure("page-not-found"), PAGE_GONE],
    ["failed", failure("failed"), REVERT_FAILED],
  ])("shows the form state of %s", async (_code, result, state) => {
    mocks.revertPage.mockResolvedValue(result);

    await expect(revertPage(id, 2, {}, formData(VALID))).resolves.toEqual(state);
    expectNotRevalidatedOrRedirected();
  });
});

describe("without a logged-in user", () => {
  // A Server Action is a public endpoint: its form may be shown by a page that checked the login, but the request can
  // come from anywhere and at any time, e.g. after the session has ended.
  it.each(ACTIONS)("%s redirects to the login page and does not reach the service", async (_name, action) => {
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

    await expect(action()).rejects.toMatchObject({ path: "/login" });

    for (const write of serviceWrites) expect(write).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)(
    "%s reaches the service with the same input once a user is logged in",
    async (_name, action, write) => {
      write.mockResolvedValue({ ok: false, error: { code: "failed" } });

      await action();

      expect(mocks.requireUser).toHaveBeenCalledOnce();
      expect(write).toHaveBeenCalledOnce();
    },
  );
});

describe("for an admin", () => {
  // The service refuses an admin, and a user without a role on the folder; for them the content does not exist, so the
  // action shows the not-found page.
  it.each(ACTIONS)("%s shows the not-found page when the service answers not-allowed", async (_name, action, write) => {
    const admin = { ...USER, type: "admin" };
    mocks.requireUser.mockResolvedValue(admin);
    write.mockResolvedValue({ ok: false, error: { code: "not-allowed" } });

    await expect(action()).rejects.toBeInstanceOf(NotFoundError);

    expect(write.mock.calls[0]?.[0]).toEqual({ ...BROWSER_USER, type: "admin" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
