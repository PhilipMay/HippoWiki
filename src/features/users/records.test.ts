import { describe, expect, it } from "vitest";

import { newUserData, placeholderEmail } from "@/features/users/records";

describe("placeholderEmail", () => {
  it("is an address of the user in a domain that never resolves", () => {
    expect(placeholderEmail("alice")).toBe("alice@users.hippowiki.invalid");
    expect(placeholderEmail("user-2")).toBe("user-2@users.hippowiki.invalid");
  });
});

describe("newUserData", () => {
  it("builds the user row with the placeholder email and the credential account", () => {
    const id = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1001";

    expect(newUserData({ id, name: "alice", passwordHash: "$argon2id$hash", mustChangePassword: true })).toStrictEqual({
      id,
      name: "alice",
      username: "alice",
      email: "alice@users.hippowiki.invalid",
      mustChangePassword: true,
      accounts: { create: { providerId: "credential", accountId: id, password: "$argon2id$hash" } },
    });
  });

  it("keeps a password change that is already done", () => {
    const data = newUserData({ name: "alice", passwordHash: "$argon2id$hash", mustChangePassword: false });

    expect(data.mustChangePassword).toBe(false);
  });

  it("gives the user a random id, which the account refers to", () => {
    const first = newUserData({ name: "alice", passwordHash: "$argon2id$hash", mustChangePassword: true });
    const second = newUserData({ name: "bob", passwordHash: "$argon2id$hash", mustChangePassword: true });

    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.id).not.toBe(second.id);
    expect(first.accounts?.create).toMatchObject({ accountId: first.id });
    expect(second.accounts?.create).toMatchObject({ accountId: second.id });
  });

  it("stores neither a display name of its own nor another email", () => {
    const data = newUserData({ name: "user-2", passwordHash: "$argon2id$hash", mustChangePassword: true });

    expect(data.name).toBe(data.username);
    expect(data.email).toBe(placeholderEmail("user-2"));
  });
});
