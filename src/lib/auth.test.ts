import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  betterAuth: vi.fn(),
  prismaAdapter: vi.fn(),
  nextCookies: vi.fn(),
  username: vi.fn(),
  getServerEnv: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  error: vi.fn(),
}));

const db = {
  authSecret: {
    findUnique: mocks.findUnique,
    createMany: mocks.createMany,
    findUniqueOrThrow: mocks.findUniqueOrThrow,
  },
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: mocks.error } }));
vi.mock("@/lib/password-hash", () => ({ hashPassword: mocks.hashPassword, verifyPassword: mocks.verifyPassword }));
vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: mocks.prismaAdapter }));
vi.mock("better-auth/next-js", () => ({ nextCookies: mocks.nextCookies }));
vi.mock("better-auth/plugins/username", () => ({ username: mocks.username }));

const SECRET = "a".repeat(64);
const INSTANCE = { api: {} };

/** The options that `betterAuth()` was called with; only the parts the tests look at are typed. */
type Options = {
  secret: string;
  database: unknown;
  advanced: { database: { generateId: unknown }; useSecureCookies: boolean };
  emailAndPassword: {
    enabled: boolean;
    disableSignUp: boolean;
    minPasswordLength: number;
    maxPasswordLength: number;
    password: {
      hash: (password: string) => Promise<string>;
      verify: (data: { hash: string; password: string }) => Promise<boolean>;
    };
  };
  session: { expiresIn: number; disableSessionRefresh: boolean; cookieCache?: unknown; updateAge?: unknown };
  user: { additionalFields: Record<string, unknown> };
  telemetry: { enabled: boolean };
  logger: { level: string; log: (level: "error", message: string, ...args: unknown[]) => void };
  plugins: unknown[];
};

function options(): Options {
  return mocks.betterAuth.mock.calls[0]?.[0] as Options;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUnique.mockResolvedValue({ secret: SECRET });
  mocks.getServerEnv.mockReturnValue({ DATABASE_URL: "postgresql://u:p@localhost:5432/db", NODE_ENV: "test" });
  mocks.betterAuth.mockReturnValue(INSTANCE);
  mocks.prismaAdapter.mockReturnValue("prisma-adapter");
  mocks.username.mockReturnValue({ id: "username" });
  mocks.nextCookies.mockReturnValue({ id: "next-cookies" });
  // The instance lives on `globalThis` and the module is loaded anew by every test, as after a hot reload.
  delete (globalThis as { hippowikiAuth?: unknown }).hippowikiAuth;
  vi.resetModules();
});

describe("getAuth", () => {
  it("neither reads the database nor creates an instance when the module is imported", async () => {
    await import("@/lib/auth");

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.getServerEnv).not.toHaveBeenCalled();
    expect(mocks.betterAuth).not.toHaveBeenCalled();
  });

  it("reads the stored secret and creates nothing when there is a row", async () => {
    const { getAuth } = await import("@/lib/auth");

    await expect(getAuth()).resolves.toBe(INSTANCE);

    expect(mocks.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: 1 }, select: { secret: true } });
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(options().secret).toBe(SECRET);
  });

  it("stores 32 random bytes as the single row when there is none, and reads the row again", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.createMany.mockResolvedValue({ count: 1 });
    mocks.findUniqueOrThrow.mockImplementation(() => {
      const [{ data }] = mocks.createMany.mock.calls[0] as [{ data: { secret: string }[] }];
      return Promise.resolve({ secret: data[0]?.secret });
    });
    const { getAuth } = await import("@/lib/auth");

    await getAuth();

    expect(mocks.createMany).toHaveBeenCalledExactlyOnceWith({
      data: [{ id: 1, secret: expect.stringMatching(/^[0-9a-f]{64}$/) as string }],
      skipDuplicates: true,
    });
    expect(mocks.findUniqueOrThrow).toHaveBeenCalledExactlyOnceWith({ where: { id: 1 }, select: { secret: true } });
    expect(options().secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses the secret of a row that another process inserted at the same time", async () => {
    mocks.findUnique.mockResolvedValue(null);
    // The conflict is ignored: no row was inserted by this process.
    mocks.createMany.mockResolvedValue({ count: 0 });
    mocks.findUniqueOrThrow.mockResolvedValue({ secret: SECRET });
    const { getAuth } = await import("@/lib/auth");

    await getAuth();

    expect(options().secret).toBe(SECRET);
  });

  it("creates the secret and the instance once and returns the same instance afterwards", async () => {
    const { getAuth } = await import("@/lib/auth");

    const [first, second] = await Promise.all([getAuth(), getAuth()]);
    const third = await getAuth();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(mocks.findUnique).toHaveBeenCalledOnce();
    expect(mocks.betterAuth).toHaveBeenCalledOnce();
  });

  it("keeps the instance when the module is evaluated again", async () => {
    const { getAuth } = await import("@/lib/auth");
    const first = await getAuth();

    vi.resetModules();
    const { getAuth: getAuthAfterReload } = await import("@/lib/auth");

    await expect(getAuthAfterReload()).resolves.toBe(first);
    expect(mocks.betterAuth).toHaveBeenCalledOnce();
  });

  it("tries again after the secret could not be read", async () => {
    mocks.findUnique.mockRejectedValueOnce(new Error("connection refused"));
    const { getAuth } = await import("@/lib/auth");

    await expect(getAuth()).rejects.toThrow("connection refused");
    await expect(getAuth()).resolves.toBe(INSTANCE);

    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("the options of Better Auth", () => {
  async function createdOptions(): Promise<Options> {
    const { getAuth } = await import("@/lib/auth");
    await getAuth();
    return options();
  }

  it("uses the Prisma client of the application for PostgreSQL and lets the database generate the ids", async () => {
    const { database, advanced } = await createdOptions();

    expect(mocks.prismaAdapter).toHaveBeenCalledExactlyOnceWith(db, { provider: "postgresql" });
    expect(database).toBe("prisma-adapter");
    expect(advanced.database.generateId).toBe(false);
  });

  it("enables passwords of 8 to 128 characters and disables the sign-up", async () => {
    const { emailAndPassword } = await createdOptions();

    expect(emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    });
  });

  it("hashes and verifies passwords with the password hashing of the application", async () => {
    mocks.hashPassword.mockResolvedValue("hash");
    mocks.verifyPassword.mockResolvedValue(true);
    const { password } = (await createdOptions()).emailAndPassword;

    await expect(password.hash("secret password")).resolves.toBe("hash");
    await expect(password.verify({ hash: "stored-hash", password: "secret password" })).resolves.toBe(true);

    expect(mocks.hashPassword).toHaveBeenCalledExactlyOnceWith("secret password");
    expect(mocks.verifyPassword).toHaveBeenCalledExactlyOnceWith("stored-hash", "secret password");
  });

  it("lets sessions last 30 days, never refreshes them and leaves the cookie cache off", async () => {
    const { session } = await createdOptions();

    expect(session).toStrictEqual({ expiresIn: 30 * 24 * 60 * 60, disableSessionRefresh: true });
  });

  it("reads mustChangePassword with the user and lets no input set it", async () => {
    const { user } = await createdOptions();

    expect(user.additionalFields).toStrictEqual({
      mustChangePassword: { type: "boolean", required: true, defaultValue: true, input: false },
    });
  });

  it.each([
    ["production", true],
    ["development", false],
    ["test", false],
  ])("with NODE_ENV %s, Secure cookies are %s", async (nodeEnv, secure) => {
    mocks.getServerEnv.mockReturnValue({ DATABASE_URL: "postgresql://u:p@localhost:5432/db", NODE_ENV: nodeEnv });

    expect((await createdOptions()).advanced.useSecureCookies).toBe(secure);
  });

  it("turns the telemetry off", async () => {
    expect((await createdOptions()).telemetry).toStrictEqual({ enabled: false });
  });

  it("logs the errors of Better Auth through the logger of the application, and only the errors", async () => {
    const { logger } = await createdOptions();
    const cause = new Error("database gone");

    logger.log("error", "Failed to delete session from database", cause);

    expect(logger.level).toBe("error");
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { betterAuth: [cause] },
      "Failed to delete session from database",
    );
  });

  it("uses the name rule as the validator of user names of 3 to 30 characters", async () => {
    await createdOptions();

    expect(mocks.username).toHaveBeenCalledOnce();
    const usernameOptions = mocks.username.mock.calls[0]?.[0] as {
      minUsernameLength: number;
      maxUsernameLength: number;
      usernameValidator: (name: string) => boolean;
    };
    expect(usernameOptions).toMatchObject({ minUsernameLength: 3, maxUsernameLength: 30 });
    for (const name of ["alice", "user-2", "7-of-9"]) {
      expect(usernameOptions.usernameValidator(name), name).toBe(true);
    }
    // The validator of the plugin would accept an underscore, a dot and upper case.
    for (const name of ["al_ice", "al.ice", "Alice", "-alice", "alice-", "al--ice", ""]) {
      expect(usernameOptions.usernameValidator(name), name).toBe(false);
    }
  });

  it("has nextCookies as its last plugin, after the username plugin", async () => {
    expect((await createdOptions()).plugins).toStrictEqual([{ id: "username" }, { id: "next-cookies" }]);
  });
});
