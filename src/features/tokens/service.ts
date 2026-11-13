// The reads and writes of API tokens. The service knows nothing about Next.js, forms or addresses, so that the GUI
// (through `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request.
//
// Every function that lists or changes tokens takes the acting user first and only ever touches the actor's own
// tokens: nobody, the admin included, sees or revokes the tokens of another user. `authenticateToken()` is the other
// way round: it finds the actor of a request from its bearer token. A token leaves the service only once, when it is
// created; only its hash is stored, and neither is ever logged.
//
// A row of `ApiToken` is either a token created here or the grant of the user to an OAuth client, which the OAuth
// service creates (`src/features/oauth/service.ts`). A grant is listed, counted in the limit and revoked like a token.

import { z } from "zod";

import { looksLikeAccessToken } from "@/features/oauth/secret";
import {
  expiresAtFor,
  isTokenScope,
  parseTokenId,
  tokenInputSchema,
  type TokenFieldErrors,
  type TokenScope,
} from "@/features/tokens/schema";
import { generateToken, hashToken, looksLikeToken } from "@/features/tokens/secret";
import { parseUserId } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import { getDb } from "@/lib/db";
import { API_TOKEN_HASH, isUniqueViolation } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import type { Result } from "@/lib/result";

/** How many tokens a user may hold, expired ones included. */
export const MAX_TOKENS_PER_USER = 20;

/** A token as the token list shows it; never the token or its hash. */
export type TokenSummary = {
  id: string;
  /** The name the user gave the token; for a grant, the name of the app it was given to. */
  name: string;
  scopes: TokenScope[];
  createdAt: Date;
  expiresAt: Date;
  /** When the token was last used, to the minute; `null` if it was never used. */
  lastUsedAt: Date | null;
  /**
   * Whether the row is a grant to an OAuth client, a connected app, instead of a token created on the account page.
   * A grant has no token to show: the app holds its tokens itself.
   */
  isGrant: boolean;
};

/** The columns of a token that make up a `TokenSummary`. */
const TOKEN_SUMMARY_SELECT = {
  id: true,
  name: true,
  scopes: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
  clientId: true,
} as const;

type TokenSummaryRow = Omit<TokenSummary, "scopes" | "isGrant"> & { scopes: string[]; clientId: string | null };

function toTokenSummary({
  id,
  name,
  scopes,
  createdAt,
  expiresAt,
  lastUsedAt,
  clientId,
}: TokenSummaryRow): TokenSummary {
  return {
    id,
    name,
    scopes: scopes.filter(isTokenScope),
    createdAt,
    expiresAt,
    lastUsedAt,
    isGrant: clientId !== null,
  };
}

/** The current time. The one place the service takes it from, so that tests can set the clock. */
function currentTime(): Date {
  return new Date();
}

/**
 * The id of the actor, or `null` if it is malformed, which is logged: the adapters take the actor from a valid
 * session, so only a broken caller passes a malformed id.
 */
function actorIdOf(actor: Actor): string | null {
  const id = parseUserId(actor.id);
  if (!id) logger.error({ actorId: actor.id }, "malformed actor id");
  return id;
}

/** The actor's tokens and grants to OAuth clients, newest first. A malformed actor id has no tokens. */
export async function listTokens(actor: Actor): Promise<TokenSummary[]> {
  const userId = parseUserId(actor.id);
  if (!userId) return [];
  const tokens = await getDb().apiToken.findMany({
    where: { userId },
    select: TOKEN_SUMMARY_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return tokens.map(toTokenSummary);
}

/**
 * A token that was just created, with the token itself. The token leaves the service this once and is stored nowhere:
 * only its hash is in the database.
 */
export type CreatedToken = { token: TokenSummary; secret: string };

type InvalidToken = { code: "invalid-input"; fieldErrors: TokenFieldErrors };
/** The actor already holds the most tokens a user may hold; nothing was written. */
type LimitReached = { code: "limit-reached" };
type TokenNotFound = { code: "token-not-found" };
/** An unexpected database error, or an actor that is malformed or does not exist; it has been logged. */
type Failed = { code: "failed" };

/** The request has no `Authorization` header with a bearer token, or its value does not look like a token. */
type MissingToken = { code: "missing-token" };
/** The token is unknown or expired, or its user still has the first password. */
type BadToken = { code: "invalid-token" };
/** The token is valid but lacks the scope that was asked for. */
type InsufficientScope = { code: "insufficient-scope" };

export type CreateTokenError = InvalidToken | LimitReached | Failed;
export type RevokeTokenError = TokenNotFound | Failed;
export type AuthenticateTokenError = MissingToken | BadToken | InsufficientScope | Failed;

/** Thrown inside the transaction of `createToken` when the actor has no row; rolls it back. */
class ActorNotFoundError extends Error {}

/**
 * Creates a token for the actor with the given name, scopes and expiry choice, and returns it together with the token
 * itself, which is shown this once. It checks the actor's id, then the input, then the limit, and writes.
 */
export async function createToken(
  actor: Actor,
  input: { name: string; scopes: string[]; expiry: string },
): Promise<Result<CreatedToken, CreateTokenError>> {
  const userId = actorIdOf(actor);
  if (!userId) return { ok: false, error: { code: "failed" } };

  const parsed = tokenInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-input", fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  const { name, scopes, expiry } = parsed.data;

  const secret = generateToken();
  const expiresAt = expiresAtFor(expiry, currentTime());

  let token: TokenSummary | null;
  try {
    token = await getDb().$transaction(async (tx) => {
      // Locks the actor's row, so that two tokens created at the same time cannot both pass the limit. It also tells a
      // missing actor from a missing token.
      const users = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      if (users.length === 0) throw new ActorNotFoundError();
      if ((await tx.apiToken.count({ where: { userId } })) >= MAX_TOKENS_PER_USER) return null;
      const created = await tx.apiToken.create({
        data: { userId, name, scopes, tokenHash: hashToken(secret), expiresAt },
        select: TOKEN_SUMMARY_SELECT,
      });
      return toTokenSummary(created);
    });
  } catch (err) {
    if (err instanceof ActorNotFoundError) {
      logger.error({ userId }, "actor of new token not found");
      return { ok: false, error: { code: "failed" } };
    }
    if (isUniqueViolation(err, API_TOKEN_HASH)) {
      // 256 random bits do not repeat; the generator is broken.
      logger.error({ userId }, "hash of new token already in use");
      return { ok: false, error: { code: "failed" } };
    }
    logger.error({ err, userId }, "failed to create token");
    return { ok: false, error: { code: "failed" } };
  }

  if (!token) {
    logger.warn({ userId }, "token not created: the user holds the most tokens allowed");
    return { ok: false, error: { code: "limit-reached" } };
  }

  logger.info({ userId, tokenId: token.id }, "token created");
  return { ok: true, value: { token, secret } };
}

/**
 * Revokes the actor's token with the given id: deletes it, so that it stops working at once. A grant to an OAuth
 * client is revoked the same way, which ends its access token and its refresh token together. A malformed id, an
 * unknown one and the token of another user all give `token-not-found`; only the log tells the last two from the
 * first.
 */
export async function revokeToken(actor: Actor, id: string): Promise<Result<{ id: string }, RevokeTokenError>> {
  const userId = actorIdOf(actor);
  if (!userId) return { ok: false, error: { code: "failed" } };

  const tokenId = parseTokenId(id);
  if (!tokenId) return { ok: false, error: { code: "token-not-found" } };

  let count: number;
  try {
    ({ count } = await getDb().apiToken.deleteMany({ where: { id: tokenId, userId } }));
  } catch (err) {
    logger.error({ err, userId, tokenId }, "failed to revoke token");
    return { ok: false, error: { code: "failed" } };
  }

  if (count === 0) {
    logger.warn({ userId, tokenId }, "token to revoke not found");
    return { ok: false, error: { code: "token-not-found" } };
  }

  logger.info({ userId, tokenId }, "token revoked");
  return { ok: true, value: { id: tokenId } };
}

/** How often the last use of a token is written at most, so that a burst of requests does not write on every one. */
export const LAST_USE_INTERVAL_MS = 60 * 1000;

/**
 * The bearer token of an `Authorization` header, or `null` without one. The scheme is matched without regard to case,
 * as RFC 6750 allows, and may be followed by more than one space.
 */
function bearerTokenOf(headers: Headers): string | null {
  const match = /^bearer +(\S+) *$/i.exec(headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

/** What `authenticateToken()` accepts besides API tokens. */
export type AuthenticateTokenOptions = {
  /**
   * Whether the access token of a grant to an OAuth client is accepted as well. Off unless a caller asks for it, so
   * that only the MCP endpoint accepts such tokens.
   */
  acceptOAuth?: boolean;
};

/**
 * Who a request acts for, from the bearer token in its `Authorization` header: the actor of the token's user, if the
 * token is valid and has the given scope. It is for callers other than the browser, such as the MCP server; the
 * browser uses the session (`src/features/auth/session.ts`).
 *
 * - `missing-token`: no header, another scheme, or a value that does not look like a token; the database is not asked
 *   and nothing is logged. Without `acceptOAuth`, an OAuth access token does not look like a token.
 * - `invalid-token`: an unknown or expired token, or one whose user still has the first password, who may do nothing
 *   but change it. An OAuth access token is looked up by its hash and refused when it or its grant has expired.
 * - `insufficient-scope`: a valid token without the scope; `write` does not include `read`.
 * - `failed`: the database could not be read.
 *
 * The MCP route answers `missing-token` and `invalid-token` with 401 and `WWW-Authenticate: Bearer`, and
 * `insufficient-scope` with 403. A valid token gets its last use written, at most once a minute; a failure of that
 * write is logged and does not refuse the request. The token is never logged.
 */
export async function authenticateToken(
  headers: Headers,
  scope: TokenScope,
  { acceptOAuth = false }: AuthenticateTokenOptions = {},
): Promise<Result<Actor, AuthenticateTokenError>> {
  const secret = bearerTokenOf(headers);
  if (secret === null) return { ok: false, error: { code: "missing-token" } };
  const kind = looksLikeToken(secret) ? "token" : acceptOAuth && looksLikeAccessToken(secret) ? "access-token" : null;
  if (kind === null) return { ok: false, error: { code: "missing-token" } };

  let token: {
    id: string;
    scopes: string[];
    expiresAt: Date;
    accessTokenExpiresAt: Date | null;
    lastUsedAt: Date | null;
    user: { id: string; username: string; mustChangePassword: boolean };
  } | null;
  try {
    token = await getDb().apiToken.findUnique({
      // The two hashes are columns of their own, so a token is never taken for an access token or the other way round.
      where: kind === "token" ? { tokenHash: hashToken(secret) } : { accessTokenHash: hashToken(secret) },
      select: {
        id: true,
        scopes: true,
        expiresAt: true,
        accessTokenExpiresAt: true,
        lastUsedAt: true,
        user: { select: { id: true, username: true, mustChangePassword: true } },
      },
    });
  } catch (err) {
    logger.error({ err }, "failed to look up token");
    return { ok: false, error: { code: "failed" } };
  }

  if (!token) {
    logger.warn({ reason: "unknown" }, "token refused");
    return { ok: false, error: { code: "invalid-token" } };
  }
  const now = currentTime();
  const tokenId = token.id;
  if (token.expiresAt.getTime() <= now.getTime()) {
    logger.warn({ reason: "expired", tokenId }, "token refused");
    return { ok: false, error: { code: "invalid-token" } };
  }
  // The access token of a grant ends long before its grant; the client then asks for a new one.
  if (kind === "access-token" && (token.accessTokenExpiresAt?.getTime() ?? 0) <= now.getTime()) {
    logger.warn({ reason: "access-token-expired", tokenId }, "token refused");
    return { ok: false, error: { code: "invalid-token" } };
  }
  if (token.user.mustChangePassword) {
    logger.warn({ reason: "first-password", tokenId }, "token refused");
    return { ok: false, error: { code: "invalid-token" } };
  }
  if (!token.scopes.includes(scope)) {
    logger.warn({ reason: "insufficient-scope", tokenId, scope }, "token refused");
    return { ok: false, error: { code: "insufficient-scope" } };
  }

  const usedBefore = new Date(now.getTime() - LAST_USE_INTERVAL_MS);
  if (token.lastUsedAt === null || token.lastUsedAt.getTime() <= usedBefore.getTime()) {
    try {
      // Conditional, so that of the requests of a burst that all read an old last use only the first one writes.
      await getDb().apiToken.updateMany({
        where: { id: tokenId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: usedBefore } }] },
        data: { lastUsedAt: now },
      });
    } catch (err) {
      logger.error({ err, tokenId }, "failed to write the last use of a token");
    }
  }

  return { ok: true, value: { id: token.user.id, name: token.user.username } };
}
