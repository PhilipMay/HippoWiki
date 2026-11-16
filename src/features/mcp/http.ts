// The adapter between the route `/mcp` and the MCP server: it is to an MCP client what `queries.ts` is to the GUI. It is
// the place where the actor of a request comes from the bearer token instead of the session: every request is
// checked with `authenticateToken()` before the SDK sees it. The SDK then speaks the protocol (Streamable HTTP,
// stateless, with JSON answers and no SSE) and calls the tools of `tools.ts`. The bearer token is the access token of
// a grant to an OAuth client, and the 401 says where a client finds the authorization server. Without
// `HIPPOWIKI_PUBLIC_URL` there is no OAuth and therefore no MCP server: every request answers 404.

import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type AuthInfo,
  type McpHttpHandler,
  type McpRequestContext,
} from "@modelcontextprotocol/server";

import { createWikiServer } from "@/features/mcp/tools";
import { protectedResourceMetadataUrl } from "@/features/oauth/issuer";
import * as tokenService from "@/features/tokens/service";
import type { Actor } from "@/features/users/service";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/** The scope an access token needs for `/mcp`: all tools only read. */
const MCP_SCOPE = "read";

/** An answer that is not one of the protocol: a status, a short reason as JSON and headers. */
function refusal(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers });
}

/** The value of a `WWW-Authenticate` header with the scheme `Bearer` and the given parameters (RFC 6750). */
function bearerChallenge(...parameters: string[]): string {
  return parameters.length === 0 ? "Bearer" : `Bearer ${parameters.join(", ")}`;
}

/**
 * Whether the request may come from where it says it comes from. Only browsers send `Origin`, and an MCP client is
 * not a page of another site: a request with an `Origin` that is not exactly the public URL of the wiki is refused, so
 * that a page which makes its host name resolve to the address of the wiki (DNS rebinding) cannot talk to `/mcp`. The
 * host the request was sent to is not enough, because such a page sends its own host name.
 */
function hasForeignOrigin(request: Request, publicUrl: string): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== publicUrl;
}

/**
 * The actor of a request as the authentication information that the handler of the SDK passes on, unread, to the
 * factory of the server: the handler is created once, and this is how each request hands it its actor. The token
 * itself is not passed on, so it stays out of everything the SDK keeps.
 */
function authInfoOf(actor: Actor): AuthInfo {
  return { token: "", clientId: actor.id, scopes: [MCP_SCOPE], extra: { actor } };
}

/** The actor that `authInfoOf()` handed to the factory. Without one the request was not checked, which never happens. */
function actorOf({ authInfo }: McpRequestContext): Actor {
  const actor = authInfo?.extra?.actor;
  if (!actor) throw new Error("mcp request without an actor");
  return actor as Actor;
}

let modernHandler: McpHttpHandler | undefined;

/**
 * The handler of the SDK for clients of the current protocol. It is created on first use, because the SDK prints a
 * note when it is, and answers everything as JSON: `subscriptions/listen`, the one request the SDK would always
 * answer as a stream, is refused by allowing no subscriptions. Clients of the older protocol are served by
 * `serveLegacy()` instead.
 */
function getModernHandler(): McpHttpHandler {
  modernHandler ??= createMcpHandler(
    (context) => createWikiServer({ publicUrl: getServerEnv().HIPPOWIKI_PUBLIC_URL, actor: actorOf(context) }),
    {
      responseMode: "json",
      legacy: "reject",
      maxSubscriptions: 0,
      onerror: (err) => logger.warn({ err }, "mcp request refused"),
    },
  );
  return modernHandler;
}

/**
 * Serves a request of a client that speaks the protocol of 2025, which opens with `initialize`: a server and a
 * transport of their own for this one request, without a session, with a JSON answer. The handler of the SDK would
 * answer these clients as a stream.
 */
async function serveLegacy(request: Request, actor: Actor): Promise<Response> {
  const server = createWikiServer({ publicUrl: getServerEnv().HIPPOWIKI_PUBLIC_URL, actor });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  transport.onerror = (err) => logger.warn({ err }, "mcp request refused");
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

/**
 * Answers a request to `/mcp`.
 *
 * - Without `HIPPOWIKI_PUBLIC_URL` every request answers 404, like the endpoints of OAuth, before anything else is
 *   looked at: without OAuth there is no MCP server.
 * - Anything but `POST` answers 405: there are no sessions to end and no stream to open.
 * - An `Origin` that is not the public URL answers 403.
 * - Without a valid access token it answers 401 with `WWW-Authenticate: Bearer`, the metadata of the protected
 *   resource (`resource_metadata`, RFC 9728) and the scope to ask for; for a token without the scope `read` 403 with
 *   `error="insufficient_scope"`, and 500 when the token could not be checked.
 * - Everything else goes to the MCP server.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const { HIPPOWIKI_PUBLIC_URL: publicUrl } = getServerEnv();
  const resourceMetadata = protectedResourceMetadataUrl();
  if (publicUrl === undefined || resourceMetadata === null) return refusal(404, "not_found");

  if (request.method !== "POST") return refusal(405, "method_not_allowed", { Allow: "POST" });

  if (hasForeignOrigin(request, publicUrl)) {
    logger.warn("mcp request with a foreign origin refused");
    return refusal(403, "forbidden_origin");
  }

  // The access token has to be valid and to have the scope; its user is the actor of the tools, and the services
  // decide what the actor may read.
  const actor = await tokenService.authenticateToken(request.headers, MCP_SCOPE);
  if (!actor.ok) {
    // What a client needs to start the OAuth flow, after the error if there is one.
    const discovery = [`resource_metadata="${resourceMetadata}"`, `scope="${MCP_SCOPE}"`];
    switch (actor.error.code) {
      case "missing-token":
        return refusal(401, "unauthorized", { "WWW-Authenticate": bearerChallenge(...discovery) });
      case "invalid-token":
        return refusal(401, "invalid_token", {
          "WWW-Authenticate": bearerChallenge('error="invalid_token"', ...discovery),
        });
      case "insufficient-scope":
        return refusal(403, "insufficient_scope", {
          "WWW-Authenticate": bearerChallenge('error="insufficient_scope"', `scope="${MCP_SCOPE}"`),
        });
      case "failed":
        return refusal(500, "server_error");
    }
  }

  try {
    return (await isLegacyRequest(request))
      ? await serveLegacy(request, actor.value)
      : await getModernHandler().fetch(request, { authInfo: authInfoOf(actor.value) });
  } catch (err) {
    logger.error({ err, userId: actor.value.id }, "mcp request failed");
    return refusal(500, "server_error");
  }
}
