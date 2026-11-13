// The secret of an API token and its hash. Uses `node:crypto`, so only the server imports it.

import { createHash, randomBytes } from "node:crypto";

/** The start of every token, so that a token is recognised as one of HippoWiki, e.g. by a secret scanner. */
export const TOKEN_PREFIX = "hw_";

/** The random bytes of a token: 256 bits. */
export const TOKEN_BYTES = 32;

/** A token: the prefix and the random bytes in base64url without padding (43 characters). */
const TOKEN_PATTERN = /^hw_[A-Za-z0-9_-]{43}$/;

/** A new random token. */
export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Whether the value has the shape of a token; a value without it is never looked up. */
export function looksLikeToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/**
 * The hash of a token as stored, the SHA-256 of the token in hex. A token has 256 random bits, so a fast hash is
 * enough: there is nothing to guess, unlike with a password, and the hash can be looked up directly.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
