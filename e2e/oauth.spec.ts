import type { APIRequestContext } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import { collectErrors } from "./support/browser";
import {
  createApiToken,
  createFolder,
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
  listFoldersStatus,
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

test.beforeEach(async () => {
  await resetTestDatabase();
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
      scopes_supported: ["read"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  for (const address of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    test(`the metadata of the protected resource at ${address} names /mcp and the wiki as its authorization server`, async ({
      request,
    }) => {
      const response = await request.get(address, { maxRedirects: 0 });

      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({
        resource: `${ISSUER}/mcp`,
        authorization_servers: [ISSUER],
        scopes_supported: ["read"],
        bearer_methods_supported: ["header"],
      });
    });
  }

  test("the metadata of a resource that is not /mcp is not found", async ({ request }) => {
    for (const address of [
      "/.well-known/oauth-protected-resource/folders",
      "/.well-known/oauth-protected-resource/mcp/x",
    ]) {
      expect((await request.get(address, { maxRedirects: 0 })).status()).toBe(404);
    }
  });

  test("a connector finds the authorization server from the 401 of /mcp", async ({ request }) => {
    const unauthorized = await request.post("/mcp", {
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      maxRedirects: 0,
    });

    expect(unauthorized.status()).toBe(401);
    const challenge = unauthorized.headers()["www-authenticate"] ?? "";
    expect(challenge).toBe(
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp", scope="read"`,
    );
    // The chain a connector follows: the 401, the protected resource, its authorization server.
    const resourceMetadata = /resource_metadata="([^"]+)"/.exec(challenge)?.[1] ?? "";
    const resource = (await (await request.get(resourceMetadata)).json()) as { authorization_servers: string[] };
    const server = (await (
      await request.get(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)
    ).json()) as { issuer: string; token_endpoint: string };
    expect(server.issuer).toBe(resource.authorization_servers[0]);
    expect(server.token_endpoint).toBe(`${ISSUER}/oauth/token`);
  });

  test("a token that is not valid gets the same hint with the error", async ({ request }) => {
    const response = await request.post("/mcp", {
      headers: { authorization: `Bearer hwa_${"A".repeat(43)}` },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toBe(
      `Bearer error="invalid_token", resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp", scope="read"`,
    );
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
      expect(await getTestDb().apiToken.count()).toBe(0);
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
    await page.goto(authorizeUrl(clientId));
    await expect(page).toHaveURL(/^http:\/\/localhost:3100\/login\?next=%2Foauth%2Fauthorize%3Fclient_id%3D/);
    await page.getByLabel("User name").fill(KNOWN_USER.name);
    await page.getByLabel("Password").fill(KNOWN_USER.password);
    await page.getByRole("button", { name: "Log in" }).click();

    // The login leads back to the consent page with the whole request.
    await expect(page).toHaveURL(authorizeUrl(clientId));
    await expect(page).toHaveTitle("Connect an app – HippoWiki");
    await expect(page.getByRole("heading", { level: 1, name: "Connect an app" })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main.getByText("127.0.0.1:53682", { exact: true })).toBeVisible();
    await expect(main.getByText(/It calls itself “Example connector”/)).toBeVisible();
    await expect(main.getByText(KNOWN_USER.name, { exact: true })).toBeVisible();
    await expect(main.getByText(/It cannot change anything/)).toBeVisible();
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
    const exchanged = await exchange(request, clientId, answer.code ?? "");
    expect(exchanged.status()).toBe(200);
    expect(exchanged.headers()["cache-control"]).toBe("no-store");
    const tokens = (await exchanged.json()) as Tokens;
    expect(tokens).toEqual({
      access_token: expect.stringMatching(/^hwa_/),
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^hwr_/),
      scope: "read",
    });
    const again = await exchange(request, clientId, answer.code ?? "");
    expect(again.status()).toBe(400);
    expect(await again.json()).toMatchObject({ error: "invalid_grant" });

    // The grant is a token of the user, named after the client, for 90 days.
    const grant = await getTestDb().apiToken.findFirstOrThrow({ where: { userId: KNOWN_USER.id } });
    expect(grant).toMatchObject({ name: "Example connector", scopes: ["read"], tokenHash: null });
    expect(grant.expiresAt.getTime() - Date.now()).toBeGreaterThan(90 * DAY_MS - 60_000);
    expect(grant.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(90 * DAY_MS);

    // The access token reads the wiki through /mcp.
    const call = await request.post("/mcp", {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_folders", arguments: {} } },
    });
    expect(call.status()).toBe(200);
    expect(JSON.stringify(await call.json())).toContain(`${ISSUER}/folders/handbook`);

    // A refresh gives new tokens, and the previous access token stops working.
    const refreshed = await refresh(request, clientId, tokens.refresh_token);
    expect(refreshed.status()).toBe(200);
    const newer = (await refreshed.json()) as Tokens;
    expect(newer.access_token).not.toBe(tokens.access_token);
    expect(newer.refresh_token).not.toBe(tokens.refresh_token);
    expect(await listFoldersStatus(request, tokens.access_token)).toBe(401);
    expect(await listFoldersStatus(request, newer.access_token)).toBe(200);

    // The old refresh token is used again: the grant is revoked, with the newer tokens.
    const reused = await refresh(request, clientId, tokens.refresh_token);
    expect(reused.status()).toBe(400);
    expect(await reused.json()).toMatchObject({ error: "invalid_grant" });
    expect(await getTestDb().apiToken.count()).toBe(0);
    expect(await listFoldersStatus(request, newer.access_token)).toBe(401);
    expect((await refresh(request, clientId, newer.refresh_token)).status()).toBe(400);
  });

  test("a user with the first password changes it first and then reaches the consent page", async ({
    page,
    request,
  }) => {
    await createUser({ name: "newcomer" });
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);

    await page.goto(authorizeUrl(clientId));
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

    await expect(page).toHaveURL(authorizeUrl(clientId));
    await expect(page.getByRole("main").getByText("newcomer", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();

    const { code } = await callback();
    expect((await exchange(request, clientId, code ?? "")).status()).toBe(200);
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

    await page.goto(authorizeUrl(clientId));
    await expect(page).toHaveURL(/^http:\/\/localhost:3100\/login\?next=%2Foauth%2Fauthorize%3Fclient_id%3D/);
    await page.getByLabel("User name").fill(KNOWN_USER.name);
    await page.getByLabel("Password").fill(KNOWN_USER.password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(authorizeUrl(clientId));
    await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();
  });
});

test.describe("the consent page, as a logged-in user", () => {
  test.use({ storageState: USER_STORAGE_STATE });

  test("deny sends the client access_denied with its state and the issuer, and grants nothing", async ({
    page,
    request,
  }) => {
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);
    await page.goto(authorizeUrl(clientId));

    await page.getByRole("button", { name: "Deny" }).click();

    expect(await callback()).toEqual({
      error: "access_denied",
      error_description: "The user denied the request",
      state: STATE,
      iss: ISSUER,
    });
    expect(await getTestDb().oAuthCode.count()).toBe(0);
    expect(await getTestDb().apiToken.count()).toBe(0);
  });

  test("the chosen lifetime is the lifetime of the grant", async ({ page, request }) => {
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);
    await page.goto(authorizeUrl(clientId));

    await page.getByRole("radio", { name: "30 days" }).check();
    await page.getByRole("button", { name: "Approve" }).click();
    const { code } = await callback();
    expect((await exchange(request, clientId, code ?? "")).status()).toBe(200);

    const grant = await getTestDb().apiToken.findFirstOrThrow();
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
      const address = authorizeUrl(clientId, params);

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
    ["a resource that is another server", { resource: "https://other.example/mcp" }, "invalid_target"],
  ] as const) {
    test(`a request with ${what} is sent back to the client as ${error}, without asking the user`, async ({
      page,
      request,
    }) => {
      const clientId = await registerClient(request);
      const callback = await awaitCallback(page);
      await page.goto("/account");

      // Not `page.goto()`, which waits until the page has hydrated: this one leaves for the client at once.
      await page.evaluate(
        (address) => {
          window.location.assign(address);
        },
        authorizeUrl(clientId, params),
      );

      expect(await callback()).toEqual({
        error,
        error_description: expect.any(String),
        state: STATE,
        iss: ISSUER,
      });
      expect(await getTestDb().oAuthCode.count()).toBe(0);
    });
  }

  test("with 20 tokens the page asks to revoke one first and offers no approval; deny still answers the client", async ({
    page,
    request,
  }) => {
    for (let index = 0; index < 20; index += 1) await createApiToken({ owner: KNOWN_USER });
    const clientId = await registerClient(request);
    const callback = await awaitCallback(page);

    await page.goto(authorizeUrl(clientId));

    const main = page.getByRole("main");
    await expect(main.getByText(/You already have the most tokens allowed/)).toBeVisible();
    await expect(main.getByRole("link", { name: "account page" })).toHaveAttribute("href", "/account");
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);

    await page.getByRole("button", { name: "Deny" }).click();
    expect(await callback()).toMatchObject({ error: "access_denied", state: STATE });
    expect(await getTestDb().apiToken.count()).toBe(20);
  });

  test("the 20th token that is a grant of the same client does not block connecting it again: the grant is replaced", async ({
    page,
    request,
  }) => {
    for (let index = 0; index < 19; index += 1) await createApiToken({ owner: KNOWN_USER });
    const clientId = await registerClient(request);
    const first = await connect(page, request, clientId);
    expect(await getTestDb().apiToken.count()).toBe(20);

    // The connector registers again, as some do on every connect, with the same name and redirect address.
    const second = await connect(page, request, await registerClient(request));

    expect(await getTestDb().apiToken.count()).toBe(20);
    expect(await getTestDb().apiToken.count({ where: { clientId: { not: null } } })).toBe(1);
    expect(await listFoldersStatus(request, first.access_token)).toBe(401);
    expect(await listFoldersStatus(request, second.access_token)).toBe(200);
  });

  test("a second client gets a grant of its own", async ({ page, request }) => {
    const first = await connect(page, request, await registerClient(request, "First connector"));
    const second = await connect(page, request, await registerClient(request, "Second connector"));

    expect((await getTestDb().apiToken.findMany({ orderBy: { name: "asc" } })).map((grant) => grant.name)).toEqual([
      "First connector",
      "Second connector",
    ]);
    expect(await listFoldersStatus(request, first.access_token)).toBe(200);
    expect(await listFoldersStatus(request, second.access_token)).toBe(200);
  });

  test("a redirect address that a crafted request puts into the form is not followed", async ({ page, request }) => {
    const clientId = await registerClient(request);
    const requests: string[] = [];
    page.on("request", (each) => requests.push(new URL(each.url()).host));
    await page.goto(authorizeUrl(clientId));
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
    await expect(page).toHaveURL(authorizeUrl(clientId));
    expect(await getTestDb().oAuthCode.count()).toBe(0);
    expect(requests.filter((host) => host !== "localhost:3100")).toEqual([]);
  });

  test("the code is bound to the client: another client cannot exchange it", async ({ page, request }) => {
    const clientId = await registerClient(request);
    const other = await registerClient(request, "Other connector");
    const callback = await awaitCallback(page);
    await page.goto(authorizeUrl(clientId));
    await page.getByRole("button", { name: "Approve" }).click();
    const { code } = await callback();

    const stolen = await exchange(request, other, code ?? "");

    expect(stolen.status()).toBe(400);
    expect(await stolen.json()).toMatchObject({ error: "invalid_grant" });
    // The failed exchange used the code up.
    expect((await exchange(request, clientId, code ?? "")).status()).toBe(400);
    expect(await getTestDb().apiToken.count()).toBe(0);
  });
});
