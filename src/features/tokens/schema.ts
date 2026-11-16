// The rules for grants: their ids, scopes and the expiry choices of the consent page. No server-only imports, so
// Client Components can use it.

import { z } from "zod";

/** A grant id: a UUID, like the ids of users, folders, tabs and pages. */
export const tokenIdSchema = z.guid();

/** Returns the id if it is a well-formed grant id, otherwise `null`, so that malformed ids never reach the database. */
export function parseTokenId(id: string): string | null {
  const result = tokenIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

/**
 * What the access token of a grant may do: `read` to read content, `write` to change it. `write` does not include
 * `read`. Every grant has only `read`; `write` is asked for by no caller yet.
 */
export const TOKEN_SCOPES = ["read", "write"] as const;

export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** How long a grant lasts: the only choices, there are no other dates and no grants that never expire. */
export const TOKEN_EXPIRIES = ["30d", "90d", "365d"] as const;

export type TokenExpiry = (typeof TOKEN_EXPIRIES)[number];

/** The expiry chosen when the consent page opens. */
export const DEFAULT_TOKEN_EXPIRY: TokenExpiry = "90d";

/** The days of each expiry choice. */
export const TOKEN_EXPIRY_DAYS: Record<TokenExpiry, number> = { "30d": 30, "90d": 90, "365d": 365 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a grant made at `now` with the given expiry choice ends. */
export function expiresAtFor(expiry: TokenExpiry, now: Date): Date {
  return new Date(now.getTime() + TOKEN_EXPIRY_DAYS[expiry] * DAY_MS);
}

/** The expiry choice of a grant. */
export const tokenExpirySchema = z.enum(TOKEN_EXPIRIES, { error: "Choose when the token expires" });
