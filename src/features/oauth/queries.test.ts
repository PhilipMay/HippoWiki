import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadConsent } from "@/features/oauth/queries";
import { RedirectError } from "@/test/unit";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  requireUser: vi.fn(),
  checkAuthorizationRequest: vi.fn(),
  isGrantLimitReached: vi.fn(),
  getServerEnv: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/features/oauth/authorization-service", () => ({
  checkAuthorizationRequest: mocks.checkAuthorizationRequest,
  isGrantLimitReached: mocks.isGrantLimitReached,
}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const USER = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", type: "user", mustChangePassword: false };
const ADMIN = { ...USER, name: "maria", type: "admin" };
const CLIENT_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const FOLDER_ID = "3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e11";
const REDIRECT_URI = "https://client.example/callback";
const QUERY = {
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
  state: "xyz",
  resource: `https://wiki.example.com/mcp/${FOLDER_ID}/writer`,
};
const REQUEST = {
  client: {
    id: CLIENT_ID,
    clientRowId: CLIENT_ID,
    name: "Example",
    redirectUris: [REDIRECT_URI],
    createdAt: new Date(),
  },
  address: { folder: { id: FOLDER_ID, name: "projects" }, role: "writer" },
  redirectUri: REDIRECT_URI,
  codeChallenge: QUERY.code_challenge,
  state: "xyz",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: "https://wiki.example.com" });
  mocks.requireUser.mockResolvedValue(USER);
  mocks.checkAuthorizationRequest.mockResolvedValue({ ok: true, value: REQUEST });
  mocks.isGrantLimitReached.mockResolvedValue(false);
});

describe("loadConsent", () => {
  it("awaits connection(), then requireUser() with the address of the consent page as the way back, then the service", async () => {
    await loadConsent(QUERY);

    expect(mocks.requireUser).toHaveBeenCalledExactlyOnceWith(
      `/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&response_type=code&code_challenge=${QUERY.code_challenge}&code_challenge_method=S256&state=xyz&resource=${encodeURIComponent(QUERY.resource)}`,
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

  it("asks the user for a valid request, with the client, the host of its redirect address, the user, the folder and the role", async () => {
    await expect(loadConsent({ ...QUERY, utm_source: "mail", scope: "read" })).resolves.toEqual({
      kind: "consent",
      clientName: "Example",
      target: "client.example",
      userName: "alice",
      folderName: "projects",
      role: "writer",
      limitReached: false,
      // Only the parameters of OAuth go into the form, and no scope.
      params: QUERY,
    });

    expect(mocks.checkAuthorizationRequest).toHaveBeenCalledExactlyOnceWith(USER, QUERY);
    expect(mocks.isGrantLimitReached).toHaveBeenCalledExactlyOnceWith(USER, CLIENT_ID, {
      folderId: FOLDER_ID,
      role: "writer",
    });
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

  it("says when the user holds the most connected apps allowed", async () => {
    mocks.isGrantLimitReached.mockResolvedValue(true);

    await expect(loadConsent(QUERY)).resolves.toMatchObject({ kind: "consent", limitReached: true });
  });

  it.each(["unknown-client", "foreign-redirect-uri", "failed"])(
    "does not send the browser anywhere for the code %s",
    async (code) => {
      mocks.checkAuthorizationRequest.mockResolvedValue({ ok: false, error: { code } });

      await expect(loadConsent(QUERY)).resolves.toEqual({ kind: "untrusted", reason: code });

      expect(mocks.isGrantLimitReached).not.toHaveBeenCalled();
    },
  );

  it("shows why a request is refused and links back to the client with error, description, state and iss", async () => {
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
    expect(consent.description).toBe("Only the response type code is supported");
    const url = new URL(consent.redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      error: "unsupported_response_type",
      error_description: "Only the response type code is supported",
      state: "xyz",
      iss: "https://wiki.example.com",
    });
    expect(mocks.isGrantLimitReached).not.toHaveBeenCalled();
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

  it.each([
    ["an admin", "Admin accounts cannot connect apps"],
    ["an address that no app of the user can be connected to", "No app can be connected to this address"],
  ])(
    "shows the refusal of %s with the way back and access_denied, as the service gave it",
    async (_case, description) => {
      mocks.checkAuthorizationRequest.mockResolvedValue({
        ok: false,
        error: { code: "refused", redirectUri: REDIRECT_URI, state: "xyz", error: "access_denied", description },
      });

      const consent = await loadConsent(QUERY);

      if (consent.kind !== "refused") return expect.fail(`not refused: ${consent.kind}`);
      expect(consent.target).toBe("client.example");
      expect(consent.description).toBe(description);
      const url = new URL(consent.redirectTo);
      expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        error: "access_denied",
        error_description: description,
        state: "xyz",
        iss: "https://wiki.example.com",
      });
      expect(mocks.isGrantLimitReached).not.toHaveBeenCalled();
    },
  );

  it("passes an admin to the service, which decides", async () => {
    mocks.requireUser.mockResolvedValue(ADMIN);

    await loadConsent(QUERY);

    expect(mocks.checkAuthorizationRequest).toHaveBeenCalledExactlyOnceWith(ADMIN, QUERY);
  });

  it.each(["unknown-client", "foreign-redirect-uri"])(
    "answers an admin with a request whose check finds %s as today, without sending the browser anywhere",
    async (code) => {
      mocks.requireUser.mockResolvedValue(ADMIN);
      mocks.checkAuthorizationRequest.mockResolvedValue({ ok: false, error: { code } });

      await expect(loadConsent(QUERY)).resolves.toEqual({ kind: "untrusted", reason: code });
    },
  );

  it("does not ask the user when the tokens cannot be counted, and logs it", async () => {
    const err = new Error("connection lost");
    mocks.isGrantLimitReached.mockRejectedValue(err);

    await expect(loadConsent(QUERY)).resolves.toEqual({ kind: "untrusted", reason: "failed" });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, userId: USER.id, clientRowId: CLIENT_ID },
      "failed to count the grants for the consent page",
    );
  });
});
