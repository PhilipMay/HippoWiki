import { beforeEach, describe, expect, it, vi } from "vitest";

import { revokeToken } from "@/features/tokens/actions";

/** Thrown by the mocked `redirect` and `notFound`, like the real ones throw, so that code after them never runs. */
class NavigationError extends Error {
  constructor(readonly target: string) {
    super(`navigation to ${target}`);
  }
}

const mocks = vi.hoisted(() => ({
  revokeToken: vi.fn(),
  issuer: vi.fn(),
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock(import("@/features/tokens/service"), async (importOriginal) => ({
  ...(await importOriginal()),
  revokeToken: mocks.revokeToken,
}));
vi.mock("@/features/oauth/issuer", () => ({ issuer: mocks.issuer }));
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
  mocks.issuer.mockReturnValue("https://wiki.example.com");
  mocks.redirect.mockImplementation((path: string) => {
    throw new NavigationError(path);
  });
  mocks.notFound.mockImplementation(() => {
    throw new NavigationError("not-found");
  });
});

describe("revokeToken", () => {
  it("revokes the app as the logged-in user, revalidates the account and redirects there", async () => {
    mocks.revokeToken.mockResolvedValue({ ok: true, value: { id: TOKEN_ID } });

    await expect(revokeToken(TOKEN_ID)).rejects.toMatchObject({ target: "/account" });

    expect(mocks.revokeToken).toHaveBeenCalledExactlyOnceWith(ALICE, TOKEN_ID);
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/account");
    expect(mocks.revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("shows the not-found page for an app that is unknown or of another user", async () => {
    mocks.revokeToken.mockResolvedValue(failure("token-not-found"));

    await expect(revokeToken(TOKEN_ID)).rejects.toMatchObject({ target: "not-found" });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("shows the not-found page for a malformed id without reaching the service", async () => {
    for (const id of ["", "not-a-uuid", `${TOKEN_ID}x`]) {
      await expect(revokeToken(id)).rejects.toMatchObject({ target: "not-found" });
    }

    expect(mocks.revokeToken).not.toHaveBeenCalled();
  });

  it("shows the not-found page without a public URL, without reaching the service", async () => {
    mocks.issuer.mockReturnValue(null);

    await expect(revokeToken(TOKEN_ID)).rejects.toMatchObject({ target: "not-found" });

    expect(mocks.revokeToken).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("shows the not-found page when the service answers not-allowed", async () => {
    mocks.revokeToken.mockResolvedValue(failure("not-allowed"));

    await expect(revokeToken(TOKEN_ID)).rejects.toMatchObject({ target: "not-found" });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("shows a message when the app cannot be revoked", async () => {
    mocks.revokeToken.mockResolvedValue(failure("failed"));

    await expect(revokeToken(TOKEN_ID)).resolves.toEqual({
      message: "The app could not be revoked. Please try again.",
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not reach the service without a logged-in user", async () => {
    mocks.requireUser.mockRejectedValue(new NavigationError("/login"));

    await expect(revokeToken(TOKEN_ID)).rejects.toMatchObject({ target: "/login" });

    expect(mocks.revokeToken).not.toHaveBeenCalled();
  });
});

describe("for an admin", () => {
  // An admin has no grants: like the address of the dialog, the action is not found.
  const ADMIN = { ...ALICE, name: "maria", type: "admin" as const };

  beforeEach(() => {
    mocks.requireUser.mockResolvedValue(ADMIN);
  });

  it("revokeToken shows the not-found page when the service answers not-allowed", async () => {
    mocks.revokeToken.mockResolvedValue(failure("not-allowed"));

    await expect(revokeToken(TOKEN_ID)).rejects.toMatchObject({ target: "not-found" });

    expect(mocks.revokeToken).toHaveBeenCalledExactlyOnceWith(ADMIN, TOKEN_ID);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
