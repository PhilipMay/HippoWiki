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
      type: "admin",
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

  it("leaves an existing account named admin as it is, its type included", async () => {
    const existing = await createUser({ name: "admin", type: "user", mustChangePassword: false });

    const result = await userService.ensureAdmin("first-password");

    expect(result).toEqual({ ok: true, value: { outcome: "exists" } });
    expect(await getTestDb().user.findUniqueOrThrow({ where: { id: existing.id } })).toStrictEqual(existing);
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
    [
      "a common password",
      "password123",
      { code: "invalid-input", fieldErrors: { password: ["Password is too common, choose another one"] } },
    ],
    [
      "a password built from the admin name",
      "admin2026",
      {
        code: "invalid-input",
        fieldErrors: {
          password: ["Password must not be built only from the user name or the name of the wiki, digits and symbols"],
        },
      },
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
  /** Users of both types, created at the same time, and the list as an admin sees it. */
  async function createUsers() {
    const createdAt = new Date("2026-03-01T10:00:00.000Z");
    const zoe = await createUser({ name: "zoe", createdAt });
    const admin = await createUser({ name: "admin", type: "admin", mustChangePassword: false, createdAt });
    const bob = await createUser({ name: "bob", mustChangePassword: false, createdAt });
    const maria = await createUser({ name: "maria", type: "admin", createdAt });
    const alice = await createUser({ name: "alice", mustChangePassword: false, createdAt });
    const forAdmin = [
      { id: admin.id, name: "admin", type: "admin", createdAt, mustChangePassword: false },
      { id: alice.id, name: "alice", type: "user", createdAt, mustChangePassword: false },
      { id: bob.id, name: "bob", type: "user", createdAt, mustChangePassword: false },
      { id: maria.id, name: "maria", type: "admin", createdAt, mustChangePassword: true },
      { id: zoe.id, name: "zoe", type: "user", createdAt, mustChangePassword: true },
    ];
    return { admin, maria, alice, forAdmin };
  }

  it("lists all users by name for an admin, with type and pending password change and nothing else", async () => {
    const { admin, maria, forAdmin } = await createUsers();

    for (const actor of [admin, maria]) {
      const list = await userService.listUsers({ id: actor.id, name: actor.username, type: actor.type });

      expect(list).toStrictEqual({ kind: "admin", users: forAdmin });
    }
  });

  it("lists all users by name for a user, admins included, with type and without pending password change", async () => {
    const { alice, forAdmin } = await createUsers();

    const list = await userService.listUsers({ id: alice.id, name: "alice", type: "user" });

    expect(list).toStrictEqual({
      kind: "user",
      users: forAdmin.map(({ id, name, type, createdAt }) => ({ id, name, type, createdAt })),
    });
  });
});

describe("createUser", () => {
  /** The admin as an actor, created in the database like every other user. */
  async function createAdmin() {
    const admin = await createUser({ name: "admin", type: "admin", mustChangePassword: false });
    return { id: admin.id, name: admin.username, type: admin.type };
  }

  it("creates a user with a pending password change who can log in with the returned password", async () => {
    const admin = await createAdmin();

    const result = await userService.createUser(admin, { name: "jane-doe", type: "user" });

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
      type: "user",
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

  it("creates an admin and a user with their types", async () => {
    const admin = await createAdmin();

    const maria = await userService.createUser(admin, { name: "maria", type: "admin" });
    const jane = await userService.createUser(admin, { name: "jane-doe", type: "user" });

    expect(maria).toMatchObject({ ok: true, value: { user: { name: "maria", type: "admin" } } });
    expect(jane).toMatchObject({ ok: true, value: { user: { name: "jane-doe", type: "user" } } });
    const stored = await getTestDb().user.findMany({
      select: { username: true, type: true },
      orderBy: { username: "asc" },
    });
    expect(stored).toEqual([
      { username: "admin", type: "admin" },
      { username: "jane-doe", type: "user" },
      { username: "maria", type: "admin" },
    ]);
  });

  it("lets a second admin, created this way, list the users and create a user", async () => {
    const admin = await createAdmin();
    const created = await userService.createUser(admin, { name: "maria", type: "admin" });
    if (!created.ok) return expect.fail(`creation failed with ${created.error.code}`);
    const maria = created.value.user;

    const list = await userService.listUsers(maria);
    const result = await userService.createUser(maria, { name: "jane-doe", type: "user" });

    expect(list).toMatchObject({
      kind: "admin",
      users: [{ name: "admin" }, { name: "maria", mustChangePassword: true }],
    });
    expect(result).toMatchObject({ ok: true, value: { user: { name: "jane-doe", type: "user" } } });
  });

  it.each([
    ["no type", undefined],
    ["an unknown type", "root"],
  ])("creates no user for %s", async (_case, type) => {
    const admin = await createAdmin();

    const result = await userService.createUser(admin, { name: "jane-doe", type } as { name: string; type: string });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(await getTestDb().user.count()).toBe(1);
  });

  it("gives every user another password", async () => {
    const admin = await createAdmin();

    const first = await userService.createUser(admin, { name: "first-user", type: "user" });
    const second = await userService.createUser(admin, { name: "second-user", type: "user" });

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

    const result = await userService.createUser(admin, { name, type: "user" });

    expect(result).toEqual({ ok: false, error: { code: "name-taken" } });
    expect(
      await getTestDb().user.findMany({ include: { accounts: true }, orderBy: { username: "asc" } }),
    ).toStrictEqual(before);
  });

  it("answers not-allowed for a normal user and stores nothing", async () => {
    await createAdmin();
    const alice = await createUser({ name: "alice" });

    const result = await userService.createUser(
      { id: alice.id, name: "alice", type: "user" },
      { name: "jane-doe", type: "user" },
    );

    expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
    expect(await getTestDb().user.count()).toBe(2);
    expect(await getTestDb().account.count()).toBe(2);
  });

  it("answers invalid-input for a name that breaks the rule and stores nothing", async () => {
    const admin = await createAdmin();

    const result = await userService.createUser(admin, { name: "Jane Doe", type: "user" });

    expect(result).toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { name: ["Use lowercase letters, digits and single hyphens"] } },
    });
    expect(await getTestDb().user.count()).toBe(1);
  });

  it("shows the created user in the list of the admin", async () => {
    const admin = await createAdmin();

    await userService.createUser(admin, { name: "jane-doe", type: "user" });

    const list = await userService.listUsers(admin);
    expect(list.kind).toBe("admin");
    expect(list.users.map((user) => ({ name: user.name, type: user.type }))).toEqual([
      { name: "admin", type: "admin" },
      { name: "jane-doe", type: "user" },
    ]);
  });
});

describe("the type of an account", () => {
  it.each([
    ["an admin", "admin", "user"],
    ["a user", "user", "admin"],
  ] as const)(
    "is never changed for %s: the database refuses the update and changes nothing",
    async (_case, type, other) => {
      const user = await createUser({ name: "maria", type });

      await expect(getTestDb().user.update({ where: { id: user.id }, data: { type: other } })).rejects.toThrow(
        "the type of an account cannot be changed",
      );
      await expect(getTestDb().user.updateMany({ data: { type: other } })).rejects.toThrow(
        "the type of an account cannot be changed",
      );
      expect(await getTestDb().user.findUniqueOrThrow({ where: { id: user.id } })).toStrictEqual(user);
    },
  );

  it("is never changed for a user that createUser() created", async () => {
    const admin = await createUser({ name: "admin", type: "admin", mustChangePassword: false });
    const created = await userService.createUser(
      { id: admin.id, name: admin.username, type: admin.type },
      { name: "jane-doe", type: "user" },
    );
    if (!created.ok) return expect.fail(`user not created: ${created.error.code}`);

    await expect(
      getTestDb().user.update({ where: { id: created.value.user.id }, data: { type: "admin" } }),
    ).rejects.toThrow("the type of an account cannot be changed");
    expect((await getTestDb().user.findUniqueOrThrow({ where: { id: created.value.user.id } })).type).toBe("user");
  });

  it("lets an update of another field pass, also one that names the same type", async () => {
    const user = await createUser({ name: "maria", type: "admin" });

    await getTestDb().user.update({ where: { id: user.id }, data: { mustChangePassword: false } });
    await getTestDb().user.update({ where: { id: user.id }, data: { type: "admin", name: "maria" } });

    expect(await getTestDb().user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      type: "admin",
      mustChangePassword: false,
    });
  });
});
