import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  changeFirstPassword,
  changeOwnPassword,
  getSessionUser,
  logIn,
  logOut,
  logOutOtherSessions,
  verifyPassword,
} from "@/features/auth/service";
import { PasswordHashBusyError } from "@/lib/password-hash";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  signInUsername: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  changePassword: vi.fn(),
  verifyPassword: vi.fn(),
  userUpdateMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  attemptFindUnique: vi.fn(),
  attemptCreateMany: vi.fn(),
  attemptUpdateMany: vi.fn(),
  attemptDeleteMany: vi.fn(),
  windowFindUnique: vi.fn(),
  windowCreateMany: vi.fn(),
  windowUpdateMany: vi.fn(),
  windowDeleteMany: vi.fn(),
  attemptDeleteOld: vi.fn(),
  windowDeleteOld: vi.fn(),
  transaction: vi.fn(),
  revokeAllGrants: vi.fn(),
  isOAuthOn: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/features/grants/service", () => ({ revokeAllGrants: mocks.revokeAllGrants }));
vi.mock("@/features/oauth/issuer", () => ({ isOAuthOn: mocks.isOAuthOn }));
/**
 * The mocked Prisma client. A transaction runs its callback with the same functions. A delete that names no user name
 * is the deleting of old rows, so it goes to a mock of its own (`attemptDeleteOld`, `windowDeleteOld`), and the mocks
 * of the deletes of a name see only those.
 */
const db = vi.hoisted(() => {
  type DeleteArgs = { where: Record<string, unknown> };
  return {
    loginAttempt: {
      findUnique: mocks.attemptFindUnique,
      createMany: mocks.attemptCreateMany,
      updateMany: mocks.attemptUpdateMany,
      deleteMany: (args: DeleteArgs): unknown =>
        "username" in args.where ? mocks.attemptDeleteMany(args) : mocks.attemptDeleteOld(args),
    },
    loginWindow: {
      findUnique: mocks.windowFindUnique,
      createMany: mocks.windowCreateMany,
      updateMany: mocks.windowUpdateMany,
      deleteMany: (args: DeleteArgs): unknown =>
        "username" in args.where ? mocks.windowDeleteMany(args) : mocks.windowDeleteOld(args),
    },
    user: { updateMany: mocks.userUpdateMany },
    session: { deleteMany: mocks.sessionDeleteMany },
    $transaction: mocks.transaction,
  };
});
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const USER_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";
const PASSWORD = "secret password";
/** A user as Better Auth returns it. */
const AUTH_USER = {
  id: USER_ID,
  name: "alice",
  username: "alice",
  email: "alice@users.hippowiki.invalid",
  type: "user",
  mustChangePassword: false,
};
/** The client address group of the logins of the tests. */
const CLIENT_ADDRESS = "203.0.113.7";
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
  return {
    data: [{ username: name, clientAddress: CLIENT_ADDRESS, failures: 1, lastFailedAt: NOW }],
    skipDuplicates: true,
  };
}

/** The write that counts one more login for the name at the time of the clock, only if the count is still `previous`. */
function nextAttempt(name: string, previous: Count) {
  return {
    where: {
      username: name,
      clientAddress: CLIENT_ADDRESS,
      failures: previous.failures,
      lastFailedAt: previous.lastFailedAt,
    },
    data: { failures: previous.failures + 1, lastFailedAt: NOW },
  };
}

/** The write that starts the window of the name at the time of the clock; it skips a row that exists. */
function firstWindow(name: string) {
  return { data: [{ username: name, attempts: 1, startedAt: NOW }], skipDuplicates: true };
}

/** The write that counts one more login in the running window of the name that started at `startedAt`. */
function nextInWindow(name: string, startedAt: Date) {
  return {
    where: { username: name, startedAt, attempts: { lt: 20 } },
    data: { attempts: { increment: 1 } },
  };
}

/** Whether the login was counted in both tables before Better Auth was asked to check the password. */
function countedBeforePasswordCheck(): boolean {
  const first = (...fns: { mock: { invocationCallOrder: number[] } }[]) =>
    Math.min(...fns.map((fn) => fn.mock.invocationCallOrder[0] ?? Infinity));
  const checked = mocks.signInUsername.mock.invocationCallOrder[0] ?? -Infinity;
  return (
    first(mocks.attemptCreateMany, mocks.attemptUpdateMany) < checked &&
    first(mocks.windowCreateMany, mocks.windowUpdateMany) < checked
  );
}

function expectNothingLoggedAsError(): void {
  expect(mocks.error).not.toHaveBeenCalled();
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
  // No window for the name so far, unless a test says otherwise, and every write of it succeeds.
  mocks.windowFindUnique.mockResolvedValue(null);
  mocks.windowCreateMany.mockResolvedValue({ count: 1 });
  mocks.windowUpdateMany.mockResolvedValue({ count: 1 });
  mocks.windowDeleteMany.mockResolvedValue({ count: 1 });
  // The deleting of old rows finds nothing to delete, unless a test says otherwise.
  mocks.attemptDeleteOld.mockResolvedValue({ count: 0 });
  mocks.windowDeleteOld.mockResolvedValue({ count: 0 });
  mocks.transaction.mockImplementation((callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  mocks.getAuth.mockResolvedValue({
    api: {
      signInUsername: mocks.signInUsername,
      signOut: mocks.signOut,
      getSession: mocks.getSession,
      changePassword: mocks.changePassword,
      verifyPassword: mocks.verifyPassword,
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
    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({
      ok: true,
      value: {
        user: { id: USER_ID, name: "alice", type: "user", mustChangePassword: false },
        headers: RESPONSE_HEADERS,
      },
    });
    expect(mocks.signInUsername).toHaveBeenCalledExactlyOnceWith({
      body: { username: "alice", password: PASSWORD },
      headers: REQUEST_HEADERS,
      returnHeaders: true,
    });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID, name: "alice", clientAddress: CLIENT_ADDRESS },
      "user logged in",
    );
    expect(logged()).not.toContain(PASSWORD);
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("returns a pending password change with the user", async () => {
    mocks.signInUsername.mockResolvedValue({
      headers: RESPONSE_HEADERS,
      response: { token: "token", user: { ...AUTH_USER, mustChangePassword: true } },
    });

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toMatchObject({ ok: true, value: { user: { mustChangePassword: true } } });
  });

  it("returns the type of an admin with the user", async () => {
    mocks.signInUsername.mockResolvedValue({
      headers: RESPONSE_HEADERS,
      response: { token: "token", user: { ...AUTH_USER, name: "maria", username: "maria", type: "admin" } },
    });

    const result = await logIn({ name: "maria", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toMatchObject({ ok: true, value: { user: { name: "maria", type: "admin" } } });
  });

  it("fails for a user without a known type", async () => {
    mocks.signInUsername.mockResolvedValue({
      headers: RESPONSE_HEADERS,
      response: { token: "token", user: { ...AUTH_USER, type: "root" } },
    });

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledWith(
      { userId: USER_ID },
      "user without a known type, treated as not logged in",
    );
  });

  it("trims the name and passes the password on as it is", async () => {
    await logIn({ name: "  alice ", password: "  spaced  " }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.signInUsername).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: { username: "alice", password: "  spaced  " } }),
    );
  });

  it("passes on a password of 128 characters and one that is shorter than a new password may be", async () => {
    await logIn({ name: "alice", password: "p".repeat(128) }, REQUEST_HEADERS, CLIENT_ADDRESS);
    await logIn({ name: "alice", password: "x" }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.signInUsername).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an unknown name or a wrong password (401)", invalidCredentials()],
    ["a name that Better Auth refuses (422)", new APIError("UNPROCESSABLE_ENTITY", { code: "INVALID_USERNAME" })],
    ["a password that Better Auth finds too long (400)", new APIError("BAD_REQUEST", { code: "PASSWORD_TOO_LONG" })],
  ])("answers %s with invalid-credentials", async (_case, err) => {
    mocks.signInUsername.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "invalid-credentials" } });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { name: "alice", clientAddress: CLIENT_ADDRESS },
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
      const result = await logIn({ name, password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code: "invalid-credentials" } });
      expect(mocks.getAuth).not.toHaveBeenCalled();
      expect(mocks.signInUsername).not.toHaveBeenCalled();
      // Such a name cannot belong to a user; the table of the failed logins must not take any text.
      expect(mocks.attemptFindUnique).not.toHaveBeenCalled();
      expect(mocks.attemptCreateMany).not.toHaveBeenCalled();
      expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
      expect(mocks.windowFindUnique).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
      expectNothingLogged();
    },
  );

  it.each([
    ["a password of 129 characters", "p".repeat(129)],
    ["an empty password", ""],
  ])("counts %s as a failed login, without reaching Better Auth", async (_case, password) => {
    const result = await logIn({ name: "alice", password }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "invalid-credentials" } });
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.signInUsername).not.toHaveBeenCalled();
    expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(firstAttempt("alice"));
    expect(mocks.windowCreateMany).toHaveBeenCalledExactlyOnceWith(firstWindow("alice"));
    // The counts stay: nothing takes them back.
    expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
    expect(mocks.windowUpdateMany).not.toHaveBeenCalled();
    expect(mocks.windowDeleteMany).not.toHaveBeenCalled();
  });

  it("answers busy when the password hashing has no free slot", async () => {
    mocks.signInUsername.mockRejectedValue(new PasswordHashBusyError());

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "busy" } });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { name: "alice", clientAddress: CLIENT_ADDRESS },
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

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, name: "alice", clientAddress: CLIENT_ADDRESS },
      "login failed",
    );
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("answers failed when Better Auth cannot be created", async () => {
    const err = new Error("connection refused");
    mocks.getAuth.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, name: "alice", clientAddress: CLIENT_ADDRESS },
      "login failed",
    );
  });

  it.each([
    ["the login succeeds", () => undefined],
    ["the password is wrong", () => mocks.signInUsername.mockRejectedValue(invalidCredentials())],
    ["the hashing is busy", () => mocks.signInUsername.mockRejectedValue(new PasswordHashBusyError())],
    ["the login fails", () => mocks.signInUsername.mockRejectedValue(new Error("connection refused"))],
  ])("does not log the password when %s", async (_case, arrange) => {
    arrange();

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(logged()).not.toContain(PASSWORD);
  });
});

describe("the wait after failed logins", () => {
  const EARLIER = new Date(NOW.getTime() - 1000);

  it("counts the first login for a name before the password is checked, in a write that skips an existing row", async () => {
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.attemptFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { username_clientAddress: { username: "alice", clientAddress: CLIENT_ADDRESS } },
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

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.attemptUpdateMany).toHaveBeenCalledExactlyOnceWith(nextAttempt("alice", previous));
    expect(countedBeforePasswordCheck()).toBe(true);
    expect(mocks.attemptCreateMany).not.toHaveBeenCalled();
    expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
  });

  it("counts under the trimmed name", async () => {
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "  alice ", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(firstAttempt("alice"));
  });

  it("deletes the row of the name after a successful login", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ failures: 4, lastFailedAt: EARLIER });

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result.ok).toBe(true);
    expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { username: "alice", clientAddress: CLIENT_ADDRESS },
    });
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

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

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

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code: "wait", waitMs } });
      // No password is checked during the wait, and the attempt is not counted.
      expect(mocks.getAuth).not.toHaveBeenCalled();
      expect(mocks.signInUsername).not.toHaveBeenCalled();
      expect(mocks.attemptCreateMany).not.toHaveBeenCalled();
      expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
      expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { name: "alice", clientAddress: CLIENT_ADDRESS, waitMs },
        "login refused: waiting after failed logins",
      );
    },
  );

  it("refuses a password that cannot belong to a user during the wait like every other one", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ failures: 5, lastFailedAt: NOW });

    const result = await logIn({ name: "alice", password: "p".repeat(129) }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "wait", waitMs: MINUTE } });
    expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
  });

  describe("with another login for the name at the same time", () => {
    it("reads the count again when the other login created the row first", async () => {
      const taken = { failures: 1, lastFailedAt: NOW };
      mocks.attemptFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(taken);
      mocks.attemptCreateMany.mockResolvedValue({ count: 0 });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

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

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

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

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code: "wait", waitMs: MINUTE } });
      expect(mocks.attemptUpdateMany).toHaveBeenCalledOnce();
      expect(mocks.getAuth).not.toHaveBeenCalled();
      expect(mocks.signInUsername).not.toHaveBeenCalled();
    });

    it("answers failed without checking the password when the count keeps changing", async () => {
      mocks.attemptFindUnique.mockResolvedValue({ failures: 1, lastFailedAt: EARLIER });
      mocks.attemptUpdateMany.mockResolvedValue({ count: 0 });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code: "failed" } });
      expect(mocks.attemptFindUnique).toHaveBeenCalledTimes(50);
      expect(mocks.attemptUpdateMany).toHaveBeenCalledTimes(50);
      expect(mocks.signInUsername).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        {
          err: expect.objectContaining({ message: expect.stringContaining("kept changing") as string }) as Error,
          name: "alice",
          clientAddress: CLIENT_ADDRESS,
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
      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({
        where: { username: "alice", clientAddress: CLIENT_ADDRESS, failures: 1, lastFailedAt: NOW },
      });
      expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
    });

    it("gives the row the count from before, so that a wait that was over does not start again", async () => {
      const previous = { failures: 5, lastFailedAt: new Date(NOW.getTime() - 2 * MINUTE) };
      mocks.attemptFindUnique.mockResolvedValue(previous);

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.attemptUpdateMany).toHaveBeenCalledTimes(2);
      expect(mocks.attemptUpdateMany).toHaveBeenNthCalledWith(1, nextAttempt("alice", previous));
      expect(mocks.attemptUpdateMany).toHaveBeenNthCalledWith(2, {
        where: { username: "alice", clientAddress: CLIENT_ADDRESS, failures: 6, lastFailedAt: NOW },
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

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.attemptUpdateMany).toHaveBeenLastCalledWith({
        where: { username: "alice", clientAddress: CLIENT_ADDRESS, failures: { gt: 0 } },
        data: { failures: { decrement: 1 } },
      });
    });

    it("keeps its answer when the login cannot be taken back, and logs that", async () => {
      const releaseError = new Error("database gone");
      mocks.attemptDeleteMany.mockRejectedValue(releaseError);

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.error).toHaveBeenCalledWith(
        { err: releaseError, name: "alice", clientAddress: CLIENT_ADDRESS },
        "failed to take back the login attempt",
      );
    });
  });

  it("answers failed when the failed logins cannot be read, without checking the password", async () => {
    const err = new Error("connection refused");
    mocks.attemptFindUnique.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.signInUsername).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, name: "alice", clientAddress: CLIENT_ADDRESS },
      "login failed",
    );
  });

  it.each([
    ["the first login for a name", null, mocks.attemptCreateMany],
    ["a further login", { failures: 2, lastFailedAt: EARLIER }, mocks.attemptUpdateMany],
  ])("answers failed when %s cannot be counted, without checking the password", async (_case, previous, write) => {
    const err = new Error("connection refused");
    mocks.attemptFindUnique.mockResolvedValue(previous);
    write.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.signInUsername).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, name: "alice", clientAddress: CLIENT_ADDRESS },
      "login failed",
    );
  });

  it("still logs in when the failed logins cannot be reset, and logs that", async () => {
    const err = new Error("connection refused");
    mocks.attemptDeleteMany.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result.ok).toBe(true);
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, name: "alice", clientAddress: CLIENT_ADDRESS },
      "failed to reset the failed logins",
    );
  });
});

describe("the limit per user name and hour", () => {
  const HOUR = 60 * MINUTE;
  const TEN_MINUTES_AGO = new Date(NOW.getTime() - 10 * MINUTE);

  it("starts the window with the first login for a name before the password is checked, skipping an existing row", async () => {
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.windowFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { username: "alice" },
      select: { attempts: true, startedAt: true },
    });
    expect(mocks.windowCreateMany).toHaveBeenCalledExactlyOnceWith(firstWindow("alice"));
    expect(mocks.windowUpdateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(countedBeforePasswordCheck()).toBe(true);
  });

  it("counts a further login in a running window only below 20 and for the start it read", async () => {
    mocks.windowFindUnique.mockResolvedValue({ attempts: 19, startedAt: TEN_MINUTES_AGO });
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.windowUpdateMany).toHaveBeenCalledExactlyOnceWith(nextInWindow("alice", TEN_MINUTES_AGO));
    expect(mocks.windowCreateMany).not.toHaveBeenCalled();
    expect(countedBeforePasswordCheck()).toBe(true);
  });

  it("starts a new window after the hour, only if the row is still the one it read", async () => {
    const over = { attempts: 20, startedAt: new Date(NOW.getTime() - HOUR) };
    mocks.windowFindUnique.mockResolvedValue(over);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result.ok).toBe(true);
    expect(mocks.windowUpdateMany).toHaveBeenCalledExactlyOnceWith({
      where: { username: "alice", ...over },
      data: { attempts: 1, startedAt: NOW },
    });
    expect(countedBeforePasswordCheck()).toBe(true);
  });

  it.each([
    ["10 minutes ago", 10 * MINUTE, 50 * MINUTE],
    ["just now", 0, HOUR],
    ["almost an hour ago", HOUR - 1, 1],
  ])(
    "refuses a login with a full window that started %s with the time that is left, without a write and without a password check",
    async (_case, ago, waitMs) => {
      mocks.windowFindUnique.mockResolvedValue({ attempts: 20, startedAt: new Date(NOW.getTime() - ago) });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code: "wait", waitMs } });
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.attemptCreateMany).not.toHaveBeenCalled();
      expect(mocks.windowCreateMany).not.toHaveBeenCalled();
      expect(mocks.windowUpdateMany).not.toHaveBeenCalled();
      expect(mocks.getAuth).not.toHaveBeenCalled();
      expect(mocks.signInUsername).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { name: "alice", clientAddress: CLIENT_ADDRESS, waitMs },
        "login refused: too many logins for the name within the hour",
      );
    },
  );

  it("returns the wait of the window when it is the longer one", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ failures: 9, lastFailedAt: NOW });
    mocks.windowFindUnique.mockResolvedValue({ attempts: 20, startedAt: TEN_MINUTES_AGO });

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "wait", waitMs: 50 * MINUTE } });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { name: "alice", clientAddress: CLIENT_ADDRESS, waitMs: 50 * MINUTE },
      "login refused: too many logins for the name within the hour",
    );
  });

  it("returns the wait after the failures when it is the longer one", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ failures: 9, lastFailedAt: NOW });
    mocks.windowFindUnique.mockResolvedValue({ attempts: 20, startedAt: new Date(NOW.getTime() - HOUR + MINUTE) });

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "wait", waitMs: 15 * MINUTE } });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { name: "alice", clientAddress: CLIENT_ADDRESS, waitMs: 15 * MINUTE },
      "login refused: waiting after failed logins",
    );
  });

  describe("with another login for the name at the same time", () => {
    it("reads the counts again when the write of the window reports 0, and checks the password once", async () => {
      mocks.windowFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ attempts: 1, startedAt: NOW });
      mocks.windowCreateMany.mockResolvedValue({ count: 0 });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result.ok).toBe(true);
      expect(mocks.transaction).toHaveBeenCalledTimes(2);
      expect(mocks.windowFindUnique).toHaveBeenCalledTimes(2);
      expect(mocks.windowCreateMany).toHaveBeenCalledExactlyOnceWith(firstWindow("alice"));
      expect(mocks.windowUpdateMany).toHaveBeenCalledExactlyOnceWith(nextInWindow("alice", NOW));
      expect(mocks.signInUsername).toHaveBeenCalledOnce();
    });

    it("reads the counts again when the write of LoginAttempt reports 0, without writing the window in that round", async () => {
      mocks.attemptCreateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result.ok).toBe(true);
      expect(mocks.transaction).toHaveBeenCalledTimes(2);
      expect(mocks.windowCreateMany).toHaveBeenCalledOnce();
      expect(mocks.signInUsername).toHaveBeenCalledOnce();
    });

    it("answers failed without checking the password when the window keeps changing", async () => {
      mocks.windowCreateMany.mockResolvedValue({ count: 0 });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code: "failed" } });
      expect(mocks.transaction).toHaveBeenCalledTimes(50);
      expect(mocks.signInUsername).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        {
          err: expect.objectContaining({ message: expect.stringContaining("kept changing") as string }) as Error,
          name: "alice",
          clientAddress: CLIENT_ADDRESS,
        },
        "login failed",
      );
    });
  });

  it("answers failed without checking the password when the transaction fails", async () => {
    const err = new Error("connection refused");
    mocks.transaction.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.signInUsername).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, name: "alice", clientAddress: CLIENT_ADDRESS },
      "login failed",
    );
  });

  it("deletes the window of the name after a successful login", async () => {
    mocks.windowFindUnique.mockResolvedValue({ attempts: 7, startedAt: TEN_MINUTES_AGO });

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result.ok).toBe(true);
    expect(mocks.windowDeleteMany).toHaveBeenCalledExactlyOnceWith({ where: { username: "alice" } });
  });

  it("keeps the window after a wrong password", async () => {
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.windowDeleteMany).not.toHaveBeenCalled();
    expect(mocks.windowUpdateMany).not.toHaveBeenCalled();
  });

  describe.each([
    ["the hashing is busy", new PasswordHashBusyError(), "busy"],
    ["the login fails", new Error("connection refused"), "failed"],
  ])("when %s", (_case, err, code) => {
    beforeEach(() => {
      mocks.signInUsername.mockRejectedValue(err);
    });

    it("takes the login back from a running window, for the start it counted in", async () => {
      mocks.windowFindUnique.mockResolvedValue({ attempts: 5, startedAt: TEN_MINUTES_AGO });

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.windowUpdateMany).toHaveBeenLastCalledWith({
        where: { username: "alice", startedAt: TEN_MINUTES_AGO, attempts: { gt: 0 } },
        data: { attempts: { decrement: 1 } },
      });
      expect(mocks.windowDeleteMany).not.toHaveBeenCalled();
    });

    it("deletes a window that it started and that still has only this login", async () => {
      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.windowDeleteMany).toHaveBeenCalledExactlyOnceWith({
        where: { username: "alice", startedAt: NOW, attempts: 1 },
      });
      expect(mocks.windowUpdateMany).not.toHaveBeenCalled();
    });

    it("only lowers a window that it started by one when other logins have counted in it since", async () => {
      mocks.windowDeleteMany.mockResolvedValue({ count: 0 });

      await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(mocks.windowUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: { username: "alice", startedAt: NOW, attempts: { gt: 0 } },
        data: { attempts: { decrement: 1 } },
      });
    });

    it("keeps its answer when the window cannot be taken back, and logs that", async () => {
      const releaseError = new Error("database gone");
      mocks.windowDeleteMany.mockRejectedValue(releaseError);

      const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.error).toHaveBeenCalledWith(
        { err: releaseError, name: "alice", clientAddress: CLIENT_ADDRESS },
        "failed to take back the login attempt",
      );
      // The count of LoginAttempt was taken back all the same.
      expect(mocks.attemptDeleteMany).toHaveBeenCalledOnce();
    });
  });
});

describe("the client address group", () => {
  it.each([
    ["the shared group", "shared"],
    ["an IPv4 address", "198.51.100.9"],
    ["the /64 of an IPv6 address", "2001:db8:0:1::/64"],
  ])("counts the login under the name and %s", async (_case, group) => {
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, group);

    expect(mocks.attemptFindUnique).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { username_clientAddress: { username: "alice", clientAddress: group } } }),
    );
    expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith({
      data: [{ username: "alice", clientAddress: group, failures: 1, lastFailedAt: NOW }],
      skipDuplicates: true,
    });
    expect(mocks.windowCreateMany).toHaveBeenCalledExactlyOnceWith(firstWindow("alice"));
    expectNothingLoggedAsError();
  });

  it.each(["", "Shared", "unknown", "2001:db8:0:1::1", "203.0.113.7:443", "x".repeat(500)])(
    "counts a group that the client address module would not write (%j) in the shared group and logs an error",
    async (group) => {
      mocks.signInUsername.mockRejectedValue(invalidCredentials());

      await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, group);

      expect(mocks.attemptFindUnique).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ where: { username_clientAddress: { username: "alice", clientAddress: "shared" } } }),
      );
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        { name: "alice" },
        "login with an invalid client address group, counted in the shared group",
      );
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { name: "alice", clientAddress: "shared" },
        "login refused: unknown name or wrong password",
      );
    },
  );

  it("deletes only the row of its name and group after a successful login, and the window of the name", async () => {
    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, "198.51.100.9");

    expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { username: "alice", clientAddress: "198.51.100.9" },
    });
    expect(mocks.windowDeleteMany).toHaveBeenCalledExactlyOnceWith({ where: { username: "alice" } });
  });

  it("keeps the window per name: it is read and written without the group", async () => {
    mocks.windowFindUnique.mockResolvedValue({ attempts: 3, startedAt: NOW });

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, "198.51.100.9");

    expect(mocks.windowFindUnique).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { username: "alice" } }),
    );
    expect(mocks.windowUpdateMany).toHaveBeenCalledExactlyOnceWith(nextInWindow("alice", NOW));
  });

  it("puts the group next to the name in the log line of a refused login", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ failures: 5, lastFailedAt: NOW });

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, "2001:db8:0:1::/64");

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { name: "alice", clientAddress: "2001:db8:0:1::/64", waitMs: MINUTE },
      "login refused: waiting after failed logins",
    );
  });
});

describe("the deleting of old rows", () => {
  const DAY = 24 * 60 * MINUTE;
  /** The delete of the rows of `LoginAttempt` whose last failure is more than a day before the clock. */
  const OLD_ATTEMPTS = { where: { lastFailedAt: { lt: new Date(NOW.getTime() - DAY) } } };
  /** The delete of the windows whose hour is over at the time of the clock. */
  const OVER_WINDOWS = { where: { startedAt: { lte: new Date(NOW.getTime() - 60 * MINUTE) } } };

  it.each([
    ["a wrong password", () => mocks.signInUsername.mockRejectedValue(invalidCredentials()), false],
    ["the right password", () => undefined, true],
  ])("deletes old rows of all names with the times of the clock after a login with %s", async (_case, arrange, ok) => {
    arrange();

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result.ok).toBe(ok);
    expect(mocks.attemptDeleteOld).toHaveBeenCalledExactlyOnceWith(OLD_ATTEMPTS);
    expect(mocks.windowDeleteOld).toHaveBeenCalledExactlyOnceWith(OVER_WINDOWS);
  });

  it("deletes the old rows after the login is counted, outside the transaction", async () => {
    let inTransaction = false;
    mocks.transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => {
      inTransaction = true;
      try {
        return await callback(db);
      } finally {
        inTransaction = false;
      }
    });
    const deletedInTransaction: boolean[] = [];
    mocks.attemptDeleteOld.mockImplementation(() => {
      deletedInTransaction.push(inTransaction);
      return Promise.resolve({ count: 0 });
    });

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(deletedInTransaction).toEqual([false]);
    expect(mocks.attemptDeleteOld.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.attemptCreateMany.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it.each([
    [
      "a login that waits",
      () => mocks.attemptFindUnique.mockResolvedValue({ failures: 5, lastFailedAt: NOW }),
      "alice",
    ],
    ["a login with a name that breaks the name rule", () => undefined, "Not A Name!"],
  ])("deletes nothing for %s", async (_case, arrange, name) => {
    arrange();

    await logIn({ name, password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.attemptDeleteOld).not.toHaveBeenCalled();
    expect(mocks.windowDeleteOld).not.toHaveBeenCalled();
  });

  it.each([
    ["the old failures", mocks.attemptDeleteOld, "failed to delete the old counts of failed logins"],
    [
      "the windows whose hour is over",
      mocks.windowDeleteOld,
      "failed to delete the windows of logins whose hour is over",
    ],
  ])("logs an error when %s cannot be deleted and answers as without it", async (_case, deleteOld, message) => {
    const err = new Error("connection refused");
    deleteOld.mockRejectedValue(err);

    const result = await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result.ok).toBe(true);
    expect(mocks.signInUsername).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err }, message);
    // The other delete is done all the same.
    expect(mocks.attemptDeleteOld).toHaveBeenCalledOnce();
    expect(mocks.windowDeleteOld).toHaveBeenCalledOnce();
  });

  it.each([
    ["more than a day ago", DAY + 1, 1],
    ["exactly a day ago", DAY, 10],
  ])("counts a row whose last failure was %s as %i failures in a row", async (_case, ago, failures) => {
    const previous = { failures: 9, lastFailedAt: new Date(NOW.getTime() - ago) };
    mocks.attemptFindUnique.mockResolvedValue(previous);
    mocks.signInUsername.mockRejectedValue(invalidCredentials());

    await logIn({ name: "alice", password: PASSWORD }, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.attemptUpdateMany).toHaveBeenCalledExactlyOnceWith({
      ...nextAttempt("alice", previous),
      data: { failures, lastFailedAt: NOW },
    });
  });
});

describe("logOut", () => {
  it("signs out the session of the request, returns the response headers and logs the user", async () => {
    mocks.getSession.mockResolvedValue({ session: { token: "token" }, user: AUTH_USER });

    const result = await logOut(REQUEST_HEADERS);

    expect(result).toEqual({ ok: true, value: { headers: RESPONSE_HEADERS } });
    expect(mocks.getSession).toHaveBeenCalledExactlyOnceWith({ headers: REQUEST_HEADERS });
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ headers: REQUEST_HEADERS, returnHeaders: true });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ userId: USER_ID }, "session ended");
  });

  it("logs the line without a user when the request has no session", async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await logOut(new Headers());

    expect(result).toEqual({ ok: true, value: { headers: RESPONSE_HEADERS } });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("session ended");
  });

  it("answers failed and ends nothing when the session cannot be read", async () => {
    mocks.getSession.mockRejectedValue(new Error("connection refused"));

    const result = await logOut(REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err: expect.objectContaining({ message: "connection refused" }) as Error },
      "logout failed",
    );
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
      type: "user",
      mustChangePassword: false,
    });
    expect(mocks.getSession).toHaveBeenCalledExactlyOnceWith({ headers: REQUEST_HEADERS });
  });

  it("returns a pending password change with the user", async () => {
    mocks.getSession.mockResolvedValue({ session: {}, user: { ...AUTH_USER, mustChangePassword: true } });

    await expect(getSessionUser(REQUEST_HEADERS)).resolves.toMatchObject({ mustChangePassword: true });
  });

  it("treats a user without the flag as one with a pending password change", async () => {
    mocks.getSession.mockResolvedValue({
      session: {},
      user: { id: USER_ID, name: "alice", username: "alice", type: "user" },
    });

    await expect(getSessionUser(REQUEST_HEADERS)).resolves.toMatchObject({ mustChangePassword: true });
  });

  it("returns the type of the account", async () => {
    for (const type of ["admin", "user"]) {
      mocks.getSession.mockResolvedValue({ session: {}, user: { ...AUTH_USER, type } });

      await expect(getSessionUser(REQUEST_HEADERS)).resolves.toMatchObject({ type });
    }
  });

  it.each([
    ["a missing type", undefined],
    ["an empty type", null],
    ["an unknown type", "root"],
    ["a type in another case", "Admin"],
  ])("refuses a user with %s like a missing session", async (_case, type) => {
    mocks.getSession.mockResolvedValue({ session: {}, user: { ...AUTH_USER, type } });

    await expect(getSessionUser(REQUEST_HEADERS)).resolves.toBeNull();
    expect(mocks.error).toHaveBeenCalledWith(
      { userId: USER_ID },
      "user without a known type, treated as not logged in",
    );
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
    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({
      ok: true,
      value: {
        user: { id: USER_ID, name: "alice", type: "user", mustChangePassword: false },
        headers: NEW_SESSION_HEADERS,
      },
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

    await changeFirstPassword(spaced, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(mocks.changePassword).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: { currentPassword: "  first  ", newPassword: "  my own  ", revokeOtherSessions: true },
      }),
    );
  });

  it("answers not-logged-in without a session and changes nothing", async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await changeFirstPassword(INPUT, new Headers(), CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "not-logged-in" } });
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it("answers not-required for a user without a pending change and changes nothing", async () => {
    mocks.getSession.mockResolvedValue({ session: {}, user: AUTH_USER });

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

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
      "a new password built from the user name",
      { ...INPUT, newPassword: "alexander2026", repeatPassword: "alexander2026" },
      {
        newPassword: ["Password must not be built only from the user name or the name of the wiki, digits and symbols"],
      },
    ],
    [
      "a common new password",
      { ...INPUT, newPassword: "password123", repeatPassword: "password123" },
      { newPassword: ["Password is too common, choose another one"] },
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

    const result = await changeFirstPassword(input, REQUEST_HEADERS, CLIENT_ADDRESS);

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

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "wrong-password" } });
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID, name: "alice", clientAddress: CLIENT_ADDRESS },
      "first password not changed: wrong current password",
    );
    expect(mocks.error).not.toHaveBeenCalled();
    // The count stays: it is neither taken back nor forgotten.
    expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(firstAttempt("alice"));
    expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
    expect(mocks.windowDeleteMany).not.toHaveBeenCalled();
  });

  it("answers not-logged-in when the session ends before Better Auth changes the password", async () => {
    mocks.changePassword.mockRejectedValue(new APIError("UNAUTHORIZED", { code: "UNAUTHORIZED" }));

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "not-logged-in" } });
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it("answers busy when the password hashing has no free slot, and leaves the flag", async () => {
    mocks.changePassword.mockRejectedValue(new PasswordHashBusyError());

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

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

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

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

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err }, "failed to change the first password");
  });

  it("answers failed when the flag cannot be cleared after the password has changed", async () => {
    const err = new Error("connection refused");
    mocks.userUpdateMany.mockRejectedValue(err);

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.changePassword).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, userId: USER_ID },
      "first password changed, but the pending change could not be cleared",
    );
  });

  it("answers failed when no user with the pending change is found any more", async () => {
    mocks.userUpdateMany.mockResolvedValue({ count: 0 });

    const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID },
      "first password changed, but the user with the pending change was not found",
    );
  });

  describe("the counting of the current password", () => {
    it("counts the change as a login of the name of the user before Better Auth checks the password", async () => {
      await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(firstAttempt("alice"));
      expect(mocks.windowCreateMany).toHaveBeenCalledExactlyOnceWith(firstWindow("alice"));
      const changed = mocks.changePassword.mock.invocationCallOrder[0] ?? -Infinity;
      expect(mocks.attemptCreateMany.mock.invocationCallOrder[0]).toBeLessThan(changed);
      expect(mocks.windowCreateMany.mock.invocationCallOrder[0]).toBeLessThan(changed);
    });

    it("forgets the counts of the name and group, and the window of the name, after a right current password", async () => {
      await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({
        where: { username: "alice", clientAddress: CLIENT_ADDRESS },
      });
      expect(mocks.windowDeleteMany).toHaveBeenCalledExactlyOnceWith({ where: { username: "alice" } });
    });

    it.each([
      [
        "after failed logins",
        { failures: 5, lastFailedAt: NOW },
        null,
        "first password not changed: waiting after failed logins",
      ],
      [
        "within the hour",
        null,
        { attempts: 20, startedAt: new Date(NOW.getTime() - 59 * MINUTE) },
        "first password not changed: too many logins for the name within the hour",
      ],
    ])("answers wait %s without reaching Better Auth and without counting", async (_case, count, window, message) => {
      mocks.attemptFindUnique.mockResolvedValue(count);
      mocks.windowFindUnique.mockResolvedValue(window);

      const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code: "wait", waitMs: MINUTE } });
      expect(mocks.changePassword).not.toHaveBeenCalled();
      expect(mocks.userUpdateMany).not.toHaveBeenCalled();
      expect(mocks.attemptCreateMany).not.toHaveBeenCalled();
      expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
      expect(mocks.windowCreateMany).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { userId: USER_ID, name: "alice", clientAddress: CLIENT_ADDRESS, waitMs: MINUTE },
        message,
      );
    });

    it.each([
      ["the hashing is busy", new PasswordHashBusyError(), "busy"],
      ["something fails", new Error("connection refused"), "failed"],
      ["the session ends meanwhile", new APIError("UNAUTHORIZED", { code: "UNAUTHORIZED" }), "not-logged-in"],
    ])("takes the counts back when %s", async (_case, err, code) => {
      mocks.changePassword.mockRejectedValue(err);

      const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code } });
      expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({
        where: { username: "alice", clientAddress: CLIENT_ADDRESS, failures: 1, lastFailedAt: NOW },
      });
      expect(mocks.windowDeleteMany).toHaveBeenCalledExactlyOnceWith({
        where: { username: "alice", startedAt: NOW, attempts: 1 },
      });
    });

    it("answers failed without checking the password when the change cannot be counted", async () => {
      const err = new Error("connection refused");
      mocks.attemptFindUnique.mockRejectedValue(err);

      const result = await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(result).toEqual({ ok: false, error: { code: "failed" } });
      expect(mocks.changePassword).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        { err, userId: USER_ID },
        "failed to change the first password",
      );
    });

    it("does not count input that breaks a rule of the new password", async () => {
      await changeFirstPassword({ ...INPUT, repeatPassword: "another password" }, REQUEST_HEADERS, CLIENT_ADDRESS);

      expect(mocks.attemptFindUnique).not.toHaveBeenCalled();
      expect(mocks.windowFindUnique).not.toHaveBeenCalled();
      expect(mocks.changePassword).not.toHaveBeenCalled();
    });

    it.each(["", "Shared", "203.0.113.7:443"])(
      "counts a group that the client address module would not write (%j) in the shared group and logs it",
      async (group) => {
        mocks.changePassword.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" }));

        await changeFirstPassword(INPUT, REQUEST_HEADERS, group);

        expect(mocks.attemptFindUnique).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            where: { username_clientAddress: { username: "alice", clientAddress: "shared" } },
          }),
        );
        expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
          { userId: USER_ID, name: "alice" },
          "first password change with an invalid client address group, counted in the shared group",
        );
        expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
          { userId: USER_ID, name: "alice", clientAddress: "shared" },
          "first password not changed: wrong current password",
        );
      },
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

    await changeFirstPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(logged()).not.toContain(FIRST_PASSWORD);
    expect(logged()).not.toContain(NEW_PASSWORD);
  });
});

describe("changeOwnPassword", () => {
  // Values that no log message contains by chance.
  const CURRENT_PASSWORD = "current-secret-1";
  const NEW_PASSWORD = "replacement-secret-2";
  const INPUT = { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD, repeatPassword: NEW_PASSWORD };
  const NEW_SESSION_HEADERS = new Headers({ "set-cookie": "better-auth.session_token=new-token.signature" });

  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ session: {}, user: AUTH_USER });
    mocks.changePassword.mockResolvedValue({ headers: NEW_SESSION_HEADERS, response: { token: "new-token" } });
    mocks.isOAuthOn.mockReturnValue(true);
    mocks.revokeAllGrants.mockResolvedValue({ ok: true, value: { count: 2 } });
  });

  describe("with the choice to disconnect the apps", () => {
    it("disconnects the apps after the password is changed and names them in the info line", async () => {
      const result = await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, true);

      expect(result).toMatchObject({ ok: true, value: { apps: { status: "disconnected", count: 2 } } });
      expect(mocks.revokeAllGrants).toHaveBeenCalledExactlyOnceWith({
        id: USER_ID,
        name: "alice",
        type: "user",
        mustChangePassword: false,
      });
      expect(mocks.changePassword.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.revokeAllGrants.mock.invocationCallOrder[0] ?? 0,
      );
      expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
        { userId: USER_ID, name: "alice", appsDisconnected: true, disconnectedApps: 2 },
        "password changed",
      );
    });

    it("keeps the change a success when the disconnect fails, with the failure in the result and the log", async () => {
      mocks.revokeAllGrants.mockResolvedValue({ ok: false, error: { code: "failed" } });

      const result = await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, true);

      expect(result).toMatchObject({ ok: true, value: { headers: NEW_SESSION_HEADERS, apps: { status: "failed" } } });
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        { userId: USER_ID },
        "password changed, but the apps could not be disconnected",
      );
      expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
        { userId: USER_ID, name: "alice", appsDisconnected: false, disconnectedApps: 0 },
        "password changed",
      );
    });

    it("disconnects nothing when the password is not changed", async () => {
      mocks.changePassword.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" }));

      await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, true);

      expect(mocks.revokeAllGrants).not.toHaveBeenCalled();
    });

    it.each([
      ["of an admin", () => mocks.getSession.mockResolvedValue({ session: {}, user: { ...AUTH_USER, type: "admin" } })],
      ["while OAuth is off", () => mocks.isOAuthOn.mockReturnValue(false)],
    ])("is ignored and logged as a warning %s", async (_case, arrange) => {
      arrange();

      const result = await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, true);

      expect(result).toMatchObject({ ok: true, value: { apps: { status: "kept" } } });
      expect(mocks.revokeAllGrants).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { userId: USER_ID },
        "choice to disconnect the apps ignored: the account has no apps",
      );
    });
  });

  it("changes the password through Better Auth, ends the other sessions and logs the user", async () => {
    const result = await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, false);

    expect(result).toEqual({
      ok: true,
      value: {
        user: { id: USER_ID, name: "alice", type: "user", mustChangePassword: false },
        headers: NEW_SESSION_HEADERS,
        apps: { status: "kept" },
      },
    });
    expect(mocks.changePassword).toHaveBeenCalledExactlyOnceWith({
      body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
      headers: REQUEST_HEADERS,
      returnHeaders: true,
    });
    // The flag of the forced change is not touched.
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.revokeAllGrants).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID, name: "alice", appsDisconnected: false, disconnectedApps: 0 },
      "password changed",
    );
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(logged()).not.toContain(CURRENT_PASSWORD);
    expect(logged()).not.toContain(NEW_PASSWORD);
  });

  it("counts the change as a login of the name before the check, and forgets the counts after a right password", async () => {
    await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, false);

    expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(firstAttempt("alice"));
    expect(mocks.windowCreateMany).toHaveBeenCalledExactlyOnceWith(firstWindow("alice"));
    expect(mocks.attemptCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.changePassword.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { username: "alice", clientAddress: CLIENT_ADDRESS },
    });
    expect(mocks.windowDeleteMany).toHaveBeenCalledExactlyOnceWith({ where: { username: "alice" } });
  });

  it("answers not-logged-in without a session and changes nothing", async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await changeOwnPassword(INPUT, new Headers(), CLIENT_ADDRESS, false);

    expect(result).toEqual({ ok: false, error: { code: "not-logged-in" } });
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.attemptFindUnique).not.toHaveBeenCalled();
  });

  it("answers first-password-pending for a user with a pending first password and changes nothing", async () => {
    mocks.getSession.mockResolvedValue({ session: {}, user: { ...AUTH_USER, mustChangePassword: true } });

    const result = await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, false);

    expect(result).toEqual({ ok: false, error: { code: "first-password-pending" } });
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.attemptFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a common new password",
      { ...INPUT, newPassword: "password123", repeatPassword: "password123" },
      { newPassword: ["Password is too common, choose another one"] },
    ],
    [
      "a new password that is the current one",
      { ...INPUT, newPassword: CURRENT_PASSWORD, repeatPassword: CURRENT_PASSWORD },
      { newPassword: ["New password must differ from the current one"] },
    ],
    [
      "a repetition that differs",
      { ...INPUT, repeatPassword: "another password" },
      { repeatPassword: ["The two new passwords do not match"] },
    ],
  ])("answers invalid-input for %s, without counting and without a change", async (_case, input, fieldErrors) => {
    const result = await changeOwnPassword(input, REQUEST_HEADERS, CLIENT_ADDRESS, false);

    expect(result).toEqual({ ok: false, error: { code: "invalid-input", fieldErrors } });
    expect(mocks.attemptFindUnique).not.toHaveBeenCalled();
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it("answers wait during a wait, without reaching Better Auth", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ failures: 5, lastFailedAt: NOW });

    const result = await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, false);

    expect(result).toEqual({ ok: false, error: { code: "wait", waitMs: MINUTE } });
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID, name: "alice", clientAddress: CLIENT_ADDRESS, waitMs: MINUTE },
      "password not changed: waiting after failed logins",
    );
  });

  it("answers wrong-password for a wrong current password, keeps the count and logs it like a failed login", async () => {
    mocks.changePassword.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" }));

    const result = await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, false);

    expect(result).toEqual({ ok: false, error: { code: "wrong-password" } });
    expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
    expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID, name: "alice", clientAddress: CLIENT_ADDRESS },
      "password not changed: wrong current password",
    );
    expect(mocks.info).not.toHaveBeenCalled();
    expect(logged()).not.toContain(CURRENT_PASSWORD);
  });

  it("answers busy when the hashing is busy, changes nothing and takes the count back", async () => {
    mocks.changePassword.mockRejectedValue(new PasswordHashBusyError());

    const result = await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, false);

    expect(result).toEqual({ ok: false, error: { code: "busy" } });
    expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { username: "alice", clientAddress: CLIENT_ADDRESS, failures: 1, lastFailedAt: NOW },
    });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID },
      "too many password hashes are running, password not changed",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each([
    ["Better Auth fails", () => mocks.changePassword.mockRejectedValue(new Error("connection refused"))],
    ["the session cannot be read", () => mocks.getSession.mockRejectedValue(new Error("connection refused"))],
  ])("answers failed when %s and logs it", async (_case, arrange) => {
    arrange();

    const result = await changeOwnPassword(INPUT, REQUEST_HEADERS, CLIENT_ADDRESS, false);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: expect.objectContaining({ message: "connection refused" }) as Error }),
      "failed to change the password",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("logOutOtherSessions", () => {
  const SESSION_ID = "4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ session: { id: SESSION_ID, token: "token" }, user: AUTH_USER });
    mocks.sessionDeleteMany.mockResolvedValue({ count: 2 });
  });

  it("deletes the other sessions of the user in one write that leaves out the current one, and returns their number", async () => {
    const result = await logOutOtherSessions(REQUEST_HEADERS);

    expect(result).toEqual({ ok: true, value: { count: 2 } });
    expect(mocks.getSession).toHaveBeenCalledExactlyOnceWith({ headers: REQUEST_HEADERS });
    expect(mocks.sessionDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: USER_ID, id: { not: SESSION_ID } },
    });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID, name: "alice", count: 2 },
      "other sessions ended",
    );
  });

  it("returns 0 when there was no other session", async () => {
    mocks.sessionDeleteMany.mockResolvedValue({ count: 0 });

    await expect(logOutOtherSessions(REQUEST_HEADERS)).resolves.toEqual({ ok: true, value: { count: 0 } });
  });

  it("deletes nothing without a session", async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await logOutOtherSessions(new Headers());

    expect(result).toEqual({ ok: false, error: { code: "not-logged-in" } });
    expect(mocks.sessionDeleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ["the delete fails", () => mocks.sessionDeleteMany.mockRejectedValue(new Error("connection refused"))],
    ["the session cannot be read", () => mocks.getSession.mockRejectedValue(new Error("connection refused"))],
  ])("answers failed when %s, logs it and claims nothing", async (_case, arrange) => {
    arrange();

    const result = await logOutOtherSessions(REQUEST_HEADERS);

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: expect.objectContaining({ message: "connection refused" }) as Error }),
      "failed to end the other sessions",
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe("verifyPassword", () => {
  // A value that no log message contains by chance.
  const SECRET = "the-secret-of-alice";

  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ session: { id: "session-1" }, user: AUTH_USER });
    mocks.verifyPassword.mockResolvedValue({ status: true });
  });

  it("checks the password through Better Auth, counted, and forgets the counts for a right one", async () => {
    const result = await verifyPassword(SECRET, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({
      ok: true,
      value: { user: { id: USER_ID, name: "alice", type: "user", mustChangePassword: false } },
    });
    expect(mocks.verifyPassword).toHaveBeenCalledExactlyOnceWith({
      body: { password: SECRET },
      headers: REQUEST_HEADERS,
    });
    expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(firstAttempt("alice"));
    expect(mocks.attemptCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.verifyPassword.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { username: "alice", clientAddress: CLIENT_ADDRESS },
    });
    expectNothingLogged();
  });

  it("answers wrong-password for a wrong one, keeps the count and logs it like a failed login", async () => {
    mocks.verifyPassword.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" }));

    const result = await verifyPassword(SECRET, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "wrong-password" } });
    expect(mocks.attemptDeleteMany).not.toHaveBeenCalled();
    expect(mocks.attemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID, name: "alice", clientAddress: CLIENT_ADDRESS },
      "password check refused: wrong password",
    );
    expect(logged()).not.toContain(SECRET);
  });

  it("answers wrong-password for an empty password, without a hash and without a count", async () => {
    const result = await verifyPassword("", REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "wrong-password" } });
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.attemptFindUnique).not.toHaveBeenCalled();
  });

  it("answers wait during a wait, without checking the password, and logs it like a login that waits", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ failures: 5, lastFailedAt: NOW });

    const result = await verifyPassword(SECRET, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code: "wait", waitMs: MINUTE } });
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID, name: "alice", clientAddress: CLIENT_ADDRESS, waitMs: MINUTE },
      "password check refused: waiting after failed logins",
    );
  });

  it.each([
    ["busy", new PasswordHashBusyError(), "busy"],
    ["failed", new Error("connection refused"), "failed"],
  ])("answers %s and takes the count back when the password was not checked", async (_case, err, code) => {
    mocks.verifyPassword.mockRejectedValue(err);

    const result = await verifyPassword(SECRET, REQUEST_HEADERS, CLIENT_ADDRESS);

    expect(result).toEqual({ ok: false, error: { code } });
    expect(mocks.attemptDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { username: "alice", clientAddress: CLIENT_ADDRESS, failures: 1, lastFailedAt: NOW },
    });
  });

  it("answers not-logged-in without a session, and failed when the session cannot be read", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    await expect(verifyPassword(SECRET, new Headers(), CLIENT_ADDRESS)).resolves.toEqual({
      ok: false,
      error: { code: "not-logged-in" },
    });

    mocks.getSession.mockRejectedValueOnce(new Error("connection refused"));
    await expect(verifyPassword(SECRET, REQUEST_HEADERS, CLIENT_ADDRESS)).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it("counts an invalid group in the shared group and logs it", async () => {
    mocks.verifyPassword.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" }));

    await verifyPassword(SECRET, REQUEST_HEADERS, "not a group");

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { userId: USER_ID, name: "alice" },
      "password check with an invalid client address group, counted in the shared group",
    );
    expect(mocks.attemptCreateMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ data: [expect.objectContaining({ clientAddress: "shared" })] }),
    );
  });
});
