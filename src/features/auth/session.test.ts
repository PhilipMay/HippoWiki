import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser, requireUser } from "@/features/auth/session";

/** Thrown by the mocked `redirect`, like the real one throws, so that code after it never runs. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/features/auth/service", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const REQUEST_HEADERS = new Headers({ cookie: "better-auth.session_token=token.signature" });
const USER = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", mustChangePassword: false };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headers.mockResolvedValue(REQUEST_HEADERS);
  mocks.redirect.mockImplementation((path: string) => {
    throw new RedirectError(path);
  });
});

describe("getCurrentUser", () => {
  it("asks the auth service with the headers of the request and returns its user", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);

    await expect(getCurrentUser()).resolves.toBe(USER);

    expect(mocks.getSessionUser).toHaveBeenCalledExactlyOnceWith(REQUEST_HEADERS);
  });

  it("returns null without a session, without redirecting", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    await expect(getCurrentUser()).resolves.toBeNull();

    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("requireUser", () => {
  it("returns the user of the session", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);

    await expect(requireUser()).resolves.toBe(USER);

    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects to the login page without a session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    await expect(requireUser()).rejects.toMatchObject({ path: "/login" });

    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/login");
  });

  it("does not hide an error of the session check behind a redirect", async () => {
    mocks.getSessionUser.mockRejectedValue(new Error("connection refused"));

    await expect(requireUser()).rejects.toThrow("connection refused");

    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
