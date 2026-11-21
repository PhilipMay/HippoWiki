import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeRole, giveRole } from "@/features/folder-roles/actions";
import { NotFoundError, RedirectError } from "@/test/unit";

const mocks = vi.hoisted(() => ({
  giveRole: vi.fn(),
  changeRole: vi.fn(),
  removeRole: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/features/folder-roles/service", () => ({
  giveRole: mocks.giveRole,
  changeRole: mocks.changeRole,
  removeRole: mocks.removeRole,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));

/** The logged-in user that `requireUser()` returns; the action passes it to the service as the actor. */
const USER = { id: crypto.randomUUID(), name: "alice", type: "user", mustChangePassword: false };
const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new RedirectError(path);
  });
  mocks.notFound.mockImplementation(() => {
    throw new NotFoundError();
  });
  mocks.requireUser.mockResolvedValue(USER);
});

function formData(user: string, role: string): FormData {
  const data = new FormData();
  data.set("user", user);
  data.set("role", role);
  return data;
}

function expectNotRevalidatedOrRedirected(): void {
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
}

describe("giveRole", () => {
  it("gives the role, revalidates the content and redirects to the stored folder", async () => {
    mocks.giveRole.mockResolvedValue({
      ok: true,
      value: { folder: { name: "stored-folder" }, user: { id: "id", name: "bob" }, role: "writer" },
    });

    await expect(giveRole(FOLDER_ID, {}, formData(" bob ", "writer"))).rejects.toMatchObject({
      path: "/folders/stored-folder",
    });

    expect(mocks.giveRole).toHaveBeenCalledExactlyOnceWith(USER, FOLDER_ID, { user: "bob", role: "writer" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/folders", "layout");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/deleted-items", "layout");
  });

  it("returns the field errors of an invalid form without calling the service", async () => {
    await expect(giveRole(FOLDER_ID, {}, formData("", "admin"))).resolves.toEqual({
      fieldErrors: { user: ["Choose a user"], role: ["Choose a role"] },
    });
    expect(mocks.giveRole).not.toHaveBeenCalled();
    expectNotRevalidatedOrRedirected();
  });

  it("shows the not-found page for a malformed folder id without calling the service", async () => {
    await expect(giveRole("not-a-uuid", {}, formData("bob", "writer"))).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.giveRole).not.toHaveBeenCalled();
  });

  it.each([
    ["user-not-found", { fieldErrors: { user: ["There is no such user"] } }],
    ["role-taken", { fieldErrors: { user: ["This user already has a role on the folder"] } }],
    ["failed", { message: "The role could not be given. Please try again." }],
  ])("returns the error to show for %s", async (code, state) => {
    mocks.giveRole.mockResolvedValue({ ok: false, error: { code } });

    await expect(giveRole(FOLDER_ID, {}, formData("bob", "writer"))).resolves.toEqual(state);
    expectNotRevalidatedOrRedirected();
  });

  it("returns the field errors of the service", async () => {
    const fieldErrors = { role: ["Reported by the service"] };
    mocks.giveRole.mockResolvedValue({ ok: false, error: { code: "invalid-input", fieldErrors } });

    await expect(giveRole(FOLDER_ID, {}, formData("bob", "writer"))).resolves.toEqual({ fieldErrors });
  });

  it("shows the not-found page when the service answers not-allowed", async () => {
    mocks.giveRole.mockResolvedValue({ ok: false, error: { code: "not-allowed" } });

    await expect(giveRole(FOLDER_ID, {}, formData("bob", "writer"))).rejects.toBeInstanceOf(NotFoundError);
    expectNotRevalidatedOrRedirected();
  });

  it("calls nothing without a login", async () => {
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

    await expect(giveRole(FOLDER_ID, {}, formData("bob", "writer"))).rejects.toMatchObject({ path: "/login" });
    expect(mocks.giveRole).not.toHaveBeenCalled();
  });
});

describe("changeRole", () => {
  const BOB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b99";

  function change(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  }

  it("changes a role and stays in the roles view", async () => {
    mocks.changeRole.mockResolvedValue({ ok: true, value: { folder: { name: "stored" }, actorRole: "owner" } });

    await expect(
      changeRole(FOLDER_ID, {}, change({ user: BOB_ID, intent: "change", role: "manager" })),
    ).rejects.toMatchObject({ path: "/folders/stored?view=roles" });

    expect(mocks.changeRole).toHaveBeenCalledExactlyOnceWith(USER, FOLDER_ID, BOB_ID, "manager");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/folders", "layout");
  });

  it("removes a role and stays in the roles view while the Owner keeps a role", async () => {
    mocks.removeRole.mockResolvedValue({ ok: true, value: { folder: { name: "stored" }, actorRole: "writer" } });

    await expect(changeRole(FOLDER_ID, {}, change({ user: BOB_ID, intent: "remove" }))).rejects.toMatchObject({
      path: "/folders/stored?view=roles",
    });
    expect(mocks.removeRole).toHaveBeenCalledExactlyOnceWith(USER, FOLDER_ID, BOB_ID);
  });

  it("leads an Owner without a role to the folder list", async () => {
    mocks.removeRole.mockResolvedValue({ ok: true, value: { folder: { name: "stored" }, actorRole: null } });

    await expect(changeRole(FOLDER_ID, {}, change({ user: USER.id, intent: "remove" }))).rejects.toMatchObject({
      path: "/folders",
    });
  });

  const LAST_OWNER = "A folder needs at least one Owner, so the role of its last Owner stays.";
  const ROLE_GONE = "This user no longer has a role on the folder.";
  const CHANGE_FAILED = "The role could not be changed. Please try again.";

  // A removal has no role, so it never gets invalid-input.
  it.each([
    ["change", "last-owner", LAST_OWNER],
    ["change", "role-not-found", ROLE_GONE],
    ["change", "failed", CHANGE_FAILED],
    ["remove", "last-owner", LAST_OWNER],
    ["remove", "role-not-found", ROLE_GONE],
    ["remove", "failed", CHANGE_FAILED],
  ] as const)("returns the message of a %s for %s", async (intent, code, message) => {
    const write = intent === "change" ? mocks.changeRole : mocks.removeRole;
    write.mockResolvedValue({ ok: false, error: { code } });

    await expect(
      changeRole(FOLDER_ID, {}, change({ user: BOB_ID, intent, ...(intent === "change" ? { role: "reader" } : {}) })),
    ).resolves.toEqual({ message });
    expect(write).toHaveBeenCalledOnce();
    expectNotRevalidatedOrRedirected();
  });

  it("shows the field error of the role when the service answers invalid-input", async () => {
    mocks.changeRole.mockResolvedValue({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { role: ["Choose a role"] } },
    });

    await expect(changeRole(FOLDER_ID, {}, change({ user: BOB_ID, intent: "change", role: "admin" }))).resolves.toEqual(
      { message: "Choose a role" },
    );
    expect(mocks.changeRole).toHaveBeenCalledExactlyOnceWith(USER, FOLDER_ID, BOB_ID, "admin");
    expectNotRevalidatedOrRedirected();
  });

  it("shows the not-found page when the service answers not-allowed, and for a malformed folder id", async () => {
    mocks.removeRole.mockResolvedValue({ ok: false, error: { code: "not-allowed" } });

    await expect(changeRole(FOLDER_ID, {}, change({ user: BOB_ID, intent: "remove" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(changeRole("not-a-uuid", {}, change({ user: BOB_ID, intent: "remove" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.removeRole).toHaveBeenCalledOnce();
    expectNotRevalidatedOrRedirected();
  });

  it("asks for a role when the submission is neither a change nor a removal", async () => {
    await expect(changeRole(FOLDER_ID, {}, change({ user: BOB_ID, intent: "other" }))).resolves.toEqual({
      message: "Choose a role.",
    });
    expect(mocks.changeRole).not.toHaveBeenCalled();
    expect(mocks.removeRole).not.toHaveBeenCalled();
  });
});
