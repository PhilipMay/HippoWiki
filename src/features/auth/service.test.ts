import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changeFirstPassword, getSessionUser, logIn, logOut } from "@/features/auth/service";
import { PasswordHashBusyError } from "@/lib/password-hash";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  signInUsername: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  changePassword: vi.fn(),
  userUpdateMany: vi.fn(),
  attemptFindUnique: vi.fn(),
  attemptCreateMany: vi.fn(),
  attemptUpdateMany: vi.fn(),
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
      createMany: mocks.attemptCreateMany,
      updateMany: mocks.attemptUpdateMany,
      deleteMany: mocks.attemptDeleteMany,
    },
    user: { updateMany: mocks.userUpdateMany },
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

/** The failed logins of a name, as the database returns them. */
type Count = { failures: number; lastFailedAt: Date };

/** The write that counts the first login for the name at the time of the clock; it skips a row that exists. */
function firstAttempt(name: string) {
  return { data: [{ username: name, failures: 1, lastFailedAt: NOW }], skipDuplicates: true };
}

/** The write that counts one more login for the name at the time of the clock, only if the count is still `previous`. */
function nextAttempt(name: string, previous: Count) {
  return {
    where: { username: name, failures: previous.failures, lastFailedAt: previous.lastFailedAt },
    data: { failures: previous.failures + 1, lastFailedAt: NOW },
  };
}

/** Whether the login was counted before Better Auth was asked to check the password. */
function countedBeforePasswordCheck(): boolean {
  const counted = Math.min(
    mocks.attemptCreateMany.mock.invocationCallOrder[0] ?? Infinity,
    mocks.attemptUpdateMany.mock.invocationCallOrder[0] ?? Infinity,
  );
  const checked = mocks.signInUsername.mock.invocationCallOrder[0] ?? -Infinity;
  return counted < checked;
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
  // Every write of the count finds the row as it expects it.
  mocks.attemptCreateMany.mockResolvedValue({ count: 1 });
  mocks.attemptUpdateMany.mockResolvedValue({ count: 1 });
  mocks.attemptDeleteMany.mockResolvedValue({ count: 1 });
  mocks.getAuth.mockResolvedValue({
    api: {
      signInUsername: mocks.signInUsername,
      signOut: mocks.signOut,
      getSession: mocks.getSession,
      changePassword: mocks.changePassword,
    },
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
      expect(mocks.attemptCreateMany).not.toHaveBeenCalled();
      expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
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
    expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(firstAttempt("alice"));
    // The count stays: nothing takes it back.
    expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
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
  const EARLIER = new Date(NOW.getTime() - 1000);

  it("counts the first login for a name before the password is checked, in a write that skips an existing row", async () => {
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(mocks.attemptFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { username: "alice" },
      select: { failures: true, lastFailedAt: true },
    });
    expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(firstAttempt("alice"));
    expect(countedBeforePasswordCheck()).toBe(true);
    // The refused login is counted already: nothing is written after the password check.
    expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
  });

  it("counts a further login before the password is checked, only if the count is still the one it read", async () => {
    const previous = { failures: 3, lastFailedAt: EARLIER };
    mocks.attemptFindUnique.mockResolvedValue(previous);
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(mocks.attemptUpdateMany).toHaveBeenCalledExactlyOnceWith(nextAttempt("alice", previous));
    expect(countedBeforePasswordCheck()).toBe(true);
    expect(mocks.attemptCreateMany).not.toHaveBeenCalled();
    expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
  });

  it("counts under the trimmed name", async () => {
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "  alice ", password: PASSWORD }, REQUEST_HEADERS);

    expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(firstAttempt("alice"));
  });

  it("deletes the row of the name after a successful login", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ failures: 4, lastFailedAt: EARLIER });

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result.ok).toBe(true);
    expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({ where: { username: "alice" } });
  });

  it.each([
    ["4 failures a moment ago", 4, 1000],
    ["5 failures a minute ago", 5, 1 * MINUTE],
    ["6 failures two minutes ago", 6, 2 * MINUTE],
    ["9 failures fifteen minutes ago", 9, 15 * MINUTE],
    ["20 failures fifteen minutes ago", 20, 15 * MINUTE],
  ])("counts the login and checks the password again after %s", async (_case, failures, ago) => {
    const previous = { failures, lastFailedAt: new Date(NOW.getTime() - ago) };
    mocks.attemptFindUnique.mockResolvedValue(previous);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result.ok).toBe(true);
    expect(mocks.attemptUpdateMany).toHaveBeenCalledExactlyOnceWith(nextAttempt("alice", previous));
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
      expect(mocks.attemptCreateMany).not.toHaveBeenCalled();
      expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
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
    expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
  });

  describe("with another login for the name at the same time", () => {
    it("reads the count again when the other login created the row first", async () => {
      const taken = { failures: 1, lastFailedAt: NOW };
      mocks.attemptFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(taken);
      mocks.attemptCreateMany.mockResolvedValue({ count: 0 });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

      expect(result.ok).toBe(true);
      expect(mocks.attemptFindUnique).toHaveBeenCalledTimes(2);
      expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(firstAttempt("alice"));
      expect(mocks.attemptUpdateMany).toHaveBeenCalledExactlyOnceWith(nextAttempt("alice", taken));
      expect(mocks.signInUsername).toHaveBeenCalledOnce();
      expect(countedBeforePasswordCheck()).toBe(true);
    });

    it("reads the count again when the other login counted first", async () => {
      const read = { failures: 2, lastFailedAt: EARLIER };
      const taken = { failures: 3, lastFailedAt: NOW };
      mocks.attemptFindUnique.mockResolvedValueOnce(read).mockResolvedValueOnce(taken);
      mocks.attemptUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

      expect(result.ok).toBe(true);
      expect(mocks.attemptUpdateMany).toHaveBeenCalledTimes(2);
      expect(mocks.attemptUpdateMany).toHaveBeenNthCalledWith(1, nextAttempt("alice", read));
      expect(mocks.attemptUpdateMany).toHaveBeenNthCalledWith(2, nextAttempt("alice", taken));
      expect(mocks.signInUsername).toHaveBeenCalledOnce();
    });

    it("makes the login wait when the other login took the last attempt before the wait", async () => {
      mocks.attemptFindUnique
        .mockResolvedValueOnce({ failures: 4, lastFailedAt: EARLIER })
        .mockResolvedValueOnce({ failures: 5, lastFailedAt: NOW });
      mocks.attemptUpdateMany.mockResolvedValue({ count: 0 });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

      expect(result).toEqual({ ok: false, error: { code: "wait", waitMs: MINUTE } });
      expect(mocks.attemptUpdateMany).toHaveBeenCalledOnce();
      expect(mocks.getAuth).not.toHaveBeenCalled();
      expect(mocks.signInUsername).not.toHaveBeenCalled();
    });

    it("answers failed without checking the password when the count keeps changing", async () => {
      mocks.attemptFindUnique.mockResolvedValue({ failures: 1, lastFailedAt: EARLIER });
      mocks.attemptUpdateMany.mockResolvedValue({ count: 0 });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

      expect(result).toEqual({ ok: false, error: { code: "failed" } });
      expect(mocks.attemptFindUnique).toHaveBeenCalledTimes(10);
      expect(mocks.attemptUpdateMany).toHaveBeenCalledTimes(10);
      expect(mocks.signInUsername).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        {
          err: expect.objectContaining({ message: expect.stringContaining("kept changing") as string }) as Error,
          name: "alice",
        },
        "login failed",
      );
    });
  });

  describe.each([
    ["the hashing is busy", new PasswordHashBusyError(), "busy"],
    ["the login fails", new Error("connection refused"), "failed"],
  ])("when %s", (_case, err, code) => {
    beforeEach(() => {
      mocks.signInUsername.mockRejectedValue(err);
    });

    it("takes back the first login for a name by deleting the row it wrote", async () => {
      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({
        where: { username: "alice", failures: 1, lastFailedAt: NOW },
      });
      expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
    });

    it("gives the row the count from before, so that a wait that was over does not start again", async () => {
      const previous = { failures: 5, lastFailedAt: new Date(NOW.getTime() - 2 * MINUTE) };
      mocks.attemptFindUnique.mockResolvedValue(previous);

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.attemptUpdateMany).toHaveBeenCalledTimes(2);
      expect(mocks.attemptUpdateMany).toHaveBeenNthCalledWith(1, nextAttempt("alice", previous));
      expect(mocks.attemptUpdateMany).toHaveBeenNthCalledWith(2, {
        where: { username: "alice", failures: 6, lastFailedAt: NOW },
        data: previous,
      });
      expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
    });

    it.each([
      ["the row it created", null, () => mocks.attemptDeleteMany.mockResolvedValue({ count: 0 })],
      [
        "the row it changed",
        { failures: 2, lastFailedAt: EARLIER },
        () => mocks.attemptUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      ],
    ])("only lowers the number by one when other logins have counted since on %s", async (_row, previous, arrange) => {
      mocks.attemptFindUnique.mockResolvedValue(previous);
      arrange();

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.attemptUpdateMany).toHaveBeenLastCalledWith({
        where: { username: "alice", failures: { gt: 0 } },
        data: { failures: { decrement: 1 } },
      });
    });

    it("keeps its answer when the login cannot be taken back, and logs that", async () => {
      const releaseError = new Error("database gone");
      mocks.attemptDeleteMany.mockRejectedValue(releaseError);

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.error).toHaveBeenCalledWith(
        { err: releaseError, name: "alice" },
        "failed to take back the login attempt",
      );
    });
  });

  it("answers failed when the failed logins cannot be read, without checking the password", async () => {
    const err = new Error("connection refused");
    mocks.attemptFindUnique.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.signInUsername).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, name: "alice" }, "login failed");
  });

  it.each([
    ["the first login for a name", null, mocks.attemptCreateMany],
    ["a further login", { failures: 2, lastFailedAt: EARLIER }, mocks.attemptUpdateMany],
  ])("answers failed when %s cannot be counted, without checking the password", async (_case, previous, write) => {
    const err = new Error("connection refused");
    mocks.attemptFindUnique.mockResolvedValue(previous);
    write.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.signInUsername).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, name: "alice" }, "login failed");
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

describe("changeFirstPassword", () => {
  // Values that no log message contains by chance.
  const FIRST_PASSWORD = "initial-secret-1";
  const NEW_PASSWORD = "replacement-secret-2";
  const INPUT = { currentPassword: FIRST_PASSWORD, newPassword: NEW_PASSWORD, repeatPassword: NEW_PASSWORD };
  const NEW_SESSION_HEADERS = new Headers({ "set-cookie": "better-auth.session_token=new-token.signature" });

  /** Whether Better Auth was asked to change the password before the flag was cleared. */
  function passwordChangedBeforeFlagCleared(): boolean {
    const changed = mocks.changePassword.mock.invocationCallOrder[0] ?? Infinity;
    const cleared = mocks.userUpdateMany.mock.invocationCallOrder[0] ?? -Infinity;
    return changed < cleared;
  }

  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ session: {}, user: { ...AUTH_USER, mustChangePassword: true } });
    mocks.changePassword.mockResolvedValue({ headers: NEW_SESSION_HEADERS, response: { token: "new-token" } });
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("changes the password through Better Auth, ends the other sessions and then clears the flag", async () => {
    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS);

    expect(result).toEqual({
      ok: true,
      value: { user: { id: USER_ID, name: "alice", mustChangePassword: false }, headers: NEW_SESSION_HEADERS },
    });
    expect(mocks.changePassword).toHaveBeenCalledExactlyOnceWith({
      body: { currentPassword: FIRST_PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
      headers: REQUEST_HEADERS,
      returnHeaders: true,
    });
    expect(mocks.userUpdateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: USER_ID, mustChangePassword: true },
      data: { mustChangePassword: false },
    });
    expect(passwordChangedBeforeFlagCleared()).toBe(true);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ userId: USER_ID }, "first password changed");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("passes the passwords on as they are, with their spaces", async () => {
    const spaced = { currentPassword: "  first  ", newPassword: "  my own  ", repeatPassword: "  my own  " };

    await changeFirstPassword(spaced, REQUEST_HEADERS);

    expect(mocks.changePassword).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: { currentPassword: "  first  ", newPassword: "  my own  ", revokeOtherSessions: true },
      }),
    );
  });

  it("answers not-logged-in without a session and changes nothing", async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await changeFirstPassword(INPUT, new Headers());

    expect(result).toEqual({ ok: false, error: { code: "not-logged-in" } });
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it("answers not-required for a user without a pending change and changes nothing", async () => {
    mocks.getSession.mockResolvedValue({ session: {}, user: AUTH_USER });

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "not-required" } });
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a new password of 7 characters",
      { ...INPUT, newPassword: "1234567", repeatPassword: "1234567" },
      { newPassword: ["Password must be at least 8 characters"] },
    ],
    [
      "a new password that is the user name",
      // A user whose name is long enough to be a password.
      { ...INPUT, newPassword: "alexander", repeatPassword: "alexander" },
      { newPassword: ["Password must not be the same as the user name"] },
    ],
    [
      "a new password that is the current one",
      { ...INPUT, newPassword: FIRST_PASSWORD, repeatPassword: FIRST_PASSWORD },
      { newPassword: ["New password must differ from the current one"] },
    ],
    [
      "a repetition that differs",
      { ...INPUT, repeatPassword: "another password" },
      { repeatPassword: ["The two new passwords do not match"] },
    ],
    [
      "a missing current password",
      { ...INPUT, currentPassword: "" },
      { currentPassword: ["Current password is required"] },
    ],
  ])("answers invalid-input for %s and changes nothing", async (_case, input, fieldErrors) => {
    mocks.getSession.mockResolvedValue({
      session: {},
      user: { ...AUTH_USER, name: "alexander", username: "alexander", mustChangePassword: true },
    });

    const result = await changeFirstPassword(input, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "invalid-input", fieldErrors } });
    expect(mocks.getAuth).toHaveBeenCalledOnce();
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it.each([
    [
      "a wrong current password",
      new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "Invalid password" }),
    ],
    [
      "a current password of more than 128 characters",
      new APIError("BAD_REQUEST", { code: "PASSWORD_TOO_LONG", message: "Password too long" }),
    ],
  ])("answers wrong-password for %s and leaves the flag", async (_case, err) => {
    mocks.changePassword.mockRejectedValue(err);

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "wrong-password" } });
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID },
      "first password not changed: wrong current password",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("answers not-logged-in when the session ends before Better Auth changes the password", async () => {
    mocks.changePassword.mockRejectedValue(new APIError("UNAUTHORIZED", { code: "UNAUTHORIZED" }));

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "not-logged-in" } });
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it("answers busy when the password hashing has no free slot, and leaves the flag", async () => {
    mocks.changePassword.mockRejectedValue(new PasswordHashBusyError());

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "busy" } });
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID },
      "too many password hashes are running, first password not changed",
    );
  });

  it.each([
    [
      "a user without a credential account",
      new APIError("BAD_REQUEST", { code: "CREDENTIAL_ACCOUNT_NOT_FOUND", message: "Credential account not found" }),
    ],
    ["an internal error of Better Auth", new APIError("INTERNAL_SERVER_ERROR", { code: "FAILED_TO_GET_SESSION" })],
    ["a database error", new Error("connection refused")],
  ])("answers failed for %s, logs it and leaves the flag", async (_case, err) => {
    mocks.changePassword.mockRejectedValue(err);

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, userId: USER_ID },
      "failed to change the first password",
    );
  });

  it("answers failed when the session cannot be read", async () => {
    const err = new Error("connection refused");
    mocks.getSession.mockRejectedValue(err);

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err }, "failed to change the first password");
  });

  it("answers failed when the flag cannot be cleared after the password has changed", async () => {
    const err = new Error("connection refused");
    mocks.userUpdateMany.mockRejectedValue(err);

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.changePassword).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, userId: USER_ID },
      "first password changed, but the pending change could not be cleared",
    );
  });

  it("answers failed when no user with the pending change is found any more", async () => {
    mocks.userUpdateMany.mockResolvedValue({ count: 0 });

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID },
      "first password changed, but the user with the pending change was not found",
    );
  });

  it.each([
    ["the change succeeds", () => undefined],
    [
      "the current password is wrong",
      () => mocks.changePassword.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" })),
    ],
    ["the hashing is busy", () => mocks.changePassword.mockRejectedValue(new PasswordHashBusyError())],
    ["the change fails", () => mocks.changePassword.mockRejectedValue(new Error("connection refused"))],
    ["the flag cannot be cleared", () => mocks.userUpdateMany.mockRejectedValue(new Error("connection refused"))],
  ])("logs neither password when %s", async (_case, arrange) => {
    arrange();

    await changeFirstPassword(INPUT, REQUEST_HEADERS);

    expect(logged()).not.toContain(FIRST_PASSWORD);
    expect(logged()).not.toContain(NEW_PASSWORD);
  });
});
