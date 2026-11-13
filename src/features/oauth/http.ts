// The adapters between the public endpoints of OAuth and the OAuth service: the two metadata documents, the
// registration of a client and the token endpoint. Their routes only hand the request over. Every one answers 404
// while `HIPPOWIKI_PUBLIC_URL` is not set: without a public address there is no OAuth. The consent page, the one
// endpoint behind the login, has its adapters in `queries.ts` and `actions.ts`.

import { issuer, mcpResource } from "@/features/oauth/issuer";
import { GRANT_SCOPES, type OAuthError } from "@/features/oauth/schema";
import * as oauthService from "@/features/oauth/service";
import { mcpPath, oauthAuthorizePath, oauthRegisterPath, oauthTokenPath } from "@/lib/addresses";
import { clientAddressGroup } from "@/lib/client-address";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/** The most bytes of a request body that the registration and the token endpoint read. */
export const MAX_BODY_BYTES = 64 * 1024;

/** The answer of every endpoint while OAuth is off. */
function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

/** The headers that keep an answer with a token or a client out of every cache (RFC 6749, section 5.1). */
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** An error in the shape of RFC 6749: the code and a description for the developer of the client. */
function oauthError(
  status: number,
  error: OAuthError,
  description: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json({ error, error_description: description }, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * The metadata of the authorization server (RFC 8414), at `/.well-known/oauth-authorization-server`. The issuer is
 * exactly `HIPPOWIKI_PUBLIC_URL`. `offline_access` is not among the scopes: every grant can be refreshed.
 */
export function authorizationServerMetadata(): Response {
  const base = issuer();
  if (base === null) return notFound();
  return Response.json({
    issuer: base,
    authorization_endpoint: `${base}${oauthAuthorizePath()}`,
    token_endpoint: `${base}${oauthTokenPath()}`,
    registration_endpoint: `${base}${oauthRegisterPath()}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...GRANT_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  });
}

/**
 * The metadata of the protected resource (RFC 9728), at `/.well-known/oauth-protected-resource` and at the same
 * address followed by `/mcp`. `path` is what follows the well-known prefix; any other path is not found. The resource
 * is the MCP endpoint in both cases, and the wiki is its only authorization server.
 */
export function protectedResourceMetadata(path: readonly string[] | undefined): Response {
  const base = issuer();
  const resource = mcpResource();
  if (base === null || resource === null) return notFound();
  const suffix = `/${(path ?? []).join("/")}`;
  if (suffix !== "/" && suffix !== mcpPath()) return notFound();
  return Response.json({
    resource,
    authorization_servers: [base],
    scopes_supported: [...GRANT_SCOPES],
    bearer_methods_supported: ["header"],
  });
}

/** The body of a request as text, or `null` if it is longer than `MAX_BODY_BYTES` or cannot be read. */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  try {
    const body = await request.text();
    return Buffer.byteLength(body) > MAX_BODY_BYTES ? null : body;
  } catch {
    return null;
  }
}

/** The media type of the body of a request, without its parameters, in lower case. */
function mediaTypeOf(request: Request): string {
  return (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Registers a client (dynamic client registration, RFC 7591), at `/oauth/register`: JSON in, and 201 with the client
 * as a public client. Metadata that is refused answers 400, the limit of registrations per client address group and
 * hour 429 with `Retry-After`. Every answer has `Cache-Control: no-store`.
 *
 * The endpoint is public, so it reads the client address itself, as the login action does: with
 * `HIPPOWIKI_TRUSTED_PROXIES` from `X-Forwarded-For`. The service only gets the group.
 */
export async function handleRegister(request: Request): Promise<Response> {
  if (issuer() === null) return notFound();

  const body = await readBody(request);
  let metadata: unknown;
  try {
    if (body === null) throw new Error("no body");
    metadata = JSON.parse(body);
  } catch {
    return oauthError(400, "invalid_client_metadata", "The body must be a JSON object of at most 64 KB");
  }

  const { group, fallback } = clientAddressGroup(request.headers, getServerEnv().HIPPOWIKI_TRUSTED_PROXIES);
  if (fallback) {
    // The value of the header is not logged; `HIPPOWIKI_LOG_CLIENT_ADDRESS` shows it.
    logger.warn(
      { reason: fallback },
      "no client address in X-Forwarded-For, the registration counts in the shared group",
    );
  }

  const result = await oauthService.registerClient(metadata, group);
  if (!result.ok) {
    switch (result.error.code) {
      case "invalid-client-metadata":
        return oauthError(400, "invalid_client_metadata", result.error.description);
      case "invalid-redirect-uri":
        return oauthError(400, "invalid_redirect_uri", result.error.description);
      case "wait":
        return oauthError(429, "temporarily_unavailable", "Too many clients were registered. Try again later.", {
          "Retry-After": String(Math.max(1, Math.ceil(result.error.waitMs / 1000))),
        });
      case "failed":
        return oauthError(500, "server_error", "The client could not be registered");
    }
  }

  const client = result.value;
  return Response.json(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      // What the client is, whatever it asked for: public, with the code flow and refresh tokens.
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: NO_STORE },
  );
}

/** The parameters of a token request, each one at most once, or `null` if the body is not one. */
async function readTokenParams(request: Request): Promise<Map<string, string> | null> {
  const body = await readBody(request);
  if (body === null) return null;
  const params = new Map<string, string>();
  const add = (name: string, value: string): boolean => {
    // A parameter must not be sent more than once (RFC 6749, section 3.2).
    if (params.has(name)) return false;
    params.set(name, value);
    return true;
  };

  switch (mediaTypeOf(request)) {
    case "application/x-www-form-urlencoded": {
      for (const [name, value] of new URLSearchParams(body)) {
        if (!add(name, value)) return null;
      }
      return params;
    }
    case "application/json": {
      let fields: unknown;
      try {
        fields = JSON.parse(body);
      } catch {
        return null;
      }
      if (typeof fields !== "object" || fields === null || Array.isArray(fields)) return null;
      for (const [name, value] of Object.entries(fields)) {
        // Only texts are parameters; anything else is left out and is then missing.
        if (typeof value === "string") add(name, value);
      }
      return params;
    }
    default:
      return null;
  }
}

/**
 * The token endpoint, at `/oauth/token`: exchanges a code (`authorization_code`) or refreshes a grant
 * (`refresh_token`). The body is `application/x-www-form-urlencoded`, as RFC 6749 asks, or JSON. Errors have the shape
 * of RFC 6749 with status 400, `invalid_client` with 401. Every answer has `Cache-Control: no-store`.
 */
export async function handleToken(request: Request): Promise<Response> {
  if (issuer() === null) return notFound();

  const params = await readTokenParams(request);
  if (params === null) {
    return oauthError(
      400,
      "invalid_request",
      "The body must be application/x-www-form-urlencoded or JSON, with every parameter at most once",
    );
  }

  let result: Awaited<ReturnType<typeof oauthService.exchangeCode>>;
  switch (params.get("grant_type")) {
    case undefined:
      return oauthError(400, "invalid_request", "grant_type is missing");
    case "authorization_code":
      result = await oauthService.exchangeCode({
        code: params.get("code"),
        clientId: params.get("client_id"),
        redirectUri: params.get("redirect_uri"),
        codeVerifier: params.get("code_verifier"),
        resource: params.get("resource"),
      });
      break;
    case "refresh_token":
      result = await oauthService.refreshGrant({
        refreshToken: params.get("refresh_token"),
        clientId: params.get("client_id"),
        resource: params.get("resource"),
      });
      break;
    default:
      return oauthError(
        400,
        "unsupported_grant_type",
        "Only the grant types authorization_code and refresh_token are supported",
      );
  }

  if (!result.ok) {
    switch (result.error.code) {
      case "invalid-request":
        return oauthError(400, "invalid_request", result.error.description);
      case "invalid-grant":
        return oauthError(400, "invalid_grant", result.error.description);
      case "invalid-target":
        return oauthError(400, "invalid_target", result.error.description);
      case "invalid-client":
        return oauthError(401, "invalid_client", result.error.description);
      case "failed":
        return oauthError(500, "server_error", "The token request could not be answered");
    }
  }

  const tokens = result.value;
  return Response.json(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.scopes.join(" "),
    },
    { headers: NO_STORE },
  );
}
