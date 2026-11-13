// The rules of the OAuth authorization code flow: clients, authorization requests, codes and grants. The service knows
// nothing about HTTP, Next.js or forms: the adapters (`http.ts`, `queries.ts`, `actions.ts`) translate between a
// request and these functions, so the rules are tested on their own.
//
// - A client is public: it has no secret and proves itself with PKCE (`S256`).
// - A code is what a client gets when a user approves it. It works once and for ten minutes.
// - A grant is what a code is exchanged for: a row of `ApiToken` with a client, listed and revoked like every other
//   token of the user and counted in the same limit. The client holds an access token that works for an hour and a
//   refresh token that changes with every use; the row holds only the hashes of the current ones.
// - A code, a token and their hashes are never logged.

import { randomUUID } from "node:crypto";

import { mcpResource } from "@/features/oauth/issuer";
import {
  clientRegistrationSchema,
  GRANT_SCOPES,
  isCodeChallenge,
  isCodeVerifier,
  isRedirectUriOf,
  parseClientRowId,
  URL_MAX_LENGTH,
  type AuthorizationParams,
  type OAuthError,
} from "@/features/oauth/schema";
import {
  generateAccessToken,
  generateCode,
  generateRefreshToken,
  grantIdOfRefreshToken,
  hashSecret,
  looksLikeCode,
  sameHash,
  verifiesChallenge,
} from "@/features/oauth/secret";
import { expiresAtFor, tokenExpirySchema } from "@/features/tokens/schema";
import { MAX_TOKENS_PER_USER } from "@/features/tokens/service";
import { parseUserId } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Result } from "@/lib/result";

/** How long an authorization code works. */
export const CODE_LIFETIME_MS = 10 * 60 * 1000;

/** How long an access token works; the client gets a new one with its refresh token. */
export const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/** How old a client that no grant and no code names has to be before it is deleted. */
export const UNUSED_CLIENT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** A client as the consent page and the registration answer show it. */
export type OAuthClient = {
  /** The id of the row. */
  id: string;
  /** What the client calls itself in a request: the id of a registered client, or the URL of its metadata document. */
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: Date;
};

/** The columns of a client that the service reads. */
const CLIENT_SELECT = { id: true, metadataUrl: true, name: true, redirectUris: true, createdAt: true } as const;

type ClientRow = { id: string; metadataUrl: string | null; name: string; redirectUris: string[]; createdAt: Date };

function toClient({ id, metadataUrl, name, redirectUris, createdAt }: ClientRow): OAuthClient {
  return { id, clientId: metadataUrl ?? id, name, redirectUris, createdAt };
}

/** The current time. The one place the service takes it from, so that tests can set the clock. */
function currentTime(): Date {
  return new Date();
}

/** An unexpected database error; it has been logged. */
type Failed = { code: "failed" };

/** The metadata of a registration is not an object, or its redirect addresses are missing or not allowed. */
type InvalidClientMetadata = { code: "invalid-client-metadata" | "invalid-redirect-uri"; description: string };

export type RegisterClientError = InvalidClientMetadata | Failed;

/**
 * Registers a client from the metadata it sent (dynamic client registration, RFC 7591). Only the redirect addresses
 * and the name are read; the client is public, whatever it asked for. Anyone can register, so the adapter limits how
 * often, and a client that nothing names is deleted after a day.
 */
export async function registerClient(metadata: unknown): Promise<Result<OAuthClient, RegisterClientError>> {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return {
      ok: false,
      error: { code: "invalid-client-metadata", description: "The client metadata must be an object" },
    };
  }
  const parsed = clientRegistrationSchema.safeParse(metadata);
  if (!parsed.success) {
    const description = parsed.error.issues[0]?.message ?? "redirect_uris is not valid";
    return { ok: false, error: { code: "invalid-redirect-uri", description } };
  }

  let client: OAuthClient;
  try {
    const row = await getDb().oAuthClient.create({
      data: { name: parsed.data.client_name, redirectUris: parsed.data.redirect_uris },
      select: CLIENT_SELECT,
    });
    client = toClient(row);
  } catch (err) {
    logger.error({ err }, "failed to register oauth client");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ clientId: client.id }, "oauth client registered");
  await deleteStaleRows();
  return { ok: true, value: client };
}

/**
 * The client that calls itself `clientId` in a request, or `null` if there is none: a registered client by its id. A
 * value that is not an id never reaches the database.
 */
async function findClient(clientId: string): Promise<ClientRow | null> {
  const id = parseClientRowId(clientId);
  if (!id) return null;
  return getDb().oAuthClient.findUnique({ where: { id }, select: CLIENT_SELECT });
}

/** An authorization request that passed every check: what the consent page shows and a code is created for. */
export type AuthorizationRequest = {
  client: OAuthClient;
  /** The redirect address as the client sent it; the code is sent there. */
  redirectUri: string;
  codeChallenge: string;
  /** The `state` of the client, sent back unchanged; `null` if it sent none. */
  state: string | null;
};

/**
 * The client is unknown or the redirect address is not one of its own. The answer must not redirect: the address
 * cannot be trusted, so the error is shown to the user instead.
 */
type UntrustedRequest = { code: "invalid-client" | "invalid-redirect-uri" };

/** The request is wrong in another way; the client is told, at its redirect address. */
type RefusedRequest = {
  code: "refused";
  redirectUri: string;
  state: string | null;
  error: OAuthError;
  description: string;
};

export type CheckAuthorizationError = UntrustedRequest | RefusedRequest | Failed;

/**
 * Checks an authorization request.
 *
 * - The client must exist and the redirect address must be one of its own: the same text, except that the port is
 *   ignored for `http` on a loopback address. If either is wrong, the answer must not redirect (`invalid-client`,
 *   `invalid-redirect-uri`).
 * - Everything else goes back to the client as an error (`refused`): `response_type` must be `code`, PKCE must be
 *   `S256` with a valid challenge, and a `resource` that is sent must be the address of the MCP endpoint.
 * - Scopes are not checked: unknown ones are ignored, and the grant is always `read`.
 */
export async function checkAuthorizationRequest(
  params: AuthorizationParams,
): Promise<Result<AuthorizationRequest, CheckAuthorizationError>> {
  const clientId = params.client_id;
  if (clientId === undefined || clientId.length > URL_MAX_LENGTH) {
    return { ok: false, error: { code: "invalid-client" } };
  }
  let row: ClientRow | null;
  try {
    row = await findClient(clientId);
  } catch (err) {
    logger.error({ err }, "failed to read oauth client");
    return { ok: false, error: { code: "failed" } };
  }
  if (!row) {
    logger.warn({ reason: "unknown-client" }, "authorization request refused");
    return { ok: false, error: { code: "invalid-client" } };
  }
  const client = toClient(row);

  const redirectUri = params.redirect_uri;
  if (redirectUri === undefined || !isRedirectUriOf(client.redirectUris, redirectUri)) {
    logger.warn({ reason: "foreign-redirect-uri", clientId: client.id }, "authorization request refused");
    return { ok: false, error: { code: "invalid-redirect-uri" } };
  }

  // A `state` that is too long is not sent back; everything else about it is the client's business.
  const state = params.state !== undefined && params.state.length <= URL_MAX_LENGTH ? params.state : null;
  const refuse = (error: OAuthError, description: string): Result<AuthorizationRequest, CheckAuthorizationError> => {
    logger.warn({ reason: error, clientId: client.id }, "authorization request refused");
    return { ok: false, error: { code: "refused", redirectUri, state, error, description } };
  };

  if (params.state !== undefined && state === null) return refuse("invalid_request", "state is too long");
  if (params.response_type === undefined) return refuse("invalid_request", "response_type is missing");
  if (params.response_type !== "code") {
    return refuse("unsupported_response_type", "Only the response type code is supported");
  }
  if (params.code_challenge_method !== "S256") {
    return refuse("invalid_request", "PKCE with the code_challenge_method S256 is required");
  }
  const codeChallenge = params.code_challenge;
  if (codeChallenge === undefined || !isCodeChallenge(codeChallenge)) {
    return refuse("invalid_request", "code_challenge is missing or not a challenge of the method S256");
  }
  if (params.resource !== undefined && params.resource !== mcpResource()) {
    return refuse("invalid_target", "resource is not the MCP endpoint of this wiki");
  }

  return { ok: true, value: { client, redirectUri, codeChallenge, state } };
}

/**
 * Which of the user's tokens a new grant to the client replaces: the grants to the same client row and, for a
 * registered client, the grants to registered clients with the same name and the same redirect addresses. A connector
 * that registers itself again on every connect would otherwise leave a grant behind each time.
 */
function replacedGrants(userId: string, client: ClientRow): Prisma.ApiTokenWhereInput {
  const sameClient: Prisma.ApiTokenWhereInput[] = [{ clientId: client.id }];
  if (client.metadataUrl === null) {
    sameClient.push({
      client: { metadataUrl: null, name: client.name, redirectUris: { equals: client.redirectUris } },
    });
  }
  return { userId, OR: sameClient };
}

/**
 * Whether the actor already holds the most tokens a user may hold, not counting the grants that a new grant to the
 * client would replace. The consent page asks before it offers to approve; the exchange of the code decides.
 * `true` for a malformed id and for a client that does not exist: there is nothing to approve then.
 */
export async function isTokenLimitReached(actor: Actor, clientRowId: string): Promise<boolean> {
  const userId = parseUserId(actor.id);
  const clientId = parseClientRowId(clientRowId);
  if (!userId || !clientId) return true;
  const db = getDb();
  const client = await db.oAuthClient.findUnique({ where: { id: clientId }, select: CLIENT_SELECT });
  if (!client) return true;
  // Two counts instead of one with `NOT`: a token of the account page has no client, and in SQL a condition on a
  // missing value is neither true nor false, so `NOT` would leave such tokens out.
  const all = await db.apiToken.count({ where: { userId } });
  const replaced = await db.apiToken.count({ where: replacedGrants(userId, client) });
  return all - replaced >= MAX_TOKENS_PER_USER;
}

/** The chosen lifetime is not one of the choices. */
type InvalidLifetime = { code: "invalid-lifetime" };
/** The actor holds the most tokens a user may hold, the grants this one would replace not counted. */
type LimitReached = { code: "limit-reached" };

export type CreateCodeError = CheckAuthorizationError | InvalidLifetime | LimitReached;

/** A code that was just created, with the request it answers. The code leaves the service this once. */
export type CreatedCode = { code: string; request: AuthorizationRequest };

/**
 * Creates an authorization code for a request that the actor approved, with the lifetime of the grant that the actor
 * chose (`30d`, `90d` or `365d`). The request is checked again here, because its parameters come back from a form.
 * The code works once and for ten minutes.
 */
export async function createCode(
  actor: Actor,
  params: AuthorizationParams,
  lifetime: string,
): Promise<Result<CreatedCode, CreateCodeError>> {
  const userId = parseUserId(actor.id);
  if (!userId) {
    logger.error({ actorId: actor.id }, "malformed actor id");
    return { ok: false, error: { code: "failed" } };
  }
  const parsedLifetime = tokenExpirySchema.safeParse(lifetime);
  if (!parsedLifetime.success) return { ok: false, error: { code: "invalid-lifetime" } };

  const checked = await checkAuthorizationRequest(params);
  if (!checked.ok) return checked;
  const request = checked.value;
  const clientId = request.client.id;

  const code = generateCode();
  try {
    if (await isTokenLimitReached(actor, clientId)) {
      logger.warn({ userId, clientId }, "authorization code not created: the user holds the most tokens allowed");
      return { ok: false, error: { code: "limit-reached" } };
    }
    await getDb().oAuthCode.create({
      data: {
        codeHash: hashSecret(code),
        clientId,
        userId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        scopes: [...GRANT_SCOPES],
        lifetime: parsedLifetime.data,
        expiresAt: new Date(currentTime().getTime() + CODE_LIFETIME_MS),
      },
      select: { id: true },
    });
  } catch (err) {
    // Also an actor or a client that was deleted in the meantime.
    logger.error({ err, userId, clientId }, "failed to create authorization code");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ userId, clientId }, "authorization code created");
  await deleteStaleRows();
  return { ok: true, value: { code, request } };
}

/** What a client gets for a code or a refresh token. */
export type TokenSet = {
  accessToken: string;
  /** How many seconds the access token works. */
  expiresIn: number;
  refreshToken: string;
  scopes: readonly string[];
};

/** A parameter is missing. */
type InvalidRequest = { code: "invalid-request"; description: string };
/** The code or the refresh token is unknown, used, expired or not the client's, or the user may not get a grant. */
type InvalidGrant = { code: "invalid-grant"; description: string };
/** The `resource` is not the MCP endpoint. */
type InvalidTarget = { code: "invalid-target"; description: string };

export type TokenError = InvalidRequest | InvalidGrant | InvalidTarget | Failed;

function invalidGrant(description: string): { ok: false; error: InvalidGrant } {
  return { ok: false, error: { code: "invalid-grant", description } };
}

const INVALID_CODE = "The authorization code is not valid";
const INVALID_REFRESH_TOKEN = "The refresh token is not valid";
const NOT_MCP_RESOURCE = "resource is not the MCP endpoint of this wiki";

/** Thrown inside the transaction of `exchangeCode()` to roll it back: the user is gone or still has the first password. */
class UserMayNotGrantError extends Error {}
/** Thrown inside the transaction of `exchangeCode()` to roll it back: the user holds the most tokens allowed. */
class TokenLimitError extends Error {}

/** The tokens of a grant with the given id and end, and what is stored of them. */
function newTokens(grantId: string, grantExpiresAt: Date, now: Date) {
  const accessToken = generateAccessToken();
  const refreshToken = generateRefreshToken(grantId);
  // The access token never outlives its grant.
  const accessTokenExpiresAt = new Date(Math.min(now.getTime() + ACCESS_TOKEN_LIFETIME_MS, grantExpiresAt.getTime()));
  const tokens: TokenSet = {
    accessToken,
    expiresIn: Math.max(0, Math.floor((accessTokenExpiresAt.getTime() - now.getTime()) / 1000)),
    refreshToken,
    scopes: GRANT_SCOPES,
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
 *   `resource` that is sent must be the MCP endpoint. A user with the first password gets no grant.
 * - In one transaction the grant is created and the user's older grants to the same client are deleted
 *   (`replacedGrants()`). The limit of tokens per user counts the new grant without the replaced ones.
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
  if (!looksLikeCode(input.code)) return invalidGrant(INVALID_CODE);

  const db = getDb();
  let code: {
    id: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
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
    logger.warn({ reason: "unknown-code" }, "code exchange refused");
    return invalidGrant(INVALID_CODE);
  }

  // From here on the code is used up, whatever the checks say.
  const { userId, client } = code;
  const refuse = (reason: string, error: TokenError): { ok: false; error: TokenError } => {
    logger.warn({ reason, userId, clientId: client.id }, "code exchange refused");
    return { ok: false, error };
  };
  const now = currentTime();
  if (code.expiresAt.getTime() <= now.getTime()) return refuse("expired-code", invalidGrant(INVALID_CODE).error);
  if (input.clientId !== toClient(client).clientId) {
    return refuse("other-client", invalidGrant("The authorization code was given to another client").error);
  }
  if (input.redirectUri !== code.redirectUri) {
    return refuse("other-redirect-uri", invalidGrant("redirect_uri is not the one of the authorization request").error);
  }
  if (
    input.codeVerifier === undefined ||
    !isCodeVerifier(input.codeVerifier) ||
    !verifiesChallenge(input.codeVerifier, code.codeChallenge)
  ) {
    return refuse("wrong-verifier", invalidGrant("code_verifier does not belong to the code_challenge").error);
  }
  if (input.resource !== undefined && input.resource !== mcpResource()) {
    return refuse("other-resource", { code: "invalid-target", description: NOT_MCP_RESOURCE });
  }
  const lifetime = tokenExpirySchema.safeParse(code.lifetime);
  if (!lifetime.success) {
    logger.error({ userId, clientId: client.id }, "authorization code with an unknown lifetime");
    return { ok: false, error: { code: "failed" } };
  }

  const grantId = randomUUID();
  const expiresAt = expiresAtFor(lifetime.data, now);
  const { tokens, stored } = newTokens(grantId, expiresAt, now);
  let replaced: number;
  try {
    replaced = await db.$transaction(async (tx) => {
      // Locks the user's row, as `createToken()` of the token service does, so that grants and tokens created at the
      // same time cannot pass the limit together.
      const users = await tx.$queryRaw<{ mustChangePassword: boolean }[]>`
        SELECT "mustChangePassword" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      if (users[0]?.mustChangePassword !== false) throw new UserMayNotGrantError();
      const { count } = await tx.apiToken.deleteMany({ where: replacedGrants(userId, client) });
      if ((await tx.apiToken.count({ where: { userId } })) >= MAX_TOKENS_PER_USER) throw new TokenLimitError();
      await tx.apiToken.create({
        data: {
          id: grantId,
          userId,
          clientId: client.id,
          name: client.name,
          scopes: [...GRANT_SCOPES],
          expiresAt,
          ...stored,
        },
        select: { id: true },
      });
      return count;
    });
  } catch (err) {
    if (err instanceof UserMayNotGrantError) {
      return refuse("first-password", invalidGrant("The user has to change the first password first").error);
    }
    if (err instanceof TokenLimitError) {
      return refuse("limit-reached", invalidGrant("The user holds the most tokens allowed").error);
    }
    logger.error({ err, userId, clientId: client.id }, "failed to create grant");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ userId, clientId: client.id, grantId, replaced }, "grant created");
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
 * - A grant past its expiry, a grant of a user with the first password and a refresh by another client are refused.
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
  if (!grantId) return invalidGrant(INVALID_REFRESH_TOKEN);

  const db = getDb();
  let grant: {
    userId: string;
    expiresAt: Date;
    refreshTokenHash: string | null;
    client: ClientRow | null;
    user: { mustChangePassword: boolean };
  } | null;
  try {
    grant = await db.apiToken.findUnique({
      where: { id: grantId },
      select: {
        userId: true,
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
  // A token created on `/account` has no client and no refresh token.
  if (!grant?.client || grant.refreshTokenHash === null) {
    logger.warn({ reason: "unknown-grant" }, "refresh refused");
    return invalidGrant(INVALID_REFRESH_TOKEN);
  }
  const { userId, client, refreshTokenHash } = grant;

  if (!sameHash(hashSecret(input.refreshToken), refreshTokenHash)) {
    try {
      await db.apiToken.deleteMany({ where: { id: grantId } });
    } catch (err) {
      logger.error({ err, grantId }, "failed to revoke grant after its refresh token was used again");
      return { ok: false, error: { code: "failed" } };
    }
    logger.warn({ grantId, userId, clientId: client.id }, "refresh token used again, grant revoked");
    return invalidGrant(INVALID_REFRESH_TOKEN);
  }

  const refuse = (reason: string, error: TokenError): { ok: false; error: TokenError } => {
    logger.warn({ reason, grantId, userId, clientId: client.id }, "refresh refused");
    return { ok: false, error };
  };
  if (input.clientId !== toClient(client).clientId) {
    return refuse("other-client", invalidGrant("The refresh token was given to another client").error);
  }
  if (input.resource !== undefined && input.resource !== mcpResource()) {
    return refuse("other-resource", { code: "invalid-target", description: NOT_MCP_RESOURCE });
  }
  const now = currentTime();
  if (grant.expiresAt.getTime() <= now.getTime()) {
    return refuse("expired-grant", invalidGrant("The grant has expired").error);
  }
  if (grant.user.mustChangePassword) {
    return refuse("first-password", invalidGrant("The user has to change the first password first").error);
  }

  const { tokens, stored } = newTokens(grantId, grant.expiresAt, now);
  let count: number;
  try {
    // Conditional on the hash that was read, so that two refreshes with the same token cannot both succeed.
    ({ count } = await db.apiToken.updateMany({ where: { id: grantId, refreshTokenHash }, data: stored }));
  } catch (err) {
    logger.error({ err, grantId }, "failed to refresh grant");
    return { ok: false, error: { code: "failed" } };
  }
  if (count !== 1) return refuse("refreshed-meanwhile", invalidGrant(INVALID_REFRESH_TOKEN).error);

  logger.info({ grantId, userId, clientId: client.id }, "grant refreshed");
  return { ok: true, value: tokens };
}

/**
 * Deletes what nothing needs any more: the codes that have expired, and the clients that are more than a day old and
 * that no grant and no code names. There is no job scheduler, so this runs when a client is registered or a code is
 * created. A failure is logged and does not fail the write that caused the clean-up.
 */
async function deleteStaleRows(): Promise<void> {
  const now = currentTime().getTime();
  const db = getDb();
  try {
    await db.oAuthCode.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
  } catch (err) {
    logger.error({ err }, "failed to delete the expired authorization codes");
  }
  try {
    await db.oAuthClient.deleteMany({
      where: {
        createdAt: { lt: new Date(now - UNUSED_CLIENT_RETENTION_MS) },
        codes: { none: {} },
        grants: { none: {} },
      },
    });
  } catch (err) {
    logger.error({ err }, "failed to delete the oauth clients that nothing names");
  }
}
