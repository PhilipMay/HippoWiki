import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

const databaseUrl = "postgresql://hippowiki:hippowiki@localhost:5432/hippowiki";

describe("parseServerEnv", () => {
  it("accepts a valid environment", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl, NODE_ENV: "production" })).toEqual({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
    });
  });

  it("accepts the postgres:// scheme", () => {
    const url = "postgres://user:secret@db.example.com:5432/wiki";
    expect(parseServerEnv({ DATABASE_URL: url, NODE_ENV: "test" }).DATABASE_URL).toBe(url);
  });

  it("defaults NODE_ENV to development", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl }).NODE_ENV).toBe("development");
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
