// Helpers for the end-to-end tests of OAuth: a test stands in for the client, such as the connector of an AI
// assistant, and for the browser of the user who approves it.
import { createHash } from "node:crypto";

import type { APIRequestContext, Page } from "@playwright/test";

import { expect } from "./test";

/** The public URL of the test server (`HIPPOWIKI_PUBLIC_URL` in `playwright.config.ts`): the issuer. */
export const ISSUER = "http://localhost:3100";

/** The redirect address of the client of the tests: on a loopback address, where nothing listens. */
export const REDIRECT_URI = "http://127.0.0.1:53682/callback";

/** The PKCE verifier of the client of the tests, and its challenge (`S256`). */
export const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
export const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

/** The `state` of the client of the tests, with characters that have to be encoded. */
export const STATE = "state/of the client&more";

/** The full MCP address of the folder for the role, as a client sends it as `resource`. */
export function mcpAddress(
  folder: { id: string },
  role: "reader" | "writer" | "manager" | (string & {}) = "reader",
): string {
  return `${ISSUER}/mcp/${folder.id}/${role}`;
}

/** Registers a client as a connector does, and returns the answer. */
export function register(request: APIRequestContext, metadata: unknown, headers: Record<string, string> = {}) {
  return request.post("/oauth/register", { data: metadata, headers, maxRedirects: 0 });
}

/** Registers a client with the redirect address of the tests and returns its id. */
export async function registerClient(request: APIRequestContext, name = "Example connector"): Promise<string> {
  const response = await register(request, { redirect_uris: [REDIRECT_URI], client_name: name });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

/**
 * The address of the consent page for an authorization request of the client to the MCP address `resource`, without
 * a scope. A parameter in `params` replaces the one of the request; one that is `null` is left out.
 */
export function authorizeUrl(clientId: string, resource: string, params: Record<string, string | null> = {}): string {
  const all: Record<string, string | null> = {
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: STATE,
    resource,
    ...params,
  };
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(all)) if (value !== null) query.set(name, value);
  return `/oauth/authorize?${query.toString()}`;
}

/**
 * Stands in for the client: answers everything at its redirect address, and returns a function that waits for the
 * next answer that arrives there and returns its parameters.
 */
export async function awaitCallback(page: Page): Promise<() => Promise<Record<string, string>>> {
  await page.route("http://127.0.0.1:53682/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Client</title><h1>Back at the client</h1>" }),
  );
  return async () => {
    await page.waitForURL((url) => url.host === "127.0.0.1:53682");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/callback");
    return Object.fromEntries(url.searchParams);
  };
}

/** Exchanges a code for tokens, as the client does, naming the MCP address of the request as `resource`. */
export function exchange(request: APIRequestContext, clientId: string, code: string, resource: string) {
  return request.post("/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
      resource,
    },
  });
}

/** Asks for new tokens with a refresh token, as the client does. */
export function refresh(request: APIRequestContext, clientId: string, refreshToken: string) {
  return request.post("/oauth/token", {
    form: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId },
  });
}

/** The answer of the token endpoint. */
export type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
};

/** Calls the tool `list_folder` at the MCP address `resource` with the access token and returns the status. */
export async function listFolderStatus(
  request: APIRequestContext,
  accessToken: string,
  resource: string,
): Promise<number> {
  const response = await request.post(new URL(resource).pathname, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_folder", arguments: {} } },
  });
  return response.status();
}

/**
 * Approves the client on its consent page for the MCP address `resource` as the logged-in user and returns the tokens
 * of the new grant.
 */
export async function connect(
  page: Page,
  request: APIRequestContext,
  clientId: string,
  resource: string,
): Promise<Tokens> {
  const callback = await awaitCallback(page);
  await page.goto(authorizeUrl(clientId, resource));
  await page.getByRole("button", { name: "Approve" }).click();
  const { code } = await callback();
  const response = await exchange(request, clientId, code ?? "", resource);
  expect(response.status()).toBe(200);
  return (await response.json()) as Tokens;
}
