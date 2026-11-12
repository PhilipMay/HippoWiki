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
