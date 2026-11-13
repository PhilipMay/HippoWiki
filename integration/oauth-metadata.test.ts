// Runs the OAuth service against the test database for clients that identify themselves by the URL of their metadata
// document (Client ID Metadata Document). The fetch of the document is replaced: the tests decide what it returns.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMetadataDocument } from "@/features/oauth/metadata-fetch";
import { challengeOf } from "@/features/oauth/secret";
import * as oauthService from "@/features/oauth/service";
import * as tokenService from "@/features/tokens/service";

import { createUser, getTestDb } from "../e2e/support/database";

vi.mock("@/features/oauth/metadata-fetch", () => ({ fetchMetadataDocument: vi.fn() }));

const fetchMock = vi.mocked(fetchMetadataDocument);

const METADATA_URL = "https://client.example/oauth/metadata.json";
const REDIRECT_URI = "https://client.example/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const DOCUMENT = { client_id: METADATA_URL, client_name: "Example", redirect_uris: [REDIRECT_URI] };

/** Lets the fetch return the given document, with the given `Cache-Control` header. */
function serve(document: unknown, cacheControl: string | null = null): void {
  fetchMock.mockResolvedValue({ ok: true, document, cacheControl });
}

/** The parameters of an authorization request of the client of the metadata document. */
function params(overrides: Record<string, string | undefined> = {}) {
  return {
    client_id: METADATA_URL,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: challengeOf(VERIFIER),
    code_challenge_method: "S256",
    state: "xyz",
    ...overrides,
  };
}

const INVALID_CLIENT = { ok: false, error: { code: "invalid-client" } };

beforeEach(() => {
  fetchMock.mockReset();
  serve(DOCUMENT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("an authorization request of a client with a metadata document", () => {
  it("fetches the document on the first request and keeps it as a client", async () => {
    const start = Date.now();
    vi.useFakeTimers({ now: start, toFake: ["Date"] });

    const result = await oauthService.checkAuthorizationRequest(params());

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(METADATA_URL);
    const rows = await getTestDb().oAuthClient.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      metadataUrl: METADATA_URL,
      name: "Example",
      redirectUris: [REDIRECT_URI],
      fetchedAt: new Date(start),
      // An hour without a `Cache-Control` header.
      freshUntil: new Date(start + HOUR_MS),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        client: { id: rows[0]?.id, clientId: METADATA_URL, name: "Example", redirectUris: [REDIRECT_URI] },
        redirectUri: REDIRECT_URI,
        state: "xyz",
      },
    });
  });

  it("uses the kept row without fetching until the cache time is over, then fetches again and updates the row", async () => {
    const start = Date.now();
    vi.useFakeTimers({ now: start, toFake: ["Date"] });
    serve(DOCUMENT, "max-age=1800");
    await oauthService.checkAuthorizationRequest(params());
    const id = (await getTestDb().oAuthClient.findFirstOrThrow()).id;

    // The document changes, but the row is still fresh.
    serve({ ...DOCUMENT, client_name: "Renamed", redirect_uris: [REDIRECT_URI, "https://client.example/other"] });
    vi.setSystemTime(start + 30 * MINUTE_MS - 1);
    await expect(oauthService.checkAuthorizationRequest(params())).resolves.toMatchObject({
      ok: true,
      value: { client: { name: "Example" } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(start + 30 * MINUTE_MS);
    await expect(
      oauthService.checkAuthorizationRequest(params({ redirect_uri: "https://client.example/other" })),
    ).resolves.toMatchObject({ ok: true, value: { client: { id, name: "Renamed" } } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const rows = await getTestDb().oAuthClient.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      name: "Renamed",
      redirectUris: [REDIRECT_URI, "https://client.example/other"],
      fetchedAt: new Date(start + 30 * MINUTE_MS),
      freshUntil: new Date(start + 90 * MINUTE_MS),
    });
  });

  it.each([
    ["a max-age below five minutes", "max-age=10", 5 * MINUTE_MS],
    ["no-store", "no-store", 5 * MINUTE_MS],
    ["a max-age above a day", "max-age=31536000", 24 * HOUR_MS],
  ])("keeps a document with %s within the bounds of the cache time", async (_case, cacheControl, cacheMs) => {
    const start = Date.now();
    vi.useFakeTimers({ now: start, toFake: ["Date"] });
    serve(DOCUMENT, cacheControl);

    await oauthService.checkAuthorizationRequest(params());

    expect((await getTestDb().oAuthClient.findFirstOrThrow()).freshUntil).toEqual(new Date(start + cacheMs));
  });

  it("checks the redirect address against the addresses of the document", async () => {
    await expect(
      oauthService.checkAuthorizationRequest(params({ redirect_uri: "https://evil.example/callback" })),
    ).resolves.toEqual({ ok: false, error: { code: "invalid-redirect-uri" } });
  });

  it.each([
    ["the client id of another document", { ...DOCUMENT, client_id: "https://evil.example/metadata.json" }],
    ["no name", { ...DOCUMENT, client_name: undefined }],
    ["a redirect address that is not allowed", { ...DOCUMENT, redirect_uris: ["javascript:alert(1)"] }],
    ["a client secret method", { ...DOCUMENT, token_endpoint_auth_method: "client_secret_post" }],
    ["a text instead of an object", "not a document"],
  ])("refuses the request without a redirect for a document with %s, and stores nothing", async (_case, document) => {
    serve(document);

    await expect(oauthService.checkAuthorizationRequest(params())).resolves.toEqual(INVALID_CLIENT);

    expect(await getTestDb().oAuthClient.count()).toBe(0);
  });

  it("refuses the request without a redirect when the fetch fails, and stores nothing", async () => {
    fetchMock.mockResolvedValue({ ok: false, reason: "address-not-public" });

    await expect(oauthService.checkAuthorizationRequest(params())).resolves.toEqual(INVALID_CLIENT);

    expect(await getTestDb().oAuthClient.count()).toBe(0);
  });

  it("refuses a request once the kept row is stale and the fetch fails, and keeps the row and its grant", async () => {
    const alice = await createUser({ mustChangePassword: false });
    const start = Date.now();
    vi.useFakeTimers({ now: start, toFake: ["Date"] });
    const created = await oauthService.createCode({ id: alice.id, name: alice.name }, params(), "90d");
    if (!created.ok) return expect.fail(`code not created: ${created.error.code}`);
    const exchanged = await oauthService.exchangeCode({
      code: created.value.code,
      clientId: METADATA_URL,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
    });
    if (!exchanged.ok) return expect.fail(`code not exchanged: ${exchanged.error.code}`);

    vi.setSystemTime(start + HOUR_MS);
    fetchMock.mockResolvedValue({ ok: false, reason: "timeout" });
    await expect(oauthService.checkAuthorizationRequest(params())).resolves.toEqual(INVALID_CLIENT);

    // The grant does not depend on the document being reachable: it is refreshed and used as before.
    expect(await getTestDb().oAuthClient.count()).toBe(1);
    const refreshed = await oauthService.refreshGrant({
      refreshToken: exchanged.value.refreshToken,
      clientId: METADATA_URL,
    });
    if (!refreshed.ok) return expect.fail(`not refreshed: ${refreshed.error.code}`);
    await expect(
      tokenService.authenticateToken(new Headers({ authorization: `Bearer ${refreshed.value.accessToken}` }), "read", {
        acceptOAuth: true,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("stores one client when many first requests arrive at the same time", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => oauthService.checkAuthorizationRequest(params())),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(await getTestDb().oAuthClient.count()).toBe(1);
  });

  it("names its grant after the document and replaces the grant on the next connect", async () => {
    const alice = await createUser({ mustChangePassword: false });
    const actor = { id: alice.id, name: alice.name };
    const connect = async () => {
      const created = await oauthService.createCode(actor, params(), "90d");
      if (!created.ok) return expect.fail(`code not created: ${created.error.code}`);
      const exchanged = await oauthService.exchangeCode({
        code: created.value.code,
        clientId: METADATA_URL,
        redirectUri: REDIRECT_URI,
        codeVerifier: VERIFIER,
      });
      if (!exchanged.ok) return expect.fail(`code not exchanged: ${exchanged.error.code}`);
      return exchanged.value;
    };

    await connect();
    await connect();

    const grants = await getTestDb().apiToken.findMany({ where: { userId: alice.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0]?.name).toBe("Example");
  });

  it("is known only by its URL: the id of its kept row is no client id", async () => {
    await oauthService.checkAuthorizationRequest(params());
    const row = await getTestDb().oAuthClient.findFirstOrThrow();

    await expect(oauthService.checkAuthorizationRequest(params({ client_id: row.id }))).resolves.toEqual(
      INVALID_CLIENT,
    );
  });
});
