// Helpers for the end-to-end tests of the MCP server: a test stands in for an MCP client, which has no session cookie,
// only the access token of its grant (see `createGrant()` in ./database.ts).
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { KNOWN_USER } from "../../prisma/known-users";
import { createFolder, createGrant, getTestDb, resetTestDatabase } from "./database";
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
function sendMcp(
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

/** The Reader connection of the known user to "projects" of the running test, set by `setUpProjects()`. */
let projectsReader: McpConnection = { address: "", token: null };

/**
 * Resets the test database and creates the folder "projects", of which the known user `alice` is Owner, with a grant
 * of that user at its Reader address. Returns the folder, the path of the address and the access token. Until the
 * next call, `send()` and `call()` use this connection unless a test gives another token or address. The specs of MCP
 * call it in `beforeEach`.
 */
export async function setUpProjects(): Promise<{
  projects: Awaited<ReturnType<typeof createFolder>>;
  address: string;
  secret: string;
}> {
  await resetTestDatabase();
  const editor = await getTestDb().user.findUniqueOrThrow({ where: { id: KNOWN_USER.id } });
  const projects = await createFolder({ name: "projects", editor });
  const address = mcpPath(projects, "reader");
  const { accessToken: secret } = await createGrant({ owner: KNOWN_USER, folder: projects });
  projectsReader = { address, token: secret };
  return { projects, address, secret };
}

/**
 * Sends a JSON-RPC message to an MCP address, by default the Reader address of "projects" of `setUpProjects()`, with
 * the given token, which is `null` for none.
 */
export function send(
  request: APIRequestContext,
  message: Record<string, unknown>,
  token: string | null = projectsReader.token,
  to: string = projectsReader.address,
): Promise<APIResponse> {
  return sendMcp(request, { address: to, token }, message);
}

/** Calls a tool, by default at the Reader address of "projects" of `setUpProjects()`, and returns its result. */
export function call(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {},
  token: string | null = projectsReader.token,
  to: string = projectsReader.address,
): Promise<ToolResult> {
  return callTool(request, { address: to, token }, name, args);
}
