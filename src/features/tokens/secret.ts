// The generator that the codes and tokens of OAuth share, and the hash under which they are stored. Uses
// `node:crypto`, so only the server imports it.

import { createHash, randomBytes } from "node:crypto";

/** The random bytes of a secret: 256 bits. */
export const TOKEN_BYTES = 32;

/**
 * The random part of a secret as a pattern: 32 bytes in base64url without padding are 43 characters. The codes and
 * tokens of OAuth (`src/features/oauth/secret.ts`) put it behind a prefix of their own.
 */
export const SECRET_PATTERN = "[A-Za-z0-9_-]{43}";

/** A new random secret behind the given prefix: 256 bits of a cryptographic source in base64url. */
export function generateSecret(prefix: string): string {
  return prefix + randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * The hash of a secret as stored, the SHA-256 of the secret in hex. A secret has 256 random bits, so a fast hash is
 * enough: there is nothing to guess, unlike with a password, and the hash can be looked up directly.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
