// Helpers for the end-to-end tests of the MCP server: a test stands in for an MCP client, which has no session cookie,
// only the access token of its grant (see `createGrant()` in ./database.ts).
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { expect } from "./test";

/** An MCP address of a folder, such as `/mcp/<folder-id>/reader`, and the bearer token a client sends there. */
export type McpConnection = { address: string; token: string | null };

/** The result of a tool call. */
export type ToolResult = { content: { type: string; text: string }[]; structuredContent?: unknown; isError?: boolean };

/** The path of the MCP address of the folder for the role. */
export function mcpPath(folder: { id: string }, role: "reader" | "writer" | "manager" | (string & {})): string {
  return `/mcp/${folder.id}/${role}`;
}

/** Sends a JSON-RPC message over the connection, as a client of the protocol of 2025 does. */
export function sendMcp(
  request: APIRequestContext,
  { address, token }: McpConnection,
  message: Record<string, unknown>,
): Promise<APIResponse> {
  return request.post(address, {
    headers: {
      accept: "application/json, text/event-stream",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    data: { jsonrpc: "2.0", id: 1, ...message },
    maxRedirects: 0,
  });
}

/** Calls a tool over the connection and returns its result; the answer itself has to be a JSON answer with 200. */
export async function callTool(
  request: APIRequestContext,
  connection: McpConnection,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const response = await sendMcp(request, connection, { method: "tools/call", params: { name, arguments: args } });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/json");
  return ((await response.json()) as { result: ToolResult }).result;
}
