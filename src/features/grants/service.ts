// The reads and writes of the grants of users to OAuth clients, the connected apps of the account page, and the check
// of the access token of a grant. The service knows nothing about Next.js, forms or addresses, so that the GUI
// (through `queries.ts` and `actions.ts`) and any other caller can use it, also outside a request.
//
// Every function that lists or revokes grants takes the acting user first and only ever touches the actor's own
// grants: nobody, the admin included, sees or revokes the grants of another user. `authenticateAccessToken()` is the
// other way round: it finds the actor of a request from the access token of a grant, the only bearer token it
// accepts. Only hashes of the tokens are stored, and neither a token nor its hash is ever logged.
//
// The token service of OAuth creates, refreshes and replaces the grants (`src/features/oauth/token-service.ts`).

import { includesRole, isMcpRole, type McpConnection, type McpRole } from "@/features/folder-roles/roles";
import { folderRoleOf } from "@/features/folder-roles/service";
import { parseGrantId } from "@/features/grants/schema";
import { isOAuthOn } from "@/features/oauth/issuer";
import type { McpAddress } from "@/features/oauth/schema";
import { hashSecret, looksLikeAccessToken } from "@/features/oauth/secret";
import { parseUserId } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import { isAdmin, type UserType } from "@/features/users/user-type";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Failed, NotAllowed, Result } from "@/lib/result";

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
    // The check constraint of the table keeps the role to Reader, Writer and Manager.
    if (!isMcpRole(role)) {
      logger.error({ grantId: grant.id, role }, "grant with a role that is no role of MCP");
      return [];
    }
    return [{ ...grant, folderName: folder.name, role }];
  });
}

type GrantNotFound = { code: "grant-not-found" };

/** The request has no `Authorization` header with a bearer token, or its value does not look like an access token. */
type MissingToken = { code: "missing-token" };
/**
 * The access token is unknown or expired, belongs to a grant of another MCP address, or its user still has the first
 * password or is an admin.
 */
type BadToken = { code: "invalid-token" };
/**
 * The access token is valid for the address, but its user has no role on the folder any more or a role below the
 * role of the address; the grant stays and works again once the role is high enough again. It names the user and the
 * grant of the token, so that the MCP route counts the request against the user's rate limit all the same.
 */
type RoleTooLow = { code: "role-too-low"; userId: string; grantId: string };

/** `not-allowed`: the actor is an admin, who has no grants, or OAuth is off; it has been logged. */
type RevokeGrantError = NotAllowed | GrantNotFound | Failed;
type AuthenticateAccessTokenError = MissingToken | BadToken | RoleTooLow | Failed;

/** Who a request through MCP acts for: the user of the grant, and the connection of the grant. */
export type McpCaller = { actor: Actor; connection: McpConnection };

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
  const actorId = actorIdOf(actor);
  if (!actorId) return { ok: false, error: { code: "failed" } };

  const grantId = parseGrantId(id);
  if (!grantId) return { ok: false, error: { code: "grant-not-found" } };

  let count: number;
  try {
    ({ count } = await getDb().oAuthGrant.deleteMany({ where: { id: grantId, userId: actorId } }));
  } catch (err) {
    logger.error({ err, actorId, grantId }, "failed to revoke grant");
    return { ok: false, error: { code: "failed" } };
  }

  if (count === 0) {
    logger.warn({ actorId, grantId }, "grant to revoke not found");
    return { ok: false, error: { code: "grant-not-found" } };
  }

  logger.info({ actorId, grantId }, "grant revoked");
  return { ok: true, value: { id: grantId } };
}

/** `not-allowed`: the actor is an admin, who has no grants, or OAuth is off; it has been logged. */
type RevokeAllGrantsError = NotAllowed | Failed;

/**
 * Revokes all connected apps of the actor in one write: deletes their grants, which ends their access tokens and
 * their refresh tokens at once, and returns how many there were. It refuses an admin and refuses while OAuth is off,
 * like `revokeGrant()`.
 */
export async function revokeAllGrants(actor: Actor): Promise<Result<{ count: number }, RevokeAllGrantsError>> {
  if (isAdmin(actor)) {
    logger.warn({ actorId: actor.id }, "grants not revoked: the actor is an admin");
    return { ok: false, error: { code: "not-allowed" } };
  }
  if (!isOAuthOn()) {
    logger.warn({ actorId: actor.id }, "grants not revoked: OAuth is off");
    return { ok: false, error: { code: "not-allowed" } };
  }
  const actorId = actorIdOf(actor);
  if (!actorId) return { ok: false, error: { code: "failed" } };

  let count: number;
  try {
    ({ count } = await getDb().oAuthGrant.deleteMany({ where: { userId: actorId } }));
  } catch (err) {
    logger.error({ err, actorId }, "failed to revoke all grants");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ actorId, count }, "all grants revoked");
  return { ok: true, value: { count } };
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
 * Who a request to the given MCP address acts for, from the bearer token in its `Authorization` header: the actor of
 * the user of the grant whose access token it is, and the connection of the grant, if the token is valid for exactly
 * this address and the user's current role on the folder includes the role of the address. It is for the MCP server;
 * the browser uses the session (`src/features/auth/session.ts`). There are no scopes.
 *
 * - `missing-token`: no header, another scheme, or a value that does not look like an access token, such as a token
 *   of another kind; the database is not asked and nothing is logged.
 * - `invalid-token`: an unknown access token, one whose grant or which itself has expired, one whose user still has
 *   the first password, who may do nothing but change it, one whose user is an admin, who has no grants, and one of a
 *   grant to another address, another folder or another role (logged as `other-address`).
 * - `role-too-low`: a valid access token for the address whose user has no role on the folder any more, or a role
 *   below the role of the address, with the ids of its user and its grant. It is logged; the grant stays.
 * - `failed`: the database could not be read.
 *
 * The MCP route answers `missing-token` and `invalid-token` with 401 and `WWW-Authenticate: Bearer`, and
 * `role-too-low` with 403. An accepted access token gets the last use of its grant written, at most once a minute; a
 * failure of that write is logged and does not refuse the request. The token is never logged.
 */
export async function authenticateAccessToken(
  headers: Headers,
  address: McpAddress,
): Promise<Result<McpCaller, AuthenticateAccessTokenError>> {
  const secret = bearerTokenOf(headers);
  if (secret === null || !looksLikeAccessToken(secret)) return { ok: false, error: { code: "missing-token" } };

  let grant: GrantToCheck | null;
  try {
    grant = await getDb().oAuthGrant.findUnique({
      where: { accessTokenHash: hashSecret(secret) },
      select: GRANT_TO_CHECK_SELECT,
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
  const accepted = await acceptGrant(grant, now, {
    address,
    log: logger.warn.bind(logger),
    refused: "access token refused",
    subject: "an access token",
  });
  if (!accepted.ok) {
    const { error } = accepted;
    return { ok: false, error: error === "refused" ? { code: "invalid-token" } : error };
  }

  const grantId = grant.id;
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

  return accepted;
}

/**
 * Who a link to a file that names the grant with the given id acts for: the actor of the user of the grant and the
 * connection of the grant, if the grant is still accepted at its MCP address, or `null`. A link follows the access of
 * its connected app, so it passes the same checks as an access token of the grant: OAuth is on, the grant exists and
 * has not expired, its user does not have the first password and is no admin, and the user's current role on the
 * folder includes the role of the grant. It does not look at the access token, whose shorter lifetime a link may
 * outlive, and it writes no last use: whoever holds a link may download, not only the app.
 *
 * A refusal and a failed read are logged with the reason and the grant; a link or its token never reaches this
 * service.
 */
export async function callerOfGrant(id: string): Promise<McpCaller | null> {
  if (!isOAuthOn()) {
    logger.info({ reason: "oauth-off" }, "grant of a file link refused");
    return null;
  }
  const grantId = parseGrantId(id);
  if (!grantId) {
    logger.warn({ reason: "malformed" }, "grant of a file link refused");
    return null;
  }

  let grant: GrantToCheck | null;
  try {
    grant = await getDb().oAuthGrant.findUnique({ where: { id: grantId }, select: GRANT_TO_CHECK_SELECT });
  } catch (err) {
    logger.error({ err, grantId }, "failed to look up the grant of a file link");
    return null;
  }
  if (!grant) {
    logger.info({ reason: "unknown", grantId }, "grant of a file link refused");
    return null;
  }
  // A link that no longer passes is expected, e.g. after the app was revoked, so its refusal is logged at `info`.
  const accepted = await acceptGrant(grant, currentTime(), {
    address: null,
    log: logger.info.bind(logger),
    refused: "grant of a file link refused",
    subject: "the grant of a file link",
  });
  return accepted.ok ? accepted.value : null;
}

/** What the checks of a grant read of it, for an access token and for a link to a file. */
type GrantToCheck = {
  id: string;
  folderId: string;
  role: string;
  expiresAt: Date;
  accessTokenExpiresAt: Date | null;
  lastUsedAt: Date | null;
  user: { id: string; username: string; type: UserType; mustChangePassword: boolean };
};

/** The columns of a `GrantToCheck`. */
const GRANT_TO_CHECK_SELECT = {
  id: true,
  folderId: true,
  role: true,
  expiresAt: true,
  accessTokenExpiresAt: true,
  lastUsedAt: true,
  user: { select: { id: true, username: true, type: true, mustChangePassword: true } },
} as const;

/**
 * The checks of a grant that an access token and a link to a file share, in one place, so that the two never disagree.
 * With an MCP address, the access token of the grant is checked as well, and the grant must be one to exactly this
 * address; without one, the grant counts at its own address. Each refusal is logged with the given function under the
 * given message, with its reason and the grant: `refused` for a grant that is not accepted, `role-too-low` for a user whose role on the folder
 * no longer includes the role of the grant, `failed` when the role could not be read.
 */
async function acceptGrant(
  grant: GrantToCheck,
  now: Date,
  options: {
    address: McpAddress | null;
    log: (data: object, message: string) => void;
    refused: string;
    subject: string;
  },
): Promise<{ ok: true; value: McpCaller } | { ok: false; error: "refused" | RoleTooLow | Failed }> {
  const { address, log, refused, subject } = options;
  const grantId = grant.id;
  if (grant.expiresAt.getTime() <= now.getTime()) {
    log({ reason: "expired", grantId }, refused);
    return { ok: false, error: "refused" };
  }
  // The access token ends long before its grant; the client then asks for a new one.
  if (address !== null && (grant.accessTokenExpiresAt?.getTime() ?? 0) <= now.getTime()) {
    log({ reason: "access-token-expired", grantId }, refused);
    return { ok: false, error: "refused" };
  }
  if (grant.user.mustChangePassword) {
    log({ reason: "first-password", grantId }, refused);
    return { ok: false, error: "refused" };
  }
  // Admins have no grants. The type of the account is checked as well, so that a grant of an admin is refused even if
  // one existed: no admin acts through an access token or a link, and no admin task is reachable with one.
  if (isAdmin(grant.user)) {
    log({ reason: "admin", grantId }, refused);
    return { ok: false, error: "refused" };
  }
  const grantRole = grant.role;
  // The check constraint of the table keeps the role to Reader, Writer and Manager.
  if (!isMcpRole(grantRole)) {
    logger.error({ grantId, role: grantRole }, "grant with a role that is no role of MCP");
    log({ reason: "other-address", grantId }, refused);
    return { ok: false, error: "refused" };
  }
  // A connection is bound to the one address it was approved for: its token is no token anywhere else.
  if (address !== null && (grant.folderId !== address.folderId || grantRole !== address.role)) {
    log({ reason: "other-address", grantId }, refused);
    return { ok: false, error: "refused" };
  }
  const actor: Actor = { id: grant.user.id, name: grant.user.username, type: grant.user.type };
  let userRole: Awaited<ReturnType<typeof folderRoleOf>>;
  try {
    // The current role, read on every request, so that a lowered or removed role takes effect at once.
    userRole = await folderRoleOf(actor, grant.folderId);
  } catch (err) {
    logger.error({ err, grantId }, `failed to read the role of the user of ${subject}`);
    return { ok: false, error: { code: "failed" } };
  }
  if (!userRole || !includesRole(userRole, grantRole)) {
    log({ reason: "role-too-low", grantId, folderId: grant.folderId, grantRole, userRole }, refused);
    return { ok: false, error: { code: "role-too-low", userId: actor.id, grantId } };
  }
  return { ok: true, value: { actor, connection: { grantId, folderId: grant.folderId, role: grantRole } } };
}
