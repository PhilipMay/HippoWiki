// The token endpoint of OAuth: the exchange of a code for a grant and the refresh of a grant. A grant is a row of
// `OAuthGrant`, a connected app that the user sees and revokes on the account page (`src/features/grants/service.ts`),
// and counted in the limit of grants per user. The client holds an access token that works for an hour and a refresh
// token that changes with every use; the row holds only the hashes of the current ones. The service knows nothing
// about HTTP or Next.js: `http.ts` is its adapter. A code, a token and their hashes are never logged.

import { randomUUID } from "node:crypto";

import { isMcpRole } from "@/features/folder-roles/roles";
import { MAX_GRANTS_PER_USER } from "@/features/grants/limits";
import { mcpResourceOf } from "@/features/oauth/issuer";
import { CLIENT_SELECT, currentTime, replacedGrants, toClient, type ClientRow } from "@/features/oauth/rows";
import { grantExpiresAt, grantLifetimeSchema, isCodeVerifier, type McpAddress } from "@/features/oauth/schema";
import {
  generateAccessToken,
  generateRefreshToken,
  grantIdOfRefreshToken,
  hashSecret,
  looksLikeCode,
  sameHash,
  verifiesChallenge,
} from "@/features/oauth/secret";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Failed, Result } from "@/lib/result";

/** How long an access token works; the client gets a new one with its refresh token. */
const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/** What a client gets for a code or a refresh token. */
export type TokenSet = {
  accessToken: string;
  /** How many seconds the access token works. */
  expiresIn: number;
  refreshToken: string;
};

/** A parameter is missing. */
type InvalidRequest = { code: "invalid-request"; description: string };
/** The code or the refresh token is unknown, used, expired or not the client's, or the user may not get a grant. */
type InvalidGrant = { code: "invalid-grant"; description: string };
/** The `resource` is not the MCP address of the code or the grant. */
type InvalidTarget = { code: "invalid-target"; description: string };
/** The request does not say which client it comes from. */
type MissingClient = { code: "invalid-client"; description: string };

type TokenError = InvalidRequest | InvalidGrant | InvalidTarget | MissingClient | Failed;

/** The error of a code or a refresh token that gets no tokens, with what the client is told. */
function invalidGrant(description: string): InvalidGrant {
  return { code: "invalid-grant", description };
}

const INVALID_CODE = invalidGrant("The authorization code is not valid");
const INVALID_REFRESH_TOKEN = invalidGrant("The refresh token is not valid");
const FIRST_PASSWORD = invalidGrant("The user has to change the first password first");
const OTHER_MCP_ADDRESS: InvalidTarget = {
  code: "invalid-target",
  description: "resource is not the MCP address the app was connected to",
};
const MISSING_CLIENT: MissingClient = { code: "invalid-client", description: "client_id is missing" };

/** Logs why a request of the token endpoint gets no tokens, and returns its error. */
function refuse(
  message: "code exchange refused" | "refresh refused",
  reason: string,
  details: Record<string, unknown>,
  error: TokenError,
): { ok: false; error: TokenError } {
  logger.warn({ reason, ...details }, message);
  return { ok: false, error };
}

/** Thrown inside the transaction of `exchangeCode()` to roll it back: the user is gone or still has the first password. */
class UserMayNotGrantError extends Error {}
/** Thrown inside the transaction of `exchangeCode()` to roll it back: the user holds the most grants allowed. */
class GrantLimitError extends Error {}

/** The tokens of a grant, and what the row of the grant stores of them: the hashes and the end of the access token. */
type NewTokens = {
  tokens: TokenSet;
  stored: { accessTokenHash: string; accessTokenExpiresAt: Date; refreshTokenHash: string };
};

/** The tokens of the grant with the given id, which ends at `grantEnd`, and what is stored of them. */
function newTokens(grantId: string, grantEnd: Date, now: Date): NewTokens {
  const accessToken = generateAccessToken();
  const refreshToken = generateRefreshToken(grantId);
  // The access token never outlives its grant.
  const accessTokenExpiresAt = new Date(Math.min(now.getTime() + ACCESS_TOKEN_LIFETIME_MS, grantEnd.getTime()));
  const tokens: TokenSet = {
    accessToken,
    expiresIn: Math.max(0, Math.floor((accessTokenExpiresAt.getTime() - now.getTime()) / 1000)),
    refreshToken,
  };
  const stored = {
    accessTokenHash: hashSecret(accessToken),
    accessTokenExpiresAt,
    refreshTokenHash: hashSecret(refreshToken),
  };
  return { tokens, stored };
}

/**
 * Exchanges an authorization code for a grant and returns its first tokens.
 *
 * - The code is deleted as it is read, so it works once, also when two exchanges arrive at the same time, and a
 *   failed check uses it up.
 * - The client, the redirect address and the PKCE verifier must be the ones of the authorization request, and a
 *   `resource` that is sent must be the MCP address of the code. A request that names no client is refused
 *   (`invalid-client`). A user with the first password gets no grant.
 * - In one transaction the grant is created with the folder and the role of the code, and the user's older grants to
 *   the same client at the same address are deleted (`replacedGrants()`). The limit of grants per user counts the new
 *   grant without the replaced ones.
 */
export async function exchangeCode(input: {
  code?: string;
  clientId?: string;
  redirectUri?: string;
  codeVerifier?: string;
  resource?: string;
}): Promise<Result<TokenSet, TokenError>> {
  if (input.code === undefined) {
    return { ok: false, error: { code: "invalid-request", description: "code is missing" } };
  }
  if (!looksLikeCode(input.code)) return { ok: false, error: INVALID_CODE };

  const db = getDb();
  let code: {
    id: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    folderId: string;
    role: string;
    lifetime: string;
    expiresAt: Date;
    client: ClientRow;
  } | null;
  try {
    code = await db.oAuthCode.findUnique({
      where: { codeHash: hashSecret(input.code) },
      select: {
        id: true,
        userId: true,
        redirectUri: true,
        codeChallenge: true,
        folderId: true,
        role: true,
        lifetime: true,
        expiresAt: true,
        client: { select: CLIENT_SELECT },
      },
    });
    // Conditional, so that of two exchanges of the same code only one goes on: the one that deleted the row.
    if (code && (await db.oAuthCode.deleteMany({ where: { id: code.id } })).count !== 1) code = null;
  } catch (err) {
    logger.error({ err }, "failed to read authorization code");
    return { ok: false, error: { code: "failed" } };
  }
  if (!code) {
    return refuse("code exchange refused", "unknown-code", {}, INVALID_CODE);
  }

  // From here on the code is used up, whatever the checks say.
  const { userId, client } = code;
  const refused = (reason: string, error: TokenError) =>
    refuse("code exchange refused", reason, { userId, clientRowId: client.id }, error);
  const now = currentTime();
  if (code.expiresAt.getTime() <= now.getTime()) return refused("expired-code", INVALID_CODE);
  if (input.clientId === undefined) return refused("no-client", MISSING_CLIENT);
  if (input.clientId !== toClient(client).clientId) {
    return refused("other-client", invalidGrant("The authorization code was given to another client"));
  }
  if (input.redirectUri !== code.redirectUri) {
    return refused("other-redirect-uri", invalidGrant("redirect_uri is not the one of the authorization request"));
  }
  if (
    input.codeVerifier === undefined ||
    !isCodeVerifier(input.codeVerifier) ||
    !verifiesChallenge(input.codeVerifier, code.codeChallenge)
  ) {
    return refused("wrong-verifier", invalidGrant("code_verifier does not belong to the code_challenge"));
  }
  const codeRole = code.role;
  if (!isMcpRole(codeRole)) {
    // The check constraint of the table keeps the role to Reader, Writer and Manager.
    logger.error({ codeId: code.id, role: codeRole }, "authorization code with a role that is no role of MCP");
    return { ok: false, error: { code: "failed" } };
  }
  const address: McpAddress = { folderId: code.folderId, role: codeRole };
  if (input.resource !== undefined && input.resource !== mcpResourceOf(address)) {
    return refused("other-resource", OTHER_MCP_ADDRESS);
  }
  const lifetime = grantLifetimeSchema.safeParse(code.lifetime);
  if (!lifetime.success) {
    logger.error({ userId, clientRowId: client.id }, "authorization code with an unknown lifetime");
    return { ok: false, error: { code: "failed" } };
  }

  const grantId = randomUUID();
  const expiresAt = grantExpiresAt(lifetime.data, now);
  const { tokens, stored } = newTokens(grantId, expiresAt, now);
  let replaced: number;
  try {
    replaced = await db.$transaction(async (tx) => {
      // Locks the user's row, so that grants created at the same time cannot pass the limit together.
      const users = await tx.$queryRaw<{ mustChangePassword: boolean }[]>`
        SELECT "mustChangePassword" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      if (users[0]?.mustChangePassword !== false) throw new UserMayNotGrantError();
      const { count } = await tx.oAuthGrant.deleteMany({ where: replacedGrants(userId, client, address) });
      if ((await tx.oAuthGrant.count({ where: { userId } })) >= MAX_GRANTS_PER_USER) throw new GrantLimitError();
      await tx.oAuthGrant.create({
        data: {
          id: grantId,
          userId,
          clientId: client.id,
          name: client.name,
          folderId: address.folderId,
          role: address.role,
          expiresAt,
          ...stored,
        },
        select: { id: true },
      });
      return count;
    });
  } catch (err) {
    if (err instanceof UserMayNotGrantError) return refused("first-password", FIRST_PASSWORD);
    if (err instanceof GrantLimitError) {
      return refused("limit-reached", invalidGrant("The user already has the most connected apps allowed"));
    }
    logger.error({ err, userId, clientRowId: client.id }, "failed to create grant");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ userId, clientRowId: client.id, grantId, ...address, replaced }, "grant created");
  return { ok: true, value: tokens };
}

/**
 * Gives a grant new tokens for its refresh token: a new access token and a new refresh token. The previous ones stop
 * working at once.
 *
 * - The refresh token names its grant. A token that is not the current one of its grant has been used before: by the
 *   client, or by someone who stole it. Nobody can tell which, so the grant is revoked, and the user connects again.
 * - The swap of the hashes is conditional, so that of two refreshes at the same time only one succeeds; the other is
 *   refused, and the grant stays.
 * - A grant past its expiry, a grant of a user with the first password and a refresh by another client are refused,
 *   and so is a request that names no client (`invalid-client`) and one whose `resource` is not the MCP address of
 *   the grant (`invalid-target`).
 */
export async function refreshGrant(input: {
  refreshToken?: string;
  clientId?: string;
  resource?: string;
}): Promise<Result<TokenSet, TokenError>> {
  if (input.refreshToken === undefined) {
    return { ok: false, error: { code: "invalid-request", description: "refresh_token is missing" } };
  }
  const grantId = grantIdOfRefreshToken(input.refreshToken);
  if (!grantId) return { ok: false, error: INVALID_REFRESH_TOKEN };

  const db = getDb();
  let grant: {
    userId: string;
    folderId: string;
    role: string;
    expiresAt: Date;
    refreshTokenHash: string | null;
    client: ClientRow;
    user: { mustChangePassword: boolean };
  } | null;
  try {
    grant = await db.oAuthGrant.findUnique({
      where: { id: grantId },
      select: {
        userId: true,
        folderId: true,
        role: true,
        expiresAt: true,
        refreshTokenHash: true,
        client: { select: CLIENT_SELECT },
        user: { select: { mustChangePassword: true } },
      },
    });
  } catch (err) {
    logger.error({ err, grantId }, "failed to read grant");
    return { ok: false, error: { code: "failed" } };
  }
  // A grant without a refresh token can only be a broken row.
  if (!grant || grant.refreshTokenHash === null) {
    return refuse("refresh refused", "unknown-grant", {}, INVALID_REFRESH_TOKEN);
  }
  const { userId, client, refreshTokenHash } = grant;

  if (!sameHash(hashSecret(input.refreshToken), refreshTokenHash)) {
    try {
      await db.oAuthGrant.deleteMany({ where: { id: grantId } });
    } catch (err) {
      logger.error({ err, grantId }, "failed to revoke grant after its refresh token was used again");
      return { ok: false, error: { code: "failed" } };
    }
    logger.warn({ grantId, userId, clientRowId: client.id }, "refresh token used again, grant revoked");
    return { ok: false, error: INVALID_REFRESH_TOKEN };
  }

  const refused = (reason: string, error: TokenError) =>
    refuse("refresh refused", reason, { grantId, userId, clientRowId: client.id }, error);
  if (input.clientId === undefined) return refused("no-client", MISSING_CLIENT);
  if (input.clientId !== toClient(client).clientId) {
    return refused("other-client", invalidGrant("The refresh token was given to another client"));
  }
  const grantRole = grant.role;
  // The check constraint of the table keeps the role to Reader, Writer and Manager.
  if (!isMcpRole(grantRole)) logger.error({ grantId, role: grantRole }, "grant with a role that is no role of MCP");
  if (
    input.resource !== undefined &&
    (!isMcpRole(grantRole) || input.resource !== mcpResourceOf({ folderId: grant.folderId, role: grantRole }))
  ) {
    return refused("other-resource", OTHER_MCP_ADDRESS);
  }
  const now = currentTime();
  if (grant.expiresAt.getTime() <= now.getTime())
    return refused("expired-grant", invalidGrant("The grant has expired"));
  if (grant.user.mustChangePassword) return refused("first-password", FIRST_PASSWORD);

  const { tokens, stored } = newTokens(grantId, grant.expiresAt, now);
  let count: number;
  try {
    // Conditional on the hash that was read, so that two refreshes with the same token cannot both succeed.
    ({ count } = await db.oAuthGrant.updateMany({ where: { id: grantId, refreshTokenHash }, data: stored }));
  } catch (err) {
    logger.error({ err, grantId }, "failed to refresh grant");
    return { ok: false, error: { code: "failed" } };
  }
  if (count !== 1) return refused("refreshed-meanwhile", INVALID_REFRESH_TOKEN);

  logger.info({ grantId, userId, clientRowId: client.id }, "grant refreshed");
  return { ok: true, value: tokens };
}
