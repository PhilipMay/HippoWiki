import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  challengeOf,
  generateAccessToken,
  generateCode,
  generateRefreshToken,
  grantIdOfRefreshToken,
  hashSecret,
  looksLikeAccessToken,
  looksLikeCode,
  sameHash,
  verifiesChallenge,
} from "@/features/oauth/secret";
import { generateToken, hashToken, looksLikeToken } from "@/features/tokens/secret";

const GRANT_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";

describe("the secrets", () => {
  it("start with a prefix of their own and carry 32 random bytes", () => {
    const [code, accessToken, refreshToken] = [generateCode(), generateAccessToken(), generateRefreshToken(GRANT_ID)];

    expect(code).toMatch(/^hwc_[A-Za-z0-9_-]{43}$/);
    expect(accessToken).toMatch(/^hwa_[A-Za-z0-9_-]{43}$/);
    expect(refreshToken).toMatch(new RegExp(`^hwr_${GRANT_ID}\\.[A-Za-z0-9_-]{43}$`));
    for (const secret of [code, accessToken, refreshToken]) {
      expect(Buffer.from(secret.slice(-43), "base64url")).toHaveLength(32);
    }
  });

  it("are different every time", () => {
    expect(generateCode()).not.toBe(generateCode());
    expect(generateAccessToken()).not.toBe(generateAccessToken());
    expect(generateRefreshToken(GRANT_ID)).not.toBe(generateRefreshToken(GRANT_ID));
  });

  it("are never taken for one another, or for an API token", () => {
    const secrets = {
      code: generateCode(),
      accessToken: generateAccessToken(),
      refreshToken: generateRefreshToken(GRANT_ID),
      token: generateToken(),
    };

    expect(Object.values(secrets).map(looksLikeCode)).toEqual([true, false, false, false]);
    expect(Object.values(secrets).map(looksLikeAccessToken)).toEqual([false, true, false, false]);
    expect(Object.values(secrets).map((secret) => grantIdOfRefreshToken(secret) !== null)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(Object.values(secrets).map(looksLikeToken)).toEqual([false, false, false, true]);
  });

  it.each([
    "",
    "hwa_",
    `hwa_${"A".repeat(42)}`,
    `hwa_${"A".repeat(44)}`,
    `hwa_${"A".repeat(42)}=`,
    ` hwa_${"A".repeat(43)}`,
  ])("%j does not look like an access token", (value) => {
    expect(looksLikeAccessToken(value)).toBe(false);
  });
});

describe("grantIdOfRefreshToken", () => {
  it("returns the id of the grant that the token names", () => {
    expect(grantIdOfRefreshToken(generateRefreshToken(GRANT_ID))).toBe(GRANT_ID);
  });

  it.each([
    ["no grant id", `hwr_${"A".repeat(43)}`],
    ["a grant id that is no UUID", `hwr_not-a-uuid.${"A".repeat(43)}`],
    ["a grant id in upper case", `hwr_${GRANT_ID.toUpperCase()}.${"A".repeat(43)}`],
    ["no dot", `hwr_${GRANT_ID}${"A".repeat(43)}`],
    ["a random part that is too short", `hwr_${GRANT_ID}.${"A".repeat(42)}`],
    ["something after the random part", `hwr_${GRANT_ID}.${"A".repeat(43)}.more`],
    ["another prefix", `hwa_${GRANT_ID}.${"A".repeat(43)}`],
    ["an empty text", ""],
  ])("returns null for %s", (_case, value) => {
    expect(grantIdOfRefreshToken(value)).toBeNull();
  });
});

describe("hashSecret and sameHash", () => {
  it("hashes with SHA-256 in hex, like an API token", () => {
    const code = generateCode();

    expect(hashSecret(code)).toBe(createHash("sha256").update(code).digest("hex"));
    expect(hashSecret(code)).toBe(hashToken(code));
    expect(hashSecret(code)).toHaveLength(64);
  });

  it("tells the same hash from another one", () => {
    const [a, b] = [hashSecret("one"), hashSecret("two")];

    expect(sameHash(a, a)).toBe(true);
    expect(sameHash(a, hashSecret("one"))).toBe(true);
    expect(sameHash(a, b)).toBe(false);
  });

  it("never throws for hashes of other lengths or texts that are no hashes", () => {
    const hash = hashSecret("one");

    expect(sameHash(hash, hash.slice(0, 32))).toBe(false);
    expect(sameHash(hash, "")).toBe(false);
    expect(sameHash("", "")).toBe(false);
    expect(sameHash(hash, "not a hash")).toBe(false);
  });
});

describe("PKCE", () => {
  // The example of RFC 7636, appendix B.
  const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("computes the challenge of a verifier as its SHA-256 in base64url", () => {
    expect(challengeOf(VERIFIER)).toBe(CHALLENGE);
  });

  it("accepts the verifier of a challenge", () => {
    expect(verifiesChallenge(VERIFIER, CHALLENGE)).toBe(true);
  });

  it.each([
    ["another verifier", `${VERIFIER.slice(0, -1)}x`, CHALLENGE],
    ["the challenge sent as the verifier (method plain)", CHALLENGE, CHALLENGE],
    ["a challenge of another length", VERIFIER, CHALLENGE.slice(0, -1)],
    ["an empty challenge", VERIFIER, ""],
    ["an empty verifier", "", CHALLENGE],
  ])("refuses %s", (_case, verifier, challenge) => {
    expect(verifiesChallenge(verifier, challenge)).toBe(false);
  });
});
