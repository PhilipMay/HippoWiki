import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUser, ensureAdmin, listUsers, type Actor } from "@/features/users/service";
import { Prisma } from "@/generated/prisma/client";
import { PasswordHashBusyError } from "@/lib/password-hash";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  userCreate: vi.fn(),
  hashPassword: vi.fn(),
  generateFirstPassword: vi.fn(),
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
vi.mock("@/features/users/password", () => ({ generateFirstPassword: mocks.generateFirstPassword }));
vi.mock(import("@/lib/password-hash"), async (importOriginal) => ({
  ...(await importOriginal()),
  hashPassword: mocks.hashPassword,
}));

const PASSWORD = "first-password";
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$salt$hash";
const ADMIN_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1000";
const ALICE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";

/** The acting users: the admin, and a normal user. */
const ADMIN: Actor = { id: ADMIN_ID, name: "admin", type: "admin" };
const ALICE: Actor = { id: ALICE_ID, name: "alice", type: "user" };

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
      type: "admin",
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
    ["that is a placeholder", "<first password>", ["Password must not be a placeholder such as <first password>"]],
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

  it.each([
    ["the admin", ADMIN],
    ["an admin with another name", { id: ALICE_ID, name: "maria", type: "admin" }],
  ] satisfies [string, Actor][])(
    "returns every user for %s, with type and the pending password change",
    async (_case, actor) => {
      mocks.userFindMany.mockResolvedValue([
        { id: ADMIN_ID, username: "admin", type: "admin", createdAt: CREATED_AT, mustChangePassword: false },
        { id: ALICE_ID, username: "alice", type: "user", createdAt: CREATED_AT, mustChangePassword: true },
      ]);

      await expect(listUsers(actor)).resolves.toStrictEqual({
        kind: "admin",
        users: [
          { id: ADMIN_ID, name: "admin", type: "admin", createdAt: CREATED_AT, mustChangePassword: false },
          { id: ALICE_ID, name: "alice", type: "user", createdAt: CREATED_AT, mustChangePassword: true },
        ],
      });
      expect(mocks.userFindMany).toHaveBeenCalledExactlyOnceWith({
        select: { id: true, username: true, type: true, createdAt: true, mustChangePassword: true },
        orderBy: { username: "asc" },
      });
    },
  );

  it.each([
    ["a user", ALICE],
    ["a user named admin", { id: ADMIN_ID, name: "admin", type: "user" }],
    ["a user with the id of an admin", { id: ADMIN_ID, name: "alice", type: "user" }],
  ] satisfies [string, Actor][])(
    "returns every user for %s, with type and without the pending password change",
    async (_case, actor) => {
      mocks.userFindMany.mockResolvedValue([
        { id: ADMIN_ID, username: "admin", type: "admin", createdAt: CREATED_AT },
        { id: ALICE_ID, username: "alice", type: "user", createdAt: CREATED_AT },
      ]);

      await expect(listUsers(actor)).resolves.toStrictEqual({
        kind: "user",
        users: [
          { id: ADMIN_ID, name: "admin", type: "admin", createdAt: CREATED_AT },
          { id: ALICE_ID, name: "alice", type: "user", createdAt: CREATED_AT },
        ],
      });
      // The pending password change is not even read for a user.
      expect(mocks.userFindMany).toHaveBeenCalledExactlyOnceWith({
        select: { id: true, username: true, type: true, createdAt: true },
        orderBy: { username: "asc" },
      });
      expectNothingLogged();
    },
  );

  it("throws a database error", async () => {
    mocks.userFindMany.mockRejectedValue(new Error("connection refused"));

    await expect(listUsers(ADMIN)).rejects.toThrow("connection refused");
    await expect(listUsers(ALICE)).rejects.toThrow("connection refused");
  });
});

describe("createUser", () => {
  const GENERATED = "Gx7pQ2mWk9RtZ4vNc8Hs";
  const CREATED_AT = new Date("2026-11-12T10:00:00.000Z");
  const STORED = { id: ALICE_ID, username: "bob", type: "user", createdAt: CREATED_AT, mustChangePassword: true };

  beforeEach(() => {
    mocks.generateFirstPassword.mockReturnValue(GENERATED);
    mocks.userCreate.mockResolvedValue(STORED);
  });

  it("creates the user with the hash of a generated password and returns the user with the password", async () => {
    const result = await createUser(ADMIN, { name: "bob", type: "user" });

    expect(result).toStrictEqual({
      ok: true,
      value: {
        user: { id: ALICE_ID, name: "bob", type: "user", createdAt: CREATED_AT, mustChangePassword: true },
        password: GENERATED,
      },
    });
    expect(mocks.hashPassword).toHaveBeenCalledExactlyOnceWith(GENERATED);
    expect(mocks.userCreate).toHaveBeenCalledOnce();
    const { data, select } = mocks.userCreate.mock.calls[0]?.[0] as { data: Prisma.UserCreateInput; select: object };
    expect(data).toStrictEqual({
      id: expect.any(String) as string,
      name: "bob",
      username: "bob",
      email: "bob@users.hippowiki.invalid",
      type: "user",
      mustChangePassword: true,
      accounts: { create: { providerId: "credential", accountId: data.id, password: HASH } },
    });
    expect(select).toStrictEqual({ id: true, username: true, type: true, createdAt: true, mustChangePassword: true });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { userId: ALICE_ID, name: "bob", type: "user", actorId: ADMIN_ID, createdBy: "admin" },
      "user created",
    );
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("creates an admin, and logs the type and the admin who created it, never the password", async () => {
    const maria: Actor = { id: ADMIN_ID, name: "maria", type: "admin" };
    mocks.userCreate.mockResolvedValue({ ...STORED, username: "carol", type: "admin" });

    const result = await createUser(maria, { name: "carol", type: "admin" });

    expect(result).toMatchObject({ ok: true, value: { user: { name: "carol", type: "admin" } } });
    const { data } = mocks.userCreate.mock.calls[0]?.[0] as { data: Prisma.UserCreateInput };
    expect(data).toMatchObject({ username: "carol", type: "admin" });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { userId: ALICE_ID, name: "carol", type: "admin", actorId: ADMIN_ID, createdBy: "maria" },
      "user created",
    );
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain(GENERATED);
  });

  it.each([
    ["no type", undefined],
    ["an empty type", ""],
    ["an unknown type", "root"],
  ])("answers invalid-input for %s, without a hash or a write", async (_case, type) => {
    const result = await createUser(ADMIN, { name: "bob", type } as { name: string; type: string });

    expect(result).toEqual({
      ok: false,
      error: { code: "invalid-input", fieldErrors: { type: ["Choose the type of the account"] } },
    });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("trims the name", async () => {
    await createUser(ADMIN, { name: "  bob ", type: "user" });

    const { data } = mocks.userCreate.mock.calls[0]?.[0] as { data: Prisma.UserCreateInput };
    expect(data).toMatchObject({ username: "bob", email: "bob@users.hippowiki.invalid" });
  });

  it("generates another password when the generated one is the user name", async () => {
    const name = "gx7pq2mwk9rtz4vnc8hs";
    mocks.generateFirstPassword.mockReturnValueOnce(name).mockReturnValueOnce(GENERATED);
    mocks.userCreate.mockResolvedValue({ ...STORED, username: name });

    const result = await createUser(ADMIN, { name, type: "user" });

    expect(result).toMatchObject({ ok: true, value: { password: GENERATED } });
    expect(mocks.hashPassword).toHaveBeenCalledExactlyOnceWith(GENERATED);
  });

  it.each([
    ["a user", ALICE],
    ["a user named admin", { id: ADMIN_ID, name: "admin", type: "user" }],
    ["a user with the id of an admin", { id: ADMIN_ID, name: "alice", type: "user" }],
  ] satisfies [string, Actor][])(
    "answers not-allowed for %s, without a password, a hash or the database",
    async (_case, actor) => {
      const result = await createUser(actor, { name: "bob", type: "user" });

      expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
      expect(mocks.generateFirstPassword).not.toHaveBeenCalled();
      expect(mocks.hashPassword).not.toHaveBeenCalled();
      expect(mocks.userCreate).not.toHaveBeenCalled();
      expect(mocks.userFindUnique).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { actorId: actor.id },
        "user not created: the actor is not an admin",
      );
    },
  );

  it("checks the actor before the name", async () => {
    const result = await createUser(ALICE, { name: "Not A Name!", type: "user" });

    expect(result).toEqual({ ok: false, error: { code: "not-allowed" } });
  });

  it.each([
    ["an empty name", "", "Name is required"],
    ["a name of 2 characters", "ab", "Name must be at least 3 characters"],
    ["a name of 31 characters", "a".repeat(31), "Name must be at most 30 characters"],
    ["a name in upper case", "Bob", "Use lowercase letters, digits and single hyphens"],
    ["a name with a double hyphen", "bo--b", "Use lowercase letters, digits and single hyphens"],
  ])("answers invalid-input for %s, without a hash or a write", async (_case, name, error) => {
    const result = await createUser(ADMIN, { name, type: "user" });

    expect(result).toEqual({ ok: false, error: { code: "invalid-input", fieldErrors: { name: [error] } } });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expectNothingLogged();
  });

  it.each([
    ["the index of the user name", { index: "User_username_key" }],
    ["the index of the email", { index: "User_email_key" }],
    ["the field of the user name, without an index name", { fields: ["username"] }],
  ])("answers name-taken for a unique violation on %s", async (_case, constraint) => {
    mocks.userCreate.mockRejectedValue(uniqueViolation(constraint));

    const result = await createUser(ADMIN, { name: "bob", type: "user" });

    expect(result).toEqual({ ok: false, error: { code: "name-taken" } });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ name: "bob" }, "name of new user already in use");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("answers busy when no hash slot gets free, and writes nothing", async () => {
    mocks.hashPassword.mockRejectedValue(new PasswordHashBusyError());

    const result = await createUser(ADMIN, { name: "bob", type: "user" });

    expect(result).toEqual({ ok: false, error: { code: "busy" } });
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { name: "bob" },
      "too many password hashes are running, user not created",
    );
  });

  it("answers failed when the hash fails, and writes nothing", async () => {
    const err = new Error("hash failed");
    mocks.hashPassword.mockRejectedValue(err);

    const result = await createUser(ADMIN, { name: "bob", type: "user" });

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, name: "bob" },
      "failed to hash the first password of a new user",
    );
  });

  it.each([
    ["a unique violation of another index", uniqueViolation({ index: "Session_token_key" })],
    ["a foreign key violation", knownError("P2003")],
    ["a connection error", new Error("connection refused")],
  ])("answers failed for %s and logs it", async (_case, err) => {
    mocks.userCreate.mockRejectedValue(err);

    const result = await createUser(ADMIN, { name: "bob", type: "user" });

    expect(result).toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err, name: "bob" }, "failed to create user");
  });

  /** What a test sets up before the call, and the actor of the call. */
  const outcomes: [string, () => void, Actor][] = [
    ["the user is created", () => undefined, ADMIN],
    ["the actor is not an admin", () => undefined, ALICE],
    [
      "the name is taken",
      () => mocks.userCreate.mockRejectedValue(uniqueViolation({ index: "User_username_key" })),
      ADMIN,
    ],
    ["the hash is busy", () => mocks.hashPassword.mockRejectedValue(new PasswordHashBusyError()), ADMIN],
    ["the hash fails", () => mocks.hashPassword.mockRejectedValue(new Error("hash failed")), ADMIN],
    ["the write fails", () => mocks.userCreate.mockRejectedValue(new Error("connection refused")), ADMIN],
  ];

  it.each(outcomes)("logs neither the password nor its hash when %s", async (_case, arrange, actor) => {
    arrange();

    await createUser(actor, { name: "bob", type: "user" });

    expect(logged()).not.toContain(GENERATED);
    expect(logged()).not.toContain(HASH);
  });
});
