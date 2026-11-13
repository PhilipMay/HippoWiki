import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadConsent } from "@/features/oauth/queries";

/** Thrown by the mocked `requireUser`, like its redirect throws, so that code after it never runs. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  requireUser: vi.fn(),
  checkAuthorizationRequest: vi.fn(),
  isTokenLimitReached: vi.fn(),
  getServerEnv: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/features/oauth/service", () => ({
  checkAuthorizationRequest: mocks.checkAuthorizationRequest,
  isTokenLimitReached: mocks.isTokenLimitReached,
}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const USER = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", mustChangePassword: false };
const CLIENT_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const REDIRECT_URI = "https://client.example/callback";
const QUERY = {
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
  state: "xyz",
};
const REQUEST = {
  client: { id: CLIENT_ID, clientId: CLIENT_ID, name: "Example", redirectUris: [REDIRECT_URI], createdAt: new Date() },
  redirectUri: REDIRECT_URI,
  codeChallenge: QUERY.code_challenge,
  state: "xyz",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: "https://wiki.example.com" });
  mocks.requireUser.mockResolvedValue(USER);
  mocks.checkAuthorizationRequest.mockResolvedValue({ ok: true, value: REQUEST });
  mocks.isTokenLimitReached.mockResolvedValue(false);
});

describe("loadConsent", () => {
  it("awaits connection(), then requireUser() with the address of the consent page as the way back, then the service", async () => {
    await loadConsent(QUERY);

    expect(mocks.requireUser).toHaveBeenCalledExactlyOnceWith(
      `/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&response_type=code&code_challenge=${QUERY.code_challenge}&code_challenge_method=S256&state=xyz`,
    );
    const order = [mocks.connection, mocks.requireUser, mocks.checkAuthorizationRequest].map(
      (mock) => mock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(3);
  });

  it("does not reach the service without a logged-in user", async () => {
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

    await expect(loadConsent(QUERY)).rejects.toMatchObject({ path: "/login" });

    expect(mocks.checkAuthorizationRequest).not.toHaveBeenCalled();
  });

  it("is not found while OAuth is off, after the login was checked and without reaching the service", async () => {
    mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: undefined });

    await expect(loadConsent(QUERY)).resolves.toEqual({ kind: "not-found" });

    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.checkAuthorizationRequest).not.toHaveBeenCalled();
  });

  it("asks the user for a valid request, with the name of the client, the host of its redirect address and the user", async () => {
    await expect(loadConsent({ ...QUERY, utm_source: "mail" })).resolves.toEqual({
      kind: "consent",
      clientName: "Example",
      target: "client.example",
      userName: "alice",
      limitReached: false,
      // Only the parameters of OAuth go into the form.
      params: QUERY,
    });

    expect(mocks.checkAuthorizationRequest).toHaveBeenCalledExactlyOnceWith(QUERY);
    expect(mocks.isTokenLimitReached).toHaveBeenCalledExactlyOnceWith(USER, CLIENT_ID);
  });

  it("shows the scheme of a native app as the target, and the redirect address of the request, not of the client", async () => {
    mocks.checkAuthorizationRequest.mockResolvedValue({
      ok: true,
      value: { ...REQUEST, redirectUri: "cursor://anysphere.cursor-mcp/oauth/callback" },
    });
    await expect(loadConsent(QUERY)).resolves.toMatchObject({ target: "cursor://" });

    mocks.checkAuthorizationRequest.mockResolvedValue({
      ok: true,
      value: { ...REQUEST, redirectUri: "http://127.0.0.1:53124/callback" },
    });
    await expect(loadConsent(QUERY)).resolves.toMatchObject({ target: "127.0.0.1:53124" });
  });

  it("says when the user holds the most tokens allowed", async () => {
    mocks.isTokenLimitReached.mockResolvedValue(true);

    await expect(loadConsent(QUERY)).resolves.toMatchObject({ kind: "consent", limitReached: true });
  });

  it.each(["invalid-client", "invalid-redirect-uri", "failed"])(
    "does not send the browser anywhere for the code %s",
    async (code) => {
      mocks.checkAuthorizationRequest.mockResolvedValue({ ok: false, error: { code } });

      await expect(loadConsent(QUERY)).resolves.toEqual({ kind: "untrusted", reason: code });

      expect(mocks.isTokenLimitReached).not.toHaveBeenCalled();
    },
  );

  it("sends a request that is refused back to the client with error, description, state and iss", async () => {
    mocks.checkAuthorizationRequest.mockResolvedValue({
      ok: false,
      error: {
        code: "refused",
        redirectUri: REDIRECT_URI,
        state: "xyz",
        error: "unsupported_response_type",
        description: "Only the response type code is supported",
      },
    });

    const consent = await loadConsent({ ...QUERY, response_type: "token" });

    if (consent.kind !== "refused") return expect.fail(`not refused: ${consent.kind}`);
    expect(consent.target).toBe("client.example");
    const url = new URL(consent.redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      error: "unsupported_response_type",
      error_description: "Only the response type code is supported",
      state: "xyz",
      iss: "https://wiki.example.com",
    });
    expect(mocks.isTokenLimitReached).not.toHaveBeenCalled();
  });

  it("leaves out the state of a refused request that had none", async () => {
    mocks.checkAuthorizationRequest.mockResolvedValue({
      ok: false,
      error: { code: "refused", redirectUri: REDIRECT_URI, state: null, error: "invalid_request", description: "x" },
    });

    const consent = await loadConsent(QUERY);

    if (consent.kind !== "refused") return expect.fail(`not refused: ${consent.kind}`);
    expect(new URL(consent.redirectTo).searchParams.has("state")).toBe(false);
  });

  it("does not ask the user when the tokens cannot be counted, and logs it", async () => {
    const err = new Error("connection lost");
    mocks.isTokenLimitReached.mockRejectedValue(err);

    await expect(loadConsent(QUERY)).resolves.toEqual({ kind: "untrusted", reason: "failed" });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, userId: USER.id, clientId: CLIENT_ID },
      "failed to count the tokens for the consent page",
    );
  });
});
