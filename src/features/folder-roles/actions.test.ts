import { beforeEach, describe, expect, it, vi } from "vitest";

import { giveRole } from "@/features/folder-roles/actions";

/** Thrown by the mocked `redirect`, like the real one throws, so that code after it never runs. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

/** Thrown by the mocked `notFound`, like the real one throws, so that code after it never runs. */
class NotFoundError extends Error {}

const mocks = vi.hoisted(() => ({
  giveRole: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/features/folder-roles/service", () => ({ giveRole: mocks.giveRole }));
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
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/deleted-pages", "layout");
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
