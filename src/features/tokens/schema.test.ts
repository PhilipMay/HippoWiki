import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DEFAULT_TOKEN_EXPIRY,
  DEFAULT_TOKEN_SCOPES,
  expiresAtFor,
  isTokenScope,
  parseTokenId,
  TOKEN_EXPIRIES,
  TOKEN_EXPIRY_DAYS,
  TOKEN_SCOPES,
  tokenInputSchema,
} from "@/features/tokens/schema";

const VALID = { name: "MCP client", scopes: ["read"], expiry: "90d" };

/** The field errors of an input that the schema rejects; an empty object when it accepts the input. */
function fieldErrorsOf(input: unknown): Record<string, string[] | undefined> {
  const result = tokenInputSchema.safeParse(input);
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
}

describe("parseTokenId", () => {
  it("returns a well-formed id", () => {
    const id = crypto.randomUUID();
    expect(parseTokenId(id)).toBe(id);
  });

  it("returns null for a malformed id", () => {
    for (const id of ["", "not-a-uuid", "hw_token", `${crypto.randomUUID()}x`, ` ${crypto.randomUUID()}`]) {
      expect(parseTokenId(id), id).toBeNull();
    }
  });
});

describe("scopes and expiry choices", () => {
  it("has the scopes read and write, with read as default", () => {
    expect(TOKEN_SCOPES).toEqual(["read", "write"]);
    expect(DEFAULT_TOKEN_SCOPES).toEqual(["read"]);
  });

  it("recognises the scopes only", () => {
    expect(isTokenScope("read")).toBe(true);
    expect(isTokenScope("write")).toBe(true);
    for (const scope of ["", "admin", "READ", " read"]) expect(isTokenScope(scope), scope).toBe(false);
  });

  it("has 30, 90 and 365 days, with 90 days as default", () => {
    expect(TOKEN_EXPIRIES).toEqual(["30d", "90d", "365d"]);
    expect(TOKEN_EXPIRY_DAYS).toEqual({ "30d": 30, "90d": 90, "365d": 365 });
    expect(DEFAULT_TOKEN_EXPIRY).toBe("90d");
  });

  it("computes the expiry from the creation time", () => {
    const now = new Date("2026-01-01T10:00:00.000Z");
    expect(expiresAtFor("30d", now)).toEqual(new Date("2026-01-31T10:00:00.000Z"));
    expect(expiresAtFor("90d", now)).toEqual(new Date("2026-04-01T10:00:00.000Z"));
    expect(expiresAtFor("365d", now)).toEqual(new Date("2027-01-01T10:00:00.000Z"));
  });
});

describe("tokenInputSchema", () => {
  it("accepts a valid input and trims the name", () => {
    expect(tokenInputSchema.parse({ ...VALID, name: "  MCP client  " })).toEqual(VALID);
  });

  it("accepts any characters in the name, up to 50", () => {
    for (const name of ["a", "Laptop – Claude Desktop", "ü".repeat(50), "x".repeat(50)]) {
      expect(fieldErrorsOf({ ...VALID, name }), name).toEqual({});
    }
  });

  it("requires a name", () => {
    for (const name of ["", "   "]) expect(fieldErrorsOf({ ...VALID, name })).toEqual({ name: ["Name is required"] });
  });

  it("refuses a name of more than 50 characters", () => {
    expect(fieldErrorsOf({ ...VALID, name: "x".repeat(51) })).toEqual({
      name: ["Name must be at most 50 characters"],
    });
  });

  it("accepts each scope and both", () => {
    for (const scopes of [["read"], ["write"], ["read", "write"], ["write", "read"]]) {
      expect(fieldErrorsOf({ ...VALID, scopes }), scopes.join()).toEqual({});
    }
  });

  it("requires at least one scope", () => {
    expect(fieldErrorsOf({ ...VALID, scopes: [] })).toEqual({ scopes: ["Choose at least one scope"] });
    expect(fieldErrorsOf({ ...VALID, scopes: undefined })).toEqual({ scopes: ["Choose at least one scope"] });
  });

  it("refuses an unknown scope and a scope twice", () => {
    expect(fieldErrorsOf({ ...VALID, scopes: ["admin"] })).toEqual({ scopes: ["Unknown scope"] });
    expect(fieldErrorsOf({ ...VALID, scopes: ["read", "read"] })).toEqual({ scopes: ["Choose each scope only once"] });
  });

  it("accepts the expiry choices only", () => {
    for (const expiry of TOKEN_EXPIRIES) expect(fieldErrorsOf({ ...VALID, expiry }), expiry).toEqual({});
    for (const expiry of ["", "7d", "never", "90", undefined]) {
      expect(fieldErrorsOf({ ...VALID, expiry }), String(expiry)).toEqual({
        expiry: ["Choose when the token expires"],
      });
    }
  });

  it("reports the errors of all fields together", () => {
    expect(fieldErrorsOf({ name: "", scopes: [], expiry: "" })).toEqual({
      name: ["Name is required"],
      scopes: ["Choose at least one scope"],
      expiry: ["Choose when the token expires"],
    });
  });
});
