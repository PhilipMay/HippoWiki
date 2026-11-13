import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseServerEnv } from "@/lib/env";

const databaseUrl = "postgresql://hippowiki:hippowiki@localhost:5432/hippowiki";

describe("parseServerEnv", () => {
  it("accepts a valid environment", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl, NODE_ENV: "production" })).toEqual({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      HIPPOWIKI_LOG_CLIENT_ADDRESS: false,
    });
  });

  it("accepts the postgres:// scheme", () => {
    const url = "postgres://user:secret@db.example.com:5432/wiki";
    expect(parseServerEnv({ DATABASE_URL: url, NODE_ENV: "test" }).DATABASE_URL).toBe(url);
  });

  it("defaults NODE_ENV to development", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl }).NODE_ENV).toBe("development");
  });

  it("switches the client address probe off by default", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl }).HIPPOWIKI_LOG_CLIENT_ADDRESS).toBe(false);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("reads HIPPOWIKI_LOG_CLIENT_ADDRESS=%s as %s", (value, expected) => {
    expect(
      parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_LOG_CLIENT_ADDRESS: value }).HIPPOWIKI_LOG_CLIENT_ADDRESS,
    ).toBe(expected);
  });

  it.each(["1", "yes", "TRUE", ""])("rejects HIPPOWIKI_LOG_CLIENT_ADDRESS=%j", (value) => {
    expect(() => parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_LOG_CLIENT_ADDRESS: value })).toThrow(
      /HIPPOWIKI_LOG_CLIENT_ADDRESS/,
    );
  });

  it("ignores unrelated variables", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl, HOME: "/home/someone" })).not.toHaveProperty("HOME");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseServerEnv({ NODE_ENV: "development" })).toThrow(/DATABASE_URL/);
  });

  it("rejects a DATABASE_URL that is not a URL", () => {
    expect(() => parseServerEnv({ DATABASE_URL: "not a url" })).toThrow(/DATABASE_URL/);
  });

  it("rejects a DATABASE_URL with another scheme", () => {
    expect(() => parseServerEnv({ DATABASE_URL: "http://localhost:5432/hippowiki" })).toThrow(/DATABASE_URL/);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseServerEnv({ DATABASE_URL: databaseUrl, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});

describe("getServerEnv", () => {
  // The module keeps the validated environment, so every test loads a fresh copy of it.
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the validated environment from process.env", async () => {
    vi.stubEnv("DATABASE_URL", databaseUrl);
    vi.stubEnv("NODE_ENV", "production");
    const { getServerEnv } = await import("@/lib/env");

    expect(getServerEnv()).toEqual({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      HIPPOWIKI_LOG_CLIENT_ADDRESS: false,
    });
  });

  it("validates on first use, not when the module is imported", async () => {
    vi.stubEnv("DATABASE_URL", "not a url");
    const { getServerEnv } = await import("@/lib/env");

    expect(() => getServerEnv()).toThrow(/Invalid server environment[^]*DATABASE_URL/);
  });

  it("validates once and keeps the result", async () => {
    vi.stubEnv("DATABASE_URL", databaseUrl);
    const { getServerEnv } = await import("@/lib/env");
    const env = getServerEnv();

    vi.stubEnv("DATABASE_URL", "not a url");

    expect(getServerEnv()).toBe(env);
  });
});
