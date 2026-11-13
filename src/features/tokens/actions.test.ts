import { beforeEach, describe, expect, it, vi } from "vitest";

import { createToken, revokeToken } from "@/features/tokens/actions";

/** Thrown by the mocked `redirect` and `notFound`, like the real ones throw, so that code after them never runs. */
class NavigationError extends Error {
  constructor(readonly target: string) {
    super(`navigation to ${target}`);
  }
}

const mocks = vi.hoisted(() => ({
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock(import("@/features/tokens/service"), async (importOriginal) => ({
  ...(await importOriginal()),
  createToken: mocks.createToken,
  revokeToken: mocks.revokeToken,
}));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

const ALICE = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", mustChangePassword: false };
const TOKEN_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
const SECRET = `hw_${"A".repeat(43)}`;

function formData(fields: { name?: string; scopes?: string[]; expiry?: string }): FormData {
  const data = new FormData();
  if (fields.name !== undefined) data.set("name", fields.name);
  for (const scope of fields.scopes ?? []) data.append("scopes", scope);
  if (fields.expiry !== undefined) data.set("expiry", fields.expiry);
  return data;
}

const VALID = { name: "MCP client", scopes: ["read"], expiry: "90d" };

function failure(code: string, fieldErrors?: Record<string, string[]>) {
  return { ok: false, error: { code, ...(fieldErrors && { fieldErrors }) } };
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

describe("createToken", () => {
  it("creates the token as the logged-in user, revalidates the account and returns the name with the token", async () => {
    mocks.createToken.mockResolvedValue({
      ok: true,
      value: { token: { id: TOKEN_ID, name: "stored name" }, secret: SECRET },
    });

    const state = await createToken({}, formData({ ...VALID, name: " MCP client " }));

    // The name comes from the stored token, never from the submitted value.
    expect(state).toStrictEqual({ created: { name: "stored name", secret: SECRET } });
    expect(mocks.createToken).toHaveBeenCalledExactlyOnceWith(ALICE, VALID);
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/account");
    // No redirect: the token must not be part of an address or of a stored page.
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid-input", { name: ["Reported by the service"] }, { fieldErrors: { name: ["Reported by the service"] } }],
    [
      "limit-reached",
      undefined,
      { message: "You already have 20 tokens, the most allowed. Revoke one to create a new one." },
    ],
    ["failed", undefined, { message: "The token could not be created. Please try again." }],
  ])("shows the form state of the code %s, without revalidating", async (code, fieldErrors, state) => {
    mocks.createToken.mockResolvedValue(failure(code, fieldErrors));

    await expect(createToken({}, formData(VALID))).resolves.toEqual(state);

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("shows the field errors of the form without reaching the service", async () => {
    await expect(createToken({}, formData({ name: "", scopes: [], expiry: "7d" }))).resolves.toEqual({
      fieldErrors: {
        name: ["Name is required"],
        scopes: ["Choose at least one scope"],
        expiry: ["Choose when the token expires"],
      },
    });

    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not reach the service without a logged-in user", async () => {
    mocks.requireUser.mockRejectedValue(new NavigationError("/login"));

    await expect(createToken({}, formData(VALID))).rejects.toMatchObject({ target: "/login" });

    expect(mocks.createToken).not.toHaveBeenCalled();
  });
});

describe("revokeToken", () => {
  it("revokes the token as the logged-in user, revalidates the account and redirects there", async () => {
    mocks.revokeToken.mockResolvedValue({ ok: true, value: { id: TOKEN_ID } });

    await expect(revokeToken(TOKEN_ID)).rejects.toMatchObject({ target: "/account" });

    expect(mocks.revokeToken).toHaveBeenCalledExactlyOnceWith(ALICE, TOKEN_ID);
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/account");
    expect(mocks.revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("shows the not-found page for a token that is not found", async () => {
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

  it("shows a message when the token cannot be revoked", async () => {
    mocks.revokeToken.mockResolvedValue(failure("failed"));

    await expect(revokeToken(TOKEN_ID)).resolves.toEqual({
      message: "The token could not be revoked. Please try again.",
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
