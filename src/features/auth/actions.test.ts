import { beforeEach, describe, expect, it, vi } from "vitest";

import { logIn, logOut } from "@/features/auth/actions";

/** `redirect` throws in Next.js; the mock throws this error, so code after it does not run. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

const mocks = vi.hoisted(() => ({
  logIn: vi.fn(),
  logOut: vi.fn(),
  headers: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/features/auth/service", () => ({ logIn: mocks.logIn, logOut: mocks.logOut }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const REQUEST_HEADERS = new Headers({ cookie: "better-auth.session_token=token.signature" });
const USER = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", mustChangePassword: false };

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const LOGIN_FORM = { name: "alice", password: "secret password" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headers.mockResolvedValue(REQUEST_HEADERS);
  mocks.redirect.mockImplementation((path: string) => {
    throw new RedirectError(path);
  });
});

describe("logIn", () => {
  it("logs in with the form and the headers of the request, revalidates everything and leads to the folders", async () => {
    mocks.logIn.mockResolvedValue({ ok: true, value: { user: USER, headers: new Headers() } });

    await expect(logIn({}, formData(LOGIN_FORM))).rejects.toMatchObject({ path: "/folders" });

    expect(mocks.logIn).toHaveBeenCalledExactlyOnceWith(LOGIN_FORM, REQUEST_HEADERS);
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it.each([
    ["invalid-credentials", { message: "Invalid user name or password" }],
    ["busy", { message: "Too many logins at the moment, please try again" }],
    ["failed", { message: "The login failed. Please try again." }],
  ])("shows the message of the code %s, without revalidating or redirecting", async (code, state) => {
    mocks.logIn.mockResolvedValue({ ok: false, error: { code } });

    await expect(logIn({}, formData(LOGIN_FORM))).resolves.toEqual(state);

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty name", { name: "", password: "secret password" }, { name: ["User name is required"] }],
    ["an empty password", { name: "alice", password: "" }, { password: ["Password is required"] }],
    [
      "an empty form",
      { name: "", password: "" },
      { name: ["User name is required"], password: ["Password is required"] },
    ],
  ])("shows the field errors of %s without reaching the service", async (_case, fields, fieldErrors) => {
    await expect(logIn({}, formData(fields))).resolves.toEqual({ fieldErrors });

    expect(mocks.logIn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("logOut", () => {
  it("ends the session of the request, revalidates everything and leads to the login page", async () => {
    mocks.logOut.mockResolvedValue({ ok: true, value: { headers: new Headers() } });

    await expect(logOut()).rejects.toMatchObject({ path: "/login" });

    expect(mocks.logOut).toHaveBeenCalledExactlyOnceWith(REQUEST_HEADERS);
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it("throws when the session could not be ended, without revalidating or redirecting", async () => {
    mocks.logOut.mockResolvedValue({ ok: false, error: { code: "failed" } });

    await expect(logOut()).rejects.toThrow("The logout failed.");

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
