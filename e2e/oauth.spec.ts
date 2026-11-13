import type { APIRequestContext } from "@playwright/test";

import { NO_STORAGE_STATE } from "./support/auth";
import { getTestDb, resetTestDatabase } from "./support/database";
import { expect, test } from "./support/test";

// An OAuth client has no session cookie when it reads the metadata, registers or asks for tokens.
test.use({ storageState: NO_STORAGE_STATE });

/** The public URL of the test server (`HIPPOWIKI_PUBLIC_URL` in `playwright.config.ts`): the issuer. */
const ISSUER = "http://localhost:3100";
const REDIRECT_URI = "http://127.0.0.1:53682/callback";

test.beforeEach(async () => {
  await resetTestDatabase();
});

/** Registers a client as a connector does, and returns the answer. */
function register(request: APIRequestContext, metadata: unknown, headers: Record<string, string> = {}) {
  return request.post("/oauth/register", { data: metadata, headers, maxRedirects: 0 });
}

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
