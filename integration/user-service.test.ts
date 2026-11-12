// Runs the users service against the test database, to check its reads and writes on real data and with real hashes.
import { describe, expect, it } from "vitest";

import * as userService from "@/features/users/service";
import { verifyPassword } from "@/lib/password-hash";

import { getTestDb } from "../e2e/support/database";

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
