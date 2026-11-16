// The reads and writes of the grants of users to OAuth clients, the connected apps of the account page, and the check
// of the access token of a grant. The service knows nothing about Next.js, forms or addresses, so that the GUI
// (through `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request.
//
// Every function that lists or revokes grants takes the acting user first and only ever touches the actor's own
// grants: nobody, the admin included, sees or revokes the grants of another user. `authenticateAccessToken()` is the
// other way round: it finds the actor of a request from the access token of a grant, the only bearer token it
// accepts. Only hashes of the tokens are stored, and neither a token nor its hash is ever logged.
//
// The OAuth service creates, refreshes and replaces the grants (`src/features/oauth/service.ts`).

import { isMcpRole, type McpRole } from "@/features/folder-roles/roles";
import { parseGrantId } from "@/features/grants/schema";
import { issuer } from "@/features/oauth/issuer";
import { hashSecret, looksLikeAccessToken } from "@/features/oauth/secret";
import { parseUserId } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import { isAdmin, type UserType } from "@/features/users/user-type";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Result } from "@/lib/result";

/**
 * How many grants a user may hold, expired ones included. A user holds one grant per app and MCP address, so per
 * folder and role.
 */
export const MAX_GRANTS_PER_USER = 50;

/** A connected app as the account page lists it; never a token, a hash or the client. */
export type GrantSummary = {
  id: string;
  /** The name of the app, as its client calls itself. */
  name: string;
  /** The current name of the folder of the MCP address the app is connected to. */
  folderName: string;
  /** The role of the MCP address: the most the app may do on the folder. */
  role: McpRole;
  /** When the user approved the app. */
  createdAt: Date;
  /** When the grant ends: it can no longer be refreshed and its access token stops working. */
  expiresAt: Date;
  /** When the app last used its access token, to the minute; `null` if it never did. */
  lastUsedAt: Date | null;
};

/** The columns of a grant that make up a `GrantSummary`. */
const GRANT_SUMMARY_SELECT = {
  id: true,
  name: true,
  folder: { select: { name: true } },
  role: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
} as const;

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

/** Whether OAuth is on: without `HIPPOWIKI_PUBLIC_URL` no app can connect and no grant can be used. */
function isOAuthOn(): boolean {
  return issuer() !== null;
}

/**
 * The actor's connected apps, newest first. A malformed actor id has none. `null` for an admin, who has no grants, and
 * while OAuth is off, when no grant can be used: then the list does not exist. The grants stay stored and are listed
 * again once OAuth is on.
 */
export async function listGrants(actor: Actor): Promise<GrantSummary[] | null> {
  if (isAdmin(actor) || !isOAuthOn()) return null;
  const userId = parseUserId(actor.id);
  if (!userId) return [];
  const grants = await getDb().oAuthGrant.findMany({
    where: { userId },
    select: GRANT_SUMMARY_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return grants.flatMap(({ folder, role, ...grant }) => {
    // The check constraint of the table keeps the role to Reader and Writer.
    if (!isMcpRole(role)) {
      logger.error({ grantId: grant.id }, "grant with a role that is no role of MCP");
      return [];
    }
    return [{ ...grant, folderName: folder.name, role }];
  });
}

type GrantNotFound = { code: "grant-not-found" };
/** An unexpected database error, or an actor that is malformed; it has been logged. */
type Failed = { code: "failed" };
/** The actor is an admin, who has no grants, or OAuth is off; it has been logged. */
type NotAllowed = { code: "not-allowed" };

/** The request has no `Authorization` header with a bearer token, or its value does not look like an access token. */
type MissingToken = { code: "missing-token" };
/** The access token is unknown or expired, or its user still has the first password or is an admin. */
type BadToken = { code: "invalid-token" };

export type RevokeGrantError = NotAllowed | GrantNotFound | Failed;
export type AuthenticateAccessTokenError = MissingToken | BadToken | Failed;

/**
 * Revokes the actor's connected app with the given id: deletes its grant, which ends its access token and its refresh
 * token at once. It refuses an admin and refuses while OAuth is off, when the account page lists no apps. A malformed
 * id, an unknown one and the grant of another user all give `grant-not-found`; only the log tells the last two from
 * the first.
 */
export async function revokeGrant(actor: Actor, id: string): Promise<Result<{ id: string }, RevokeGrantError>> {
  if (isAdmin(actor)) {
    logger.warn({ actorId: actor.id }, "grant not revoked: the actor is an admin");
    return { ok: false, error: { code: "not-allowed" } };
  }
  if (!isOAuthOn()) {
    logger.warn({ actorId: actor.id }, "grant not revoked: OAuth is off");
    return { ok: false, error: { code: "not-allowed" } };
  }
  const userId = actorIdOf(actor);
  if (!userId) return { ok: false, error: { code: "failed" } };

  const grantId = parseGrantId(id);
  if (!grantId) return { ok: false, error: { code: "grant-not-found" } };

  let count: number;
  try {
    ({ count } = await getDb().oAuthGrant.deleteMany({ where: { id: grantId, userId } }));
  } catch (err) {
    logger.error({ err, userId, grantId }, "failed to revoke grant");
    return { ok: false, error: { code: "failed" } };
  }

  if (count === 0) {
    logger.warn({ userId, grantId }, "grant to revoke not found");
    return { ok: false, error: { code: "grant-not-found" } };
  }

  logger.info({ userId, grantId }, "grant revoked");
  return { ok: true, value: { id: grantId } };
}

/** How often the last use of a grant is written at most, so that a burst of requests does not write on every one. */
export const LAST_USE_INTERVAL_MS = 60 * 1000;

/**
 * The bearer token of an `Authorization` header, or `null` without one. The scheme is matched without regard to case,
 * as RFC 6750 allows, and may be followed by more than one space.
 */
function bearerTokenOf(headers: Headers): string | null {
  const match = /^bearer +(\S+) *$/i.exec(headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

/**
 * Who a request acts for, from the bearer token in its `Authorization` header: the actor of the user of the grant
 * whose access token it is, if the token is valid. It is for callers other than the browser, such as the MCP server;
 * the browser uses the session (`src/features/auth/session.ts`). There are no scopes.
 *
 * - `missing-token`: no header, another scheme, or a value that does not look like an access token, a former API
 *   token included; the database is not asked and nothing is logged.
 * - `invalid-token`: an unknown access token, one whose grant or which itself has expired, one whose user still has
 *   the first password, who may do nothing but change it, or one whose user is an admin, who has no grants.
 * - `failed`: the database could not be read.
 *
 * The MCP route answers `missing-token` and `invalid-token` with 401 and `WWW-Authenticate: Bearer`. A valid access token gets the last use of its grant written, at most once a minute;
 * a failure of that write is logged and does not refuse the request. The token is never logged.
 */
export async function authenticateAccessToken(headers: Headers): Promise<Result<Actor, AuthenticateAccessTokenError>> {
  const secret = bearerTokenOf(headers);
  if (secret === null || !looksLikeAccessToken(secret)) return { ok: false, error: { code: "missing-token" } };

  let grant: {
    id: string;
    expiresAt: Date;
    accessTokenExpiresAt: Date | null;
    lastUsedAt: Date | null;
    user: { id: string; username: string; type: UserType; mustChangePassword: boolean };
  } | null;
  try {
    grant = await getDb().oAuthGrant.findUnique({
      where: { accessTokenHash: hashSecret(secret) },
      select: {
        id: true,
        expiresAt: true,
        accessTokenExpiresAt: true,
        lastUsedAt: true,
        user: { select: { id: true, username: true, type: true, mustChangePassword: true } },
      },
    });
  } catch (err) {
    logger.error({ err }, "failed to look up access token");
    return { ok: false, error: { code: "failed" } };
  }

  if (!grant) {
    logger.warn({ reason: "unknown" }, "access token refused");
    return { ok: false, error: { code: "invalid-token" } };
  }
  const now = currentTime();
  const grantId = grant.id;
  if (grant.expiresAt.getTime() <= now.getTime()) {
    logger.warn({ reason: "expired", grantId }, "access token refused");
    return { ok: false, error: { code: "invalid-token" } };
  }
  // The access token ends long before its grant; the client then asks for a new one.
  if ((grant.accessTokenExpiresAt?.getTime() ?? 0) <= now.getTime()) {
    logger.warn({ reason: "access-token-expired", grantId }, "access token refused");
    return { ok: false, error: { code: "invalid-token" } };
  }
  if (grant.user.mustChangePassword) {
    logger.warn({ reason: "first-password", grantId }, "access token refused");
    return { ok: false, error: { code: "invalid-token" } };
  }
  // Admins have no grants. The type of the account is checked as well, so that a grant of an admin is refused even if
  // one existed: no admin acts through an access token, and no admin task is reachable with one.
  if (isAdmin(grant.user)) {
    logger.warn({ reason: "admin", grantId }, "access token refused");
    return { ok: false, error: { code: "invalid-token" } };
  }

  const usedBefore = new Date(now.getTime() - LAST_USE_INTERVAL_MS);
  if (grant.lastUsedAt === null || grant.lastUsedAt.getTime() <= usedBefore.getTime()) {
    try {
      // Conditional, so that of the requests of a burst that all read an old last use only the first one writes.
      await getDb().oAuthGrant.updateMany({
        where: { id: grantId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: usedBefore } }] },
        data: { lastUsedAt: now },
      });
    } catch (err) {
      logger.error({ err, grantId }, "failed to write the last use of a grant");
    }
  }

  return { ok: true, value: { id: grant.user.id, name: grant.user.username, type: grant.user.type } };
}
