// The rules for API tokens: their ids, scopes, expiry choices and the input of a new token. No server-only imports, so
// Client Components can use it.

import { z } from "zod";

/** A token id: a UUID, like the ids of users, folders, tabs and pages. */
export const tokenIdSchema = z.guid();

/** Returns the id if it is a well-formed token id, otherwise `null`, so that malformed ids never reach the database. */
export function parseTokenId(id: string): string | null {
  const result = tokenIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

/**
 * What a token may do: `read` to read content, `write` to change it. `write` does not include `read`: a token that is
 * to do both needs both scopes.
 */
export const TOKEN_SCOPES = ["read", "write"] as const;

export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** The scopes that are ticked when the "New token" form opens. */
export const DEFAULT_TOKEN_SCOPES: readonly TokenScope[] = ["read"];

/** Whether the value is one of the scopes; for the scopes read from the database. */
export function isTokenScope(value: string): value is TokenScope {
  return (TOKEN_SCOPES as readonly string[]).includes(value);
}

/** How long a new token works: the only choices, there are no other dates and no tokens that never expire. */
export const TOKEN_EXPIRIES = ["30d", "90d", "365d"] as const;

export type TokenExpiry = (typeof TOKEN_EXPIRIES)[number];

/** The expiry chosen when the "New token" form opens. */
export const DEFAULT_TOKEN_EXPIRY: TokenExpiry = "90d";

/** The days of each expiry choice. */
export const TOKEN_EXPIRY_DAYS: Record<TokenExpiry, number> = { "30d": 30, "90d": 90, "365d": 365 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a token created at `now` with the given expiry choice stops working. */
export function expiresAtFor(expiry: TokenExpiry, now: Date): Date {
  return new Date(now.getTime() + TOKEN_EXPIRY_DAYS[expiry] * DAY_MS);
}

export const TOKEN_NAME_MAX_LENGTH = 50;

/** The name of a token: any text of 1 to 50 characters, without surrounding whitespace. */
export const tokenNameSchema = z
  .string()
  .trim()
  // Abort here, so that an empty name reports only this error and not also the length error.
  .min(1, { error: "Name is required", abort: true })
  .max(TOKEN_NAME_MAX_LENGTH, `Name must be at most ${TOKEN_NAME_MAX_LENGTH} characters`);

/** The scopes of a new token: at least one, each one only once. */
export const tokenScopesSchema = z
  .array(z.enum(TOKEN_SCOPES, { error: "Unknown scope" }), { error: "Choose at least one scope" })
  .min(1, "Choose at least one scope")
  .refine((scopes) => new Set(scopes).size === scopes.length, "Choose each scope only once");

/** The expiry choice of a new token. */
export const tokenExpirySchema = z.enum(TOKEN_EXPIRIES, { error: "Choose when the token expires" });

/** Input for creating a token: its name, its scopes and its expiry choice. */
export const tokenInputSchema = z.object({
  name: tokenNameSchema,
  scopes: tokenScopesSchema,
  expiry: tokenExpirySchema,
});

/** A validated new token. */
export type TokenInput = z.output<typeof tokenInputSchema>;

export type TokenFieldErrors = { name?: string[]; scopes?: string[]; expiry?: string[] };
