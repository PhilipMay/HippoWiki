// The adapter between the MCP addresses of the folders, `/mcp/<folder-uuid>/<reader|writer|manager>`, and the MCP
// server: it is to an MCP client what `queries.ts` is to the GUI. It is the place where the actor of a request comes
// from the bearer token instead of the session: every request is checked with `authenticateAccessToken()` for its
// address before the SDK sees it. The SDK then speaks the protocol (Streamable HTTP, stateless, with JSON answers and
// no SSE) and calls the tools of the server of `server.ts`. The bearer token is the access token of a grant to an OAuth client at
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

import { createWikiServer } from "@/features/mcp/server";
import type { WikiToolsOptions } from "@/features/mcp/tools";
import { inMcp, type McpActor } from "@/features/folder-roles/actors";
import * as folderService from "@/features/folders/service";
import { issuer, protectedResourceMetadataUrl } from "@/features/oauth/issuer";
import { parseMcpPath } from "@/features/oauth/schema";
import * as grantService from "@/features/grants/service";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/** An answer that is not one of the protocol: a status, a short reason as JSON and headers. */
function refusal(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers });
}

/** Why a valid access token is refused at its address: the user's role on the folder is too low for it now. */
const ROLE_TOO_LOW_MESSAGE = "Your role on the folder does not allow this address.";

/** The answer to a valid access token whose user's role no longer allows its address: 403, without a challenge. */
function roleTooLow(): Response {
  return Response.json({ error: "role_too_low", error_description: ROLE_TOO_LOW_MESSAGE }, { status: 403 });
}

/** Logs an error of the SDK with a request, such as a body that is no JSON-RPC message. */
function logRefused(err: unknown): void {
  logger.warn({ err }, "mcp request refused");
}

/** The body limit of an MCP request in bytes, `HIPPOWIKI_MCP_BODY_LIMIT` (`src/lib/env.ts`). */
function bodyLimit(): number {
  return getServerEnv().HIPPOWIKI_MCP_BODY_LIMIT;
}

/** The body of a request, read up to the body limit, or that it is larger. */
type ReadBody = { tooLarge: true } | { tooLarge: false; text: string };

/**
 * Reads the body of a request as text, at most `limit` bytes. A `Content-Length` over the limit is refused without
 * reading anything; a body without one, sent in chunks, is read until more than the limit has arrived, and then the
 * rest is cancelled instead of read.
 */
async function readBody(request: Request, limit: number): Promise<ReadBody> {
  if (Number(request.headers.get("content-length")) > limit) return { tooLarge: true };
  if (request.body === null) return { tooLarge: false, text: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel().catch(() => undefined);
      return { tooLarge: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  return { tooLarge: false, text: text + decoder.decode() };
}

/** What the log of a refused request names: the user, the grant and the address, never the token or the body. */
function logContextOf(actor: McpActor): Record<string, string> {
  return {
    userId: actor.id,
    grantId: actor.connection.grantId,
    folderId: actor.connection.folderId,
    role: actor.connection.role,
  };
}

/** The message of the JSON-RPC error with which a batch is refused. */
const BATCH_MESSAGE =
  "Invalid Request: batches are not supported. Send the calls one by one, each in a request of its own.";

/**
 * The answer to a JSON-RPC batch, a body that is a JSON array: 400 with the error "Invalid Request" (`-32600`) for the
 * request as a whole, so that a client of the protocol reads why. No message of the batch is answered.
 */
function batchRefused(): Response {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: BATCH_MESSAGE } }, { status: 400 });
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
 * The public URL, the actor and the folder of a request as the authentication information that the handler of the SDK passes on,
 * unread, to the factory of the server: the handler is created once, and this is how each request hands it its
 * connection. The token itself is not passed on, so it stays out of everything the SDK keeps.
 */
function authInfoOf(connected: WikiToolsOptions): AuthInfo {
  return { token: "", clientId: connected.actor.connection.grantId, scopes: [], extra: { connected } };
}

/** What `authInfoOf()` handed to the factory. Without it the request was not checked, which never happens. */
function connectedOf({ authInfo }: McpRequestContext): WikiToolsOptions {
  const connected = authInfo?.extra?.connected;
  if (!connected) throw new Error("mcp request without a connection");
  return connected as WikiToolsOptions;
}

let modernHandler: McpHttpHandler | undefined;

/**
 * The handler of the SDK for the current clients, which speak the protocol revision 2026-07-28 and send the
 * per-request `_meta` envelope. It is created on first use, because the SDK prints a note when it is, and answers
 * everything as JSON: `subscriptions/listen`, the one request the SDK would always answer as a stream, is refused by
 * allowing no subscriptions. The older clients, which send no per-request `_meta` envelope, are served by
 * `serveLegacy()` instead. The adapter hands it the body parsed, read under the body limit of the wiki and never a
 * batch; the same limit is its own `maxRequestBodySize`, for the body that is no JSON, which it reads itself, so that
 * the SDK never applies a limit of its own.
 */
function getModernHandler(): McpHttpHandler {
  modernHandler ??= createMcpHandler((context) => createWikiServer(connectedOf(context)), {
    responseMode: "json",
    legacy: "reject",
    maxSubscriptions: 0,
    maxRequestBodySize: bodyLimit(),
    onerror: logRefused,
  });
  return modernHandler;
}

/**
 * Serves a request of an older client, one of the older protocol revisions that the SDK serves, which sends no
 * per-request `_meta` envelope (`isLegacyRequest()` of the SDK decides it), whether or not it opens with `initialize`:
 * a server and a transport of their own for this one request, without a session, with a JSON answer. The handler of
 * the SDK would answer these clients as a stream. Like the handler, the transport gets the body parsed, and the body
 * limit of the wiki for the body that is no JSON.
 */
async function serveLegacy(request: Request, connected: WikiToolsOptions, parsedBody: unknown): Promise<Response> {
  const server = createWikiServer(connected);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: bodyLimit(),
  });
  transport.onerror = logRefused;
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { parsedBody });
  } finally {
    await server.close();
  }
}

/** What `parseJson()` returns for a text that is no JSON, or empty. */
const NOT_JSON = Symbol("not JSON");

/** The parsed JSON of a body, or `NOT_JSON`. */
function parseJson(text: string): unknown {
  if (text.length === 0) return NOT_JSON;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}

/**
 * Hands a request to the SDK, with its body parsed already (`undefined` when the SDK reads it itself): to
 * `serveLegacy()` for an older client, to the handler of the current protocol otherwise.
 */
async function serve(
  request: Request,
  connected: WikiToolsOptions,
  parsedBody: unknown,
  limit: number,
): Promise<Response> {
  return (await isLegacyRequest(request, parsedBody, { maxRequestBodySize: limit }))
    ? await serveLegacy(request, connected, parsedBody)
    : await getModernHandler().fetch(request, { authInfo: authInfoOf(connected), parsedBody });
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
 * 6. A body over the body limit of the wiki, `HIPPOWIKI_MCP_BODY_LIMIT` (1 MiB by default), answers 413, whether it
 *    has a `Content-Length` or is sent in chunks; the reading stops at the limit. Only now is the body read at all.
 * 7. A JSON-RPC batch, a body that is a JSON array, answers 400 with the JSON-RPC error `-32600`, for every protocol
 *    revision, and is logged without its content; no message of it is answered, so no tool runs. A body that is no
 *    JSON gets the answer of the SDK.
 *
 * Everything else goes to the MCP server, with the actor of MCP and the folder of the connection, read for this
 * request so that its name is the current one.
 */
export async function handleMcpRequest(request: Request, path: readonly string[] | undefined): Promise<Response> {
  // Without the issuer OAuth is off (`isOAuthOn()`), and so is the MCP server.
  const publicUrl = issuer();
  if (publicUrl === null) return refusal(404, "not_found");

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
        return roleTooLow();
      case "failed":
        return refusal(500, "server_error");
    }
  }

  const actor = inMcp(caller.value.actor, caller.value.connection);
  try {
    const folder = await folderService.getFolderById(actor, actor.connection.folderId);
    if (!folder) return roleTooLow();
    const connected: WikiToolsOptions = { publicUrl, actor, folder: { id: folder.id, name: folder.name } };

    // The adapter reads the body itself, once, under the body limit of the wiki, and hands it on parsed.
    const limit = bodyLimit();
    const body = await readBody(request, limit);
    if (body.tooLarge) {
      logger.warn({ ...logContextOf(actor), limit }, "mcp request refused: the body is over the limit");
      return refusal(413, "request_too_large");
    }
    const parsed = parseJson(body.text);
    if (parsed === NOT_JSON) {
      // A body that is no JSON, or empty, gets the answer of the SDK, which reads it again from a copy.
      const copy = new Request(request.url, { method: request.method, headers: request.headers, body: body.text });
      return await serve(copy, connected, undefined, limit);
    }
    // A batch is refused as a whole, before the path of the protocol revision is chosen, so for every revision.
    if (Array.isArray(parsed)) {
      logger.warn(logContextOf(actor), "mcp batch refused");
      return batchRefused();
    }
    return await serve(request, connected, parsed, limit);
  } catch (err) {
    logger.error({ err, userId: actor.id }, "mcp request failed");
    return refusal(500, "server_error");
  }
}
