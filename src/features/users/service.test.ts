import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureAdmin, listUsers } from "@/features/users/service";
import { Prisma } from "@/generated/prisma/client";
import { PasswordHashBusyError } from "@/lib/password-hash";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  userCreate: vi.fn(),
  hashPassword: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    user: { findUnique: mocks.userFindUnique, findMany: mocks.userFindMany, create: mocks.userCreate },
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));
vi.mock(import("@/lib/password-hash"), async (importOriginal) => ({
  ...(await importOriginal()),
  hashPassword: mocks.hashPassword,
}));

const PASSWORD = "first-password";
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$salt$hash";
const ADMIN_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1000";
const ALICE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";

/** The acting users: the admin, and a normal user. */
const ADMIN = { id: ADMIN_ID, name: "admin" };
const ALICE = { id: ALICE_ID, name: "alice" };

function knownError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("database error", { code, clientVersion: "test", meta });
}

/** A unique violation as Prisma reports it with a driver adapter. */
function uniqueViolation(constraint: { index?: string; fields?: string[] }) {
  return knownError("P2002", { driverAdapterError: { cause: { constraint } } });
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
  mocks.userFindUnique.mockResolvedValue(null);
  mocks.hashPassword.mockResolvedValue(HASH);
  mocks.userCreate.mockResolvedValue({ id: ADMIN_ID });
});

describe("ensureAdmin", () => {
  it("creates the admin with the hash of the password and a pending password change", async () => {
    await expect(ensureAdmin(PASSWORD)).resolves.toEqual({ ok: true, value: { outcome: "created" } });

    expect(mocks.userFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { username: "admin" },
      select: { id: true },
    });
    expect(mocks.hashPassword).toHaveBeenCalledExactlyOnceWith(PASSWORD);
    expect(mocks.userCreate).toHaveBeenCalledOnce();
    const { data } = mocks.userCreate.mock.calls[0]?.[0] as { data: Prisma.UserCreateInput };
    expect(data).toStrictEqual({
      id: expect.any(String) as string,
      name: "admin",
      username: "admin",
      email: "admin@users.hippowiki.invalid",
      mustChangePassword: true,
      accounts: { create: { providerId: "credential", accountId: data.id, password: HASH } },
    });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ userId: ADMIN_ID }, "admin created");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("hashes the password as it is, with its spaces", async () => {
    await ensureAdmin("  spaced password  ");

    expect(mocks.hashPassword).toHaveBeenCalledExactlyOnceWith("  spaced password  ");
  });

  it.each([
    ["the same password", PASSWORD],
    ["another password", "another-password"],
    ["an invalid password", "short"],
    ["an empty password", ""],
    ["no password", undefined],
  ])("does nothing when the admin exists, with %s", async (_case, password) => {
    mocks.userFindUnique.mockResolvedValue({ id: ADMIN_ID });

    await expect(ensureAdmin(password)).resolves.toEqual({ ok: true, value: { outcome: "exists" } });

    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ userId: ADMIN_ID }, "admin exists, nothing to do");
  });

  it.each([
    ["a missing password", undefined],
    ["an empty password", ""],
  ])("reports %s and writes nothing", async (_case, password) => {
    await expect(ensureAdmin(password)).resolves.toEqual({ ok: false, error: { code: "password-missing" } });

    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it.each([
    ["of 7 characters", "1234567", ["Password must be at least 8 characters"]],
    ["of 129 characters", "p".repeat(129), ["Password must be at most 128 characters"]],
  ])("reports an invalid password %s with its field error and writes nothing", async (_case, password, errors) => {
    await expect(ensureAdmin(password)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { password: errors } },
    });

    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it("reports busy when no hash slot gets free, and writes nothing", async () => {
    mocks.hashPassword.mockRejectedValue(new PasswordHashBusyError());

    await expect(ensureAdmin(PASSWORD)).resolves.toEqual({ ok: false, error: { code: "busy" } });

    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith("too many password hashes are running, admin not created");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("reports failed when the hash fails, and writes nothing", async () => {
    const err = new Error("hash failed");
    mocks.hashPassword.mockRejectedValue(err);

    await expect(ensureAdmin(PASSWORD)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err }, "failed to hash the password of the admin");
  });

  it.each([
    ["the index of the user name", { index: "User_username_key" }],
    ["the index of the email", { index: "User_email_key" }],
    ["the field of the user name, without an index name", { fields: ["username"] }],
  ])("counts a unique violation on %s as an admin that exists", async (_case, constraint) => {
    mocks.userCreate.mockRejectedValue(uniqueViolation(constraint));

    await expect(ensureAdmin(PASSWORD)).resolves.toEqual({ ok: true, value: { outcome: "exists" } });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("admin was created in the meantime, nothing to do");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([
    ["a unique violation of another index", uniqueViolation({ index: "Session_token_key" })],
    ["a foreign key violation", knownError("P2003")],
    ["a connection error", new Error("connection refused")],
  ])("reports failed for %s when it creates the admin", async (_case, err) => {
    mocks.userCreate.mockRejectedValue(err);

    await expect(ensureAdmin(PASSWORD)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err }, "failed to create the admin");
  });

  it("reports failed when the lookup of the admin fails, without a hash or a write", async () => {
    const err = new Error("connection refused");
    mocks.userFindUnique.mockRejectedValue(err);

    await expect(ensureAdmin(PASSWORD)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err }, "failed to look up the admin");
  });

  it.each([
    ["the admin is created", () => undefined],
    ["the admin exists", () => mocks.userFindUnique.mockResolvedValue({ id: ADMIN_ID })],
    ["the hash is busy", () => mocks.hashPassword.mockRejectedValue(new PasswordHashBusyError())],
    ["the hash fails", () => mocks.hashPassword.mockRejectedValue(new Error("hash failed"))],
    ["the name is taken", () => mocks.userCreate.mockRejectedValue(uniqueViolation({ index: "User_username_key" }))],
    ["the write fails", () => mocks.userCreate.mockRejectedValue(new Error("connection refused"))],
  ])("logs neither the password nor its hash when %s", async (_case, arrange) => {
    arrange();

    await ensureAdmin(PASSWORD);

    expect(logged()).not.toContain(PASSWORD);
    expect(logged()).not.toContain(HASH);
  });
});

describe("listUsers", () => {
  const CREATED_AT = new Date("2026-11-12T10:00:00.000Z");

  it("returns every user for the admin, with the user name as the name", async () => {
    mocks.userFindMany.mockResolvedValue([
      { id: ADMIN_ID, username: "admin", createdAt: CREATED_AT, mustChangePassword: false },
      { id: ALICE_ID, username: "alice", createdAt: CREATED_AT, mustChangePassword: true },
    ]);

    await expect(listUsers(ADMIN)).resolves.toStrictEqual([
      { id: ADMIN_ID, name: "admin", createdAt: CREATED_AT, mustChangePassword: false },
      { id: ALICE_ID, name: "alice", createdAt: CREATED_AT, mustChangePassword: true },
    ]);
  });

  it.each([
    ["a normal user", ALICE],
    ["a user whose name only starts like the admin's", { id: ALICE_ID, name: "admin-2" }],
    ["a name in another case", { id: ALICE_ID, name: "Admin" }],
    ["a normal user with the id of the admin", { id: ADMIN_ID, name: "alice" }],
  ])("returns null for %s and does not ask the database", async (_case, actor) => {
    await expect(listUsers(actor)).resolves.toBeNull();

    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it("throws a database error", async () => {
    mocks.userFindMany.mockRejectedValue(new Error("connection refused"));

    await expect(listUsers(ADMIN)).rejects.toThrow("connection refused");
  });
});
