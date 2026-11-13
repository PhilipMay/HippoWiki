// The reads and writes of API tokens. The service knows nothing about Next.js, forms or addresses, so that the GUI
// (through `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request.
//
// Every function takes the acting user first and only ever touches the actor's own tokens: nobody, the admin included,
// sees or revokes the tokens of another user. A token leaves the service only once, when it is created; only its hash
// is stored, and neither is ever logged.

import { z } from "zod";

import {
  expiresAtFor,
  isTokenScope,
  parseTokenId,
  tokenInputSchema,
  type TokenFieldErrors,
  type TokenScope,
} from "@/features/tokens/schema";
import { generateToken, hashToken } from "@/features/tokens/secret";
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
  name: string;
  scopes: TokenScope[];
  createdAt: Date;
  expiresAt: Date;
  /** When the token was last used, to the minute; `null` if it was never used. */
  lastUsedAt: Date | null;
};

/** The columns of a token that make up a `TokenSummary`. */
const TOKEN_SUMMARY_SELECT = {
  id: true,
  name: true,
  scopes: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
} as const;

type TokenSummaryRow = Omit<TokenSummary, "scopes"> & { scopes: string[] };

function toTokenSummary({ id, name, scopes, createdAt, expiresAt, lastUsedAt }: TokenSummaryRow): TokenSummary {
  return { id, name, scopes: scopes.filter(isTokenScope), createdAt, expiresAt, lastUsedAt };
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

/** The actor's tokens, newest first. A malformed actor id has no tokens. */
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

export type CreateTokenError = InvalidToken | LimitReached | Failed;
export type RevokeTokenError = TokenNotFound | Failed;

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
 * Revokes the actor's token with the given id: deletes it, so that it stops working at once. A malformed id, an
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
