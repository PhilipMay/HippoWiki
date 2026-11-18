import { beforeEach, describe, expect, it, vi } from "vitest";

import { revokeGrant } from "@/features/grants/actions";

/** Thrown by the mocked `redirect` and `notFound`, like the real ones throw, so that code after them never runs. */
class NavigationError extends Error {
  constructor(readonly target: string) {
    super(`navigation to ${target}`);
  }
}

const mocks = vi.hoisted(() => ({
  revokeGrant: vi.fn(),
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock(import("@/features/grants/service"), async (importOriginal) => ({
  ...(await importOriginal()),
  revokeGrant: mocks.revokeGrant,
}));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

const ALICE = {
  id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002",
  name: "alice",
  type: "user" as const,
  mustChangePassword: false,
};
const TOKEN_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
function failure(code: string) {
  return { ok: false, error: { code } };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(ALICE);
  mocks.redirect.mockImplementation((path: string) => {
    throw new NavigationError(path);
  });
  mocks.notFound.mockImplementation(() => {
    throw new NavigationError("not-found");
  });
});

describe("revokeGrant", () => {
  it("revokes the app as the logged-in user, revalidates the account and redirects there", async () => {
    mocks.revokeGrant.mockResolvedValue({ ok: true, value: { id: TOKEN_ID } });

    await expect(revokeGrant(TOKEN_ID)).rejects.toMatchObject({ target: "/account" });

    expect(mocks.revokeGrant).toHaveBeenCalledExactlyOnceWith(ALICE, TOKEN_ID);
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/account");
    expect(mocks.revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("shows the not-found page for an app that is unknown or of another user", async () => {
    mocks.revokeGrant.mockResolvedValue(failure("grant-not-found"));

    await expect(revokeGrant(TOKEN_ID)).rejects.toMatchObject({ target: "not-found" });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("shows the not-found page for a malformed id without reaching the service", async () => {
    for (const id of ["", "not-a-uuid", `${TOKEN_ID}x`]) {
      await expect(revokeGrant(id)).rejects.toMatchObject({ target: "not-found" });
    }

    expect(mocks.revokeGrant).not.toHaveBeenCalled();
  });

  // The service answers not-allowed for an admin and while OAuth is off.
  it("shows the not-found page when the service answers not-allowed", async () => {
    mocks.revokeGrant.mockResolvedValue(failure("not-allowed"));

    await expect(revokeGrant(TOKEN_ID)).rejects.toMatchObject({ target: "not-found" });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("shows a message when the app cannot be revoked", async () => {
    mocks.revokeGrant.mockResolvedValue(failure("failed"));

    await expect(revokeGrant(TOKEN_ID)).resolves.toEqual({
      message: "The app could not be revoked. Please try again.",
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not reach the service without a logged-in user", async () => {
    mocks.requireUser.mockRejectedValue(new NavigationError("/login"));

    await expect(revokeGrant(TOKEN_ID)).rejects.toMatchObject({ target: "/login" });

    expect(mocks.revokeGrant).not.toHaveBeenCalled();
  });
});

describe("for an admin", () => {
  // An admin has no grants: like the address of the dialog, the action is not found.
  const ADMIN = { ...ALICE, name: "maria", type: "admin" as const };

  beforeEach(() => {
    mocks.requireUser.mockResolvedValue(ADMIN);
  });

  it("revokeGrant shows the not-found page when the service answers not-allowed", async () => {
    mocks.revokeGrant.mockResolvedValue(failure("not-allowed"));

    await expect(revokeGrant(TOKEN_ID)).rejects.toMatchObject({ target: "not-found" });

    expect(mocks.revokeGrant).toHaveBeenCalledExactlyOnceWith(ADMIN, TOKEN_ID);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
