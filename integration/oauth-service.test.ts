// Runs the OAuth service against the test database, to check the authorization code flow on real data: what only
// the database decides, such as a code that works once and a refresh that cannot succeed twice.
import { afterEach, describe, expect, it, vi } from "vitest";

import { challengeOf, hashSecret } from "@/features/oauth/secret";
import * as oauthService from "@/features/oauth/service";
import * as tokenService from "@/features/tokens/service";

import { createApiToken, createUser, getTestDb } from "../e2e/support/database";

/** The address of the MCP endpoint of the wiki of these tests (`HIPPOWIKI_PUBLIC_URL` in `setup.ts`). */
const MCP = "https://wiki.example.com/mcp";
const REDIRECT_URI = "https://client.example/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type Actor = { id: string; name: string };
type Client = oauthService.OAuthClient;

afterEach(() => {
  vi.useRealTimers();
});

/** Sets the clock of the services; only `Date` is faked, so the database driver keeps its timers. */
function setClock(now: number): void {
  vi.useFakeTimers({ now, toFake: ["Date"] });
}

/** A user of the test database as the actor of the service, with the password change done. */
async function createActor(data: { mustChangePassword?: boolean } = {}): Promise<Actor> {
  const user = await createUser({ mustChangePassword: false, ...data });
  return { id: user.id, name: user.name };
}

/** Registers a client and fails the test if that does not succeed. */
async function register(metadata: Record<string, unknown> = {}): Promise<Client> {
  const result = await oauthService.registerClient({
    redirect_uris: [REDIRECT_URI],
    client_name: "Example",
    ...metadata,
  });
  if (!result.ok) return expect.fail(`client not registered: ${result.error.code}`);
  return result.value;
}

/** The parameters of a valid authorization request of the client. */
function paramsOf(client: Client, params: Record<string, string | undefined> = {}) {
  return {
    client_id: client.clientId,
    redirect_uri: client.redirectUris[0],
    response_type: "code",
    code_challenge: challengeOf(VERIFIER),
    code_challenge_method: "S256",
    state: "xyz",
    ...params,
  };
}

/** Creates a code for the actor and the client, as the consent page does after "Approve". */
async function approve(actor: Actor, client: Client, lifetime = "90d"): Promise<string> {
  const result = await oauthService.createCode(actor, paramsOf(client), lifetime);
  if (!result.ok) return expect.fail(`code not created: ${result.error.code}`);
  return result.value.code;
}

/** The token request of the client for the code. */
function exchangeOf(client: Client, code: string, input: Record<string, string | undefined> = {}) {
  return { code, clientId: client.clientId, redirectUri: client.redirectUris[0], codeVerifier: VERIFIER, ...input };
}

/** Approves the client and exchanges the code: a grant with its first tokens. */
async function grant(actor: Actor, client: Client, lifetime = "90d"): Promise<oauthService.TokenSet> {
  const result = await oauthService.exchangeCode(exchangeOf(client, await approve(actor, client, lifetime)));
  if (!result.ok) return expect.fail(`code not exchanged: ${result.error.code}`);
  return result.value;
}

/** Request headers that carry the token as a bearer token. */
function bearer(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` });
}

/** Whether `/mcp` would accept the access token: `authenticateToken()` with OAuth accepted. */
async function works(accessToken: string): Promise<boolean> {
  return (await tokenService.authenticateToken(bearer(accessToken), "read", { acceptOAuth: true })).ok;
}

function grantsOf(actor: Actor) {
  return getTestDb().apiToken.findMany({ where: { userId: actor.id }, orderBy: { createdAt: "asc" } });
}

const INVALID_GRANT = { ok: false, error: { code: "invalid-grant" } };

describe("registerClient", () => {
  it("stores a public client with its name and redirect addresses, and its client id is its id", async () => {
    const client = await register({
      redirect_uris: [REDIRECT_URI, "http://127.0.0.1/callback"],
      client_name: "  Claude  ",
      token_endpoint_auth_method: "client_secret_basic",
    });

    const rows = await getTestDb().oAuthClient.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: client.id,
      metadataUrl: null,
      fetchedAt: null,
      freshUntil: null,
      name: "Claude",
      redirectUris: [REDIRECT_URI, "http://127.0.0.1/callback"],
    });
    expect(client).toStrictEqual({
      id: rows[0]?.id,
      clientId: rows[0]?.id,
      name: "Claude",
      redirectUris: [REDIRECT_URI, "http://127.0.0.1/callback"],
      createdAt: rows[0]?.createdAt,
    });
  });

  it("cuts a long name to 50 characters and names a client without a name Connected app", async () => {
    expect((await register({ client_name: "a".repeat(80) })).name).toBe("a".repeat(50));
    expect((await register({ client_name: undefined })).name).toBe("Connected app");
    expect((await register({ client_name: "   " })).name).toBe("Connected app");
  });

  it.each([
    ["no redirect addresses", { redirect_uris: undefined }],
    ["an empty list", { redirect_uris: [] }],
    ["11 addresses", { redirect_uris: Array.from({ length: 11 }, (_, index) => `${REDIRECT_URI}/${index}`) }],
    ["a script", { redirect_uris: ["javascript:alert(1)"] }],
    ["http on another host", { redirect_uris: ["http://client.example/callback"] }],
    ["a fragment", { redirect_uris: [`${REDIRECT_URI}#fragment`] }],
  ])("refuses %s and stores nothing", async (_case, metadata) => {
    const result = await oauthService.registerClient({ client_name: "Example", ...metadata });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-redirect-uri" } });
    expect(await getTestDb().oAuthClient.count()).toBe(0);
  });
});

describe("checkAuthorizationRequest", () => {
  it("accepts a valid request and returns what the consent page shows", async () => {
    const client = await register();

    const result = await oauthService.checkAuthorizationRequest(paramsOf(client, { scope: "read", resource: MCP }));

    expect(result).toStrictEqual({
      ok: true,
      value: { client, redirectUri: REDIRECT_URI, codeChallenge: challengeOf(VERIFIER), state: "xyz" },
    });
  });

  it("accepts a request without a state, a scope and a resource", async () => {
    const client = await register();

    const result = await oauthService.checkAuthorizationRequest(paramsOf(client, { state: undefined }));

    expect(result).toMatchObject({ ok: true, value: { state: null } });
  });

  it("ignores scopes it does not know: the grant is read whatever was asked for", async () => {
    const [alice, client] = [await createActor(), await register()];

    const check = await oauthService.checkAuthorizationRequest(
      paramsOf(client, { scope: "write admin offline_access openid" }),
    );
    await grant(alice, client);

    expect(check.ok).toBe(true);
    expect((await grantsOf(alice))[0]?.scopes).toEqual(["read"]);
  });

  it("does not redirect for a client that does not exist", async () => {
    const client = await register();
    await getTestDb().oAuthClient.deleteMany();

    for (const client_id of [client.clientId, crypto.randomUUID(), "not-a-uuid", undefined]) {
      await expect(oauthService.checkAuthorizationRequest(paramsOf(client, { client_id }))).resolves.toEqual({
        ok: false,
        error: { code: "invalid-client" },
      });
    }
  });

  it.each([
    ["no redirect address", undefined],
    ["an address of another site", "https://evil.example/callback"],
    ["another path", `${REDIRECT_URI}/more`],
    ["a query", `${REDIRECT_URI}?next=https://evil.example`],
    ["another port", "https://client.example:8443/callback"],
    ["the address of another client", "https://other.example/callback"],
  ])("does not redirect for %s", async (_case, redirect_uri) => {
    const client = await register();
    await register({ redirect_uris: ["https://other.example/callback"] });

    await expect(oauthService.checkAuthorizationRequest(paramsOf(client, { redirect_uri }))).resolves.toEqual({
      ok: false,
      error: { code: "invalid-redirect-uri" },
    });
  });

  it("ignores the port of http on a loopback address, and nothing else of it", async () => {
    const client = await register({ redirect_uris: ["http://127.0.0.1/callback"] });

    await expect(
      oauthService.checkAuthorizationRequest(paramsOf(client, { redirect_uri: "http://127.0.0.1:51234/callback" })),
    ).resolves.toMatchObject({ ok: true, value: { redirectUri: "http://127.0.0.1:51234/callback" } });
    for (const redirect_uri of ["http://127.0.0.1:51234/other", "http://localhost:51234/callback"]) {
      await expect(oauthService.checkAuthorizationRequest(paramsOf(client, { redirect_uri }))).resolves.toEqual({
        ok: false,
        error: { code: "invalid-redirect-uri" },
      });
    }
  });

  it.each([
    ["no response type", { response_type: undefined }, "invalid_request"],
    ["the response type token", { response_type: "token" }, "unsupported_response_type"],
    ["no PKCE method", { code_challenge_method: undefined }, "invalid_request"],
    ["the PKCE method plain", { code_challenge_method: "plain" }, "invalid_request"],
    ["no challenge", { code_challenge: undefined }, "invalid_request"],
    ["a challenge that is no SHA-256", { code_challenge: "too-short" }, "invalid_request"],
    ["a resource that is another server", { resource: "https://other.example/mcp" }, "invalid_target"],
    ["a resource that is the wiki, not its MCP endpoint", { resource: "https://wiki.example.com" }, "invalid_target"],
    ["a state of more than 2048 characters", { state: "s".repeat(2049) }, "invalid_request"],
  ])("sends %s back to the client as %s, with its state", async (_case, params, error) => {
    const client = await register();

    const result = await oauthService.checkAuthorizationRequest(paramsOf(client, params));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "refused",
        redirectUri: REDIRECT_URI,
        state: "state" in params ? null : "xyz",
        error,
        description: expect.any(String),
      },
    });
  });
});

describe("createCode", () => {
  it("stores the hash of a code that expires after ten minutes, with the request and the chosen lifetime", async () => {
    const [alice, client] = [await createActor(), await register()];
    const start = Date.now();
    setClock(start);

    const code = await approve(alice, client, "365d");

    const rows = await getTestDb().oAuthCode.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      codeHash: hashSecret(code),
      clientId: client.id,
      userId: alice.id,
      redirectUri: REDIRECT_URI,
      codeChallenge: challengeOf(VERIFIER),
      scopes: ["read"],
      lifetime: "365d",
      expiresAt: new Date(start + 10 * MINUTE_MS),
    });
    expect(JSON.stringify(rows[0])).not.toContain(code);
    // A code is no grant yet.
    expect(await getTestDb().apiToken.count()).toBe(0);
  });

  it("checks the request again and creates no code for one that is not valid", async () => {
    const [alice, client] = [await createActor(), await register()];

    for (const [params, code] of [
      [{ redirect_uri: "https://evil.example/callback" }, "invalid-redirect-uri"],
      [{ client_id: crypto.randomUUID() }, "invalid-client"],
      [{ code_challenge_method: "plain" }, "refused"],
    ] as const) {
      await expect(oauthService.createCode(alice, paramsOf(client, params), "90d")).resolves.toMatchObject({
        ok: false,
        error: { code },
      });
    }
    await expect(oauthService.createCode(alice, paramsOf(client), "7d")).resolves.toEqual({
      ok: false,
      error: { code: "invalid-lifetime" },
    });

    expect(await getTestDb().oAuthCode.count()).toBe(0);
  });

  it("reports failed for an actor that does not exist", async () => {
    const client = await register();

    await expect(
      oauthService.createCode({ id: crypto.randomUUID(), name: "ghost" }, paramsOf(client), "90d"),
    ).resolves.toEqual({ ok: false, error: { code: "failed" } });
  });
});

describe("exchangeCode", () => {
  it("creates a grant named after the client, with the scope read and the chosen lifetime, and returns its tokens", async () => {
    const [alice, client] = [await createActor(), await register({ client_name: "Claude" })];
    const start = Date.now();
    setClock(start);
    const code = await approve(alice, client, "30d");

    const result = await oauthService.exchangeCode(exchangeOf(client, code, { resource: MCP }));

    if (!result.ok) return expect.fail(`code not exchanged: ${result.error.code}`);
    const { accessToken, refreshToken, expiresIn, scopes } = result.value;
    expect(accessToken).toMatch(/^hwa_[A-Za-z0-9_-]{43}$/);
    expect(expiresIn).toBe(3600);
    expect(scopes).toEqual(["read"]);
    const rows = await grantsOf(alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: alice.id,
      clientId: client.id,
      name: "Claude",
      scopes: ["read"],
      tokenHash: null,
      accessTokenHash: hashSecret(accessToken),
      refreshTokenHash: hashSecret(refreshToken),
      accessTokenExpiresAt: new Date(start + HOUR_MS),
      expiresAt: new Date(start + 30 * DAY_MS),
      lastUsedAt: null,
    });
    expect(refreshToken.startsWith(`hwr_${rows[0]?.id}.`)).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain(accessToken);
    expect(JSON.stringify(rows[0])).not.toContain(refreshToken);
    // The code is gone.
    expect(await getTestDb().oAuthCode.count()).toBe(0);
    expect(await works(accessToken)).toBe(true);
  });

  it("exchanges a code only once", async () => {
    const [alice, client] = [await createActor(), await register()];
    const code = await approve(alice, client);

    await expect(oauthService.exchangeCode(exchangeOf(client, code))).resolves.toMatchObject({ ok: true });
    await expect(oauthService.exchangeCode(exchangeOf(client, code))).resolves.toMatchObject(INVALID_GRANT);

    expect(await grantsOf(alice)).toHaveLength(1);
  });

  it("exchanges a code only once when many exchanges arrive at the same time", async () => {
    const [alice, client] = [await createActor(), await register()];
    const code = await approve(alice, client);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => oauthService.exchangeCode(exchangeOf(client, code))),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.error.code === "invalid-grant")).toHaveLength(7);
    expect(await grantsOf(alice)).toHaveLength(1);
  });

  it.each([
    ["another verifier", { codeVerifier: "a".repeat(43) }],
    ["no verifier", { codeVerifier: undefined }],
    ["another redirect address", { redirectUri: `${REDIRECT_URI}/` }],
    ["no redirect address", { redirectUri: undefined }],
    ["no client", { clientId: undefined }],
    ["a resource that is another server", { resource: "https://other.example/mcp" }],
  ])("refuses %s, and the failed check uses the code up", async (_case, input) => {
    const [alice, client] = [await createActor(), await register()];
    const code = await approve(alice, client);

    await expect(oauthService.exchangeCode(exchangeOf(client, code, input))).resolves.toMatchObject({ ok: false });
    // The right request comes too late.
    await expect(oauthService.exchangeCode(exchangeOf(client, code))).resolves.toMatchObject(INVALID_GRANT);

    expect(await getTestDb().apiToken.count()).toBe(0);
    expect(await getTestDb().oAuthCode.count()).toBe(0);
  });

  it("refuses a code that another client presents", async () => {
    const [alice, client, other] = [await createActor(), await register(), await register()];
    const code = await approve(alice, client);

    await expect(oauthService.exchangeCode(exchangeOf(other, code))).resolves.toMatchObject(INVALID_GRANT);

    expect(await getTestDb().apiToken.count()).toBe(0);
  });

  it("accepts a code a millisecond before it expires and refuses it at the moment it expires", async () => {
    const [alice, client] = [await createActor(), await register()];
    const start = Date.now();
    setClock(start);
    const [early, late] = [await approve(alice, client), await approve(alice, client)];

    vi.setSystemTime(start + 10 * MINUTE_MS - 1);
    await expect(oauthService.exchangeCode(exchangeOf(client, early))).resolves.toMatchObject({ ok: true });
    vi.setSystemTime(start + 10 * MINUTE_MS);
    await expect(oauthService.exchangeCode(exchangeOf(client, late))).resolves.toMatchObject(INVALID_GRANT);
  });

  it("gives no grant to a user who got the first password back after approving", async () => {
    const [alice, client] = [await createActor(), await register()];
    const code = await approve(alice, client);
    await getTestDb().user.update({ where: { id: alice.id }, data: { mustChangePassword: true } });

    await expect(oauthService.exchangeCode(exchangeOf(client, code))).resolves.toMatchObject(INVALID_GRANT);

    expect(await getTestDb().apiToken.count()).toBe(0);
  });

  it("refuses values that are no codes", async () => {
    const client = await register();

    for (const code of ["", "not-a-code", `hwc_${"A".repeat(43)}`]) {
      await expect(oauthService.exchangeCode(exchangeOf(client, code))).resolves.toMatchObject(INVALID_GRANT);
    }
    await expect(oauthService.exchangeCode({ ...exchangeOf(client, ""), code: undefined })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
  });
});

describe("the grants that a new grant replaces", () => {
  it("replaces the older grant of the same user to the same client, and its tokens stop working", async () => {
    const [alice, client] = [await createActor(), await register()];
    const first = await grant(alice, client);

    const second = await grant(alice, client);

    const rows = await grantsOf(alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accessTokenHash).toBe(hashSecret(second.accessToken));
    expect(await works(first.accessToken)).toBe(false);
    expect(await works(second.accessToken)).toBe(true);
    await expect(
      oauthService.refreshGrant({ refreshToken: first.refreshToken, clientId: client.clientId }),
    ).resolves.toMatchObject(INVALID_GRANT);
  });

  it("replaces the grant to a registered client with the same name and redirect addresses, which registered again", async () => {
    const alice = await createActor();
    const first = await grant(alice, await register());

    const again = await register();
    const second = await grant(alice, again);

    const rows = await grantsOf(alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clientId).toBe(again.id);
    expect(await works(first.accessToken)).toBe(false);
    expect(await works(second.accessToken)).toBe(true);
  });

  it.each([
    ["another name", { client_name: "Other" }],
    ["other redirect addresses", { redirect_uris: ["https://other.example/callback"] }],
    ["one more redirect address", { redirect_uris: [REDIRECT_URI, "https://other.example/callback"] }],
  ])("keeps the grant to a client with %s", async (_case, metadata) => {
    const alice = await createActor();
    const first = await grant(alice, await register());

    await grant(alice, await register(metadata));

    expect(await grantsOf(alice)).toHaveLength(2);
    expect(await works(first.accessToken)).toBe(true);
  });

  it("keeps the grants of other users to the same client, and the tokens of the account page", async () => {
    const [alice, bob, client] = [await createActor(), await createActor(), await register()];
    const bobs = await grant(bob, client);
    await grant(alice, client);
    const { secret } = await createApiToken({ owner: alice, name: "Example" });

    await grant(alice, client);

    expect(await grantsOf(alice)).toHaveLength(2);
    expect(await grantsOf(bob)).toHaveLength(1);
    expect(await works(bobs.accessToken)).toBe(true);
    await expect(tokenService.authenticateToken(bearer(secret), "read")).resolves.toMatchObject({ ok: true });
  });
});

describe("the limit of tokens per user", () => {
  /** Fills the tokens of the user up to the given number, with tokens of the account page. */
  async function fill(owner: Actor, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) await createApiToken({ owner });
  }

  it("counts a grant like a token: the 21st is refused, at the consent and at the exchange", async () => {
    const [alice, client] = [await createActor(), await register()];
    await fill(alice, tokenService.MAX_TOKENS_PER_USER - 1);
    const code = await approve(alice, client);
    // A second code, created while there was still room.
    const late = await approve(alice, await register({ client_name: "Late" }));
    await expect(oauthService.isTokenLimitReached(alice, client.id)).resolves.toBe(false);

    await expect(oauthService.exchangeCode(exchangeOf(client, code))).resolves.toMatchObject({ ok: true });

    expect(await getTestDb().apiToken.count({ where: { userId: alice.id } })).toBe(20);
    const other = await register({ client_name: "Other" });
    await expect(oauthService.isTokenLimitReached(alice, other.id)).resolves.toBe(true);
    await expect(oauthService.createCode(alice, paramsOf(other), "90d")).resolves.toEqual({
      ok: false,
      error: { code: "limit-reached" },
    });
    // The exchange decides: the code that was created in time is refused as well.
    const lateClient = (await getTestDb().oAuthClient.findFirstOrThrow({ where: { name: "Late" } })).id;
    await expect(
      oauthService.exchangeCode({
        code: late,
        clientId: lateClient,
        redirectUri: REDIRECT_URI,
        codeVerifier: VERIFIER,
      }),
    ).resolves.toMatchObject(INVALID_GRANT);
    expect(await getTestDb().apiToken.count({ where: { userId: alice.id } })).toBe(20);
    // The token service counts the grant as well.
    await expect(
      tokenService.createToken(alice, { name: "one too many", scopes: ["read"], expiry: "90d" }),
    ).resolves.toEqual({ ok: false, error: { code: "limit-reached" } });
  });

  it("does not count the grants that the new one replaces", async () => {
    const [alice, client] = [await createActor(), await register()];
    await fill(alice, tokenService.MAX_TOKENS_PER_USER - 1);
    const first = await grant(alice, client);
    expect(await getTestDb().apiToken.count({ where: { userId: alice.id } })).toBe(20);

    await expect(oauthService.isTokenLimitReached(alice, client.id)).resolves.toBe(false);
    const second = await grant(alice, client);

    expect(await getTestDb().apiToken.count({ where: { userId: alice.id } })).toBe(20);
    expect(await works(first.accessToken)).toBe(false);
    expect(await works(second.accessToken)).toBe(true);
  });

  it("keeps the older grant when the exchange that would replace it fails at the limit", async () => {
    const [alice, client] = [await createActor(), await register()];
    const first = await grant(alice, client);
    const code = await approve(alice, await register({ client_name: "Other" }));
    await fill(alice, tokenService.MAX_TOKENS_PER_USER - 1);
    const other = await getTestDb().oAuthClient.findFirstOrThrow({ where: { name: "Other" } });

    await expect(
      oauthService.exchangeCode({ code, clientId: other.id, redirectUri: REDIRECT_URI, codeVerifier: VERIFIER }),
    ).resolves.toMatchObject(INVALID_GRANT);

    expect(await works(first.accessToken)).toBe(true);
    expect(await getTestDb().apiToken.count({ where: { userId: alice.id } })).toBe(20);
  });

  it("cannot be passed by exchanges and new tokens at the same time", async () => {
    const alice = await createActor();
    await fill(alice, tokenService.MAX_TOKENS_PER_USER - 2);
    const exchanges = [];
    for (let index = 0; index < 4; index += 1) {
      const client = await register({ client_name: `Client ${index}` });
      exchanges.push(exchangeOf(client, await approve(alice, client)));
    }

    const results = await Promise.all([
      ...exchanges.map((exchange) => oauthService.exchangeCode(exchange)),
      tokenService.createToken(alice, { name: "script", scopes: ["read"], expiry: "90d" }),
      tokenService.createToken(alice, { name: "script", scopes: ["read"], expiry: "90d" }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(await getTestDb().apiToken.count({ where: { userId: alice.id } })).toBe(20);
  });
});

describe("refreshGrant", () => {
  it("gives a new access token and a new refresh token, and the previous ones stop working", async () => {
    const [alice, client] = [await createActor(), await register()];
    const start = Date.now();
    setClock(start);
    const first = await grant(alice, client, "30d");
    vi.setSystemTime(start + 30 * MINUTE_MS);

    const result = await oauthService.refreshGrant({
      refreshToken: first.refreshToken,
      clientId: client.clientId,
      resource: MCP,
    });

    if (!result.ok) return expect.fail(`not refreshed: ${result.error.code}`);
    const second = result.value;
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.expiresIn).toBe(3600);
    expect(await works(first.accessToken)).toBe(false);
    expect(await works(second.accessToken)).toBe(true);
    const rows = await grantsOf(alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accessTokenHash: hashSecret(second.accessToken),
      refreshTokenHash: hashSecret(second.refreshToken),
      accessTokenExpiresAt: new Date(start + 90 * MINUTE_MS),
      // The grant itself does not live longer by being refreshed.
      expiresAt: new Date(start + 30 * DAY_MS),
    });
  });

  it("can be refreshed again and again with the newest refresh token", async () => {
    const [alice, client] = [await createActor(), await register()];
    let tokens = await grant(alice, client);

    for (let round = 0; round < 3; round += 1) {
      const result = await oauthService.refreshGrant({ refreshToken: tokens.refreshToken, clientId: client.clientId });
      if (!result.ok) return expect.fail(`not refreshed: ${result.error.code}`);
      tokens = result.value;
    }

    expect(await works(tokens.accessToken)).toBe(true);
    expect(await grantsOf(alice)).toHaveLength(1);
  });

  it("revokes the grant when a refresh token is used a second time", async () => {
    const [alice, client] = [await createActor(), await register()];
    const first = await grant(alice, client);
    const refreshed = await oauthService.refreshGrant({ refreshToken: first.refreshToken, clientId: client.clientId });
    if (!refreshed.ok) return expect.fail(`not refreshed: ${refreshed.error.code}`);

    await expect(
      oauthService.refreshGrant({ refreshToken: first.refreshToken, clientId: client.clientId }),
    ).resolves.toMatchObject(INVALID_GRANT);

    // The grant is gone, with the tokens of whoever refreshed first.
    expect(await grantsOf(alice)).toHaveLength(0);
    expect(await works(refreshed.value.accessToken)).toBe(false);
    await expect(
      oauthService.refreshGrant({ refreshToken: refreshed.value.refreshToken, clientId: client.clientId }),
    ).resolves.toMatchObject(INVALID_GRANT);
  });

  it("revokes the grant for a refresh token with the right grant and a made-up secret", async () => {
    const [alice, client] = [await createActor(), await register()];
    await grant(alice, client);
    const grantId = (await grantsOf(alice))[0]?.id;

    await expect(
      oauthService.refreshGrant({ refreshToken: `hwr_${grantId}.${"A".repeat(43)}`, clientId: client.clientId }),
    ).resolves.toMatchObject(INVALID_GRANT);

    expect(await grantsOf(alice)).toHaveLength(0);
  });

  it("lets only one of two refreshes at the same time succeed, and the grant stays", async () => {
    const [alice, client] = [await createActor(), await register()];
    const first = await grant(alice, client);
    const refresh = { refreshToken: first.refreshToken, clientId: client.clientId };

    const results = await Promise.all(Array.from({ length: 6 }, () => oauthService.refreshGrant(refresh)));

    const succeeded = results.filter((result) => result.ok);
    expect(succeeded).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.error.code === "invalid-grant")).toHaveLength(5);
    // Each of them showed the token that was current when it was read: none revoked the grant.
    const rows = await grantsOf(alice);
    expect(rows).toHaveLength(1);
    const winner = succeeded[0];
    if (!winner?.ok) return expect.fail("no refresh succeeded");
    expect(rows[0]?.refreshTokenHash).toBe(hashSecret(winner.value.refreshToken));
    expect(await works(winner.value.accessToken)).toBe(true);
  });

  it("refuses a refresh by another client without revoking the grant", async () => {
    const [alice, client, other] = [await createActor(), await register(), await register({ client_name: "Other" })];
    const tokens = await grant(alice, client);

    for (const clientId of [other.clientId, undefined]) {
      await expect(oauthService.refreshGrant({ refreshToken: tokens.refreshToken, clientId })).resolves.toMatchObject(
        INVALID_GRANT,
      );
    }

    await expect(
      oauthService.refreshGrant({ refreshToken: tokens.refreshToken, clientId: client.clientId }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses the grant of a user with the first password, and accepts it again after the change", async () => {
    const [alice, client] = [await createActor(), await register()];
    const tokens = await grant(alice, client);
    await getTestDb().user.update({ where: { id: alice.id }, data: { mustChangePassword: true } });

    await expect(
      oauthService.refreshGrant({ refreshToken: tokens.refreshToken, clientId: client.clientId }),
    ).resolves.toMatchObject(INVALID_GRANT);
    expect(await works(tokens.accessToken)).toBe(false);

    await getTestDb().user.update({ where: { id: alice.id }, data: { mustChangePassword: false } });
    await expect(
      oauthService.refreshGrant({ refreshToken: tokens.refreshToken, clientId: client.clientId }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("does not refresh a token of the account page", async () => {
    const [alice, client] = [await createActor(), await register()];
    const { token } = await createApiToken({ owner: alice });

    await expect(
      oauthService.refreshGrant({ refreshToken: `hwr_${token.id}.${"A".repeat(43)}`, clientId: client.clientId }),
    ).resolves.toMatchObject(INVALID_GRANT);

    // It is not revoked either: it is no grant.
    expect(await getTestDb().apiToken.count({ where: { id: token.id } })).toBe(1);
  });
});

describe("expiry", () => {
  it("ends an access token after an hour, while its grant can still be refreshed", async () => {
    const [alice, client] = [await createActor(), await register()];
    const start = Date.now();
    setClock(start);
    const tokens = await grant(alice, client);

    vi.setSystemTime(start + HOUR_MS - 1);
    expect(await works(tokens.accessToken)).toBe(true);
    vi.setSystemTime(start + HOUR_MS);
    expect(await works(tokens.accessToken)).toBe(false);

    const refreshed = await oauthService.refreshGrant({ refreshToken: tokens.refreshToken, clientId: client.clientId });
    if (!refreshed.ok) return expect.fail(`not refreshed: ${refreshed.error.code}`);
    expect(await works(refreshed.value.accessToken)).toBe(true);
  });

  it("ends a grant after its lifetime: it cannot be refreshed, and its last access token ends with it", async () => {
    const [alice, client] = [await createActor(), await register()];
    const start = Date.now();
    setClock(start);
    const first = await grant(alice, client, "30d");

    // Half an hour before the end the access token of a refresh lasts only that long.
    vi.setSystemTime(start + 30 * DAY_MS - 30 * MINUTE_MS);
    const last = await oauthService.refreshGrant({ refreshToken: first.refreshToken, clientId: client.clientId });
    if (!last.ok) return expect.fail(`not refreshed: ${last.error.code}`);
    expect(last.value.expiresIn).toBe(30 * 60);
    vi.setSystemTime(start + 30 * DAY_MS - 1);
    expect(await works(last.value.accessToken)).toBe(true);

    vi.setSystemTime(start + 30 * DAY_MS);
    expect(await works(last.value.accessToken)).toBe(false);
    await expect(
      oauthService.refreshGrant({ refreshToken: last.value.refreshToken, clientId: client.clientId }),
    ).resolves.toMatchObject(INVALID_GRANT);
    // An expired grant stays in the list, like an expired token, until it is revoked.
    expect(await grantsOf(alice)).toHaveLength(1);
  });
});

describe("authenticateToken", () => {
  it("accepts an access token only when the caller accepts OAuth", async () => {
    const [alice, client] = [await createActor(), await register()];
    const { accessToken } = await grant(alice, client);

    await expect(tokenService.authenticateToken(bearer(accessToken), "read")).resolves.toEqual({
      ok: false,
      error: { code: "missing-token" },
    });
    await expect(tokenService.authenticateToken(bearer(accessToken), "read", { acceptOAuth: false })).resolves.toEqual({
      ok: false,
      error: { code: "missing-token" },
    });
    await expect(
      tokenService.authenticateToken(bearer(accessToken), "read", { acceptOAuth: true }),
    ).resolves.toStrictEqual({ ok: true, value: alice });
  });

  it("accepts a token of the account page with and without the option", async () => {
    const alice = await createActor();
    const { secret } = await createApiToken({ owner: alice });

    for (const options of [undefined, { acceptOAuth: true }]) {
      await expect(tokenService.authenticateToken(bearer(secret), "read", options)).resolves.toStrictEqual({
        ok: true,
        value: alice,
      });
    }
  });

  it("does not accept a refresh token, a code or the access token for the scope write", async () => {
    const [alice, client] = [await createActor(), await register()];
    const code = await approve(alice, client);
    const { accessToken, refreshToken } = await grant(alice, client);

    for (const secret of [refreshToken, code]) {
      await expect(tokenService.authenticateToken(bearer(secret), "read", { acceptOAuth: true })).resolves.toEqual({
        ok: false,
        error: { code: "missing-token" },
      });
    }
    await expect(tokenService.authenticateToken(bearer(accessToken), "write", { acceptOAuth: true })).resolves.toEqual({
      ok: false,
      error: { code: "insufficient-scope" },
    });
  });

  it("writes the last use of a grant", async () => {
    const [alice, client] = [await createActor(), await register()];
    const { accessToken } = await grant(alice, client);

    await works(accessToken);

    expect((await grantsOf(alice))[0]?.lastUsedAt).not.toBeNull();
  });

  it("stops accepting the access token once the grant is revoked like a token", async () => {
    const [alice, client] = [await createActor(), await register()];
    const { accessToken, refreshToken } = await grant(alice, client);
    const grantId = (await grantsOf(alice))[0]?.id ?? "";

    await expect(tokenService.revokeToken(alice, grantId)).resolves.toMatchObject({ ok: true });

    expect(await works(accessToken)).toBe(false);
    await expect(oauthService.refreshGrant({ refreshToken, clientId: client.clientId })).resolves.toMatchObject(
      INVALID_GRANT,
    );
  });
});

describe("deleting", () => {
  it("a client deletes its codes and its grants", async () => {
    const [alice, client, other] = [await createActor(), await register(), await register({ client_name: "Other" })];
    const tokens = await grant(alice, client);
    await approve(alice, client);
    const kept = await grant(alice, other);

    await getTestDb().oAuthClient.delete({ where: { id: client.id } });

    expect(await getTestDb().oAuthCode.count()).toBe(0);
    expect(await works(tokens.accessToken)).toBe(false);
    expect(await works(kept.accessToken)).toBe(true);
    expect(await grantsOf(alice)).toHaveLength(1);
  });

  it("a user deletes the user's codes and grants, and leaves the client", async () => {
    const [alice, bob, client] = [await createActor(), await createActor(), await register()];
    const alices = await grant(alice, client);
    const bobs = await grant(bob, client);
    await approve(alice, client);

    await getTestDb().user.delete({ where: { id: alice.id } });

    expect(await getTestDb().oAuthCode.count()).toBe(0);
    expect(await works(alices.accessToken)).toBe(false);
    expect(await works(bobs.accessToken)).toBe(true);
    expect(await getTestDb().oAuthClient.count()).toBe(1);
  });
});

describe("the check constraint of ApiToken", () => {
  it("refuses a row that is neither a token nor a grant, and one that is both", async () => {
    const [alice, client] = [await createActor(), await register()];
    const row = { userId: alice.id, name: "broken", scopes: ["read"], expiresAt: new Date() };

    await expect(getTestDb().apiToken.create({ data: row })).rejects.toThrow(/ApiToken_token_or_grant/);
    await expect(
      getTestDb().apiToken.create({ data: { ...row, tokenHash: "d".repeat(64), clientId: client.id } }),
    ).rejects.toThrow(/ApiToken_token_or_grant/);
    expect(await getTestDb().apiToken.count()).toBe(0);
  });
});

describe("the clean-up", () => {
  it("deletes the expired codes when a code is created or a client is registered", async () => {
    const [alice, client] = [await createActor(), await register()];
    const start = Date.now();
    setClock(start);
    const old = await approve(alice, client);
    vi.setSystemTime(start + 10 * MINUTE_MS - 1);
    const young = await approve(alice, client);
    expect(await getTestDb().oAuthCode.count()).toBe(2);

    vi.setSystemTime(start + 10 * MINUTE_MS);
    await register({ client_name: "Other" });

    const rows = await getTestDb().oAuthCode.findMany();
    expect(rows.map((row) => row.codeHash)).toEqual([hashSecret(young)]);
    expect(rows.map((row) => row.codeHash)).not.toContain(hashSecret(old));

    vi.setSystemTime(start + 20 * MINUTE_MS);
    await approve(alice, client);
    expect(await getTestDb().oAuthCode.count()).toBe(1);
  });

  it("deletes the clients older than a day that no grant and no code names", async () => {
    const alice = await createActor();
    const start = Date.now();
    const old = new Date(start - DAY_MS - 1);
    const unused = await register({ client_name: "Unused" });
    const withGrant = await register({ client_name: "With grant" });
    const withCode = await register({ client_name: "With code" });
    const young = await register({ client_name: "Young" });
    await grant(alice, withGrant);
    await approve(alice, withCode);
    await getTestDb().oAuthClient.updateMany({ where: { id: { not: young.id } }, data: { createdAt: old } });
    await getTestDb().oAuthClient.update({
      where: { id: young.id },
      data: { createdAt: new Date(start - DAY_MS + MINUTE_MS) },
    });

    await register({ client_name: "Newest" });

    const names = (await getTestDb().oAuthClient.findMany({ orderBy: { name: "asc" } })).map((row) => row.name);
    expect(names).toEqual(["Newest", "With code", "With grant", "Young"]);
    expect(names).not.toContain(unused.name);
  });

  it("deletes a client once its code has expired and it is older than a day", async () => {
    const [alice, client] = [await createActor(), await register()];
    await approve(alice, client);
    await getTestDb().oAuthClient.update({
      where: { id: client.id },
      data: { createdAt: new Date(Date.now() - DAY_MS - 1) },
    });
    setClock(Date.now() + 10 * MINUTE_MS);

    // The first clean-up deletes the code, and the client with nothing left that names it.
    await register({ client_name: "Other" });

    expect(await getTestDb().oAuthClient.count({ where: { id: client.id } })).toBe(0);
  });
});
