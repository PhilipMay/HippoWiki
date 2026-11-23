import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FILE_LINK_LIFETIME,
  FILE_SIZE_LIMIT,
  MCP_BODY_LIMIT,
  MCP_RATE_BURST,
  MCP_RATE_PER_MINUTE,
  parseServerEnv,
} from "@/lib/env";

const databaseUrl = "postgresql://hippowiki:hippowiki@localhost:5432/hippowiki";

describe("parseServerEnv", () => {
  it("accepts a valid environment", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl, NODE_ENV: "production" })).toEqual({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      HIPPOWIKI_LOG_CLIENT_ADDRESS: false,
      HIPPOWIKI_TRUSTED_PROXIES: 0,
      HIPPOWIKI_MCP_BODY_LIMIT: 1_048_576,
      HIPPOWIKI_MCP_RATE_BURST: 60,
      HIPPOWIKI_MCP_RATE_PER_MINUTE: 300,
      HIPPOWIKI_FILE_SIZE_LIMIT: 26_214_400,
      HIPPOWIKI_FILE_LINK_LIFETIME: 600,
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

  it("trusts no reverse proxy by default", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl }).HIPPOWIKI_TRUSTED_PROXIES).toBe(0);
  });

  it.each(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"])(
    "reads HIPPOWIKI_TRUSTED_PROXIES=%s as its number",
    (value) => {
      expect(
        parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_TRUSTED_PROXIES: value }).HIPPOWIKI_TRUSTED_PROXIES,
      ).toBe(Number(value));
    },
  );

  it.each(["-1", "1.5", "10", "one", "", " 1"])("rejects HIPPOWIKI_TRUSTED_PROXIES=%j", (value) => {
    expect(() => parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_TRUSTED_PROXIES: value })).toThrow(
      /HIPPOWIKI_TRUSTED_PROXIES/,
    );
  });

  it("has no public URL by default", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl }).HIPPOWIKI_PUBLIC_URL).toBeUndefined();
  });

  it.each([
    ["https://wiki.example.com", "https://wiki.example.com"],
    ["https://wiki.example.com/", "https://wiki.example.com"],
    ["https://wiki.example.com:8443", "https://wiki.example.com:8443"],
    ["https://wiki.example.com:443", "https://wiki.example.com"],
    ["HTTPS://Wiki.Example.com", "https://wiki.example.com"],
    ["https://localhost", "https://localhost"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3100/", "http://127.0.0.1:3100"],
    ["http://[::1]:3000", "http://[::1]:3000"],
  ])("reads HIPPOWIKI_PUBLIC_URL=%s as the origin %s", (value, origin) => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_PUBLIC_URL: value }).HIPPOWIKI_PUBLIC_URL).toBe(
      origin,
    );
  });

  it.each([
    "",
    " https://wiki.example.com",
    "https://wiki.example.com ",
    "wiki.example.com",
    "http://wiki.example.com",
    "http://192.168.1.10:3000",
    "http://localhost.example.com",
    "ftp://wiki.example.com",
    "https://user@wiki.example.com",
    "https://user:secret@wiki.example.com",
    "https://wiki.example.com/wiki",
    "https://wiki.example.com//",
    "https://wiki.example.com/?",
    "https://wiki.example.com/?a=1",
    "https://wiki.example.com/#",
    "https://wiki.example.com/#top",
    "not a url",
  ])("rejects HIPPOWIKI_PUBLIC_URL=%j", (value) => {
    expect(() => parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_PUBLIC_URL: value })).toThrow(
      /HIPPOWIKI_PUBLIC_URL/,
    );
  });

  describe("the limits of MCP", () => {
    it("has the defaults of 1 MiB, 60 at once and 300 per minute without the variables", () => {
      const env = parseServerEnv({ DATABASE_URL: databaseUrl });

      expect(env.HIPPOWIKI_MCP_BODY_LIMIT).toBe(1_048_576);
      expect(env.HIPPOWIKI_MCP_RATE_BURST).toBe(60);
      expect(env.HIPPOWIKI_MCP_RATE_PER_MINUTE).toBe(300);
      expect([MCP_BODY_LIMIT.default, MCP_RATE_BURST.default, MCP_RATE_PER_MINUTE.default]).toEqual([
        1_048_576, 60, 300,
      ]);
    });

    const VARIABLES = [
      ["HIPPOWIKI_MCP_BODY_LIMIT", 1_048_576, 16_777_216],
      ["HIPPOWIKI_MCP_RATE_BURST", 1, 10_000],
      ["HIPPOWIKI_MCP_RATE_PER_MINUTE", 1, 100_000],
    ] as const;

    describe.each(VARIABLES)("%s", (name, min, max) => {
      it.each([min, max, min + 1])("accepts %i", (value) => {
        expect(parseServerEnv({ DATABASE_URL: databaseUrl, [name]: String(value) })[name]).toBe(value);
      });

      it.each([String(min - 1), String(max + 1), "1.5", "1e6", "+60", " 60", "60 ", "1MiB", "060", "-1", "0x10", ""])(
        "refuses %j with an error that names the variable",
        (value) => {
          expect(() => parseServerEnv({ DATABASE_URL: databaseUrl, [name]: value })).toThrow(new RegExp(name));
        },
      );
    });

    it.each(["HIPPOWIKI_MCP_RATE_BURST", "HIPPOWIKI_MCP_RATE_PER_MINUTE"])(
      "refuses 0 for %s, so that the rate limit cannot be switched off",
      (name) => {
        expect(() => parseServerEnv({ DATABASE_URL: databaseUrl, [name]: "0" })).toThrow(new RegExp(name));
      },
    );
  });

  describe("the files", () => {
    it("has no files directory and a size limit of 25 MiB without the variables", () => {
      const env = parseServerEnv({ DATABASE_URL: databaseUrl });

      expect(env.HIPPOWIKI_FILES_DIR).toBeUndefined();
      expect(env.HIPPOWIKI_FILE_SIZE_LIMIT).toBe(26_214_400);
      expect(FILE_SIZE_LIMIT).toEqual({ min: 1_048_576, max: 1_073_741_824, default: 26_214_400 });
    });

    it("takes the files directory as a path, relative or absolute", () => {
      for (const path of ["files", "/data/files", "./data/files"]) {
        expect(parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_FILES_DIR: path }).HIPPOWIKI_FILES_DIR).toBe(path);
      }
    });

    it("refuses an empty files directory with an error that names the variable", () => {
      expect(() => parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_FILES_DIR: "" })).toThrow(
        /HIPPOWIKI_FILES_DIR/,
      );
    });

    it.each([1_048_576, 1_073_741_824, 52_428_800])("accepts a size limit of %i", (value) => {
      expect(
        parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_FILE_SIZE_LIMIT: String(value) })
          .HIPPOWIKI_FILE_SIZE_LIMIT,
      ).toBe(value);
    });

    it.each(["1048575", "1073741825", "25MiB", "25e6", " 26214400", "026214400", "-1", ""])(
      "refuses the size limit %j with an error that names the variable",
      (value) => {
        expect(() => parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_FILE_SIZE_LIMIT: value })).toThrow(
          /HIPPOWIKI_FILE_SIZE_LIMIT/,
        );
      },
    );
  });

  describe("the lifetime of the links to files", () => {
    it("is 600 seconds without the variable", () => {
      expect(parseServerEnv({ DATABASE_URL: databaseUrl }).HIPPOWIKI_FILE_LINK_LIFETIME).toBe(600);
      expect(FILE_LINK_LIFETIME).toEqual({ min: 60, max: 3600, default: 600 });
    });

    it.each([60, 3600, 900])("accepts %i", (value) => {
      expect(
        parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_FILE_LINK_LIFETIME: String(value) })
          .HIPPOWIKI_FILE_LINK_LIFETIME,
      ).toBe(value);
    });

    it.each(["59", "3601", "0", "10m", "", "600.0", " 600", "0600", "-60"])(
      "refuses %j with an error that names the variable",
      (value) => {
        expect(() => parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_FILE_LINK_LIFETIME: value })).toThrow(
          /HIPPOWIKI_FILE_LINK_LIFETIME/,
        );
      },
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
      HIPPOWIKI_TRUSTED_PROXIES: 0,
      HIPPOWIKI_MCP_BODY_LIMIT: 1_048_576,
      HIPPOWIKI_MCP_RATE_BURST: 60,
      HIPPOWIKI_MCP_RATE_PER_MINUTE: 300,
      HIPPOWIKI_FILE_SIZE_LIMIT: 26_214_400,
      HIPPOWIKI_FILE_LINK_LIFETIME: 600,
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
