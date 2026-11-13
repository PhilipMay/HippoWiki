// The secret of an API token and its hash, and the generator that the codes and tokens of OAuth share. Uses
// `node:crypto`, so only the server imports it.

import { createHash, randomBytes } from "node:crypto";

/** The start of every token, so that a token is recognised as one of HippoWiki, e.g. by a secret scanner. */
export const TOKEN_PREFIX = "hw_";

/** The random bytes of a token: 256 bits. */
export const TOKEN_BYTES = 32;

/**
 * The random part of a secret as a pattern: 32 bytes in base64url without padding are 43 characters. The codes and
 * tokens of OAuth (`src/features/oauth/secret.ts`) have the same random part behind another prefix.
 */
export const SECRET_PATTERN = "[A-Za-z0-9_-]{43}";

/** A token: the prefix and the random bytes in base64url without padding (43 characters). */
const TOKEN_PATTERN = new RegExp(`^${TOKEN_PREFIX}${SECRET_PATTERN}$`);

/** A new random secret behind the given prefix: 256 bits of a cryptographic source in base64url. */
export function generateSecret(prefix: string): string {
  return prefix + randomBytes(TOKEN_BYTES).toString("base64url");
}

/** A new random token. */
export function generateToken(): string {
  return generateSecret(TOKEN_PREFIX);
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
