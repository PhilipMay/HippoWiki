// Helpers for the end-to-end tests of the MCP server: a test stands in for an MCP client, which has no session cookie,
// only the access token of its grant (see `createGrant()` in ./database.ts). Every test that `setUpProjects()` sets up
// connects as a user of its own, not as the known user `alice`: the server of a worker keeps the budget of the rate
// limit of MCP per user in its memory, which `resetTestDatabase()` does not empty, so the known user would share one
// budget across all MCP specs of that worker and a spec could meet the limit (429) in the complete suite.
import type { APIRequestContext, APIResponse } from "@playwright/test";

import type { User } from "@/generated/prisma/client";

import { createFolder, createGrant, createUser, resetTestDatabase } from "./database";
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

/** The Reader connection of the owner of "projects" of the running test, set by `setUpProjects()`. */
let projectsReader: McpConnection = { address: "", token: null };

/**
 * Resets the test database, creates a user of its own for the test, with `TEST_PASSWORD` and the password change
 * already done, and the folder "projects", of which that user is the Owner and the last editor, with a grant of that
 * user at its Reader address. Returns the folder, the user as `owner`, the path of the address and the access token.
 * Until the next call, `send()` and `call()` use this connection unless a test gives another token or address. The
 * specs of MCP call it in `beforeEach`. The user is new for every test, so that its MCP requests never share the
 * budget of the rate limit with another test: the server of a worker keeps that budget per user in its memory, where
 * it outlives `resetTestDatabase()`.
 */
export async function setUpProjects(): Promise<{
  projects: Awaited<ReturnType<typeof createFolder>>;
  owner: User;
  address: string;
  secret: string;
}> {
  await resetTestDatabase();
  const owner = await createUser({ mustChangePassword: false });
  const projects = await createFolder({ name: "projects", editor: owner, roles: [{ user: owner, role: "owner" }] });
  const address = mcpPath(projects, "reader");
  const { accessToken: secret } = await createGrant({ owner, folder: projects });
  projectsReader = { address, token: secret };
  return { projects, owner, address, secret };
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
