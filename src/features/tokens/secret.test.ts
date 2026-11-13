import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  generateSecret,
  generateToken,
  hashToken,
  looksLikeToken,
  SECRET_PATTERN,
  TOKEN_BYTES,
  TOKEN_PREFIX,
} from "@/features/tokens/secret";

describe("generateSecret", () => {
  it("puts 32 random bytes in base64url behind the given prefix", () => {
    const secret = generateSecret("hwx_");

    expect(secret).toMatch(new RegExp(`^hwx_${SECRET_PATTERN}$`));
    expect(Buffer.from(secret.slice(4), "base64url")).toHaveLength(32);
    expect(generateSecret("hwx_")).not.toBe(secret);
  });
});

describe("generateToken", () => {
  const tokens = Array.from({ length: 500 }, generateToken);

  it("starts every token with hw_", () => {
    expect(TOKEN_PREFIX).toBe("hw_");
    for (const token of tokens) expect(token.startsWith("hw_")).toBe(true);
  });

  it("encodes 32 random bytes in base64url without padding", () => {
    expect(TOKEN_BYTES).toBe(32);
    for (const token of tokens) {
      expect(token).toHaveLength(3 + 43);
      expect(token.slice(3)).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token.slice(3), "base64url")).toHaveLength(32);
    }
  });

  it("uses the whole base64url alphabet", () => {
    const expected = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"].sort();
    // 21,500 characters: each of the 64 is missing with a probability far below 1e-100.
    expect([...new Set(tokens.map((token) => token.slice(3)).join(""))].sort()).toEqual(expected);
  });

  it("generates another token every time", () => {
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(generateToken()).not.toBe(generateToken());
  });

  it("generates tokens that look like tokens", () => {
    for (const token of tokens) expect(looksLikeToken(token)).toBe(true);
  });
});

describe("looksLikeToken", () => {
  it("refuses values that do not have the shape of a token", () => {
    const token = generateToken();
    for (const value of [
      "",
      "hw_",
      token.slice(3),
      `HW_${token.slice(3)}`,
      `xx_${token.slice(3)}`,
      token.slice(0, -1),
      `${token}A`,
      `${token.slice(0, -1)}=`,
      `${token.slice(0, -1)}+`,
      ` ${token}`,
      `${token} `,
    ]) {
      expect(looksLikeToken(value), value).toBe(false);
    }
  });
});

describe("hashToken", () => {
  it("is the SHA-256 of the token in hex", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    // Computed with `printf 'hw_abc' | shasum -a 256`.
    expect(hashToken("hw_abc")).toBe("db1b81732b5b7ec95f3c0924f76afc0e433bdf6f68bb0214d47f87b8891131ef");
  });

  it("gives the same hash for the same token and another for another token", () => {
    const [first, second] = [generateToken(), generateToken()];
    expect(hashToken(first)).toBe(hashToken(first));
    expect(hashToken(first)).not.toBe(hashToken(second));
    expect(hashToken(first)).toMatch(/^[0-9a-f]{64}$/);
  });
});
