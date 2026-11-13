import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { challengeOf, hashSecret } from "@/features/oauth/secret";
import { Prisma } from "@/generated/prisma/client";
import {
  checkAuthorizationRequest,
  createCode,
  exchangeCode,
  isTokenLimitReached,
  refreshGrant,
  registerClient,
} from "@/features/oauth/service";

const mocks = vi.hoisted(() => ({
  clientCreate: vi.fn(),
  clientFindUnique: vi.fn(),
  clientFindFirst: vi.fn(),
  clientDeleteMany: vi.fn(),
  clientUpsert: vi.fn(),
  fetchMetadataDocument: vi.fn(),
  codeCreate: vi.fn(),
  codeFindUnique: vi.fn(),
  codeDeleteMany: vi.fn(),
  tokenCount: vi.fn(),
  tokenFindUnique: vi.fn(),
  tokenDeleteMany: vi.fn(),
  tokenUpdateMany: vi.fn(),
  tokenCreate: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  getServerEnv: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    oAuthClient: {
      create: mocks.clientCreate,
      findUnique: mocks.clientFindUnique,
      findFirst: mocks.clientFindFirst,
      deleteMany: mocks.clientDeleteMany,
      upsert: mocks.clientUpsert,
    },
    oAuthCode: { create: mocks.codeCreate, findUnique: mocks.codeFindUnique, deleteMany: mocks.codeDeleteMany },
    apiToken: {
      count: mocks.tokenCount,
      findUnique: mocks.tokenFindUnique,
      deleteMany: mocks.tokenDeleteMany,
      updateMany: mocks.tokenUpdateMany,
    },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/features/oauth/metadata-fetch", () => ({ fetchMetadataDocument: mocks.fetchMetadataDocument }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const NOW = new Date("2026-03-01T12:00:00.000Z");
const ALICE_ID = "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002";
const ALICE = { id: ALICE_ID, name: "alice" };
const CLIENT_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const GRANT_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
const REDIRECT_URI = "https://client.example/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CODE = `hwc_${"C".repeat(43)}`;
const REFRESH_TOKEN = `hwr_${GRANT_ID}.${"R".repeat(43)}`;
const MCP = "https://wiki.example.com/mcp";

const CLIENT_ROW = {
  id: CLIENT_ID,
  metadataUrl: null,
  name: "Example",
  redirectUris: [REDIRECT_URI],
  createdAt: NOW,
};

const PARAMS = {
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  code_challenge: challengeOf(VERIFIER),
  code_challenge_method: "S256",
  state: "state-of-the-client",
};

/** The row of a code as the exchange reads it. */
function codeRow(data: Record<string, unknown> = {}) {
  return {
    id: "c0de0000-0000-4000-8000-000000000001",
    userId: ALICE_ID,
    redirectUri: REDIRECT_URI,
    codeChallenge: challengeOf(VERIFIER),
    lifetime: "90d",
    expiresAt: new Date(NOW.getTime() + 60_000),
    client: CLIENT_ROW,
    ...data,
  };
}

/** The row of a grant as a refresh reads it. */
function grantRow(data: Record<string, unknown> = {}) {
  return {
    userId: ALICE_ID,
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    refreshTokenHash: hashSecret(REFRESH_TOKEN),
    client: CLIENT_ROW,
    user: { mustChangePassword: false },
    ...data,
  };
}

const EXCHANGE = { code: CODE, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, codeVerifier: VERIFIER };

/** Everything that was passed to the logger, as one string. */
function logged(): string {
  return JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls]);
}

/** Everything that was written to the database, as one string. */
function written(): string {
  return JSON.stringify([
    mocks.codeCreate.mock.calls,
    mocks.tokenCreate.mock.calls,
    mocks.tokenUpdateMany.mock.calls,
    mocks.clientCreate.mock.calls,
  ]);
}

/** Expects that none of the given secrets and none of their hashes was logged. */
function expectNotLogged(...secrets: string[]): void {
  for (const secret of secrets) {
    expect(logged()).not.toContain(secret);
    expect(logged()).not.toContain(hashSecret(secret));
    // Not even the random part alone.
    expect(logged()).not.toContain(secret.slice(-43));
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: "https://wiki.example.com" });
  mocks.clientFindUnique.mockResolvedValue(CLIENT_ROW);
  mocks.clientFindFirst.mockResolvedValue(CLIENT_ROW);
  mocks.clientCreate.mockResolvedValue(CLIENT_ROW);
  mocks.clientDeleteMany.mockResolvedValue({ count: 0 });
  mocks.codeCreate.mockResolvedValue({ id: "c0de0000-0000-4000-8000-000000000001" });
  mocks.codeFindUnique.mockResolvedValue(codeRow());
  mocks.codeDeleteMany.mockResolvedValue({ count: 1 });
  mocks.tokenCount.mockResolvedValue(0);
  mocks.tokenFindUnique.mockResolvedValue(grantRow());
  mocks.tokenDeleteMany.mockResolvedValue({ count: 0 });
  mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
  mocks.tokenCreate.mockResolvedValue({ id: GRANT_ID });
  mocks.queryRaw.mockResolvedValue([{ mustChangePassword: false }]);
  // The transaction client of `exchangeCode`: the reads and writes it makes inside the transaction.
  const tx = {
    $queryRaw: mocks.queryRaw,
    apiToken: { deleteMany: mocks.tokenDeleteMany, count: mocks.tokenCount, create: mocks.tokenCreate },
  };
  mocks.transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) => run(tx));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registerClient", () => {
  it.each([null, undefined, "text", 5, ["https://client.example/callback"]])(
    "refuses %j, which is no object, without writing",
    async (metadata) => {
      await expect(registerClient(metadata)).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid-client-metadata" },
      });

      expect(mocks.clientCreate).not.toHaveBeenCalled();
    },
  );

  it("refuses redirect addresses that are not allowed, without writing or logging", async () => {
    await expect(registerClient({ redirect_uris: ["javascript:alert(1)"] })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-redirect-uri", description: "redirect_uris has an address that is not allowed" },
    });

    expect(mocks.clientCreate).not.toHaveBeenCalled();
    expect(logged()).toBe("[[],[],[]]");
  });

  it("stores only the name and the redirect addresses, whatever else the client asked for", async () => {
    await registerClient({
      redirect_uris: [REDIRECT_URI],
      client_name: "Example",
      token_endpoint_auth_method: "client_secret_post",
      client_secret: "a-secret-the-client-made-up",
    });

    expect(mocks.clientCreate.mock.calls[0]?.[0].data).toEqual({ name: "Example", redirectUris: [REDIRECT_URI] });
  });

  it("reports failed for a database error, and logs it", async () => {
    const err = new Error("connection lost");
    mocks.clientCreate.mockRejectedValue(err);

    await expect(registerClient({ redirect_uris: [REDIRECT_URI] })).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ err }, "failed to register oauth client");
  });

  it("still registers when the clean-up fails, and logs the failure", async () => {
    mocks.codeDeleteMany.mockRejectedValue(new Error("deadlock"));
    mocks.clientDeleteMany.mockRejectedValue(new Error("deadlock"));

    await expect(registerClient({ redirect_uris: [REDIRECT_URI] })).resolves.toMatchObject({ ok: true });

    expect(mocks.error).toHaveBeenCalledTimes(2);
  });
});

describe("checkAuthorizationRequest", () => {
  it.each([
    ["no client id", { ...PARAMS, client_id: undefined }],
    ["a client id that is no id", { ...PARAMS, client_id: "not-a-uuid" }],
    ["a client id of more than 2048 characters", { ...PARAMS, client_id: "a".repeat(2049) }],
  ])("reports %s as an invalid client without asking the database", async (_case, params) => {
    await expect(checkAuthorizationRequest(params)).resolves.toEqual({ ok: false, error: { code: "invalid-client" } });

    expect(mocks.clientFindFirst).not.toHaveBeenCalled();
    expect(mocks.clientFindUnique).not.toHaveBeenCalled();
  });

  it("reports failed when the client cannot be read", async () => {
    mocks.clientFindFirst.mockRejectedValue(new Error("connection lost"));

    await expect(checkAuthorizationRequest(PARAMS)).resolves.toEqual({ ok: false, error: { code: "failed" } });
  });

  it("does not log the state or the challenge of a request it refuses", async () => {
    await checkAuthorizationRequest({ ...PARAMS, response_type: "token", state: "secret-state-of-the-client" });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { reason: "unsupported_response_type", clientId: CLIENT_ID },
      "authorization request refused",
    );
    expect(logged()).not.toContain("secret-state-of-the-client");
    expect(logged()).not.toContain(PARAMS.code_challenge);
  });
});

describe("a client from a metadata document", () => {
  const METADATA_URL = "https://client.example/metadata.json";
  const DOCUMENT = { client_id: METADATA_URL, client_name: "Example", redirect_uris: [REDIRECT_URI] };
  const METADATA_ROW = { ...CLIENT_ROW, metadataUrl: METADATA_URL };
  const METADATA_PARAMS = { ...PARAMS, client_id: METADATA_URL };

  beforeEach(() => {
    mocks.clientFindUnique.mockResolvedValue(null);
    mocks.clientUpsert.mockResolvedValue(METADATA_ROW);
    mocks.fetchMetadataDocument.mockResolvedValue({ ok: true, document: DOCUMENT, cacheControl: "max-age=7200" });
  });

  it("is fetched, stored with the time until which it is fresh, and known by its URL", async () => {
    const result = await checkAuthorizationRequest(METADATA_PARAMS);

    expect(result).toMatchObject({ ok: true, value: { client: { id: CLIENT_ID, clientId: METADATA_URL } } });
    expect(mocks.fetchMetadataDocument).toHaveBeenCalledExactlyOnceWith(METADATA_URL);
    const document = {
      name: "Example",
      redirectUris: [REDIRECT_URI],
      fetchedAt: NOW,
      freshUntil: new Date(NOW.getTime() + 7200 * 1000),
    };
    expect(mocks.clientUpsert.mock.calls[0]?.[0]).toMatchObject({
      where: { metadataUrl: METADATA_URL },
      create: { metadataUrl: METADATA_URL, ...document },
      update: document,
    });
  });

  it.each([
    ["a row that is fresh for another millisecond", new Date(NOW.getTime() + 1), false],
    ["a row at the moment its cache time is over", NOW, true],
    ["a row without a cache time", null, true],
  ])("with %s, is fetched again: %s", async (_case, freshUntil, fetchedAgain) => {
    mocks.clientFindUnique.mockResolvedValue({ ...METADATA_ROW, freshUntil });

    await expect(checkAuthorizationRequest(METADATA_PARAMS)).resolves.toMatchObject({ ok: true });

    expect(mocks.fetchMetadataDocument).toHaveBeenCalledTimes(fetchedAgain ? 1 : 0);
    expect(mocks.clientUpsert).toHaveBeenCalledTimes(fetchedAgain ? 1 : 0);
  });

  it("refuses the request without a redirect when the fetch fails, and logs the reason with the URL", async () => {
    mocks.fetchMetadataDocument.mockResolvedValue({ ok: false, reason: "address-not-public" });

    await expect(checkAuthorizationRequest(METADATA_PARAMS)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-client" },
    });

    expect(mocks.warn).toHaveBeenCalledWith(
      { metadataUrl: METADATA_URL, reason: "address-not-public" },
      "client metadata document not fetched",
    );
    expect(mocks.clientUpsert).not.toHaveBeenCalled();
  });

  it("refuses the request without a redirect for a document that is not valid, and logs the reason with the URL", async () => {
    mocks.fetchMetadataDocument.mockResolvedValue({
      ok: true,
      document: { ...DOCUMENT, client_id: "https://evil.example/metadata.json" },
      cacheControl: null,
    });

    await expect(checkAuthorizationRequest(METADATA_PARAMS)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-client" },
    });

    expect(mocks.warn).toHaveBeenCalledWith(
      { metadataUrl: METADATA_URL, reason: "client-id-mismatch" },
      "client metadata document refused",
    );
    expect(mocks.clientUpsert).not.toHaveBeenCalled();
  });

  it("refuses the request also when an older row exists and the fetch fails", async () => {
    mocks.clientFindUnique.mockResolvedValue({ ...METADATA_ROW, freshUntil: new Date(NOW.getTime() - 1) });
    mocks.fetchMetadataDocument.mockResolvedValue({ ok: false, reason: "timeout" });

    await expect(checkAuthorizationRequest(METADATA_PARAMS)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-client" },
    });
  });

  it("reads the row of the other request when two store the document of a new client at the same time", async () => {
    mocks.clientUpsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
        meta: { driverAdapterError: { cause: { constraint: { index: "OAuthClient_metadataUrl_key" } } } },
      }),
    );
    mocks.clientFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(METADATA_ROW);

    await expect(checkAuthorizationRequest(METADATA_PARAMS)).resolves.toMatchObject({
      ok: true,
      value: { client: { clientId: METADATA_URL } },
    });
  });

  it("reports failed when the document cannot be stored", async () => {
    mocks.clientUpsert.mockRejectedValue(new Error("connection lost"));

    await expect(checkAuthorizationRequest(METADATA_PARAMS)).resolves.toEqual({ ok: false, error: { code: "failed" } });
  });

  it.each([
    ["http", "http://client.example/metadata.json"],
    ["no path", "https://client.example/"],
    ["a port", "https://client.example:8443/metadata.json"],
    ["credentials", "https://user:secret@client.example/metadata.json"],
  ])("is not fetched for a URL with %s", async (_case, client_id) => {
    await expect(checkAuthorizationRequest({ ...PARAMS, client_id })).resolves.toEqual({
      ok: false,
      error: { code: "invalid-client" },
    });

    expect(mocks.fetchMetadataDocument).not.toHaveBeenCalled();
    expect(mocks.clientFindUnique).not.toHaveBeenCalled();
    expect(mocks.clientFindFirst).not.toHaveBeenCalled();
  });

  it("is looked up by its URL, a registered client by its id among the clients without a URL", async () => {
    await checkAuthorizationRequest(METADATA_PARAMS);
    await checkAuthorizationRequest(PARAMS);

    expect(mocks.clientFindUnique.mock.calls[0]?.[0].where).toEqual({ metadataUrl: METADATA_URL });
    expect(mocks.clientFindFirst.mock.calls[0]?.[0].where).toEqual({ id: CLIENT_ID, metadataUrl: null });
  });

  it("is named by its URL when its code is exchanged and its grant is refreshed, without another fetch", async () => {
    mocks.codeFindUnique.mockResolvedValue(codeRow({ client: METADATA_ROW }));
    mocks.tokenFindUnique.mockResolvedValue(grantRow({ client: METADATA_ROW }));

    await expect(exchangeCode({ ...EXCHANGE, clientId: METADATA_URL })).resolves.toMatchObject({ ok: true });
    await expect(refreshGrant({ refreshToken: REFRESH_TOKEN, clientId: METADATA_URL })).resolves.toMatchObject({
      ok: true,
    });
    // The id of its row is not its client id.
    await expect(refreshGrant({ refreshToken: REFRESH_TOKEN, clientId: CLIENT_ID })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-grant" },
    });

    expect(mocks.fetchMetadataDocument).not.toHaveBeenCalled();
  });
});

describe("isTokenLimitReached", () => {
  it.each([
    ["a malformed actor id", { id: "not-a-uuid", name: "alice" }, CLIENT_ID],
    ["a malformed client id", ALICE, "not-a-uuid"],
  ])("is true for %s, without asking the database", async (_case, actor, clientId) => {
    await expect(isTokenLimitReached(actor, clientId)).resolves.toBe(true);

    expect(mocks.clientFindUnique).not.toHaveBeenCalled();
    expect(mocks.tokenCount).not.toHaveBeenCalled();
  });

  it("is true for a client that does not exist", async () => {
    mocks.clientFindUnique.mockResolvedValue(null);

    await expect(isTokenLimitReached(ALICE, CLIENT_ID)).resolves.toBe(true);
  });
});

describe("createCode", () => {
  it("stores the hash of the code, never the code, and logs neither", async () => {
    const result = await createCode(ALICE, PARAMS, "90d");

    if (!result.ok) return expect.fail(`no code: ${result.error.code}`);
    const { code } = result.value;
    expect(code).toMatch(/^hwc_/);
    expect(mocks.codeCreate.mock.calls[0]?.[0].data).toMatchObject({
      codeHash: hashSecret(code),
      clientId: CLIENT_ID,
      userId: ALICE_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge: PARAMS.code_challenge,
      scopes: ["read"],
      lifetime: "90d",
      expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
    });
    expect(written()).not.toContain(code);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { userId: ALICE_ID, clientId: CLIENT_ID },
      "authorization code created",
    );
    expectNotLogged(code);
    expect(logged()).not.toContain(PARAMS.state);
  });

  it("refuses a malformed actor id before it asks the database, and logs it", async () => {
    await expect(createCode({ id: "not-a-uuid", name: "alice" }, PARAMS, "90d")).resolves.toEqual({
      ok: false,
      error: { code: "failed" },
    });

    expect(mocks.clientFindUnique).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ actorId: "not-a-uuid" }, "malformed actor id");
  });

  it.each(["", "7d", "never", "90"])("refuses the lifetime %j without writing", async (lifetime) => {
    await expect(createCode(ALICE, PARAMS, lifetime)).resolves.toEqual({
      ok: false,
      error: { code: "invalid-lifetime" },
    });

    expect(mocks.codeCreate).not.toHaveBeenCalled();
  });

  it("reports failed for a database error, and logs it without the code", async () => {
    const err = new Error("connection lost");
    mocks.codeCreate.mockRejectedValue(err);

    await expect(createCode(ALICE, PARAMS, "90d")).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, userId: ALICE_ID, clientId: CLIENT_ID },
      "failed to create authorization code",
    );
    expect(logged()).not.toContain("hwc_");
  });
});

describe("exchangeCode", () => {
  it("stores the hashes of the tokens, never the tokens, and logs neither", async () => {
    const result = await exchangeCode(EXCHANGE);

    if (!result.ok) return expect.fail(`no tokens: ${result.error.code}`);
    const { accessToken, refreshToken } = result.value;
    const stored = mocks.tokenCreate.mock.calls[0]?.[0].data;
    expect(stored).toMatchObject({
      userId: ALICE_ID,
      clientId: CLIENT_ID,
      name: "Example",
      scopes: ["read"],
      accessTokenHash: hashSecret(accessToken),
      refreshTokenHash: hashSecret(refreshToken),
      accessTokenExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      expiresAt: new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
    });
    expect(stored).not.toHaveProperty("tokenHash");
    // The refresh token names the grant it belongs to.
    expect(refreshToken.startsWith(`hwr_${stored.id}.`)).toBe(true);
    expect(written()).not.toContain(accessToken);
    expect(written()).not.toContain(refreshToken);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { userId: ALICE_ID, clientId: CLIENT_ID, grantId: stored.id, replaced: 0 },
      "grant created",
    );
    expectNotLogged(CODE, accessToken, refreshToken, VERIFIER);
  });

  it("reports a missing code as an invalid request", async () => {
    await expect(exchangeCode({ ...EXCHANGE, code: undefined })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });

    expect(mocks.codeFindUnique).not.toHaveBeenCalled();
  });

  it.each(["", "not-a-code", `hwa_${"C".repeat(43)}`, `hw_${"C".repeat(43)}`, `${CODE}x`])(
    "reports %j, which does not look like a code, as an invalid grant without asking the database or logging",
    async (code) => {
      await expect(exchangeCode({ ...EXCHANGE, code })).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid-grant" },
      });

      expect(mocks.codeFindUnique).not.toHaveBeenCalled();
      expect(logged()).toBe("[[],[],[]]");
    },
  );

  it("looks the code up by its hash and deletes the row before it checks anything else", async () => {
    await exchangeCode({ ...EXCHANGE, codeVerifier: "a".repeat(43) });

    expect(mocks.codeFindUnique.mock.calls[0]?.[0].where).toEqual({ codeHash: hashSecret(CODE) });
    expect(mocks.codeDeleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id: codeRow().id } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["an expired code", { code: codeRow({ expiresAt: NOW }) }, "expired-code"],
    ["another client", { input: { clientId: "1b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a11" } }, "other-client"],
    ["no client", { input: { clientId: undefined } }, "other-client"],
    ["another redirect address", { input: { redirectUri: `${REDIRECT_URI}/` } }, "other-redirect-uri"],
    ["no redirect address", { input: { redirectUri: undefined } }, "other-redirect-uri"],
    ["another verifier", { input: { codeVerifier: "a".repeat(43) } }, "wrong-verifier"],
    ["no verifier", { input: { codeVerifier: undefined } }, "wrong-verifier"],
    ["the challenge as the verifier", { input: { codeVerifier: challengeOf(VERIFIER) } }, "wrong-verifier"],
  ])("refuses %s with the reason in the log, and never the code or the verifier", async (_case, change, reason) => {
    const { code, input } = change as { code?: ReturnType<typeof codeRow>; input?: Record<string, unknown> };
    if (code) mocks.codeFindUnique.mockResolvedValue(code);

    await expect(exchangeCode({ ...EXCHANGE, ...input })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-grant" },
    });

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { reason, userId: ALICE_ID, clientId: CLIENT_ID },
      "code exchange refused",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectNotLogged(CODE, VERIFIER);
  });

  it("refuses a resource that is not the MCP endpoint, and accepts the MCP endpoint", async () => {
    await expect(exchangeCode({ ...EXCHANGE, resource: "https://other.example/mcp" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-target" },
    });
    await expect(exchangeCode({ ...EXCHANGE, resource: MCP })).resolves.toMatchObject({ ok: true });
  });

  it("reports failed when the grant cannot be written, and logs it without a token", async () => {
    const err = new Error("connection lost");
    mocks.tokenCreate.mockRejectedValue(err);

    await expect(exchangeCode(EXCHANGE)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, userId: ALICE_ID, clientId: CLIENT_ID },
      "failed to create grant",
    );
    expect(logged()).not.toContain("hwa_");
    expect(logged()).not.toContain("hwr_");
  });

  it("reports failed for a code with a lifetime that is no choice, which only a broken row has", async () => {
    mocks.codeFindUnique.mockResolvedValue(codeRow({ lifetime: "forever" }));

    await expect(exchangeCode(EXCHANGE)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("refreshGrant", () => {
  const REFRESH = { refreshToken: REFRESH_TOKEN, clientId: CLIENT_ID };

  it("swaps the hashes on the condition of the hash it read, and logs no token", async () => {
    const result = await refreshGrant(REFRESH);

    if (!result.ok) return expect.fail(`no tokens: ${result.error.code}`);
    const { accessToken, refreshToken } = result.value;
    expect(refreshToken).not.toBe(REFRESH_TOKEN);
    expect(refreshToken.startsWith(`hwr_${GRANT_ID}.`)).toBe(true);
    expect(mocks.tokenUpdateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: GRANT_ID, refreshTokenHash: hashSecret(REFRESH_TOKEN) },
      data: {
        accessTokenHash: hashSecret(accessToken),
        accessTokenExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
        refreshTokenHash: hashSecret(refreshToken),
      },
    });
    expect(result.value.expiresIn).toBe(3600);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { grantId: GRANT_ID, userId: ALICE_ID, clientId: CLIENT_ID },
      "grant refreshed",
    );
    expectNotLogged(REFRESH_TOKEN, accessToken, refreshToken);
  });

  it("gives an access token that ends with its grant when the grant ends within the hour", async () => {
    mocks.tokenFindUnique.mockResolvedValue(grantRow({ expiresAt: new Date(NOW.getTime() + 90_000) }));

    const result = await refreshGrant(REFRESH);

    expect(result).toMatchObject({ ok: true, value: { expiresIn: 90 } });
    expect(mocks.tokenUpdateMany.mock.calls[0]?.[0].data.accessTokenExpiresAt).toEqual(
      new Date(NOW.getTime() + 90_000),
    );
  });

  it("reports a missing refresh token as an invalid request", async () => {
    await expect(refreshGrant({ clientId: CLIENT_ID })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
  });

  it.each(["", "not-a-token", `hwr_${"R".repeat(43)}`, `hwa_${"R".repeat(43)}`, `hwr_not-a-uuid.${"R".repeat(43)}`])(
    "reports %j, which names no grant, as an invalid grant without asking the database or logging",
    async (refreshToken) => {
      await expect(refreshGrant({ ...REFRESH, refreshToken })).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid-grant" },
      });

      expect(mocks.tokenFindUnique).not.toHaveBeenCalled();
      expect(logged()).toBe("[[],[],[]]");
    },
  );

  it.each([
    ["a grant that does not exist", null],
    ["a token of the account page, which has no client", grantRow({ client: null, refreshTokenHash: null })],
  ])("reports %s as an invalid grant and deletes nothing", async (_case, row) => {
    mocks.tokenFindUnique.mockResolvedValue(row);

    await expect(refreshGrant(REFRESH)).resolves.toMatchObject({ ok: false, error: { code: "invalid-grant" } });

    expect(mocks.tokenDeleteMany).not.toHaveBeenCalled();
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
  });

  it("revokes the grant for a refresh token that is not the current one, and logs the grant id but no token", async () => {
    const old = `hwr_${GRANT_ID}.${"O".repeat(43)}`;

    await expect(refreshGrant({ ...REFRESH, refreshToken: old })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-grant" },
    });

    expect(mocks.tokenDeleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id: GRANT_ID } });
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { grantId: GRANT_ID, userId: ALICE_ID, clientId: CLIENT_ID },
      "refresh token used again, grant revoked",
    );
    expectNotLogged(old, REFRESH_TOKEN);
  });

  it.each([
    ["another client", { input: { clientId: "1b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a11" } }, "other-client"],
    ["no client", { input: { clientId: undefined } }, "other-client"],
    ["a grant at the moment it expires", { grant: grantRow({ expiresAt: NOW }) }, "expired-grant"],
    ["a user with the first password", { grant: grantRow({ user: { mustChangePassword: true } }) }, "first-password"],
  ])("refuses %s without revoking the grant, with the reason in the log", async (_case, change, reason) => {
    const { grant, input } = change as { grant?: ReturnType<typeof grantRow>; input?: Record<string, unknown> };
    if (grant) mocks.tokenFindUnique.mockResolvedValue(grant);

    await expect(refreshGrant({ ...REFRESH, ...input })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-grant" },
    });

    expect(mocks.tokenDeleteMany).not.toHaveBeenCalled();
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { reason, grantId: GRANT_ID, userId: ALICE_ID, clientId: CLIENT_ID },
      "refresh refused",
    );
    expectNotLogged(REFRESH_TOKEN);
  });

  it("refuses a resource that is not the MCP endpoint without revoking the grant", async () => {
    await expect(refreshGrant({ ...REFRESH, resource: "https://other.example/mcp" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-target" },
    });
    await expect(refreshGrant({ ...REFRESH, resource: MCP })).resolves.toMatchObject({ ok: true });

    expect(mocks.tokenDeleteMany).not.toHaveBeenCalled();
  });

  it("refuses a refresh whose swap found the hash changed, without revoking the grant", async () => {
    mocks.tokenUpdateMany.mockResolvedValue({ count: 0 });

    await expect(refreshGrant(REFRESH)).resolves.toMatchObject({ ok: false, error: { code: "invalid-grant" } });

    expect(mocks.tokenDeleteMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { reason: "refreshed-meanwhile", grantId: GRANT_ID, userId: ALICE_ID, clientId: CLIENT_ID },
      "refresh refused",
    );
  });

  it.each([
    ["the grant cannot be read", () => mocks.tokenFindUnique.mockRejectedValue(new Error("connection lost"))],
    ["the hashes cannot be written", () => mocks.tokenUpdateMany.mockRejectedValue(new Error("connection lost"))],
  ])("reports failed when %s, and logs it without a token", async (_case, breakDatabase) => {
    breakDatabase();

    await expect(refreshGrant(REFRESH)).resolves.toEqual({ ok: false, error: { code: "failed" } });

    expect(mocks.error).toHaveBeenCalledOnce();
    expectNotLogged(REFRESH_TOKEN);
  });
});
