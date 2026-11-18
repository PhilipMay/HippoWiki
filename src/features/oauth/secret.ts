// The secrets of OAuth: authorization codes, access tokens and refresh tokens, and their hashes. Each has 256 random
// bits behind a prefix of its own, so that each kind is recognised by its start and never taken for another. Only
// SHA-256 hashes are stored. Uses `node:crypto`, so only the server imports it.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** The random bytes of a secret: 256 bits. */
export const SECRET_BYTES = 32;

/** The random part of a secret as a pattern: 32 bytes in base64url without padding are 43 characters. */
export const SECRET_PATTERN = "[A-Za-z0-9_-]{43}";

/** A new random secret behind the given prefix: 256 bits of a cryptographic source in base64url. */
export function generateSecret(prefix: string): string {
  return prefix + randomBytes(SECRET_BYTES).toString("base64url");
}

/** The start of an authorization code. */
const CODE_PREFIX = "hwc_";

/** The start of an access token of a grant. */
const ACCESS_TOKEN_PREFIX = "hwa_";

/** The start of a refresh token of a grant. */
const REFRESH_TOKEN_PREFIX = "hwr_";

const CODE_PATTERN = new RegExp(`^${CODE_PREFIX}${SECRET_PATTERN}$`);
const ACCESS_TOKEN_PATTERN = new RegExp(`^${ACCESS_TOKEN_PREFIX}${SECRET_PATTERN}$`);
/** A refresh token: the prefix, the id of its grant (a UUID), a dot and the random part. */
const REFRESH_TOKEN_PATTERN = new RegExp(
  `^${REFRESH_TOKEN_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.${SECRET_PATTERN}$`,
);

/** A new random authorization code. */
export function generateCode(): string {
  return generateSecret(CODE_PREFIX);
}

/** Whether the value has the shape of an authorization code; a value without it is never looked up. */
export function looksLikeCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}

/** A new random access token. */
export function generateAccessToken(): string {
  return generateSecret(ACCESS_TOKEN_PREFIX);
}

/** Whether the value has the shape of an access token; a value without it is never looked up. */
export function looksLikeAccessToken(value: string): boolean {
  return ACCESS_TOKEN_PATTERN.test(value);
}

/**
 * A new random refresh token of the grant with the given id. It names its grant, so that a refresh token that is no
 * longer the current one still leads to the grant it once belonged to, which is then revoked.
 */
export function generateRefreshToken(grantId: string): string {
  return generateSecret(`${REFRESH_TOKEN_PREFIX}${grantId}.`);
}

/** The id of the grant that a refresh token names, or `null` if the value does not have the shape of one. */
export function grantIdOfRefreshToken(value: string): string | null {
  return REFRESH_TOKEN_PATTERN.exec(value)?.[1] ?? null;
}

/**
 * The hash of a code or a token as stored: the SHA-256 in hex. Each has 256 random bits, so a fast hash is enough:
 * there is nothing to guess, unlike with a password, and the hash can be looked up directly.
 */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Whether two hashes in hex are the same, compared in constant time, so that the time of the comparison does not tell
 * how many characters of a guess were right.
 */
export function sameHash(a: string, b: string): boolean {
  const [bytesA, bytesB] = [Buffer.from(a, "hex"), Buffer.from(b, "hex")];
  return bytesA.length === bytesB.length && bytesA.length > 0 && timingSafeEqual(bytesA, bytesB);
}

/** The PKCE challenge of a verifier with the method `S256`: its SHA-256 in base64url without padding (RFC 7636). */
export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Whether the verifier belongs to the challenge (method `S256`), compared in constant time. */
export function verifiesChallenge(verifier: string, challenge: string): boolean {
  const [expected, given] = [Buffer.from(challengeOf(verifier)), Buffer.from(challenge)];
  return expected.length === given.length && timingSafeEqual(expected, given);
}
