import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  PrismaPg: vi.fn(),
  PrismaClient: vi.fn(),
  getServerEnv: vi.fn(),
}));

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: mocks.PrismaPg }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: mocks.PrismaClient }));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));

const databaseUrl = "postgresql://hippowiki:hippowiki@localhost:5432/hippowiki";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getServerEnv.mockReturnValue({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  // The client lives on `globalThis` and the module is loaded anew by every test, as after a hot reload.
  delete (globalThis as { hippowikiDb?: unknown }).hippowikiDb;
  vi.resetModules();
});

describe("getDb", () => {
  it("neither reads the environment nor creates a client when the module is imported", async () => {
    await import("@/lib/db");

    expect(mocks.getServerEnv).not.toHaveBeenCalled();
    expect(mocks.PrismaPg).not.toHaveBeenCalled();
    expect(mocks.PrismaClient).not.toHaveBeenCalled();
  });

  it("creates the client on first use, connecting to DATABASE_URL with a connection timeout", async () => {
    const { getDb } = await import("@/lib/db");

    const db = getDb();

    expect(mocks.PrismaPg).toHaveBeenCalledExactlyOnceWith({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5_000,
    });
    expect(mocks.PrismaClient).toHaveBeenCalledExactlyOnceWith({ adapter: mocks.PrismaPg.mock.instances[0] });
    expect(db).toBe(mocks.PrismaClient.mock.instances[0]);
  });

  it("returns the same client on every call", async () => {
    const { getDb } = await import("@/lib/db");

    expect(getDb()).toBe(getDb());
    expect(mocks.PrismaClient).toHaveBeenCalledOnce();
  });

  it("keeps the client when the module is evaluated again, as on a hot reload", async () => {
    const first = (await import("@/lib/db")).getDb();

    vi.resetModules();
    const reloaded = await import("@/lib/db");

    expect(reloaded.getDb()).toBe(first);
    expect(mocks.PrismaClient).toHaveBeenCalledOnce();
  });
});
