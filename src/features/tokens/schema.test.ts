import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOKEN_EXPIRY,
  expiresAtFor,
  parseTokenId,
  TOKEN_EXPIRIES,
  TOKEN_EXPIRY_DAYS,
  TOKEN_SCOPES,
  tokenExpirySchema,
} from "@/features/tokens/schema";

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
  it("has the scopes read and write", () => {
    expect(TOKEN_SCOPES).toEqual(["read", "write"]);
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

  it("accepts the expiry choices only", () => {
    for (const expiry of TOKEN_EXPIRIES) expect(tokenExpirySchema.safeParse(expiry).success, expiry).toBe(true);
    for (const expiry of ["", "7d", "never", "90", undefined]) {
      expect(tokenExpirySchema.safeParse(expiry).success, String(expiry)).toBe(false);
    }
  });
});
