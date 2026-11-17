import type { APIRequestContext } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import {
  createFolder,
  createFolderRole,
  createGrant,
  createUser,
  getTestDb,
  resetTestDatabase,
  TEST_PASSWORD,
} from "./support/database";
import {
  authorizeUrl,
  awaitCallback,
  connect,
  exchange,
  ISSUER,
  listFolderStatus,
  mcpAddress,
  REDIRECT_URI,
  refresh,
  register,
  registerClient,
  STATE,
  type Tokens,
} from "./support/oauth";
import { expect, test } from "./support/test";

// An OAuth client has no session cookie when it reads the metadata, registers or asks for tokens.
test.use({ storageState: NO_STORAGE_STATE });

/** The folder "projects", of which the known user is Owner, and its MCP address for Reader. */
let projects: { id: string };
let reader: string;

test.beforeEach(async () => {
  await resetTestDatabase();
  projects = await createFolder({ name: "projects" });
  reader = mcpAddress(projects);
});

test.describe("discovery", () => {
  test("the metadata of the authorization server names the public URL as the issuer and the endpoints under /oauth", async ({
    request,
  }) => {
    const response = await request.get("/.well-known/oauth-authorization-server", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  test("the metadata of the protected resource at a folder address names that address and the wiki as its authorization server", async ({
    request,
  }) => {
    for (const role of ["reader", "writer"]) {
      const response = await request.get(`/.well-known/oauth-protected-resource/mcp/${projects.id}/${role}`, {
        maxRedirects: 0,
      });

      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({
        resource: mcpAddress(projects, role),
        authorization_servers: [ISSUER],
        bearer_methods_supported: ["header"],
      });
    }
  });

  test("the metadata of a resource that is not a folder address is not found, /mcp included", async ({ request }) => {
    for (const address of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource/folders",
      "/.well-known/oauth-protected-resource/mcp/x",
      `/.well-known/oauth-protected-resource/mcp/${projects.id}/owner`,
    ]) {
      expect((await request.get(address, { maxRedirects: 0 })).status(), address).toBe(404);
    }
  });

  test("a connector finds the authorization server from the 401 of a folder address", async ({ request }) => {
    const unauthorized = await request.post(new URL(reader).pathname, {
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      maxRedirects: 0,
    });

    expect(unauthorized.status()).toBe(401);
    const challenge = unauthorized.headers()["www-authenticate"] ?? "";
    expect(challenge).toBe(
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp/${projects.id}/reader"`,
    );
    // The chain a connector follows: the 401, the protected resource, its authorization server.
    const resourceMetadata = /resource_metadata="([^"]+)"/.exec(challenge)?.[1] ?? "";
    const resource = (await (await request.get(resourceMetadata)).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toBe(reader);
    const server = (await (
      await request.get(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)
    ).json()) as { issuer: string; token_endpoint: string };
    expect(server.issuer).toBe(resource.authorization_servers[0]);
    expect(server.token_endpoint).toBe(`${ISSUER}/oauth/token`);
  });

  test("a token that is not valid gets the same hint with the error", async ({ request }) => {
    const response = await request.post(new URL(reader).pathname, {
      headers: { authorization: `Bearer hwa_${"A".repeat(43)}` },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toBe(
      `Bearer error="invalid_token", resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp/${projects.id}/reader"`,
    );
  });

  test("the metadata documents list no scopes", async ({ request }) => {
    for (const address of [
      "/.well-known/oauth-authorization-server",
      `/.well-known/oauth-protected-resource/mcp/${projects.id}/writer`,
    ]) {
      expect(await (await request.get(address)).json()).not.toHaveProperty("scopes_supported");
    }
  });
});

test.describe("registration", () => {
  test("a client registers and gets its id as a public client, without a secret", async ({ request }) => {
    const response = await register(request, {
      redirect_uris: [REDIRECT_URI, "https://client.example/callback"],
      client_name: "Example connector",
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["authorization_code", "refresh_token"],
    });

    expect(response.status()).toBe(201);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const client = (await response.json()) as Record<string, unknown>;
    const row = await getTestDb().oAuthClient.findFirstOrThrow();
    expect(client).toEqual({
      client_id: row.id,
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      client_name: "Example connector",
      redirect_uris: [REDIRECT_URI, "https://client.example/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(row).toMatchObject({
      metadataUrl: null,
      name: "Example connector",
      redirectUris: [REDIRECT_URI, "https://client.example/callback"],
    });
  });

  test("a client without a name is called Connected app", async ({ request }) => {
    const response = await register(request, { redirect_uris: [REDIRECT_URI] });

    expect(response.status()).toBe(201);
    expect(((await response.json()) as { client_name: string }).client_name).toBe("Connected app");
  });

  for (const [what, metadata, error] of [
    ["no redirect addresses", { client_name: "Example" }, "invalid_redirect_uri"],
    ["a script as a redirect address", { redirect_uris: ["javascript:alert(1)"] }, "invalid_redirect_uri"],
    [
      "http on a host that is not the own machine",
      { redirect_uris: ["http://client.example/cb"] },
      "invalid_redirect_uri",
    ],
    ["a redirect address with a fragment", { redirect_uris: ["https://client.example/cb#x"] }, "invalid_redirect_uri"],
    ["a list instead of an object", [REDIRECT_URI], "invalid_client_metadata"],
  ] as const) {
    test(`a registration with ${what} is refused with ${error} and stores nothing`, async ({ request }) => {
      const response = await register(request, metadata);

      expect(response.status()).toBe(400);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toMatchObject({ error, error_description: expect.any(String) });
      expect(await getTestDb().oAuthClient.count()).toBe(0);
    });
  }

  test("a body that is not JSON is refused", async ({ request }) => {
    const response = await request.post("/oauth/register", {
      headers: { "content-type": "application/json" },
      data: "{not json",
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_client_metadata" });
  });

  test("the 21st registration of a client address in an hour is refused with 429 and Retry-After, another address is not", async ({
    request,
  }) => {
    // The test server trusts one reverse proxy, so the rightmost entry of the header is the client address.
    const visitor = { "x-forwarded-for": "203.0.113.50" };
    for (let index = 0; index < 20; index += 1) {
      expect((await register(request, { redirect_uris: [REDIRECT_URI] }, visitor)).status()).toBe(201);
    }

    const refused = await register(request, { redirect_uris: [REDIRECT_URI] }, visitor);

    expect(refused.status()).toBe(429);
    expect(refused.headers()["cache-control"]).toBe("no-store");
    const retryAfter = Number(refused.headers()["retry-after"]);
    expect(retryAfter).toBeGreaterThan(3500);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(await getTestDb().oAuthClient.count()).toBe(20);
    const other = await register(request, { redirect_uris: [REDIRECT_URI] }, { "x-forwarded-for": "203.0.113.51" });
    expect(other.status()).toBe(201);
  });

  test("the registration endpoint only takes POST", async ({ request }) => {
    expect((await request.get("/oauth/register", { maxRedirects: 0 })).status()).toBe(405);
  });
});

test.describe("the token endpoint", () => {
  /** Sends a token request as a form, as RFC 6749 asks. */
  function token(request: APIRequestContext, form: Record<string, string>) {
    return request.post("/oauth/token", { form, maxRedirects: 0 });
  }

  for (const [what, form, status, error] of [
    ["no grant type", { code: "x" }, 400, "invalid_request"],
    ["the grant type client_credentials", { grant_type: "client_credentials" }, 400, "unsupported_grant_type"],
    [
      "the grant type password",
      { grant_type: "password", username: "alice", password: "x" },
      400,
      "unsupported_grant_type",
    ],
    ["no code", { grant_type: "authorization_code" }, 400, "invalid_request"],
    [
      "a code that does not exist",
      { grant_type: "authorization_code", code: `hwc_${"A".repeat(43)}` },
      400,
      "invalid_grant",
    ],
    ["a value that is no code", { grant_type: "authorization_code", code: "guess" }, 400, "invalid_grant"],
    ["no refresh token", { grant_type: "refresh_token" }, 400, "invalid_request"],
    ["a value that is no refresh token", { grant_type: "refresh_token", refresh_token: "guess" }, 400, "invalid_grant"],
    [
      "a refresh token of a grant that does not exist",
      { grant_type: "refresh_token", refresh_token: `hwr_0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01.${"A".repeat(43)}` },
      400,
      "invalid_grant",
    ],
  ] as const) {
    test(`a token request with ${what} is refused with ${error}`, async ({ request }) => {
      const response = await token(request, form);

      expect(response.status()).toBe(status);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(response.headers()["content-type"]).toContain("application/json");
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({ error, error_description: expect.any(String) });
      expect(await getTestDb().oAuthGrant.count()).toBe(0);
    });
  }

  test("a token request as JSON is read as well", async ({ request }) => {
    const response = await request.post("/oauth/token", { data: { grant_type: "client_credentials" } });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: "unsupported_grant_type" });
  });

  test("a token request with another content type is refused", async ({ request }) => {
    const response = await request.post("/oauth/token", {
      headers: { "content-type": "text/plain" },
      data: "grant_type=authorization_code",
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  test("the token endpoint only takes POST", async ({ request }) => {
    expect((await request.get("/oauth/token", { maxRedirects: 0 })).status()).toBe(405);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

test.describe("the whole flow", () => {
  test("logged out: login, consent, code, tokens, a tool call, a refresh, and the old refresh token revokes the grant", async ({
    page,
    request,
  }) => {
    const errors = collectErrors(page);
    await createFolder({ name: "handbook" });
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);

    // The connector opens the consent page in the browser of the user, who is not logged in.
    await page.goto(authorizeUrl(clientId, reader));
    await expect(page).toHaveURL(/^http:\/\/localhost:3100\/login\?next=%2Foauth%2Fauthorize%3Fclient_id%3D/);
    await page.getByLabel("User name").fill(KNOWN_USER.name);
    await page.getByLabel("Password").fill(KNOWN_USER.password);
    await page.getByRole("button", { name: "Log in" }).click();

    // The login leads back to the consent page with the whole request.
    await expect(page).toHaveURL(authorizeUrl(clientId, reader));
    await expect(page).toHaveTitle("Connect an app – HippoWiki");
    await expect(page.getByRole("heading", { level: 1, name: "Connect an app" })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main.getByText("127.0.0.1:53682", { exact: true })).toBeVisible();
    await expect(main.getByText(/It calls itself “Example connector”/)).toBeVisible();
    await expect(main.getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
    await expect(main.getByText("projects", { exact: true })).toBeVisible();
    await expect(main.getByText("Reader", { exact: true })).toBeVisible();
    await expect(main.getByText(/without changing anything/)).toBeVisible();
    await expect(page.getByRole("radio", { name: "90 days" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Deny" })).toBeEnabled();
    // Nothing is granted before the user approves.
    expect(await getTestDb().oAuthCode.count()).toBe(0);
    expect(errors).toEqual([]);

    await page.getByRole("button", { name: "Approve" }).click();

    // The client gets the code with its state and the issuer.
    const answer = await callback();
    expect(Object.keys(answer).sort()).toEqual(["code", "iss", "state"]);
    expect(answer.state).toBe(STATE);
    expect(answer.iss).toBe(ISSUER);
    expect(answer.code).toMatch(/^hwc_/);

    // The code is exchanged for tokens, once.
    const exchanged = await exchange(request, clientId, answer.code ?? "", reader);
    expect(exchanged.status()).toBe(200);
    expect(exchanged.headers()["cache-control"]).toBe("no-store");
    const tokens = (await exchanged.json()) as Tokens;
    expect(tokens).toEqual({
      access_token: expect.stringMatching(/^hwa_/),
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^hwr_/),
    });
    const again = await exchange(request, clientId, answer.code ?? "", reader);
    expect(again.status()).toBe(400);
    expect(await again.json()).toMatchObject({ error: "invalid_grant" });

    // The grant is a connected app of the user, named after the client, for 90 days.
    const grant = await getTestDb().oAuthGrant.findFirstOrThrow({ where: { userId: KNOWN_USER.id } });
    expect(grant).toMatchObject({ name: "Example connector", folderId: projects.id, role: "reader" });
    expect(grant).not.toHaveProperty("tokenHash");
    expect(grant.expiresAt.getTime() - Date.now()).toBeGreaterThan(90 * DAY_MS - 60_000);
    expect(grant.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(90 * DAY_MS);

    // The access token reads the wiki through the folder address.
    const call = await request.post(new URL(reader).pathname, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_folder", arguments: {} } },
    });
    expect(call.status()).toBe(200);
    // It reads the folder of the connection, and no other folder.
    const listed = JSON.stringify(await call.json());
    expect(listed).toContain(`${ISSUER}/folders/projects`);
    expect(listed).not.toContain("handbook");

    // A refresh gives new tokens, and the previous access token stops working.
    const refreshed = await refresh(request, clientId, tokens.refresh_token);
    expect(refreshed.status()).toBe(200);
    const newer = (await refreshed.json()) as Tokens;
    expect(newer.access_token).not.toBe(tokens.access_token);
    expect(newer.refresh_token).not.toBe(tokens.refresh_token);
    expect(await listFolderStatus(request, tokens.access_token, reader)).toBe(401);
    expect(await listFolderStatus(request, newer.access_token, reader)).toBe(200);

    // The old refresh token is used again: the grant is revoked, with the newer tokens.
    const reused = await refresh(request, clientId, tokens.refresh_token);
    expect(reused.status()).toBe(400);
    expect(await reused.json()).toMatchObject({ error: "invalid_grant" });
    expect(await getTestDb().oAuthGrant.count()).toBe(0);
    expect(await listFolderStatus(request, newer.access_token, reader)).toBe(401);
    expect((await refresh(request, clientId, newer.refresh_token)).status()).toBe(400);
  });

  test("a user with the first password changes it first and then reaches the consent page", async ({
    page,
    request,
  }) => {
    await createFolderRole({ folder: projects, user: await createUser({ name: "newcomer" }), role: "reader" });
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);

    await page.goto(authorizeUrl(clientId, reader));
    await page.getByLabel("User name").fill("newcomer");
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/^http:\/\/localhost:3100\/change-password\?next=%2Foauth%2Fauthorize%3F/);
    // Nothing of the request is shown before the password is changed.
    await expect(page.getByText("Example connector")).toHaveCount(0);
    await page.getByLabel("Current password").fill(TEST_PASSWORD);
    await page.getByLabel(/^New password/).fill("my-own-password");
    await page.getByLabel("Repeat new password").fill("my-own-password");
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page).toHaveURL(authorizeUrl(clientId, reader));
    await expect(page.getByRole("main").getByText("newcomer", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();

    const { code } = await callback();
    expect((await exchange(request, clientId, code ?? "", reader)).status()).toBe(200);
  });

  test("with a session cookie that is no longer valid, the login leads back to the consent page", async ({
    page,
    request,
    context,
  }) => {
    const clientId = await registerClient(request);
    // Past the proxy, which only looks whether the cookie is there.
    await context.addCookies([
      { name: "better-auth.session_token", value: "unknown-token.unknown-signature", url: ISSUER },
    ]);

    await page.goto(authorizeUrl(clientId, reader));
    await expect(page).toHaveURL(/^http:\/\/localhost:3100\/login\?next=%2Foauth%2Fauthorize%3Fclient_id%3D/);
    await page.getByLabel("User name").fill(KNOWN_USER.name);
    await page.getByLabel("Password").fill(KNOWN_USER.password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(authorizeUrl(clientId, reader));
    await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();
  });
});

test.describe("the consent page, as an admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("a valid request says that admin accounts cannot connect apps and returns to the client with access_denied", async ({
    page,
    request,
  }) => {
    const errors = collectErrors(page);
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);
    const requests: string[] = [];
    page.on("request", (each) => requests.push(new URL(each.url()).host));
    const address = authorizeUrl(clientId, reader);

    await page.goto(address);

    const main = page.getByRole("main");
    await expect(main.getByRole("alert")).toHaveText(/Admin accounts cannot connect apps/);
    await expect(main.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Deny" })).toHaveCount(0);
    // The browser stays here until the admin clicks.
    await expect(page).toHaveURL(address);
    expect(requests.filter((host) => host !== "localhost:3100")).toEqual([]);
    expect(errors).toEqual([]);

    await main.getByRole("link", { name: "Return to 127.0.0.1:53682" }).click();

    expect(await callback()).toEqual({
      error: "access_denied",
      error_description: "Admin accounts cannot connect apps",
      state: STATE,
      iss: ISSUER,
    });
    expect(await getTestDb().oAuthCode.count()).toBe(0);
    expect(await getTestDb().oAuthGrant.count()).toBe(0);
  });

  for (const [what, params, message] of [
    ["a client that is not registered", { client_id: "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10" }, /not known to the wiki/],
    [
      "a redirect address that is not one of the client",
      { redirect_uri: "https://evil.example/callback" },
      /not one of its own/,
    ],
  ] as const) {
    test(`a request with ${what} shows the error of every user and sends the browser nowhere`, async ({
      page,
      request,
    }) => {
      const clientId = await registerClient(request);
      const requests: string[] = [];
      page.on("request", (each) => requests.push(new URL(each.url()).host));
      const address = authorizeUrl(clientId, reader, params);

      await page.goto(address);

      await expect(page.getByRole("main").getByRole("alert")).toHaveText(message);
      await expect(page.getByRole("main").getByRole("link", { name: /^Return to/ })).toHaveCount(0);
      await expect(page).toHaveURL(address);
      expect(requests.filter((host) => host !== "localhost:3100")).toEqual([]);
    });
  }
});

test.describe("the consent page, as a logged-in user", () => {
  test.use({ storageState: USER_STORAGE_STATE });

  test("deny sends the client access_denied with its state and the issuer, and grants nothing", async ({
    page,
    request,
  }) => {
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);
    await page.goto(authorizeUrl(clientId, reader));

    await page.getByRole("button", { name: "Deny" }).click();

    expect(await callback()).toEqual({
      error: "access_denied",
      error_description: "The user denied the request",
      state: STATE,
      iss: ISSUER,
    });
    expect(await getTestDb().oAuthCode.count()).toBe(0);
    expect(await getTestDb().oAuthGrant.count()).toBe(0);
  });

  test("the chosen lifetime is the lifetime of the grant", async ({ page, request }) => {
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);
    await page.goto(authorizeUrl(clientId, reader));

    await page.getByRole("radio", { name: "30 days" }).check();
    await page.getByRole("button", { name: "Approve" }).click();
    const { code } = await callback();
    expect((await exchange(request, clientId, code ?? "", reader)).status()).toBe(200);

    const grant = await getTestDb().oAuthGrant.findFirstOrThrow();
    expect(grant.expiresAt.getTime() - Date.now()).toBeGreaterThan(30 * DAY_MS - 60_000);
    expect(grant.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * DAY_MS);
  });

  for (const [what, params, message] of [
    [
      "a redirect address that is not one of the client",
      { redirect_uri: "https://evil.example/callback" },
      /not one of its own/,
    ],
    ["a redirect address on another path", { redirect_uri: "http://127.0.0.1:53682/other" }, /not one of its own/],
    ["a client that is not registered", { client_id: "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10" }, /not known to the wiki/],
    ["a client id that is no id", { client_id: "example" }, /not known to the wiki/],
  ] as const) {
    test(`a request with ${what} shows the reason and sends the browser nowhere`, async ({ page, request }) => {
      const errors = collectErrors(page);
      const clientId = await registerClient(request);
      const requests: string[] = [];
      page.on("request", (each) => requests.push(new URL(each.url()).host));
      const address = authorizeUrl(clientId, reader, params);

      await page.goto(address);

      await expect(page.getByRole("main").getByRole("alert")).toHaveText(message);
      await expect(page).toHaveURL(address);
      await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(0);
      // The name of the client is not shown for a request that cannot be trusted.
      await expect(page.getByText("Example connector")).toHaveCount(0);
      expect(requests.filter((host) => host !== "localhost:3100")).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  for (const [what, params, error] of [
    ["another response type", { response_type: "token" }, "unsupported_response_type"],
    ["PKCE with the method plain", { code_challenge_method: "plain" }, "invalid_request"],
    ["no PKCE challenge", { code_challenge: "" }, "invalid_request"],
    ["no resource", { resource: null }, "invalid_target"],
    ["the plain /mcp as the resource", { resource: `${ISSUER}/mcp` }, "invalid_target"],
    [
      "the address of the role Owner",
      { resource: `${ISSUER}/mcp/0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10/owner` },
      "invalid_target",
    ],
    ["a resource that is no folder address", { resource: `${ISSUER}/mcp/abc/reader` }, "invalid_target"],
    [
      "a resource that is another server",
      { resource: "https://other.example/mcp/0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10/reader" },
      "invalid_target",
    ],
  ] as const) {
    test(`a request with ${what} shows the reason and returns to the client with ${error} only on a click`, async ({
      page,
      request,
    }) => {
      const clientId = await registerClient(request);
      const callback = await awaitCallback(page);
      const requests: string[] = [];
      page.on("request", (each) => requests.push(new URL(each.url()).host));
      const address = authorizeUrl(clientId, reader, params);

      await page.goto(address);

      const main = page.getByRole("main");
      await expect(main.getByRole("alert")).toHaveText(/The request of the app cannot be answered: /);
      await expect(main.getByRole("button", { name: "Approve" })).toHaveCount(0);
      await expect(main.getByRole("button", { name: "Deny" })).toHaveCount(0);
      // Anyone can register a redirect address: the browser stays here until the user clicks.
      await expect(page).toHaveURL(address);
      expect(requests.filter((host) => host !== "localhost:3100")).toEqual([]);

      await main.getByRole("link", { name: "Return to 127.0.0.1:53682" }).click();

      expect(await callback()).toEqual({
        error,
        error_description: expect.any(String),
        state: STATE,
        iss: ISSUER,
      });
      expect(await getTestDb().oAuthCode.count()).toBe(0);
    });
  }

  test("the consent page names the folder and the role of the address, and what the role allows", async ({
    page,
    request,
  }) => {
    const errors = collectErrors(page);
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);

    await page.goto(authorizeUrl(clientId, mcpAddress(projects, "writer")));

    const main = page.getByRole("main");
    await expect(main.getByText(/It asks to connect to the folder projects with the role Writer\./)).toBeVisible();
    await expect(
      main.getByText(/create pages, replace their content, and move or rename them within the folder/),
    ).toBeVisible();
    await expect(main.getByText(/scope|\bread the wiki\b/i)).toHaveCount(0);
    expect(errors).toEqual([]);

    await page.getByRole("button", { name: "Approve" }).click();
    const { code } = await callback();
    expect((await exchange(request, clientId, code ?? "", mcpAddress(projects, "writer"))).status()).toBe(200);
    expect(await getTestDb().oAuthGrant.findFirstOrThrow()).toMatchObject({ folderId: projects.id, role: "writer" });
  });

  for (const role of ["manager", "owner"] as const) {
    test(`a ${role} approves a connection to the Manager address, and the app lists the folder through MCP`, async ({
      page,
      request,
    }) => {
      const errors = collectErrors(page);
      const guides = await createFolder({ name: "guides", roles: [{ user: KNOWN_USER, role }] });
      const manager = mcpAddress(guides, "manager");
      const clientId = await registerClient(request);
      const callback = await awaitCallback(page);

      await page.goto(authorizeUrl(clientId, manager));

      const main = page.getByRole("main");
      await expect(main.getByText(/It asks to connect to the folder guides with the role Manager\./)).toBeVisible();
      await expect(main.getByText(/delete pages, and create, rename and delete tabs/)).toBeVisible();
      expect(errors).toEqual([]);

      await page.getByRole("button", { name: "Approve" }).click();
      const { code } = await callback();
      const response = await exchange(request, clientId, code ?? "", manager);
      expect(response.status()).toBe(200);
      const tokens = (await response.json()) as Tokens;
      expect(await getTestDb().oAuthGrant.findFirstOrThrow()).toMatchObject({ folderId: guides.id, role: "manager" });
      expect(await listFolderStatus(request, tokens.access_token, manager)).toBe(200);
    });
  }

  test("a missing folder, a folder without a role and a role too low show the same refusal with access_denied", async ({
    page,
    request,
  }) => {
    const notes = await createFolder({ name: "notes", roles: [] });
    const handbook = await createFolder({ name: "handbook", roles: [{ user: KNOWN_USER, role: "reader" }] });
    const drafts = await createFolder({ name: "drafts", roles: [{ user: KNOWN_USER, role: "writer" }] });
    const clientId = await registerClient(request);

    for (const resource of [
      mcpAddress({ id: "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10" }),
      mcpAddress(notes),
      mcpAddress(handbook, "writer"),
      mcpAddress(handbook, "manager"),
      mcpAddress(drafts, "manager"),
    ]) {
      const callback = await awaitCallback(page);
      await page.goto(authorizeUrl(clientId, resource));

      const main = page.getByRole("main");
      await expect(main.getByRole("alert")).toHaveText(
        "The request of the app cannot be answered: No app can be connected to this address.",
      );
      await expect(main.getByText(/notes|handbook|drafts/)).toHaveCount(0);
      await expect(main.getByRole("button", { name: "Approve" })).toHaveCount(0);
      await main.getByRole("link", { name: "Return to 127.0.0.1:53682" }).click();
      expect(await callback()).toEqual({
        error: "access_denied",
        error_description: "No app can be connected to this address",
        state: STATE,
        iss: ISSUER,
      });
    }
    expect(await getTestDb().oAuthCode.count()).toBe(0);
    expect(await getTestDb().oAuthGrant.count()).toBe(0);
  });

  test("a scope that the client sends is ignored", async ({ page, request }) => {
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);
    await page.goto(authorizeUrl(clientId, reader, { scope: "write admin openid" }));
    await page.getByRole("button", { name: "Approve" }).click();
    const { code } = await callback();

    const response = await exchange(request, clientId, code ?? "", reader);

    expect(response.status()).toBe(200);
    expect(await response.json()).not.toHaveProperty("scope");
    expect(await getTestDb().oAuthGrant.findFirstOrThrow()).toMatchObject({ folderId: projects.id, role: "reader" });
  });

  test("with 50 connected apps the page asks to revoke an app first and offers no approval; deny still answers the client", async ({
    page,
    request,
  }) => {
    for (let index = 0; index < 50; index += 1) await createGrant({ owner: KNOWN_USER, folder: projects });
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);

    await page.goto(authorizeUrl(clientId, reader));

    const main = page.getByRole("main");
    await expect(
      main.getByText(
        "You already have the most connected apps allowed, so no further app can be connected. Revoke an app on " +
          "your account page first, then connect again.",
      ),
    ).toBeVisible();
    await expect(main.getByText(/token/i)).toHaveCount(0);
    await expect(main.getByRole("link", { name: "account page" })).toHaveAttribute("href", "/account");
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);

    await page.getByRole("button", { name: "Deny" }).click();
    expect(await callback()).toMatchObject({ error: "access_denied", state: STATE });
    expect(await getTestDb().oAuthGrant.count()).toBe(50);
  });

  test("a 50th app that is a grant of the same client does not block connecting it again: the grant is replaced", async ({
    page,
    request,
  }) => {
    const others = [];
    for (let index = 0; index < 49; index += 1) {
      others.push((await createGrant({ owner: KNOWN_USER, folder: projects })).client.id);
    }
    const clientId = await registerClient(request);
    const first = await connect(page, request, clientId, reader);
    expect(await getTestDb().oAuthGrant.count()).toBe(50);

    // The connector registers again, as some do on every connect, with the same name and redirect address.
    const second = await connect(page, request, await registerClient(request), reader);

    expect(await getTestDb().oAuthGrant.count()).toBe(50);
    expect(await getTestDb().oAuthGrant.count({ where: { clientId: { notIn: others } } })).toBe(1);
    expect(await listFolderStatus(request, first.access_token, reader)).toBe(401);
    expect(await listFolderStatus(request, second.access_token, reader)).toBe(200);
  });

  test("a second client gets a grant of its own", async ({ page, request }) => {
    const first = await connect(page, request, await registerClient(request, "First connector"), reader);
    const second = await connect(page, request, await registerClient(request, "Second connector"), reader);

    expect((await getTestDb().oAuthGrant.findMany({ orderBy: { name: "asc" } })).map((grant) => grant.name)).toEqual([
      "First connector",
      "Second connector",
    ]);
    expect(await listFolderStatus(request, first.access_token, reader)).toBe(200);
    expect(await listFolderStatus(request, second.access_token, reader)).toBe(200);
  });

  test("a redirect address that a crafted request puts into the form is not followed", async ({ page, request }) => {
    const clientId = await registerClient(request);
    const requests: string[] = [];
    page.on("request", (each) => requests.push(new URL(each.url()).host));
    await page.goto(authorizeUrl(clientId, reader));
    // The page checked the request; the action checks the submitted fields again.
    await page
      .getByRole("main")
      .locator("form")
      .evaluate((form: HTMLFormElement) => {
        form.addEventListener("formdata", (event) => {
          event.formData.set("redirect_uri", "https://evil.example/callback");
        });
      });

    await page.getByRole("button", { name: "Approve" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/This request is no longer valid/);
    await expect(page).toHaveURL(authorizeUrl(clientId, reader));
    expect(await getTestDb().oAuthCode.count()).toBe(0);
    expect(requests.filter((host) => host !== "localhost:3100")).toEqual([]);
  });

  test("the code is bound to the client: another client cannot exchange it", async ({ page, request }) => {
    const clientId = await registerClient(request);
    const other = await registerClient(request, "Other connector");
    const callback = await awaitCallback(page);
    await page.goto(authorizeUrl(clientId, reader));
    await page.getByRole("button", { name: "Approve" }).click();
    const { code } = await callback();

    const stolen = await exchange(request, other, code ?? "", reader);

    expect(stolen.status()).toBe(400);
    expect(await stolen.json()).toMatchObject({ error: "invalid_grant" });
    // The failed exchange used the code up.
    expect((await exchange(request, clientId, code ?? "", reader)).status()).toBe(400);
    expect(await getTestDb().oAuthGrant.count()).toBe(0);
  });
});
