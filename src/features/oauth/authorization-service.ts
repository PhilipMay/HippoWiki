// The authorization request of the OAuth code flow and the code that answers it: the check of a request for the user
// who is asked to approve it, the limit of connected apps per user, and the code that "Approve" creates. A code works
// once and for ten minutes, and is exchanged for a grant by `token-service.ts`. The service knows nothing about HTTP,
// Next.js or forms: `queries.ts` and `actions.ts` are its adapters for the consent page. A code and its hash are never
// logged.

import { folderRoleOf } from "@/features/folder-roles/service";
import { includesRole, type McpRole } from "@/features/folder-roles/roles";
import { MAX_GRANTS_PER_USER } from "@/features/grants/limits";
import { deleteStaleRows } from "@/features/oauth/cleanup-service";
import { findClient } from "@/features/oauth/clients-service";
import { mcpAddressOf } from "@/features/oauth/issuer";
import {
  CLIENT_SELECT,
  currentTime,
  replacedGrants,
  toClient,
  type ClientRow,
  type OAuthClient,
} from "@/features/oauth/rows";
import {
  grantLifetimeSchema,
  isCodeChallenge,
  isRedirectUriOf,
  parseClientRowId,
  URL_MAX_LENGTH,
  type AuthorizationParams,
  type McpAddress,
  type OAuthError,
} from "@/features/oauth/schema";
import { generateCode, hashSecret } from "@/features/oauth/secret";
import { parseUserId } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import { isAdmin } from "@/features/users/user-type";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Failed, Result } from "@/lib/result";

/** How long an authorization code works. */
const CODE_LIFETIME_MS = 10 * 60 * 1000;

/** The MCP address of an authorization request that passed every check, with the name of its folder. */
type RequestedAddress = { folder: { id: string; name: string }; role: McpRole };

/** An authorization request that passed every check: what the consent page shows and a code is created for. */
export type AuthorizationRequest = {
  client: OAuthClient;
  /** The MCP address the app connects to: a folder on which the actor's role includes the role of the address. */
  address: RequestedAddress;
  /** The redirect address as the client sent it; the code is sent there. */
  redirectUri: string;
  codeChallenge: string;
  /** The `state` of the client, sent back unchanged; `null` if it sent none. */
  state: string | null;
};

/**
 * The client is unknown (`unknown-client`) or the redirect address is not one of its own (`foreign-redirect-uri`). The
 * answer must not redirect: the address cannot be trusted, so the error is shown to the user instead. Unlike the codes
 * of the token endpoint and the registration, these carry no description: no client is told.
 */
type UntrustedRequest = { code: "unknown-client" | "foreign-redirect-uri" };

/** The request is wrong in another way; the client is told, at its redirect address. */
type RefusedRequest = {
  code: "refused";
  redirectUri: string;
  state: string | null;
  error: OAuthError;
  description: string;
};

type CheckAuthorizationError = UntrustedRequest | RefusedRequest | Failed;

/** Why an admin cannot approve a request; shown on the consent page and sent to the client. */
const ADMIN_REFUSAL_DESCRIPTION = "Admin accounts cannot connect apps";

/**
 * Why no app can be connected to the address of a request: the folder does not exist, the actor has no role on it,
 * or the role of the address is above the actor's role. One description for all three, so that it tells nothing about
 * which folders exist.
 */
const ADDRESS_REFUSAL_DESCRIPTION = "No app can be connected to this address";

/** Why a request names no MCP address of this wiki. */
const NOT_MCP_ADDRESS =
  "resource must be the MCP address of a folder of this wiki, /mcp/<folder-uuid>/<reader|writer|manager>";

/**
 * Checks an authorization request for the actor who is asked to approve it.
 *
 * - The client must exist and the redirect address must be one of its own: the same text, except that the port is
 *   ignored for `http` on a loopback address. If either is wrong, the answer must not redirect (`unknown-client`,
 *   `foreign-redirect-uri`).
 * - Everything else goes back to the client as an error (`refused`), in this order: `response_type` must be `code`,
 *   PKCE must be `S256` with a valid challenge, and `resource` must be the full MCP address of a folder
 *   (`invalid_target`), whether that folder exists or not. Then an admin, who connects no apps, gets `access_denied`.
 *   Then the folder must exist and the actor's current role on it must include the role of the address; a missing
 *   folder, a folder without a role of the actor and a role too low all get the same `access_denied`.
 * - There are no scopes: a `scope` that a client sends is not even read.
 */
export async function checkAuthorizationRequest(
  actor: Actor,
  params: AuthorizationParams,
): Promise<Result<AuthorizationRequest, CheckAuthorizationError>> {
  const clientId = params.client_id;
  if (clientId === undefined || clientId.length > URL_MAX_LENGTH) {
    return { ok: false, error: { code: "unknown-client" } };
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
    return { ok: false, error: { code: "unknown-client" } };
  }
  const client = toClient(row);

  const redirectUri = params.redirect_uri;
  if (redirectUri === undefined || !isRedirectUriOf(client.redirectUris, redirectUri)) {
    logger.warn({ reason: "foreign-redirect-uri", clientRowId: client.id }, "authorization request refused");
    return { ok: false, error: { code: "foreign-redirect-uri" } };
  }

  // A `state` that is too long is not sent back; everything else about it is the client's business.
  const state = params.state !== undefined && params.state.length <= URL_MAX_LENGTH ? params.state : null;
  // Each refusal is logged with a reason of its own; the client gets the error of the protocol and its description.
  const refuse = (
    reason: string,
    error: OAuthError,
    description: string,
    details: Record<string, unknown> = {},
  ): Result<AuthorizationRequest, CheckAuthorizationError> => {
    logger.warn({ reason, clientRowId: client.id, ...details }, "authorization request refused");
    return { ok: false, error: { code: "refused", redirectUri, state, error, description } };
  };

  if (params.state !== undefined && state === null) {
    return refuse("state-too-long", "invalid_request", "state is too long");
  }
  if (params.response_type === undefined) {
    return refuse("missing-response-type", "invalid_request", "response_type is missing");
  }
  if (params.response_type !== "code") {
    return refuse("unsupported-response-type", "unsupported_response_type", "Only the response type code is supported");
  }
  if (params.code_challenge_method !== "S256") {
    return refuse("missing-pkce", "invalid_request", "PKCE with the code_challenge_method S256 is required");
  }
  const codeChallenge = params.code_challenge;
  if (codeChallenge === undefined || !isCodeChallenge(codeChallenge)) {
    return refuse(
      "invalid-code-challenge",
      "invalid_request",
      "code_challenge is missing or not a challenge of the method S256",
    );
  }
  const target = mcpAddressOf(params.resource);
  if (!target) return refuse("not-mcp-address", "invalid_target", NOT_MCP_ADDRESS);
  if (isAdmin(actor)) return refuse("admin", "access_denied", ADMIN_REFUSAL_DESCRIPTION);

  let folder: { id: string; name: string } | null;
  try {
    const role = await folderRoleOf(actor, target.folderId);
    folder =
      role && includesRole(role, target.role)
        ? await getDb().folder.findUnique({ where: { id: target.folderId }, select: { id: true, name: true } })
        : null;
  } catch (err) {
    logger.error({ err, clientRowId: client.id }, "failed to read the folder of an authorization request");
    return { ok: false, error: { code: "failed" } };
  }
  if (!folder) {
    return refuse("address-not-allowed", "access_denied", ADDRESS_REFUSAL_DESCRIPTION, {
      folderId: target.folderId,
      role: target.role,
    });
  }

  return { ok: true, value: { client, address: { folder, role: target.role }, redirectUri, codeChallenge, state } };
}

/**
 * Whether the actor already holds the most connected apps a user may hold, not counting the grants that a new grant
 * to the client at the given MCP address would replace. The consent page asks before it offers to approve; the
 * exchange of the code decides. `true` for a malformed id and for a client that does not exist: there is nothing to
 * approve then.
 */
export async function isGrantLimitReached(actor: Actor, clientRowId: string, address: McpAddress): Promise<boolean> {
  const userId = parseUserId(actor.id);
  const clientId = parseClientRowId(clientRowId);
  if (!userId || !clientId) return true;
  const db = getDb();
  const client = await db.oAuthClient.findUnique({ where: { id: clientId }, select: CLIENT_SELECT });
  if (!client) return true;
  // Two counts instead of one with `NOT`, so that the replaced grants are counted by the same condition that the
  // exchange deletes them with.
  const all = await db.oAuthGrant.count({ where: { userId } });
  const replaced = await db.oAuthGrant.count({ where: replacedGrants(userId, client, address) });
  return all - replaced >= MAX_GRANTS_PER_USER;
}

/** The chosen lifetime is not one of the choices. */
type InvalidLifetime = { code: "invalid-lifetime" };
/** The actor holds the most connected apps a user may hold, the grants this one would replace not counted. */
type LimitReached = { code: "limit-reached" };

type CreateCodeError = CheckAuthorizationError | InvalidLifetime | LimitReached;

/** A code that was just created, with the request it answers. The code leaves the service this once. */
type CreatedCode = { code: string; request: AuthorizationRequest };

/**
 * Creates an authorization code for a request that the actor approved, with the lifetime of the grant that the actor
 * chose (`30d`, `90d` or `365d`) and the MCP address of the request. The request is checked again here, with the
 * actor's current role, because its parameters come back from a form. The code works once and for ten minutes. An
 * admin, who connects no apps, gets the refusal `access_denied` for an otherwise valid request, and no code is
 * written.
 */
export async function createCode(
  actor: Actor,
  params: AuthorizationParams,
  lifetime: string,
): Promise<Result<CreatedCode, CreateCodeError>> {
  const actorId = parseUserId(actor.id);
  if (!actorId) {
    logger.error({ actorId: actor.id }, "malformed actor id");
    return { ok: false, error: { code: "failed" } };
  }
  const parsedLifetime = grantLifetimeSchema.safeParse(lifetime);
  if (!parsedLifetime.success) return { ok: false, error: { code: "invalid-lifetime" } };

  const checked = await checkAuthorizationRequest(actor, params);
  if (!checked.ok) return checked;
  const request = checked.value;
  const clientRowId = request.client.id;
  const address = { folderId: request.address.folder.id, role: request.address.role };

  const code = generateCode();
  try {
    if (await isGrantLimitReached(actor, clientRowId, address)) {
      logger.warn({ actorId, clientRowId }, "authorization code not created: the user holds the most grants allowed");
      return { ok: false, error: { code: "limit-reached" } };
    }
    await getDb().oAuthCode.create({
      data: {
        codeHash: hashSecret(code),
        clientId: clientRowId,
        userId: actorId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        folderId: address.folderId,
        role: address.role,
        lifetime: parsedLifetime.data,
        expiresAt: new Date(currentTime().getTime() + CODE_LIFETIME_MS),
      },
      select: { id: true },
    });
  } catch (err) {
    // Also an actor or a client that was deleted in the meantime.
    logger.error({ err, actorId, clientRowId }, "failed to create authorization code");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ actorId, clientRowId, ...address }, "authorization code created");
  await deleteStaleRows();
  return { ok: true, value: { code, request } };
}
