import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateSecret, hashToken, SECRET_PATTERN, TOKEN_BYTES } from "@/features/tokens/secret";

describe("generateSecret", () => {
  const secrets = Array.from({ length: 500 }, () => generateSecret("hwx_"));

  it("puts 32 random bytes in base64url without padding behind the given prefix", () => {
    expect(TOKEN_BYTES).toBe(32);
    for (const secret of secrets) {
      expect(secret).toMatch(new RegExp(`^hwx_${SECRET_PATTERN}$`));
      expect(secret).toHaveLength(4 + 43);
      expect(Buffer.from(secret.slice(4), "base64url")).toHaveLength(32);
    }
  });

  it("uses the whole base64url alphabet", () => {
    const expected = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"].sort();
    // 21,500 characters: each of the 64 is missing with a probability far below 1e-100.
    expect([...new Set(secrets.map((secret) => secret.slice(4)).join(""))].sort()).toEqual(expected);
  });

  it("generates another secret every time", () => {
    expect(new Set(secrets).size).toBe(secrets.length);
  });
});

describe("hashToken", () => {
  it("is the SHA-256 of the secret in hex", () => {
    const secret = generateSecret("hwx_");
    expect(hashToken(secret)).toBe(createHash("sha256").update(secret).digest("hex"));
    // Computed with `printf 'hw_abc' | shasum -a 256`.
    expect(hashToken("hw_abc")).toBe("db1b81732b5b7ec95f3c0924f76afc0e433bdf6f68bb0214d47f87b8891131ef");
  });

  it("gives the same hash for the same secret and another for another secret", () => {
    const [first, second] = [generateSecret("hwx_"), generateSecret("hwx_")];
    expect(hashToken(first)).toBe(hashToken(first));
    expect(hashToken(first)).not.toBe(hashToken(second));
    expect(hashToken(first)).toMatch(/^[0-9a-f]{64}$/);
  });
});
