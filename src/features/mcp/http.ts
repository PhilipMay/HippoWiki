// The adapter between the MCP addresses of the folders, `/mcp/<folder-uuid>/<reader|writer|manager>`, and the MCP
// server: it is to an MCP client what `queries.ts` is to the GUI. It is the place where the actor of a request comes
// from the bearer token instead of the session: every request is checked with `authenticateAccessToken()` for its
// address before the SDK sees it. The SDK then speaks the protocol (Streamable HTTP, stateless, with JSON answers and
// no SSE) and calls the tools of `tools.ts`. The bearer token is the access token of a grant to an OAuth client at
// exactly that address, and the 401 says where a client finds the authorization server. Without
// `HIPPOWIKI_PUBLIC_URL` there is no OAuth and therefore no MCP server: every request answers 404.

import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type AuthInfo,
  type McpHttpHandler,
  type McpRequestContext,
} from "@modelcontextprotocol/server";

import { createWikiServer, type WikiToolsOptions } from "@/features/mcp/tools";
import { inMcp } from "@/features/folder-roles/actors";
import * as folderService from "@/features/folders/service";
import { protectedResourceMetadataUrl } from "@/features/oauth/issuer";
import { parseMcpPath } from "@/features/oauth/schema";
import * as grantService from "@/features/grants/service";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/** An answer that is not one of the protocol: a status, a short reason as JSON and headers. */
function refusal(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers });
}

/** Why a valid access token is refused at its address: the user's role on the folder is too low for it now. */
export const ROLE_TOO_LOW_MESSAGE = "Your role on the folder does not allow this address.";

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

/** What the tools of a request are built with, apart from the public URL: the actor of MCP and its folder. */
type Connected = Pick<WikiToolsOptions, "actor" | "folder">;

/**
 * The actor and the folder of a request as the authentication information that the handler of the SDK passes on,
 * unread, to the factory of the server: the handler is created once, and this is how each request hands it its
 * connection. The token itself is not passed on, so it stays out of everything the SDK keeps.
 */
function authInfoOf(connected: Connected): AuthInfo {
  return { token: "", clientId: connected.actor.connection.grantId, scopes: [], extra: { connected } };
}

/** What `authInfoOf()` handed to the factory. Without it the request was not checked, which never happens. */
function connectedOf({ authInfo }: McpRequestContext): Connected {
  const connected = authInfo?.extra?.connected;
  if (!connected) throw new Error("mcp request without a connection");
  return connected as Connected;
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
    (context) => createWikiServer({ publicUrl: getServerEnv().HIPPOWIKI_PUBLIC_URL, ...connectedOf(context) }),
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
async function serveLegacy(request: Request, connected: Connected): Promise<Response> {
  const server = createWikiServer({ publicUrl: getServerEnv().HIPPOWIKI_PUBLIC_URL, ...connected });
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
 * Answers a request to `/mcp` or an address below it; `path` holds the segments of the path after `/mcp`. In this
 * order:
 *
 * 1. Without `HIPPOWIKI_PUBLIC_URL` every request answers 404, like the endpoints of OAuth, before anything else is
 *    looked at: without OAuth there is no MCP server.
 * 2. A path that is not `<folder-uuid>/<reader|writer|manager>` answers 404: the plain `/mcp`, the role Owner and a
 *    part that is no UUID included.
 * 3. Anything but `POST` answers 405: there are no sessions to end and no stream to open. An `Origin` that is not the
 *    public URL answers 403.
 * 4. Without a valid access token for the address it answers 401 with `WWW-Authenticate: Bearer` and the metadata of
 *    the protected resource at the address (`resource_metadata`, RFC 9728), whether a folder of that id exists or
 *    not; with `error="invalid_token"` where a token was sent, the token of another address included. 500 when the
 *    token could not be checked. There are no scopes.
 * 5. A valid token whose user's role on the folder no longer allows the address answers 403 with a short message,
 *    without a challenge, so that the client does not authorize again; no tool runs. So does a folder that can no
 *    longer be read with the actor of MCP, e.g. one deleted in the meantime.
 *
 * Everything else goes to the MCP server, with the actor of MCP and the folder of the connection, read for this
 * request so that its name is the current one.
 */
export async function handleMcpRequest(request: Request, path: readonly string[] | undefined): Promise<Response> {
  const { HIPPOWIKI_PUBLIC_URL: publicUrl } = getServerEnv();
  if (publicUrl === undefined) return refusal(404, "not_found");

  const address = parseMcpPath(path);
  const resourceMetadata = address && protectedResourceMetadataUrl(address);
  if (!address || !resourceMetadata) return refusal(404, "not_found");

  if (request.method !== "POST") return refusal(405, "method_not_allowed", { Allow: "POST" });

  if (hasForeignOrigin(request, publicUrl)) {
    logger.warn("mcp request with a foreign origin refused");
    return refusal(403, "forbidden_origin");
  }

  // The access token has to be valid for the address and its user's role has to allow it; its user is the actor of the
  // tools, and the services decide what the actor may read.
  const caller = await grantService.authenticateAccessToken(request.headers, address);
  if (!caller.ok) {
    // What a client needs to start the OAuth flow, after the error if there is one.
    const discovery = [`resource_metadata="${resourceMetadata}"`];
    switch (caller.error.code) {
      case "missing-token":
        return refusal(401, "unauthorized", { "WWW-Authenticate": bearerChallenge(...discovery) });
      case "invalid-token":
        return refusal(401, "invalid_token", {
          "WWW-Authenticate": bearerChallenge('error="invalid_token"', ...discovery),
        });
      case "role-too-low":
        return Response.json({ error: "role_too_low", error_description: ROLE_TOO_LOW_MESSAGE }, { status: 403 });
      case "failed":
        return refusal(500, "server_error");
    }
  }

  const actor = inMcp(caller.value.actor, caller.value.connection);
  try {
    const folder = await folderService.getFolderById(actor, actor.connection.folderId);
    if (!folder) {
      return Response.json({ error: "role_too_low", error_description: ROLE_TOO_LOW_MESSAGE }, { status: 403 });
    }
    const connected: Connected = { actor, folder: { id: folder.id, name: folder.name } };
    return (await isLegacyRequest(request))
      ? await serveLegacy(request, connected)
      : await getModernHandler().fetch(request, { authInfo: authInfoOf(connected) });
  } catch (err) {
    logger.error({ err, userId: actor.id }, "mcp request failed");
    return refusal(500, "server_error");
  }
}
