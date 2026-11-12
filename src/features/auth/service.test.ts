import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSessionUser, logIn, logOut } from "@/features/auth/service";
import { PasswordHashBusyError } from "@/lib/password-hash";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  signInUsername: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const USER_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";
const PASSWORD = "secret password";
/** A user as Better Auth returns it. */
const AUTH_USER = {
  id: USER_ID,
  name: "alice",
  username: "alice",
  email: "alice@users.hippowiki.invalid",
  mustChangePassword: false,
};
const REQUEST_HEADERS = new Headers({ cookie: "better-auth.session_token=token.signature" });
const RESPONSE_HEADERS = new Headers({ "set-cookie": "better-auth.session_token=token.signature" });

/** The error of Better Auth for an unknown name and for a wrong password. */
function invalidCredentials(): APIError {
  return new APIError("UNAUTHORIZED", {
    code: "INVALID_USERNAME_OR_PASSWORD",
    message: "Invalid username or password",
  });
}

/** Everything that was passed to the logger, as one string. */
function logged(): string {
  return JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls]);
}

function expectNothingLogged(): void {
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.warn).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAuth.mockResolvedValue({
    api: { signInUsername: mocks.signInUsername, signOut: mocks.signOut, getSession: mocks.getSession },
  });
  mocks.signInUsername.mockResolvedValue({
    headers: RESPONSE_HEADERS,
    response: { token: "token", user: AUTH_USER },
  });
  mocks.signOut.mockResolvedValue({ headers: RESPONSE_HEADERS, response: { success: true } });
});

describe("logIn", () => {
  it("signs in through Better Auth and returns the user with the response headers", async () => {
    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toEqual({
      ok: true,
      value: { user: { id: USER_ID, name: "alice", mustChangePassword: false }, headers: RESPONSE_HEADERS },
    });
    expect(mocks.signInUsername).toHaveBeenCalledExactlyOnceWith({
      body: { username: "alice", password: PASSWORD },
      headers: REQUEST_HEADERS,
      returnHeaders: true,
    });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ userId: USER_ID }, "user logged in");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("returns a pending password change with the user", async () => {
    mocks.signInUsername.mockResolvedValue({
      headers: RESPONSE_HEADERS,
      response: { token: "token", user: { ...AUTH_USER, mustChangePassword: true } },
    });

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toMatchObject({ ok: true, value: { user: { mustChangePassword: true } } });
  });

  it("trims the name and passes the password on as it is", async () => {
    await logIn({ name: "  alice ", password: "  spaced  " }, REQUEST_HEADERS);

    expect(mocks.signInUsername).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: { username: "alice", password: "  spaced  " } }),
    );
  });

  it("passes on a password of 128 characters and one that is shorter than a new password may be", async () => {
    await logIn({ name: "alice", password: "p".repeat(128) }, REQUEST_HEADERS);
    await logIn({ name: "alice", password: "x" }, REQUEST_HEADERS);

    expect(mocks.signInUsername).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an unknown name or a wrong password (401)", invalidCredentials()],
    ["a name that Better Auth refuses (422)", new APIError("UNPROCESSABLE_ENTITY", { code: "INVALID_USERNAME" })],
    ["a password that Better Auth finds too long (400)", new APIError("BAD_REQUEST", { code: "PASSWORD_TOO_LONG" })],
  ])("answers %s with invalid-credentials", async (_case, err) => {
    mocks.signInUsername.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "invalid-credentials" } });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { name: "alice" },
      "login refused: unknown name or wrong password",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty name", "", PASSWORD],
    ["a name of 2 characters", "ab", PASSWORD],
    ["a name of 31 characters", "a".repeat(31), PASSWORD],
    ["a name in upper case", "Alice", PASSWORD],
    ["a name with a double hyphen", "al--ice", PASSWORD],
    ["an email address as the name", "alice@users.hippowiki.invalid", PASSWORD],
    ["a password of 129 characters", "alice", "p".repeat(129)],
    ["an empty password", "alice", ""],
  ])("answers %s like a wrong password, without reaching Better Auth", async (_case, name, password) => {
    const result = await logIn({ name, password }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "invalid-credentials" } });
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.signInUsername).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it("answers busy when the password hashing has no free slot", async () => {
    mocks.signInUsername.mockRejectedValue(new PasswordHashBusyError());

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "busy" } });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { name: "alice" },
      "too many password hashes are running, login not checked",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([
    ["an internal error of Better Auth", new APIError("INTERNAL_SERVER_ERROR", { code: "FAILED_TO_CREATE_SESSION" })],
    ["a refusal that is not about the credentials", new APIError("FORBIDDEN", { code: "EMAIL_NOT_VERIFIED" })],
    ["a database error", new Error("connection refused")],
  ])("answers %s with failed and logs it", async (_case, err) => {
    mocks.signInUsername.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, name: "alice" }, "login failed");
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("answers failed when Better Auth cannot be created", async () => {
    const err = new Error("connection refused");
    mocks.getAuth.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, name: "alice" }, "login failed");
  });

  it.each([
    ["the login succeeds", () => undefined],
    ["the password is wrong", () => mocks.signInUsername.mockRejectedValue(invalidCredentials())],
    ["the hashing is busy", () => mocks.signInUsername.mockRejectedValue(new PasswordHashBusyError())],
    ["the login fails", () => mocks.signInUsername.mockRejectedValue(new Error("connection refused"))],
  ])("does not log the password when %s", async (_case, arrange) => {
    arrange();

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(logged()).not.toContain(PASSWORD);
  });
});

describe("logOut", () => {
  it("signs out the session of the request and returns the response headers", async () => {
    const result = await logOut(REQUEST_HEADERS);

    expect(result).toEqual({ ok: true, value: { headers: RESPONSE_HEADERS } });
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ headers: REQUEST_HEADERS, returnHeaders: true });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("session ended");
  });

  it.each([
    ["Better Auth fails", () => mocks.signOut.mockRejectedValue(new Error("connection refused"))],
    ["Better Auth cannot be created", () => mocks.getAuth.mockRejectedValue(new Error("connection refused"))],
  ])("answers failed and logs it when %s", async (_case, arrange) => {
    arrange();

    const result = await logOut(REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err: expect.objectContaining({ message: "connection refused" }) as Error },
      "logout failed",
    );
  });
});

describe("getSessionUser", () => {
  it("returns the user of the session of the request", async () => {
    mocks.getSession.mockResolvedValue({ session: { token: "token" }, user: AUTH_USER });

    await expect(getSessionUser(REQUEST_HEADERS)).resolves.toStrictEqual({
      id: USER_ID,
      name: "alice",
      mustChangePassword: false,
    });
    expect(mocks.getSession).toHaveBeenCalledExactlyOnceWith({ headers: REQUEST_HEADERS });
  });

  it("returns a pending password change with the user", async () => {
    mocks.getSession.mockResolvedValue({ session: {}, user: { ...AUTH_USER, mustChangePassword: true } });

    await expect(getSessionUser(REQUEST_HEADERS)).resolves.toMatchObject({ mustChangePassword: true });
  });

  it("treats a user without the flag as one with a pending password change", async () => {
    mocks.getSession.mockResolvedValue({ session: {}, user: { id: USER_ID, name: "alice", username: "alice" } });

    await expect(getSessionUser(REQUEST_HEADERS)).resolves.toMatchObject({ mustChangePassword: true });
  });

  it("returns null without a valid session", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(getSessionUser(new Headers())).resolves.toBeNull();
  });

  it("throws when the session cannot be read", async () => {
    mocks.getSession.mockRejectedValue(new Error("connection refused"));

    await expect(getSessionUser(REQUEST_HEADERS)).rejects.toThrow("connection refused");
  });
});
