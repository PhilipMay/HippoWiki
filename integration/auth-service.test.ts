// Runs the auth service against the test database, through the real Better Auth instance and with real hashes, to
// check what the unit tests can only mock: that Better Auth accepts the users that HippoWiki writes, and what it does
// to the sessions.
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authService from "@/features/auth/service";
import * as userService from "@/features/users/service";
import { hashPassword, PasswordHashBusyError, verifyPassword } from "@/lib/password-hash";

import { createUser, getTestDb, TEST_PASSWORD } from "../e2e/support/database";

// The real functions, as spies: one test lets them fail the way they do when no hash slot gets free.
vi.mock(import("@/lib/password-hash"), { spy: true });

beforeEach(() => {
  vi.mocked(hashPassword).mockClear();
  vi.mocked(verifyPassword).mockClear();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const WRONG_PASSWORD = "wrong-password";
const INVALID_CREDENTIALS = { ok: false, error: { code: "invalid-credentials" } };

/** The request headers of a browser that has kept the cookies of the given response headers. */
function withCookies(responseHeaders: Headers): Headers {
  const cookies = responseHeaders.getSetCookie().map((cookie) => cookie.split(";")[0]);
  return new Headers({ cookie: cookies.join("; ") });
}

/** Logs in and returns the user with the request headers of the new session; fails the test if the login fails. */
async function logInAs(name: string, password = TEST_PASSWORD) {
  const result = await authService.logIn({ name, password }, new Headers());
  if (!result.ok) return expect.fail(`login of ${name} failed with ${result.error.code}`);
  return { user: result.value.user, headers: withCookies(result.value.headers), response: result.value.headers };
}

describe("logIn", () => {
  it("logs in a user built with records.ts and returns the user", async () => {
    const alice = await createUser({ name: "alice" });

    const { user, headers } = await logInAs("alice");

    expect(user).toStrictEqual({ id: alice.id, name: "alice", mustChangePassword: true });
    expect(await authService.getSessionUser(headers)).toStrictEqual(user);
  });

  it("logs in the admin that ensureAdmin created, with the pending password change", async () => {
    await userService.ensureAdmin("first-password");

    const { user, headers } = await logInAs("admin", "first-password");

    expect(user).toMatchObject({ name: "admin", mustChangePassword: true });
    expect(await authService.getSessionUser(headers)).toStrictEqual(user);
  });

  it("returns a password change that is already done", async () => {
    await createUser({ name: "alice", mustChangePassword: false });

    expect((await logInAs("alice")).user.mustChangePassword).toBe(false);
  });

  it("gives a wrong password and an unknown name the same code and starts no session", async () => {
    await createUser({ name: "alice" });

    const wrongPassword = await authService.logIn({ name: "alice", password: WRONG_PASSWORD }, new Headers());
    const unknownName = await authService.logIn({ name: "nobody", password: WRONG_PASSWORD }, new Headers());

    expect(wrongPassword).toEqual(INVALID_CREDENTIALS);
    expect(unknownName).toStrictEqual(wrongPassword);
    expect(await getTestDb().session.count()).toBe(0);
  });

  it("computes one hash for a wrong password and one for an unknown name", async () => {
    await createUser({ name: "alice" });
    vi.mocked(hashPassword).mockClear();
    vi.mocked(verifyPassword).mockClear();

    await authService.logIn({ name: "alice", password: WRONG_PASSWORD }, new Headers());
    expect([vi.mocked(hashPassword).mock.calls.length, vi.mocked(verifyPassword).mock.calls.length]).toEqual([0, 1]);

    await authService.logIn({ name: "nobody", password: WRONG_PASSWORD }, new Headers());
    expect([vi.mocked(hashPassword).mock.calls.length, vi.mocked(verifyPassword).mock.calls.length]).toEqual([1, 1]);
  });

  it.each([
    ["a name in upper case", "ALICE", TEST_PASSWORD],
    ["the email of the user as the name", "alice@users.hippowiki.invalid", TEST_PASSWORD],
    ["a password with a space at its end", "alice", `${TEST_PASSWORD} `],
    ["a password in another case", "alice", TEST_PASSWORD.toUpperCase()],
    ["a password of 129 characters", "alice", "p".repeat(129)],
  ])("refuses %s", async (_case, name, password) => {
    await createUser({ name: "alice" });

    expect(await authService.logIn({ name, password }, new Headers())).toEqual(INVALID_CREDENTIALS);
    expect(await getTestDb().session.count()).toBe(0);
  });

  it("logs in with a name that has spaces around it", async () => {
    const alice = await createUser({ name: "alice" });

    expect((await logInAs("  alice ")).user.id).toBe(alice.id);
  });

  it("logs in with a password of 128 characters, with spaces and non-Latin letters", async () => {
    const password = "  пароль-密碼 ".padEnd(128, "p");
    expect(password).toHaveLength(128);
    await createUser({ name: "alice", password });

    expect((await logInAs("alice", password)).user.name).toBe("alice");
    expect(await authService.logIn({ name: "alice", password: password.trim() }, new Headers())).toEqual(
      INVALID_CREDENTIALS,
    );
  });

  it.each([
    ["a known name", "alice", verifyPassword],
    ["an unknown name", "nobody", hashPassword],
  ])("answers busy for %s when the password hashing has no free slot", async (_case, name, hashFunction) => {
    await createUser({ name: "alice" });
    // What Better Auth gets from the hashing when the limiter gives up; it must reach the service unchanged.
    vi.mocked(hashFunction).mockRejectedValueOnce(new PasswordHashBusyError());

    const result = await authService.logIn({ name, password: TEST_PASSWORD }, new Headers());

    expect(result).toEqual({ ok: false, error: { code: "busy" } });
    expect(await getTestDb().session.count()).toBe(0);
  });

  it("sets a session cookie for 30 days that scripts cannot read", async () => {
    await createUser({ name: "alice" });

    const { response } = await logInAs("alice");

    const cookies = response.getSetCookie();
    expect(cookies).toHaveLength(1);
    const attributes = cookies[0]?.split("; ") ?? [];
    expect(attributes[0]).toMatch(/^better-auth\.session_token=.+/);
    expect(attributes).toEqual(expect.arrayContaining(["Max-Age=2592000", "Path=/", "HttpOnly", "SameSite=Lax"]));
    // `Secure` is set in a production build only; these tests run with NODE_ENV=test.
    expect(attributes).not.toContain("Secure");
  });
});

describe("sessions", () => {
  it("lets a session end 30 days after the login", async () => {
    await createUser({ name: "alice" });
    const before = Date.now();

    await logInAs("alice");

    const session = await getTestDb().session.findFirstOrThrow();
    const lifetime = session.expiresAt.getTime() - before;
    expect(lifetime).toBeGreaterThanOrEqual(30 * DAY_MS - 1000);
    expect(lifetime).toBeLessThanOrEqual(30 * DAY_MS + 60_000);
  });

  it("does not move the end of a session when the session is used", async () => {
    await createUser({ name: "alice" });
    const { headers, user } = await logInAs("alice");
    // A session that has one day left: Better Auth would refresh it now if it refreshed sessions at all.
    const expiresAt = new Date(Date.now() + DAY_MS);
    await getTestDb().session.updateMany({ data: { expiresAt } });
    const before = await getTestDb().session.findFirstOrThrow();

    expect(await authService.getSessionUser(headers)).toStrictEqual(user);
    expect(await authService.getSessionUser(headers)).toStrictEqual(user);

    expect(await getTestDb().session.findFirstOrThrow()).toStrictEqual(before);
  });

  it("knows no user for a session that has ended", async () => {
    await createUser({ name: "alice" });
    const { headers } = await logInAs("alice");
    await getTestDb().session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await authService.getSessionUser(headers)).toBeNull();
  });

  it("knows no user without a cookie, with a cookie it did not sign and with one of a session that is gone", async () => {
    await createUser({ name: "alice" });
    const { headers } = await logInAs("alice");
    const [name, value] = (headers.get("cookie") ?? "").split("=");
    const forged = new Headers({ cookie: `${name}=${value?.replace(/^.{4}/, "AAAA")}` });
    await getTestDb().session.deleteMany();

    expect(await authService.getSessionUser(new Headers())).toBeNull();
    expect(await authService.getSessionUser(new Headers({ cookie: `${name}=not-a-session` }))).toBeNull();
    expect(await authService.getSessionUser(forged)).toBeNull();
    expect(await authService.getSessionUser(headers)).toBeNull();
  });

  it("gives two logins of one user two sessions", async () => {
    const alice = await createUser({ name: "alice" });

    const first = await logInAs("alice");
    const second = await logInAs("alice");

    expect(first.headers.get("cookie")).not.toBe(second.headers.get("cookie"));
    expect(await getTestDb().session.count({ where: { userId: alice.id } })).toBe(2);
    expect(await authService.getSessionUser(first.headers)).toStrictEqual(first.user);
    expect(await authService.getSessionUser(second.headers)).toStrictEqual(second.user);
  });
});

describe("logOut", () => {
  it("ends only the session of the request", async () => {
    await createUser({ name: "alice" });
    await createUser({ name: "bob" });
    const first = await logInAs("alice");
    const second = await logInAs("alice");
    const bob = await logInAs("bob");

    const result = await authService.logOut(first.headers);

    expect(result.ok).toBe(true);
    expect(await getTestDb().session.count()).toBe(2);
    expect(await authService.getSessionUser(first.headers)).toBeNull();
    expect(await authService.getSessionUser(second.headers)).toStrictEqual(second.user);
    expect(await authService.getSessionUser(bob.headers)).toStrictEqual(bob.user);
  });

  it("clears the session cookie", async () => {
    await createUser({ name: "alice" });
    const { headers } = await logInAs("alice");

    const result = await authService.logOut(headers);

    if (!result.ok) return expect.fail("logout failed");
    const cleared = result.value.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("better-auth.session_token="));
    expect(cleared).toMatch(/^better-auth\.session_token=;/);
    expect(cleared).toContain("Max-Age=0");
  });

  it("changes nothing without a session", async () => {
    await createUser({ name: "alice" });
    const { headers, user } = await logInAs("alice");

    expect((await authService.logOut(new Headers())).ok).toBe(true);

    expect(await getTestDb().session.count()).toBe(1);
    expect(await authService.getSessionUser(headers)).toStrictEqual(user);
  });

  it("allows a new login afterwards", async () => {
    await createUser({ name: "alice" });
    const { headers } = await logInAs("alice");
    await authService.logOut(headers);

    const again = await logInAs("alice");

    expect(await authService.getSessionUser(again.headers)).toStrictEqual(again.user);
  });
});

describe("the wait after failed logins", () => {
  const MINUTE_MS = 60_000;

  /** Tries the given number of logins with a wrong password and returns their results. */
  async function failLogins(name: string, count: number) {
    const results = [];
    for (let attempt = 0; attempt < count; attempt += 1) {
      results.push(await authService.logIn({ name, password: WRONG_PASSWORD }, new Headers()));
    }
    return results;
  }

  /** Moves the time of the last failed login for the name back, as if that much time had passed. */
  async function letTimePass(name: string, ms: number) {
    const attempt = await getTestDb().loginAttempt.findUniqueOrThrow({ where: { username: name } });
    await getTestDb().loginAttempt.update({
      where: { username: name },
      data: { lastFailedAt: new Date(attempt.lastFailedAt.getTime() - ms) },
    });
  }

  /** Asserts that the result is a refusal with a wait of about the given minutes: at most that, and close to it. */
  function expectWait(result: Awaited<ReturnType<typeof authService.logIn>>, minutes: number) {
    expect(result).toMatchObject({ ok: false, error: { code: "wait" } });
    if (result.ok || result.error.code !== "wait") return;
    expect(result.error.waitMs).toBeLessThanOrEqual(minutes * MINUTE_MS);
    expect(result.error.waitMs).toBeGreaterThan(minutes * MINUTE_MS - 10_000);
  }

  it("makes the login after five failures wait a minute, the same for a known and an unknown name", async () => {
    await createUser({ name: "alice" });

    const known = await failLogins("alice", 5);
    const unknown = await failLogins("nobody", 5);

    expect(known).toEqual(Array.from({ length: 5 }, () => INVALID_CREDENTIALS));
    expect(unknown).toStrictEqual(known);
    expectWait(await authService.logIn({ name: "alice", password: WRONG_PASSWORD }, new Headers()), 1);
    expectWait(await authService.logIn({ name: "nobody", password: WRONG_PASSWORD }, new Headers()), 1);
    const attempts = await getTestDb().loginAttempt.findMany({ orderBy: { username: "asc" } });
    expect(attempts.map(({ username, failures }) => ({ username, failures }))).toEqual([
      { username: "alice", failures: 5 },
      { username: "nobody", failures: 5 },
    ]);
  });

  it("does not make a fifth login wait after four failures", async () => {
    await createUser({ name: "alice" });
    await failLogins("alice", 4);

    expect((await logInAs("alice")).user.name).toBe("alice");
  });

  it("refuses the right password during the wait, without checking it and without counting the attempt", async () => {
    await createUser({ name: "alice" });
    await failLogins("alice", 5);
    const before = await getTestDb().loginAttempt.findUniqueOrThrow({ where: { username: "alice" } });
    vi.mocked(hashPassword).mockClear();
    vi.mocked(verifyPassword).mockClear();

    const result = await authService.logIn({ name: "alice", password: TEST_PASSWORD }, new Headers());

    expectWait(result, 1);
    expect(vi.mocked(verifyPassword)).not.toHaveBeenCalled();
    expect(vi.mocked(hashPassword)).not.toHaveBeenCalled();
    expect(await getTestDb().loginAttempt.findUniqueOrThrow({ where: { username: "alice" } })).toStrictEqual(before);
    expect(await getTestDb().session.count()).toBe(0);
  });

  it("accepts the right password once the wait is over, and forgets the failures", async () => {
    await createUser({ name: "alice" });
    await failLogins("alice", 5);

    await letTimePass("alice", MINUTE_MS - 5000);
    expectWait(await authService.logIn({ name: "alice", password: TEST_PASSWORD }, new Headers()), 5 / 60);
    await letTimePass("alice", 5000);
    const { user, headers } = await logInAs("alice");

    expect(await authService.getSessionUser(headers)).toStrictEqual(user);
    expect(await getTestDb().loginAttempt.count()).toBe(0);
    // The count starts again: four more failures do not make the next login wait.
    await failLogins("alice", 4);
    expect((await logInAs("alice")).user.name).toBe("alice");
  });

  it("forgets the failures of a name after a successful login, and keeps those of other names", async () => {
    await createUser({ name: "alice" });
    await failLogins("alice", 4);
    await failLogins("nobody", 4);

    await logInAs("alice");

    const attempts = await getTestDb().loginAttempt.findMany();
    expect(attempts.map(({ username, failures }) => ({ username, failures }))).toEqual([
      { username: "nobody", failures: 4 },
    ]);
  });

  it("doubles the wait with each further failure, up to 15 minutes", async () => {
    await createUser({ name: "alice" });
    await failLogins("alice", 5);

    for (const minutes of [2, 4, 8, 15, 15]) {
      // Once the wait is over, the next failure counts and starts a longer one.
      await letTimePass("alice", 15 * MINUTE_MS);
      expect(await failLogins("alice", 1)).toEqual([INVALID_CREDENTIALS]);
      expectWait(await authService.logIn({ name: "alice", password: TEST_PASSWORD }, new Headers()), minutes);
    }
    expect((await getTestDb().loginAttempt.findUniqueOrThrow({ where: { username: "alice" } })).failures).toBe(10);
  });

  it("keeps the count in the database: a new instance of the service still makes the login wait", async () => {
    await createUser({ name: "alice" });
    await failLogins("alice", 5);

    // As after a restart of the server: the modules are loaded anew, only the database remembers.
    vi.resetModules();
    const restarted = await import("@/features/auth/service");

    expect(restarted.logIn).not.toBe(authService.logIn);
    expectWait(await restarted.logIn({ name: "alice", password: TEST_PASSWORD }, new Headers()), 1);
  });

  it("counts a password of 129 characters as a failure", async () => {
    await createUser({ name: "alice" });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await authService.logIn({ name: "alice", password: "p".repeat(129) }, new Headers());
    }

    expectWait(await authService.logIn({ name: "alice", password: TEST_PASSWORD }, new Headers()), 1);
  });

  it("keeps no row for a name that breaks the name rule, however often it is tried", async () => {
    const results = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      results.push(await authService.logIn({ name: "Not A Name!", password: WRONG_PASSWORD }, new Headers()));
    }

    expect(results).toEqual(Array.from({ length: 7 }, () => INVALID_CREDENTIALS));
    expect(await getTestDb().loginAttempt.count()).toBe(0);
  });

  it("counts the failures of a name with spaces around it under the name itself", async () => {
    await createUser({ name: "alice" });

    await failLogins("  alice ", 5);

    expectWait(await authService.logIn({ name: "alice", password: TEST_PASSWORD }, new Headers()), 1);
    expect(await getTestDb().loginAttempt.count()).toBe(1);
  });

  describe("with logins at the same time", () => {
    const BURST = 20;

    /** Sends the given number of logins for the name at the same time and returns their results. */
    function logInAtOnce(name: string, password: string, count = BURST) {
      return Promise.all(Array.from({ length: count }, () => authService.logIn({ name, password }, new Headers())));
    }

    /** How many of the results have the code; `ok` stands for a login that succeeded. */
    function countOf(results: Awaited<ReturnType<typeof logInAtOnce>>, code: string): number {
      return results.filter((result) => (result.ok ? "ok" : result.error.code) === code).length;
    }

    /** How many passwords were checked: Better Auth verifies for a known name and hashes for an unknown one. */
    function passwordChecks(): number {
      return vi.mocked(verifyPassword).mock.calls.length + vi.mocked(hashPassword).mock.calls.length;
    }

    it.each([
      ["a known name", "alice"],
      ["an unknown name", "nobody"],
    ])("checks the password of five logins for %s and makes all others wait", async (_case, name) => {
      await createUser({ name: "alice" });
      vi.mocked(hashPassword).mockClear();
      vi.mocked(verifyPassword).mockClear();

      const results = await logInAtOnce(name, WRONG_PASSWORD);

      expect(countOf(results, "invalid-credentials")).toBe(5);
      expect(countOf(results, "wait")).toBe(BURST - 5);
      expect(passwordChecks()).toBe(5);
      expect((await getTestDb().loginAttempt.findUniqueOrThrow({ where: { username: name } })).failures).toBe(5);
    });

    it("checks the password of one login once a wait is over", async () => {
      await createUser({ name: "alice" });
      await failLogins("alice", 5);
      await letTimePass("alice", MINUTE_MS);
      vi.mocked(hashPassword).mockClear();
      vi.mocked(verifyPassword).mockClear();

      const results = await logInAtOnce("alice", WRONG_PASSWORD);

      expect(countOf(results, "invalid-credentials")).toBe(1);
      expect(countOf(results, "wait")).toBe(BURST - 1);
      expect(passwordChecks()).toBe(1);
      expect((await getTestDb().loginAttempt.findUniqueOrThrow({ where: { username: "alice" } })).failures).toBe(6);
    });

    it("starts a session for each login with the right password that is checked, and forgets the count", async () => {
      await createUser({ name: "alice" });
      vi.mocked(verifyPassword).mockClear();

      const results = await logInAtOnce("alice", TEST_PASSWORD);

      // The first five are checked in any case; a later one only if it comes after a login has deleted the count.
      const loggedIn = countOf(results, "ok");
      expect(loggedIn).toBeGreaterThanOrEqual(5);
      expect(countOf(results, "wait")).toBe(BURST - loggedIn);
      expect(vi.mocked(verifyPassword).mock.calls).toHaveLength(loggedIn);
      expect(await getTestDb().session.count()).toBe(loggedIn);
      expect(await getTestDb().loginAttempt.count()).toBe(0);
    });
  });

  describe("when the password hashing is busy", () => {
    /** Logs in with the right password while no hash slot gets free. */
    async function logInWhileBusy(name: string) {
      vi.mocked(verifyPassword).mockRejectedValueOnce(new PasswordHashBusyError());
      return authService.logIn({ name, password: TEST_PASSWORD }, new Headers());
    }

    it("keeps no row for a name without failed logins", async () => {
      await createUser({ name: "alice" });

      expect(await logInWhileBusy("alice")).toEqual({ ok: false, error: { code: "busy" } });

      expect(await getTestDb().loginAttempt.count()).toBe(0);
    });

    it("leaves the count of a name as it was", async () => {
      await createUser({ name: "alice" });
      await failLogins("alice", 4);
      const before = await getTestDb().loginAttempt.findUniqueOrThrow({ where: { username: "alice" } });

      expect(await logInWhileBusy("alice")).toEqual({ ok: false, error: { code: "busy" } });

      expect(await getTestDb().loginAttempt.findUniqueOrThrow({ where: { username: "alice" } })).toStrictEqual(before);
      // The busy login was not the fifth failure: the next one is checked.
      expect((await logInAs("alice")).user.name).toBe("alice");
    });

    it("does not start a wait again that was over", async () => {
      await createUser({ name: "alice" });
      await failLogins("alice", 5);
      await letTimePass("alice", MINUTE_MS);
      const before = await getTestDb().loginAttempt.findUniqueOrThrow({ where: { username: "alice" } });

      expect(await logInWhileBusy("alice")).toEqual({ ok: false, error: { code: "busy" } });

      expect(await getTestDb().loginAttempt.findUniqueOrThrow({ where: { username: "alice" } })).toStrictEqual(before);
      expect((await logInAs("alice")).user.name).toBe("alice");
    });
  });
});

describe("changeFirstPassword", () => {
  const NEW_PASSWORD = "my-own-password";

  /** The three passwords of a change from the password of `createUser()` to the given one. */
  function changeTo(newPassword: string, currentPassword = TEST_PASSWORD) {
    return { currentPassword, newPassword, repeatPassword: newPassword };
  }

  /** What a refused change must leave as it is: the user row, the password hash and the sessions. */
  async function storedState(name: string) {
    const user = await getTestDb().user.findUniqueOrThrow({ where: { username: name }, include: { accounts: true } });
    const sessions = await getTestDb().session.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    return { user, sessions };
  }

  it("clears the pending change, and the new password logs in while the old one does not", async () => {
    const alice = await createUser({ name: "alice" });
    const { headers } = await logInAs("alice");

    const result = await authService.changeFirstPassword(changeTo(NEW_PASSWORD), headers);

    expect(result).toMatchObject({
      ok: true,
      value: { user: { id: alice.id, name: "alice", mustChangePassword: false } },
    });
    expect((await getTestDb().user.findUniqueOrThrow({ where: { id: alice.id } })).mustChangePassword).toBe(false);
    const account = await getTestDb().account.findFirstOrThrow({ where: { userId: alice.id } });
    expect(account.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect((await logInAs("alice", NEW_PASSWORD)).user).toStrictEqual({
      id: alice.id,
      name: "alice",
      mustChangePassword: false,
    });
    expect(await authService.logIn({ name: "alice", password: TEST_PASSWORD }, new Headers())).toEqual(
      INVALID_CREDENTIALS,
    );
  });

  it("ends the other sessions of the user and keeps the request logged in, with a new session", async () => {
    const alice = await createUser({ name: "alice" });
    await createUser({ name: "bob" });
    const request = await logInAs("alice");
    const other = await logInAs("alice");
    const bob = await logInAs("bob");

    const result = await authService.changeFirstPassword(changeTo(NEW_PASSWORD), request.headers);

    if (!result.ok) return expect.fail(`change failed with ${result.error.code}`);
    // Better Auth ends all sessions of the user and starts a new one, whose cookie is in the response headers.
    const newHeaders = withCookies(result.value.headers);
    expect(await authService.getSessionUser(newHeaders)).toStrictEqual({
      id: alice.id,
      name: "alice",
      mustChangePassword: false,
    });
    expect(await authService.getSessionUser(other.headers)).toBeNull();
    expect(await authService.getSessionUser(request.headers)).toBeNull();
    expect(await getTestDb().session.count({ where: { userId: alice.id } })).toBe(1);
    // The sessions of other users are not touched.
    expect(await authService.getSessionUser(bob.headers)).toStrictEqual(bob.user);
  });

  it.each([
    ["a wrong current password", changeTo(NEW_PASSWORD, WRONG_PASSWORD), { code: "wrong-password" }],
    [
      "a new password equal to the current one",
      changeTo(TEST_PASSWORD),
      { code: "invalid-input", fieldErrors: { newPassword: ["New password must differ from the current one"] } },
    ],
    [
      "a new password equal to the user name",
      changeTo("alexander"),
      { code: "invalid-input", fieldErrors: { newPassword: ["Password must not be the same as the user name"] } },
    ],
    [
      "a new password of 7 characters",
      changeTo("1234567"),
      { code: "invalid-input", fieldErrors: { newPassword: ["Password must be at least 8 characters"] } },
    ],
    [
      "a repetition that differs",
      { ...changeTo(NEW_PASSWORD), repeatPassword: "another-password" },
      { code: "invalid-input", fieldErrors: { repeatPassword: ["The two new passwords do not match"] } },
    ],
  ])("changes nothing for %s", async (_case, input, error) => {
    await createUser({ name: "alexander" });
    const request = await logInAs("alexander");
    const other = await logInAs("alexander");
    const before = await storedState("alexander");

    const result = await authService.changeFirstPassword(input, request.headers);

    expect(result).toEqual({ ok: false, error });
    expect(await storedState("alexander")).toStrictEqual(before);
    expect(before.user.mustChangePassword).toBe(true);
    expect(await authService.getSessionUser(request.headers)).toStrictEqual(request.user);
    expect(await authService.getSessionUser(other.headers)).toStrictEqual(other.user);
    expect((await logInAs("alexander")).user.mustChangePassword).toBe(true);
  });

  it("changes nothing when the password hashing has no free slot", async () => {
    await createUser({ name: "alice" });
    const { headers, user } = await logInAs("alice");
    const before = await storedState("alice");
    vi.mocked(hashPassword).mockRejectedValueOnce(new PasswordHashBusyError());

    const result = await authService.changeFirstPassword(changeTo(NEW_PASSWORD), headers);

    expect(result).toEqual({ ok: false, error: { code: "busy" } });
    expect(await storedState("alice")).toStrictEqual(before);
    expect(await authService.getSessionUser(headers)).toStrictEqual(user);
  });

  it("is refused without a session and for a user without a pending change", async () => {
    await createUser({ name: "alice", mustChangePassword: false });
    const { headers } = await logInAs("alice");
    const before = await storedState("alice");

    expect(await authService.changeFirstPassword(changeTo(NEW_PASSWORD), new Headers())).toEqual({
      ok: false,
      error: { code: "not-logged-in" },
    });
    expect(await authService.changeFirstPassword(changeTo(NEW_PASSWORD), headers)).toEqual({
      ok: false,
      error: { code: "not-required" },
    });
    expect(await storedState("alice")).toStrictEqual(before);
  });

  it("cannot be used a second time", async () => {
    await createUser({ name: "alice" });
    const { headers } = await logInAs("alice");
    const first = await authService.changeFirstPassword(changeTo(NEW_PASSWORD), headers);
    if (!first.ok) return expect.fail(`change failed with ${first.error.code}`);

    const second = await authService.changeFirstPassword(
      changeTo("yet-another-password", NEW_PASSWORD),
      withCookies(first.value.headers),
    );

    expect(second).toEqual({ ok: false, error: { code: "not-required" } });
    expect((await logInAs("alice", NEW_PASSWORD)).user.name).toBe("alice");
  });

  it("accepts a new password of 128 characters with spaces and non-Latin letters", async () => {
    const password = "  мой-пароль-密碼 ".padEnd(128, "p");
    await createUser({ name: "alice" });
    const { headers } = await logInAs("alice");

    const result = await authService.changeFirstPassword(changeTo(password), headers);

    expect(result.ok).toBe(true);
    expect((await logInAs("alice", password)).user.mustChangePassword).toBe(false);
    expect(await authService.logIn({ name: "alice", password: password.trim() }, new Headers())).toEqual(
      INVALID_CREDENTIALS,
    );
  });
});
