import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkUploadName, deleteFile, moveOrRenameFile, restoreFile, revertFile } from "@/features/files/actions";
import { NotFoundError, RedirectError } from "@/test/unit";

const mocks = vi.hoisted(() => ({
  checkUploadName: vi.fn(),
  revertFile: vi.fn(),
  moveOrRenameFile: vi.fn(),
  deleteFile: vi.fn(),
  restoreFile: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/features/files/service", () => ({
  checkUploadName: mocks.checkUploadName,
  revertFile: mocks.revertFile,
  moveOrRenameFile: mocks.moveOrRenameFile,
  deleteFile: mocks.deleteFile,
  restoreFile: mocks.restoreFile,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));

const USER = { id: crypto.randomUUID(), name: "alice", type: "user", mustChangePassword: false };
const BROWSER_USER = { id: USER.id, name: USER.name, type: USER.type, channel: "web" };
const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const TAB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.notFound.mockImplementation(() => {
    throw new NotFoundError();
  });
  mocks.redirect.mockImplementation((path: string) => {
    throw new RedirectError(path);
  });
  mocks.requireUser.mockResolvedValue(USER);
});

describe("checkUploadName", () => {
  it("does not reach the service without a logged-in user", async () => {
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

    await expect(checkUploadName(FOLDER_ID, TAB_ID, "diagram.png")).rejects.toBeInstanceOf(RedirectError);
    expect(mocks.checkUploadName).not.toHaveBeenCalled();
  });

  it("answers a free name, with the place and the name passed to the service", async () => {
    mocks.checkUploadName.mockResolvedValue({ ok: true, value: null });

    await expect(checkUploadName(FOLDER_ID, null, "diagram.png")).resolves.toEqual({ ok: true, file: null });
    expect(mocks.checkUploadName).toHaveBeenCalledWith(
      BROWSER_USER,
      { folderId: FOLDER_ID, tabId: null },
      "diagram.png",
    );
  });

  it("answers a taken name with the file of that name as it is now", async () => {
    const updatedAt = new Date("2026-11-20T10:00:00Z");
    mocks.checkUploadName.mockResolvedValue({
      ok: true,
      value: { id: "f", name: "diagram.png", lockVersion: 3, updatedAt, lastEditedBy: { name: "bob", via: "mcp" } },
    });

    await expect(checkUploadName(FOLDER_ID, TAB_ID, "diagram.png")).resolves.toEqual({
      ok: true,
      file: { lockVersion: 3, updatedAt: "2026-11-20T10:00:00.000Z", lastEditedBy: { name: "bob", via: "mcp" } },
    });
  });

  it.each([
    [{ code: "folder-not-found" }, { ok: false, field: null, message: "This folder no longer exists." }],
    [{ code: "tab-not-found" }, { ok: false, field: null, message: "This tab no longer exists." }],
    [
      { code: "invalid-input", fieldErrors: { name: ["Use lowercase…"] } },
      { ok: false, field: "name", message: "Use lowercase…" },
    ],
    [{ code: "failed" }, { ok: false, field: null, message: "The file could not be uploaded. Please try again." }],
  ])("answers %j with its message", async (error, answer) => {
    mocks.checkUploadName.mockResolvedValue({ ok: false, error });

    await expect(checkUploadName(FOLDER_ID, TAB_ID, "x")).resolves.toEqual(answer);
  });

  it("shows the not-found page for a role that may not upload", async () => {
    mocks.checkUploadName.mockResolvedValue({ ok: false, error: { code: "not-allowed" } });

    await expect(checkUploadName(FOLDER_ID, TAB_ID, "diagram.png")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("revertFile", () => {
  const FILE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";
  const STORED = { name: "diagram.png", folder: { name: "handbook" }, tab: { name: "guides" } };

  /** The form of the dialog with the given lock version. */
  function form(lockVersion: string | null = "3"): FormData {
    const data = new FormData();
    if (lockVersion !== null) data.set("lockVersion", lockVersion);
    return data;
  }

  it("does not reach the service without a logged-in user or with a malformed id", async () => {
    await expect(revertFile("not-a-uuid", 1, {}, form())).resolves.toEqual({ message: "This file no longer exists." });
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));
    await expect(revertFile(FILE_ID, 1, {}, form())).rejects.toBeInstanceOf(RedirectError);
    expect(mocks.revertFile).not.toHaveBeenCalled();
  });

  it("reverts with the lock version of the form, revalidates and leads to the details page", async () => {
    mocks.revertFile.mockResolvedValue({ ok: true, value: STORED });

    await expect(revertFile(FILE_ID, 1, {}, form())).rejects.toEqual(
      new RedirectError("/folders/handbook/guides/diagram.png"),
    );
    expect(mocks.revertFile).toHaveBeenCalledWith(BROWSER_USER, FILE_ID, { version: 1, lockVersion: 3 });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it("passes no lock version for a missing or malformed one", async () => {
    mocks.revertFile.mockResolvedValue({ ok: false, error: { code: "failed" } });
    for (const value of [null, "", "x", "-1", "1.5"]) {
      await revertFile(FILE_ID, 1, {}, form(value));
      expect(mocks.revertFile).toHaveBeenLastCalledWith(BROWSER_USER, FILE_ID, { version: 1, lockVersion: null });
    }
  });

  it("shows the dialog again with the notice when the file was changed", async () => {
    mocks.revertFile.mockResolvedValue({ ok: false, error: { code: "file-changed", file: STORED } });

    await expect(revertFile(FILE_ID, 1, {}, form())).rejects.toEqual(
      new RedirectError("/folders/handbook/guides/diagram.png?action=revert&version=1&notice=changed"),
    );
  });

  it.each([
    [{ code: "file-not-found" }, { message: "This file no longer exists." }],
    [{ code: "failed" }, { message: "The file could not be reverted. Please try again." }],
  ])("answers %j with its message, without revalidating", async (error, state) => {
    mocks.revertFile.mockResolvedValue({ ok: false, error });

    await expect(revertFile(FILE_ID, 1, {}, form())).resolves.toEqual(state);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["not-allowed", "version-not-found"])("shows the not-found page for %s", async (code) => {
    mocks.revertFile.mockResolvedValue({ ok: false, error: { code } });

    await expect(revertFile(FILE_ID, 1, {}, form())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("moveOrRenameFile", () => {
  const FILE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";
  const STORED = { name: "network.png", folder: { name: "handbook" }, tab: null, updatedPages: [] };

  /** The form of the dialog with the given name, place and lock version. */
  function form(name = "network.png", place = "", lockVersion: string | null = "3"): FormData {
    const data = new FormData();
    data.set("name", name);
    data.set("place", place);
    if (lockVersion !== null) data.set("lockVersion", lockVersion);
    return data;
  }

  it("does not reach the service without a logged-in user or with a malformed id", async () => {
    await expect(moveOrRenameFile("not-a-uuid", {}, form())).resolves.toEqual({
      message: "This file no longer exists.",
    });
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));
    await expect(moveOrRenameFile(FILE_ID, {}, form())).rejects.toBeInstanceOf(RedirectError);
    expect(mocks.moveOrRenameFile).not.toHaveBeenCalled();
  });

  it("moves with the name, place and lock version of the form, revalidates and leads to the new details page", async () => {
    mocks.moveOrRenameFile.mockResolvedValue({ ok: true, value: STORED });

    await expect(moveOrRenameFile(FILE_ID, {}, form(" network.png ", TAB_ID))).rejects.toEqual(
      new RedirectError("/folders/handbook/network.png"),
    );
    expect(mocks.moveOrRenameFile).toHaveBeenCalledWith(BROWSER_USER, FILE_ID, {
      name: "network.png",
      tabId: TAB_ID,
      lockVersion: 3,
    });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it("answers an invalid name and a malformed place together, without the service", async () => {
    await expect(moveOrRenameFile(FILE_ID, {}, form("Network.png", "not-a-tab"))).resolves.toEqual({
      fieldErrors: { name: [expect.any(String)] },
      message: "This tab no longer exists.",
    });
    expect(mocks.moveOrRenameFile).not.toHaveBeenCalled();
  });

  it("shows the dialog again with the notice when the file was changed", async () => {
    const file = { name: "diagram.png", folder: { name: "handbook" }, tab: { name: "guides" } };
    mocks.moveOrRenameFile.mockResolvedValue({ ok: false, error: { code: "file-changed", file } });

    await expect(moveOrRenameFile(FILE_ID, {}, form())).rejects.toEqual(
      new RedirectError("/folders/handbook/guides/diagram.png?action=move-or-rename&notice=changed"),
    );
  });

  it.each([
    [{ code: "file-not-found" }, { message: "This file no longer exists." }],
    [{ code: "tab-not-found" }, { message: "This tab no longer exists." }],
    [{ code: "invalid-input", fieldErrors: { name: ["x"] } }, { fieldErrors: { name: ["x"] } }],
    [{ code: "name-taken" }, { fieldErrors: { name: ["Name is already in use"] } }],
    [{ code: "failed" }, { message: "The file could not be moved or renamed. Please try again." }],
  ])("answers %j with its message, without revalidating", async (error, state) => {
    mocks.moveOrRenameFile.mockResolvedValue({ ok: false, error });

    await expect(moveOrRenameFile(FILE_ID, {}, form())).resolves.toEqual(state);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("shows the not-found page for a role that may not move it", async () => {
    mocks.moveOrRenameFile.mockResolvedValue({ ok: false, error: { code: "not-allowed" } });

    await expect(moveOrRenameFile(FILE_ID, {}, form())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteFile", () => {
  const FILE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";

  /** The form of the dialog with the given lock version. */
  function form(lockVersion: string | null = "3"): FormData {
    const data = new FormData();
    if (lockVersion !== null) data.set("lockVersion", lockVersion);
    return data;
  }

  it("does not reach the service without a logged-in user or with a malformed id", async () => {
    await expect(deleteFile("not-a-uuid", {}, form())).resolves.toEqual({ message: "This file no longer exists." });
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));
    await expect(deleteFile(FILE_ID, {}, form())).rejects.toBeInstanceOf(RedirectError);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("deletes with the lock version of the form and leads to the tab or the folder the file was in", async () => {
    mocks.deleteFile.mockResolvedValue({ ok: true, value: { folder: { name: "handbook" }, tab: { name: "guides" } } });
    await expect(deleteFile(FILE_ID, {}, form())).rejects.toEqual(new RedirectError("/folders/handbook/guides"));
    expect(mocks.deleteFile).toHaveBeenCalledWith(BROWSER_USER, FILE_ID, { lockVersion: 3 });
    expect(mocks.revalidatePath).toHaveBeenCalled();

    mocks.deleteFile.mockResolvedValue({ ok: true, value: { folder: { name: "handbook" }, tab: null } });
    await expect(deleteFile(FILE_ID, {}, form(null))).rejects.toEqual(new RedirectError("/folders/handbook"));
    expect(mocks.deleteFile).toHaveBeenLastCalledWith(BROWSER_USER, FILE_ID, { lockVersion: null });
  });

  it("shows the dialog again with the notice when the file was changed", async () => {
    const file = { name: "diagram.png", folder: { name: "handbook" }, tab: { name: "guides" } };
    mocks.deleteFile.mockResolvedValue({ ok: false, error: { code: "file-changed", file } });

    await expect(deleteFile(FILE_ID, {}, form())).rejects.toEqual(
      new RedirectError("/folders/handbook/guides/diagram.png?action=delete&notice=changed"),
    );
  });

  it.each([
    [{ code: "file-not-found" }, { message: "This file no longer exists." }],
    [{ code: "failed" }, { message: "The file could not be deleted. Please try again." }],
  ])("answers %j with its message", async (error, state) => {
    mocks.deleteFile.mockResolvedValue({ ok: false, error });
    await expect(deleteFile(FILE_ID, {}, form())).resolves.toEqual(state);
  });

  it("shows the not-found page for a role that may not delete", async () => {
    mocks.deleteFile.mockResolvedValue({ ok: false, error: { code: "not-allowed" } });
    await expect(deleteFile(FILE_ID, {}, form())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("restoreFile", () => {
  const FILE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";

  /** The form of the dialog with the given name and place; `null` leaves the place out. */
  function form(name = "diagram.png", place: string | null = TAB_ID): FormData {
    const data = new FormData();
    data.set("name", name);
    if (place !== null) data.set("place", place);
    return data;
  }

  it("restores under the name and place of the form and leads to the details page", async () => {
    mocks.restoreFile.mockResolvedValue({
      ok: true,
      value: { name: "diagram.png", folder: { name: "handbook" }, tab: { name: "guides" } },
    });

    await expect(restoreFile(FILE_ID, {}, form())).rejects.toEqual(
      new RedirectError("/folders/handbook/guides/diagram.png"),
    );
    expect(mocks.restoreFile).toHaveBeenCalledWith(BROWSER_USER, FILE_ID, { name: "diagram.png", tabId: TAB_ID });
  });

  it("asks for a place when none is chosen, and reports an invalid name with it, without the service", async () => {
    await expect(restoreFile(FILE_ID, {}, form("Diagram.png", null))).resolves.toEqual({
      fieldErrors: { name: [expect.any(String)], place: ["Choose a place"] },
    });
    expect(mocks.restoreFile).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "file-not-found" }, { message: "This file no longer exists." }],
    [{ code: "tab-not-found" }, { message: "This tab no longer exists." }],
    [{ code: "name-taken" }, { fieldErrors: { name: ["Name is already in use"] } }],
    [{ code: "failed" }, { message: "The file could not be restored. Please try again." }],
  ])("answers %j with its message", async (error, state) => {
    mocks.restoreFile.mockResolvedValue({ ok: false, error });
    await expect(restoreFile(FILE_ID, {}, form())).resolves.toEqual(state);
  });

  it("shows the not-found page for a role that may not restore", async () => {
    mocks.restoreFile.mockResolvedValue({ ok: false, error: { code: "not-allowed" } });
    await expect(restoreFile(FILE_ID, {}, form())).rejects.toBeInstanceOf(NotFoundError);
  });
});
