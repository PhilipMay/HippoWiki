import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSessionUser, logIn, logOut } from "@/features/auth/service";
import { PasswordHashBusyError } from "@/lib/password-hash";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  signInUsername: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  attemptFindUnique: vi.fn(),
  attemptUpsert: vi.fn(),
  attemptDeleteMany: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    loginAttempt: {
      findUnique: mocks.attemptFindUnique,
      upsert: mocks.attemptUpsert,
      deleteMany: mocks.attemptDeleteMany,
    },
  }),
}));
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

/** The clock of the tests; the service takes the current time from it. */
const NOW = new Date("2026-11-12T12:00:00.000Z");
const MINUTE = 60_000;

/** The statement that counts a failed login for the name at the time of the clock. */
function countedFailure(name: string) {
  return {
    where: { username: name },
    create: { username: name, failures: 1, lastFailedAt: NOW },
    update: { failures: { increment: 1 }, lastFailedAt: NOW },
  };
}

function expectNothingLogged(): void {
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.warn).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  // No failed logins so far, unless a test says otherwise.
  mocks.attemptFindUnique.mockResolvedValue(null);
  mocks.attemptUpsert.mockResolvedValue({});
  mocks.attemptDeleteMany.mockResolvedValue({ count: 0 });
  mocks.getAuth.mockResolvedValue({
    api: { signInUsername: mocks.signInUsername, signOut: mocks.signOut, getSession: mocks.getSession },
  });
  mocks.signInUsername.mockResolvedValue({
    headers: RESPONSE_HEADERS,
    response: { token: "token", user: AUTH_USER },
  });
  mocks.signOut.mockResolvedValue({ headers: RESPONSE_HEADERS, response: { success: true } });
});

afterEach(() => {
  vi.useRealTimers();
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
    ["an empty name", ""],
    ["a name of 2 characters", "ab"],
    ["a name of 31 characters", "a".repeat(31)],
    ["a name in upper case", "Alice"],
    ["a name with a double hyphen", "al--ice"],
    ["an email address as the name", "alice@users.hippowiki.invalid"],
  ])(
    "answers %s like a wrong password, without reaching Better Auth and without a row for the name",
    async (_case, name) => {
      const result = await logIn({ name, password: PASSWORD }, REQUEST_HEADERS);

      expect(result).toEqual({ ok: false, error: { code: "invalid-credentials" } });
      expect(mocks.getAuth).not.toHaveBeenCalled();
      expect(mocks.signInUsername).not.toHaveBeenCalled();
      // Such a name cannot belong to a user; the table of the failed logins must not take any text.
      expect(mocks.attemptFindUnique).not.toHaveBeenCalled();
      expect(mocks.attemptUpsert).not.toHaveBeenCalled();
      expectNothingLogged();
    },
  );

  it.each([
    ["a password of 129 characters", "p".repeat(129)],
    ["an empty password", ""],
  ])("counts %s as a failed login, without reaching Better Auth", async (_case, password) => {
    const result = await logIn({ name: "alice", password }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "invalid-credentials" } });
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.signInUsername).not.toHaveBeenCalled();
    expect(mocks.attemptUpsert).toHaveBeenCalledExactlyOnceWith(countedFailure("alice"));
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

describe("the wait after failed logins", () => {
  it("counts a refused login for the name, in one statement that also creates the row", async () => {
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(mocks.attemptFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { username: "alice" },
      select: { failures: true, lastFailedAt: true },
    });
    expect(mocks.attemptUpsert).toHaveBeenCalledExactlyOnceWith(countedFailure("alice"));
    expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
  });

  it("counts under the trimmed name", async () => {
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "  alice ", password: PASSWORD }, REQUEST_HEADERS);

    expect(mocks.attemptUpsert).toHaveBeenCalledExactlyOnceWith(countedFailure("alice"));
  });

  it("deletes the row of the name after a successful login", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ failures: 4, lastFailedAt: new Date(NOW.getTime() - 1000) });

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result.ok).toBe(true);
    expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({ where: { username: "alice" } });
    expect(mocks.attemptUpsert).not.toHaveBeenCalled();
  });

  it.each([
    ["4 failures a moment ago", 4, 1000],
    ["5 failures a minute ago", 5, 1 * MINUTE],
    ["6 failures two minutes ago", 6, 2 * MINUTE],
    ["9 failures fifteen minutes ago", 9, 15 * MINUTE],
    ["20 failures fifteen minutes ago", 20, 15 * MINUTE],
  ])("checks the password again after %s", async (_case, failures, ago) => {
    mocks.attemptFindUnique.mockResolvedValue({ failures, lastFailedAt: new Date(NOW.getTime() - ago) });

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result.ok).toBe(true);
    expect(mocks.signInUsername).toHaveBeenCalledOnce();
  });

  it.each([
    ["5 failures a moment ago", 5, 1000, 1 * MINUTE - 1000],
    ["5 failures almost a minute ago", 5, 1 * MINUTE - 1, 1],
    ["6 failures a minute ago", 6, 1 * MINUTE, 1 * MINUTE],
    ["7 failures a moment ago", 7, 0, 4 * MINUTE],
    ["8 failures a moment ago", 8, 0, 8 * MINUTE],
    ["9 failures a moment ago", 9, 0, 15 * MINUTE],
    ["20 failures ten minutes ago", 20, 10 * MINUTE, 5 * MINUTE],
  ])(
    "refuses a login after %s with the time that is left, without Better Auth and without a change of the row",
    async (_case, failures, ago, waitMs) => {
      mocks.attemptFindUnique.mockResolvedValue({ failures, lastFailedAt: new Date(NOW.getTime() - ago) });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

      expect(result).toEqual({ ok: false, error: { code: "wait", waitMs } });
      // No password is checked during the wait, and the attempt is not counted.
      expect(mocks.getAuth).not.toHaveBeenCalled();
      expect(mocks.signInUsername).not.toHaveBeenCalled();
      expect(mocks.attemptUpsert).not.toHaveBeenCalled();
      expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { name: "alice", waitMs },
        "login refused: waiting after failed logins",
      );
    },
  );

  it("refuses a password that cannot belong to a user during the wait like every other one", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ failures: 5, lastFailedAt: NOW });

    const result = await logIn({ name: "alice", password: "p".repeat(129) }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "wait", waitMs: MINUTE } });
    expect(mocks.attemptUpsert).not.toHaveBeenCalled();
  });

  it.each([
    ["the hashing is busy", new PasswordHashBusyError(), "busy"],
    ["the login fails", new Error("connection refused"), "failed"],
  ])("does not count an attempt when %s", async (_case, err, code) => {
    mocks.signInUsername.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code } });
    expect(mocks.attemptUpsert).not.toHaveBeenCalled();
    expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
  });

  it("answers failed when the failed logins cannot be read, without checking the password", async () => {
    const err = new Error("connection refused");
    mocks.attemptFindUnique.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.signInUsername).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, name: "alice" }, "login failed");
  });

  it("still refuses the login when the failure cannot be counted, and logs that", async () => {
    const err = new Error("connection refused");
    mocks.signInUsername.mockRejectedValue(invalidCredentials());
    mocks.attemptUpsert.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "invalid-credentials" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, name: "alice" }, "failed to count the failed login");
  });

  it("still logs in when the failed logins cannot be reset, and logs that", async () => {
    const err = new Error("connection refused");
    mocks.attemptDeleteMany.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result.ok).toBe(true);
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, name: "alice" }, "failed to reset the failed logins");
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
