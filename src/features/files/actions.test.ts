import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkUploadName } from "@/features/files/actions";
import { NotFoundError, RedirectError } from "@/test/unit";

const mocks = vi.hoisted(() => ({
  checkUploadName: vi.fn(),
  notFound: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/features/files/service", () => ({ checkUploadName: mocks.checkUploadName }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
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
