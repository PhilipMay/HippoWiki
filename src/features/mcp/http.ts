// The adapter between the route `/mcp` and the MCP server: it is to an MCP client what `queries.ts` is to the GUI. It is
// the place where the actor of a request comes from the bearer token instead of the session: every request is
// checked with `authenticateToken()` before the SDK sees it. The SDK then speaks the protocol (Streamable HTTP,
// stateless, with JSON answers and no SSE) and calls the tools of `tools.ts`.

import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";

import { createWikiServer } from "@/features/mcp/tools";
import * as tokenService from "@/features/tokens/service";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/** The scope a token needs for `/mcp`: all tools only read. */
const MCP_SCOPE = "read";

/** An answer that is not one of the protocol: a status, a short reason as JSON and headers. */
function refusal(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers });
}

/**
 * Whether the request may come from where it says it comes from. Only browsers send `Origin`, and an MCP client is
 * not a page of another site: a request with an `Origin` that is not the wiki's own is refused, so that a page which
 * makes its host name resolve to the address of the wiki (DNS rebinding) cannot talk to `/mcp`. With a public URL
 * the origin must be exactly that; without one, its host must be the host the request was sent to.
 */
function hasForeignOrigin(request: Request, publicUrl: string | undefined): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  if (publicUrl !== undefined) return origin !== publicUrl;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return true;
  }
  return host === "" || host !== request.headers.get("host");
}

let modernHandler: McpHttpHandler | undefined;

/**
 * The handler of the SDK for clients of the current protocol. It is created on first use, because the SDK prints a
 * note when it is, and answers everything as JSON: `subscriptions/listen`, the one request the SDK would always
 * answer as a stream, is refused by allowing no subscriptions. Clients of the older protocol are served by
 * `serveLegacy()` instead.
 */
function getModernHandler(): McpHttpHandler {
  modernHandler ??= createMcpHandler(() => createWikiServer({ publicUrl: getServerEnv().HIPPOWIKI_PUBLIC_URL }), {
    responseMode: "json",
    legacy: "reject",
    maxSubscriptions: 0,
    onerror: (err) => logger.warn({ err }, "mcp request refused"),
  });
  return modernHandler;
}

/**
 * Serves a request of a client that speaks the protocol of 2025, which opens with `initialize`: a server and a
 * transport of their own for this one request, without a session, with a JSON answer. The handler of the SDK would
 * answer these clients as a stream.
 */
async function serveLegacy(request: Request): Promise<Response> {
  const server = createWikiServer({ publicUrl: getServerEnv().HIPPOWIKI_PUBLIC_URL });
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
 * - Anything but `POST` answers 405: there are no sessions to end and no stream to open.
 * - An `Origin` that is not the wiki's own answers 403.
 * - Without a valid token it answers 401 with `WWW-Authenticate: Bearer`, for a token without the scope `read` 403
 *   with `error="insufficient_scope"`, and 500 when the token could not be checked.
 * - Everything else goes to the MCP server.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return refusal(405, "method_not_allowed", { Allow: "POST" });

  const { HIPPOWIKI_PUBLIC_URL: publicUrl } = getServerEnv();
  if (hasForeignOrigin(request, publicUrl)) {
    logger.warn("mcp request with a foreign origin refused");
    return refusal(403, "forbidden_origin");
  }

  // The reads of the folders and pages take no actor: everyone who is logged in may read everything. The token only
  // has to be valid and to have the scope.
  const actor = await tokenService.authenticateToken(request.headers, MCP_SCOPE);
  if (!actor.ok) {
    switch (actor.error.code) {
      case "missing-token":
        return refusal(401, "unauthorized", { "WWW-Authenticate": "Bearer" });
      case "invalid-token":
        return refusal(401, "invalid_token", { "WWW-Authenticate": 'Bearer error="invalid_token"' });
      case "insufficient-scope":
        return refusal(403, "insufficient_scope", {
          "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${MCP_SCOPE}"`,
        });
      case "failed":
        return refusal(500, "server_error");
    }
  }

  try {
    return (await isLegacyRequest(request)) ? await serveLegacy(request) : await getModernHandler().fetch(request);
  } catch (err) {
    logger.error({ err, userId: actor.value.id }, "mcp request failed");
    return refusal(500, "server_error");
  }
}
