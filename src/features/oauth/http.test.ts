import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  authorizationServerMetadata,
  handleRegister,
  handleToken,
  MAX_BODY_BYTES,
  protectedResourceMetadata,
} from "@/features/oauth/http";

const mocks = vi.hoisted(() => ({
  registerClient: vi.fn(),
  exchangeCode: vi.fn(),
  refreshGrant: vi.fn(),
  getServerEnv: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/oauth/service", () => ({
  registerClient: mocks.registerClient,
  exchangeCode: mocks.exchangeCode,
  refreshGrant: mocks.refreshGrant,
}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const PUBLIC_URL = "https://wiki.example.com";
const CLIENT_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const REDIRECT_URI = "https://client.example/callback";
const CLIENT = {
  id: CLIENT_ID,
  clientId: CLIENT_ID,
  name: "Example",
  redirectUris: [REDIRECT_URI],
  createdAt: new Date("2026-03-01T12:00:00.500Z"),
};
const TOKENS = {
  accessToken: `hwa_${"A".repeat(43)}`,
  expiresIn: 3600,
  refreshToken: `hwr_${CLIENT_ID}.${"R".repeat(43)}`,
  scopes: ["read"],
};

/** Sets the public URL and the number of trusted proxies that the adapters read from the server environment. */
function setEnv(publicUrl: string | undefined, trustedProxies = 0): void {
  mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: publicUrl, HIPPOWIKI_TRUSTED_PROXIES: trustedProxies });
}

/** A `POST` with a JSON body. */
function postJson(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${PUBLIC_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A `POST` to the token endpoint with a form body, as RFC 6749 asks. */
function postForm(fields: Record<string, string> | string): Request {
  return new Request(`${PUBLIC_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: typeof fields === "string" ? fields : new URLSearchParams(fields).toString(),
  });
}

/** Expects the headers that keep an answer out of every cache. */
function expectNoStore(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
}

beforeEach(() => {
  vi.resetAllMocks();
  setEnv(PUBLIC_URL);
  mocks.registerClient.mockResolvedValue({ ok: true, value: CLIENT });
  mocks.exchangeCode.mockResolvedValue({ ok: true, value: TOKENS });
  mocks.refreshGrant.mockResolvedValue({ ok: true, value: TOKENS });
});

describe("without a public URL", () => {
  beforeEach(() => {
    setEnv(undefined);
  });

  it("every endpoint answers 404 and reaches no service", async () => {
    const responses = [
      authorizationServerMetadata(),
      protectedResourceMetadata(undefined),
      protectedResourceMetadata(["mcp"]),
      await handleRegister(postJson("/oauth/register", { redirect_uris: [REDIRECT_URI] })),
      await handleToken(postForm({ grant_type: "authorization_code", code: "hwc_x" })),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "not_found" });
    }
    expect(mocks.registerClient).not.toHaveBeenCalled();
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });
});

describe("authorizationServerMetadata", () => {
  it("describes the authorization server with exactly the public URL as its issuer", async () => {
    const response = authorizationServerMetadata();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toStrictEqual({
      issuer: "https://wiki.example.com",
      authorization_endpoint: "https://wiki.example.com/oauth/authorize",
      token_endpoint: "https://wiki.example.com/oauth/token",
      registration_endpoint: "https://wiki.example.com/oauth/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe("protectedResourceMetadata", () => {
  it.each([
    ["the well-known address alone", undefined],
    ["the well-known address alone, as an empty path", []],
    ["the well-known address followed by /mcp", ["mcp"]],
  ])("describes the MCP endpoint at %s", async (_case, path) => {
    const response = protectedResourceMetadata(path);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      resource: "https://wiki.example.com/mcp",
      authorization_servers: ["https://wiki.example.com"],
      scopes_supported: ["read"],
      bearer_methods_supported: ["header"],
    });
  });

  it.each([[["folders"]], [["mcp", "more"]], [["MCP"]], [["oauth", "token"]]])(
    "answers 404 for the path %j",
    (path) => {
      expect(protectedResourceMetadata(path).status).toBe(404);
    },
  );
});

describe("handleRegister", () => {
  const METADATA = { redirect_uris: [REDIRECT_URI], client_name: "Example" };

  it("registers the client and answers 201 with the client as a public client", async () => {
    const response = await handleRegister(postJson("/oauth/register", METADATA));

    expect(mocks.registerClient).toHaveBeenCalledExactlyOnceWith(METADATA, "shared");
    expect(response.status).toBe(201);
    expectNoStore(response);
    await expect(response.json()).resolves.toStrictEqual({
      client_id: CLIENT_ID,
      client_id_issued_at: 1772366400,
      client_name: "Example",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  it("answers as a public client without a secret, whatever the client asked for", async () => {
    const response = await handleRegister(
      postJson("/oauth/register", { ...METADATA, token_endpoint_auth_method: "client_secret_basic" }),
    );

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body).not.toHaveProperty("client_secret");
  });

  it.each([
    ["no trusted proxy", 0, { "x-forwarded-for": "203.0.113.7" }, "shared", false],
    ["one trusted proxy", 1, { "x-forwarded-for": "198.51.100.9, 203.0.113.7" }, "203.0.113.7", false],
    [
      "one trusted proxy and an IPv6 address",
      1,
      { "x-forwarded-for": "2001:db8:1:2:3:4:5:6" },
      "2001:db8:1:2::/64",
      false,
    ],
    ["one trusted proxy and no header", 1, {}, "shared", true],
    ["two trusted proxies and one entry", 2, { "x-forwarded-for": "203.0.113.7" }, "shared", true],
  ])(
    "passes the client address group to the service with %s",
    async (_case, proxies, headers: Record<string, string>, group, warned) => {
      setEnv(PUBLIC_URL, proxies);

      await handleRegister(postJson("/oauth/register", METADATA, headers));

      expect(mocks.registerClient).toHaveBeenCalledExactlyOnceWith(METADATA, group);
      expect(mocks.warn).toHaveBeenCalledTimes(warned ? 1 : 0);
      // The value of the header is never logged.
      expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("203.0.113.7");
    },
  );

  it.each([
    ["invalid-client-metadata", 400, "invalid_client_metadata"],
    ["invalid-redirect-uri", 400, "invalid_redirect_uri"],
  ])("answers the code %s with %i and %s, with the description of the service", async (code, status, error) => {
    mocks.registerClient.mockResolvedValue({ ok: false, error: { code, description: "Reported by the service" } });

    const response = await handleRegister(postJson("/oauth/register", METADATA));

    expect(response.status).toBe(status);
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({ error, error_description: "Reported by the service" });
  });

  it.each([
    [1, "1"],
    [999, "1"],
    [1001, "2"],
    [40 * 60 * 1000, "2400"],
  ])("answers the limit with 429 and Retry-After for a wait of %i ms as %s seconds", async (waitMs, seconds) => {
    mocks.registerClient.mockResolvedValue({ ok: false, error: { code: "wait", waitMs } });

    const response = await handleRegister(postJson("/oauth/register", METADATA));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe(seconds);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ error: "temporarily_unavailable" });
  });

  it("answers a failure of the service with 500", async () => {
    mocks.registerClient.mockResolvedValue({ ok: false, error: { code: "failed" } });

    const response = await handleRegister(postJson("/oauth/register", METADATA));

    expect(response.status).toBe(500);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ error: "server_error" });
  });

  it.each([
    ["a body that is not JSON", "{not json"],
    ["an empty body", ""],
    [
      "a body of more than 64 KB",
      JSON.stringify({ redirect_uris: [REDIRECT_URI], padding: "a".repeat(MAX_BODY_BYTES) }),
    ],
  ])("answers %s with 400 and does not reach the service", async (_case, body) => {
    const response = await handleRegister(postJson("/oauth/register", body));

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_client_metadata" });
    expect(mocks.registerClient).not.toHaveBeenCalled();
  });

  it("passes JSON that is no object on to the service, which refuses it", async () => {
    await handleRegister(postJson("/oauth/register", "[1, 2]"));

    expect(mocks.registerClient).toHaveBeenCalledExactlyOnceWith([1, 2], "shared");
  });
});

describe("handleToken", () => {
  const CODE_REQUEST = {
    grant_type: "authorization_code",
    code: `hwc_${"C".repeat(43)}`,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  };

  it("exchanges a code from a form and answers with the tokens", async () => {
    const response = await handleToken(postForm({ ...CODE_REQUEST, resource: "https://wiki.example.com/mcp" }));

    expect(mocks.exchangeCode).toHaveBeenCalledExactlyOnceWith({
      code: CODE_REQUEST.code,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: CODE_REQUEST.code_verifier,
      resource: "https://wiki.example.com/mcp",
    });
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toStrictEqual({
      access_token: TOKENS.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: TOKENS.refreshToken,
      scope: "read",
    });
    expect(mocks.refreshGrant).not.toHaveBeenCalled();
  });

  it("refreshes a grant from a form", async () => {
    const response = await handleToken(
      postForm({ grant_type: "refresh_token", refresh_token: TOKENS.refreshToken, client_id: CLIENT_ID }),
    );

    expect(mocks.refreshGrant).toHaveBeenCalledExactlyOnceWith({
      refreshToken: TOKENS.refreshToken,
      clientId: CLIENT_ID,
      resource: undefined,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ access_token: TOKENS.accessToken, token_type: "Bearer" });
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it("reads the parameters from JSON as well", async () => {
    const response = await handleToken(
      postJson("/oauth/token", CODE_REQUEST, { "content-type": "application/json; charset=utf-8" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.exchangeCode).toHaveBeenCalledExactlyOnceWith({
      code: CODE_REQUEST.code,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: CODE_REQUEST.code_verifier,
      resource: undefined,
    });
  });

  it("leaves out a JSON parameter that is no text, for the service to report it as missing", async () => {
    await handleToken(postJson("/oauth/token", { ...CODE_REQUEST, code: 12345, client_id: null }));

    expect(mocks.exchangeCode.mock.calls[0]?.[0]).toMatchObject({ code: undefined, clientId: undefined });
  });

  it("decodes the values of a form", async () => {
    await handleToken(
      postForm(`grant_type=authorization_code&code=a+b%2Bc&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback`),
    );

    expect(mocks.exchangeCode.mock.calls[0]?.[0]).toMatchObject({ code: "a b+c", redirectUri: REDIRECT_URI });
  });

  it.each([
    ["invalid-request", 400, "invalid_request"],
    ["invalid-grant", 400, "invalid_grant"],
    ["invalid-target", 400, "invalid_target"],
    ["invalid-client", 401, "invalid_client"],
  ])("answers the code %s with %i and %s in the shape of RFC 6749", async (code, status, error) => {
    mocks.exchangeCode.mockResolvedValue({ ok: false, error: { code, description: "Reported by the service" } });

    const response = await handleToken(postForm(CODE_REQUEST));

    expect(response.status).toBe(status);
    expectNoStore(response);
    await expect(response.json()).resolves.toStrictEqual({ error, error_description: "Reported by the service" });
  });

  it("answers a failure of the service with 500, for a code and for a refresh", async () => {
    mocks.exchangeCode.mockResolvedValue({ ok: false, error: { code: "failed" } });
    mocks.refreshGrant.mockResolvedValue({ ok: false, error: { code: "failed" } });

    for (const request of [postForm(CODE_REQUEST), postForm({ grant_type: "refresh_token", refresh_token: "x" })]) {
      const response = await handleToken(request);

      expect(response.status).toBe(500);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({ error: "server_error" });
    }
  });

  it("answers a missing grant type with invalid_request", async () => {
    const response = await handleToken(postForm({ code: CODE_REQUEST.code }));

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it.each(["client_credentials", "password", "implicit", "urn:ietf:params:oauth:grant-type:device_code", ""])(
    "answers the grant type %j with unsupported_grant_type and reaches no service",
    async (grant_type) => {
      const response = await handleToken(postForm({ ...CODE_REQUEST, grant_type }));

      expect(response.status).toBe(400);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({ error: "unsupported_grant_type" });
      expect(mocks.exchangeCode).not.toHaveBeenCalled();
      expect(mocks.refreshGrant).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a parameter that is sent twice", postForm(`grant_type=authorization_code&code=one&code=two`)],
    ["a grant type that is sent twice", postForm(`grant_type=refresh_token&grant_type=authorization_code&code=one`)],
    [
      "another content type",
      new Request(`${PUBLIC_URL}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "x",
      }),
    ],
    ["no content type and no body", new Request(`${PUBLIC_URL}/oauth/token`, { method: "POST" })],
    ["JSON that is not valid", postJson("/oauth/token", "{not json")],
    ["JSON that is a list", postJson("/oauth/token", "[]")],
    ["a body of more than 64 KB", postForm({ ...CODE_REQUEST, padding: "a".repeat(MAX_BODY_BYTES) })],
  ])("answers %s with invalid_request and reaches no service", async (_case, request) => {
    const response = await handleToken(request);

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.refreshGrant).not.toHaveBeenCalled();
  });

  it("never logs a code or a token", async () => {
    await handleToken(postForm(CODE_REQUEST));
    await handleToken(postForm({ grant_type: "refresh_token", refresh_token: TOKENS.refreshToken }));

    const logged = JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls]);
    expect(logged).toBe("[[],[],[]]");
  });
});
