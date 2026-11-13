// Runs the users service against the test database, to check its reads and writes on real data and with real hashes.
import { describe, expect, it } from "vitest";

import * as authService from "@/features/auth/service";
import * as userService from "@/features/users/service";
import { verifyPassword } from "@/lib/password-hash";

import { createUser, getTestDb } from "../e2e/support/database";

/** Every user with its accounts, to compare the tables before and after a call. */
function storedUsers() {
  return getTestDb().user.findMany({ include: { accounts: true }, orderBy: { username: "asc" } });
}

describe("ensureAdmin", () => {
  it("creates the admin with a pending password change, a credential account and a hash of the password", async () => {
    const result = await userService.ensureAdmin("first-password");

    expect(result).toEqual({ ok: true, value: { outcome: "created" } });
    const users = await storedUsers();
    expect(users).toHaveLength(1);
    const admin = users[0];
    expect(admin).toMatchObject({
      name: "admin",
      username: "admin",
      email: "admin@users.hippowiki.invalid",
      emailVerified: false,
      mustChangePassword: true,
    });
    expect(admin?.accounts).toHaveLength(1);
    const account = admin?.accounts[0];
    expect(account).toMatchObject({ providerId: "credential", accountId: admin?.id, userId: admin?.id });
    expect(account?.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(account?.password ?? "", "first-password")).toBe(true);
    expect(await verifyPassword(account?.password ?? "", "first-passwore")).toBe(false);
  });

  it.each([
    ["the same password", "first-password"],
    ["another password", "another-password"],
    ["an invalid password", "short"],
    ["no password", undefined],
  ])("changes nothing on a second call with %s", async (_case, password) => {
    await userService.ensureAdmin("first-password");
    const before = await storedUsers();

    const result = await userService.ensureAdmin(password);

    expect(result).toEqual({ ok: true, value: { outcome: "exists" } });
    expect(await storedUsers()).toStrictEqual(before);
    expect(await verifyPassword(before[0]?.accounts[0]?.password ?? "", "first-password")).toBe(true);
  });

  it.each([
    ["a missing password", undefined, { code: "password-missing" }],
    ["an empty password", "", { code: "password-missing" }],
    [
      "a password of 7 characters",
      "1234567",
      { code: "invalid-input", fieldErrors: { password: ["Password must be at least 8 characters"] } },
    ],
    [
      "a password of 129 characters",
      "p".repeat(129),
      { code: "invalid-input", fieldErrors: { password: ["Password must be at most 128 characters"] } },
    ],
  ])("leaves the tables empty for %s", async (_case, password, error) => {
    const result = await userService.ensureAdmin(password);

    expect(result).toEqual({ ok: false, error });
    expect(await getTestDb().user.count()).toBe(0);
    expect(await getTestDb().account.count()).toBe(0);
  });

  it("creates one admin when two calls run at the same time", async () => {
    const results = await Promise.all([
      userService.ensureAdmin("first-password"),
      userService.ensureAdmin("second-password"),
    ]);

    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(await getTestDb().user.count()).toBe(1);
    expect(await getTestDb().account.count()).toBe(1);
  });
});

describe("listUsers", () => {
  it("lists all users by name for the admin, with exactly the declared fields", async () => {
    const createdAt = new Date("2026-03-01T10:00:00.000Z");
    const zoe = await createUser({ name: "zoe", createdAt });
    const admin = await createUser({ name: "admin", mustChangePassword: false, createdAt });
    const bob = await createUser({ name: "bob", mustChangePassword: false, createdAt });
    const alice = await createUser({ name: "alice", createdAt });

    const users = await userService.listUsers({ id: admin.id, name: "admin" });

    expect(users).toStrictEqual([
      { id: admin.id, name: "admin", createdAt, mustChangePassword: false },
      { id: alice.id, name: "alice", createdAt, mustChangePassword: true },
      { id: bob.id, name: "bob", createdAt, mustChangePassword: false },
      { id: zoe.id, name: "zoe", createdAt, mustChangePassword: true },
    ]);
  });

  it("returns null for a normal user", async () => {
    await createUser({ name: "admin" });
    const alice = await createUser({ name: "alice" });

    expect(await userService.listUsers({ id: alice.id, name: "alice" })).toBeNull();
  });
});

describe("createUser", () => {
  /** The admin as an actor, created in the database like every other user. */
  async function createAdmin() {
    const admin = await createUser({ name: "admin", mustChangePassword: false });
    return { id: admin.id, name: admin.username };
  }

  it("creates a user with a pending password change who can log in with the returned password", async () => {
    const admin = await createAdmin();

    const result = await userService.createUser(admin, { name: "jane-doe" });

    if (!result.ok) return expect.fail(`creation failed with ${result.error.code}`);
    const { user, password } = result.value;
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{20}$/);
    const stored = await getTestDb().user.findUniqueOrThrow({
      where: { username: "jane-doe" },
      include: { accounts: true },
    });
    expect(user).toStrictEqual({
      id: stored.id,
      name: "jane-doe",
      createdAt: stored.createdAt,
      mustChangePassword: true,
    });
    expect(stored).toMatchObject({
      name: "jane-doe",
      email: "jane-doe@users.hippowiki.invalid",
      mustChangePassword: true,
    });
    expect(stored.accounts).toHaveLength(1);
    expect(stored.accounts[0]).toMatchObject({ providerId: "credential", accountId: stored.id });
    // Only the hash is stored.
    expect(JSON.stringify(stored)).not.toContain(password);
    expect(await verifyPassword(stored.accounts[0]?.password ?? "", password)).toBe(true);

    const login = await authService.logIn({ name: "jane-doe", password }, new Headers(), "shared");
    expect(login).toMatchObject({ ok: true, value: { user: { id: stored.id, mustChangePassword: true } } });
  });

  it("gives every user another password", async () => {
    const admin = await createAdmin();

    const first = await userService.createUser(admin, { name: "first-user" });
    const second = await userService.createUser(admin, { name: "second-user" });

    if (!first.ok || !second.ok) return expect.fail("creation failed");
    expect(first.value.password).not.toBe(second.value.password);
  });

  it.each([
    ["a taken name", "alice"],
    ["the name of the admin", "admin"],
    ["a taken name with spaces around it", "  alice "],
  ])("answers name-taken for %s and stores nothing", async (_case, name) => {
    const admin = await createAdmin();
    await createUser({ name: "alice" });
    const before = await getTestDb().user.findMany({ include: { accounts: true }, orderBy: { username: "asc" } });

    const result = await userService.createUser(admin, { name });

    expect(result).toEqual({ ok: false, error: { code: "name-taken" } });
    expect(
      await getTestDb().user.findMany({ include: { accounts: true }, orderBy: { username: "asc" } }),
    ).toStrictEqual(before);
  });

  it("answers not-allowed for a normal user and stores nothing", async () => {
    await createAdmin();
    const alice = await createUser({ name: "alice" });

    const result = await userService.createUser({ id: alice.id, name: "alice" }, { name: "jane-doe" });

    expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
    expect(await getTestDb().user.count()).toBe(2);
    expect(await getTestDb().account.count()).toBe(2);
  });

  it("answers invalid-input for a name that breaks the rule and stores nothing", async () => {
    const admin = await createAdmin();

    const result = await userService.createUser(admin, { name: "Jane Doe" });

    expect(result).toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { name: ["Use lowercase letters, digits and single hyphens"] } },
    });
    expect(await getTestDb().user.count()).toBe(1);
  });

  it("shows the created user in the list of the admin", async () => {
    const admin = await createAdmin();

    await userService.createUser(admin, { name: "jane-doe" });

    expect(
      (await userService.listUsers(admin))?.map(({ name, mustChangePassword }) => ({ name, mustChangePassword })),
    ).toEqual([
      { name: "admin", mustChangePassword: false },
      { name: "jane-doe", mustChangePassword: true },
    ]);
  });
});
