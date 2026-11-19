import { beforeEach, describe, expect, it, vi } from "vitest";

import { approve, deny } from "@/features/oauth/actions";
import { RedirectError } from "@/test/unit";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createCode: vi.fn(),
  checkAuthorizationRequest: vi.fn(),
  getServerEnv: vi.fn(),
  verifyOwnPassword: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/features/oauth/authorization-service", () => ({
  createCode: mocks.createCode,
  checkAuthorizationRequest: mocks.checkAuthorizationRequest,
}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/features/auth/password-check", () => ({ verifyOwnPassword: mocks.verifyOwnPassword }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const USER = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", mustChangePassword: false };
const CLIENT_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const REDIRECT_URI = "https://client.example/callback?tenant=a";
const CODE = `hwc_${"C".repeat(43)}`;
const PARAMS = {
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
  state: "state of the client",
  resource: "https://wiki.example.com/mcp/3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e11/reader",
};
const REQUEST = {
  client: { id: CLIENT_ID, clientId: CLIENT_ID, name: "Example", redirectUris: [REDIRECT_URI], createdAt: new Date() },
  address: { folder: { id: "3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e11", name: "projects" }, role: "reader" },
  redirectUri: REDIRECT_URI,
  codeChallenge: PARAMS.code_challenge,
  state: "state of the client",
};
const REFUSED = {
  code: "refused",
  redirectUri: REDIRECT_URI,
  state: "state of the client",
  error: "invalid_request",
  description: "PKCE with the code_challenge_method S256 is required",
};

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** The parameters that an answer added to the redirect address. */
function answerOf(state: { redirectTo?: string }): Record<string, string> {
  const url = new URL(state.redirectTo ?? "");
  expect(`${url.origin}${url.pathname}`).toBe("https://client.example/callback");
  return Object.fromEntries(url.searchParams);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: "https://wiki.example.com" });
  mocks.requireUser.mockResolvedValue(USER);
  mocks.createCode.mockResolvedValue({ ok: true, value: { code: CODE, request: REQUEST } });
  mocks.checkAuthorizationRequest.mockResolvedValue({ ok: true, value: REQUEST });
  mocks.verifyOwnPassword.mockResolvedValue({ ok: true, value: { user: USER } });
  mocks.redirect.mockImplementation((path: string) => {
    throw new RedirectError(path);
  });
});

describe("approve", () => {
  it("creates a code for the logged-in user from the submitted request and lifetime, and returns the address of the client with code, state and iss", async () => {
    const state = await approve(formData({ ...PARAMS, lifetime: "365d" }));

    expect(mocks.createCode).toHaveBeenCalledExactlyOnceWith(USER, PARAMS, "365d");
    expect(answerOf(state)).toEqual({
      tenant: "a",
      code: CODE,
      state: "state of the client",
      iss: "https://wiki.example.com",
    });
    expect(state.message).toBeUndefined();
  });

  it("leaves out the state of a request that had none", async () => {
    mocks.createCode.mockResolvedValue({ ok: true, value: { code: CODE, request: { ...REQUEST, state: null } } });

    expect(answerOf(await approve(formData({ ...PARAMS, lifetime: "90d" })))).toEqual({
      tenant: "a",
      code: CODE,
      iss: "https://wiki.example.com",
    });
  });

  it("does not reach the service without a logged-in user", async () => {
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

    await expect(approve(formData({ ...PARAMS, lifetime: "90d" }))).rejects.toMatchObject({ path: "/login" });

    expect(mocks.createCode).not.toHaveBeenCalled();
  });

  it("passes on an empty form as a request without parameters, for the service to refuse", async () => {
    mocks.createCode.mockResolvedValue({ ok: false, error: { code: "unknown-client" } });

    await approve(new FormData());

    expect(mocks.createCode).toHaveBeenCalledExactlyOnceWith(USER, {}, "");
  });

  it.each([
    ["unknown-client", "This request is no longer valid. Go back to the app and connect again."],
    ["foreign-redirect-uri", "This request is no longer valid. Go back to the app and connect again."],
    ["invalid-lifetime", "Choose how long the app keeps its access."],
    [
      "limit-reached",
      "You already have 50 connected apps, the most allowed. Revoke an app on your account page first.",
    ],
    ["failed", "The app could not be connected. Please try again."],
  ])("shows the message of the code %s and sends the browser nowhere", async (code, message) => {
    mocks.createCode.mockResolvedValue({ ok: false, error: { code } });

    await expect(approve(formData({ ...PARAMS, lifetime: "90d" }))).resolves.toEqual({ message });
  });

  it("sends the refusal of an address that no app can be connected to back to the client with access_denied", async () => {
    mocks.createCode.mockResolvedValue({
      ok: false,
      error: { ...REFUSED, error: "access_denied", description: "No app can be connected to this address" },
    });

    expect(answerOf(await approve(formData({ ...PARAMS, lifetime: "90d" })))).toEqual({
      tenant: "a",
      error: "access_denied",
      error_description: "No app can be connected to this address",
      state: "state of the client",
      iss: "https://wiki.example.com",
    });
  });

  it("sends a request that the service refuses back to the client with its error, and without a code", async () => {
    mocks.createCode.mockResolvedValue({ ok: false, error: REFUSED });

    const answer = answerOf(await approve(formData({ ...PARAMS, lifetime: "90d" })));

    expect(answer).toEqual({
      tenant: "a",
      error: "invalid_request",
      error_description: "PKCE with the code_challenge_method S256 is required",
      state: "state of the client",
      iss: "https://wiki.example.com",
    });
  });

  it("answers with a message and reaches no service while OAuth is off", async () => {
    mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: undefined });

    await expect(approve(formData({ ...PARAMS, lifetime: "90d" }))).resolves.toEqual({
      message: "Connecting apps is switched off in this wiki.",
    });

    expect(mocks.createCode).not.toHaveBeenCalled();
  });
});

describe("the password before an approval", () => {
  const PASSWORD = " the password of alice ";

  it("checks the submitted password, as it is, before the code is created", async () => {
    await approve(formData({ ...PARAMS, lifetime: "30d", password: PASSWORD }));

    expect(mocks.verifyOwnPassword).toHaveBeenCalledExactlyOnceWith(PASSWORD, "consent");
    expect(mocks.verifyOwnPassword.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createCode.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("passes on a missing password as empty, for the service to refuse", async () => {
    mocks.verifyOwnPassword.mockResolvedValue({ ok: false, error: { code: "wrong-password" } });

    const state = await approve(formData({ ...PARAMS, lifetime: "30d" }));

    expect(mocks.verifyOwnPassword).toHaveBeenCalledExactlyOnceWith("", "consent");
    expect(state).toEqual({ fieldErrors: { password: ["Wrong password"] } });
    expect(mocks.createCode).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong-password", {}, { fieldErrors: { password: ["Wrong password"] } }],
    [
      "wait",
      { waitMs: 60_000 },
      { fieldErrors: { password: ["Too many wrong passwords. Please try again in 1 minute."] } },
    ],
    ["busy", {}, { message: "Too many logins at the moment, please try again" }],
    ["failed", {}, { message: "The password could not be checked. Please try again." }],
  ])("creates no code for %s and returns its state", async (code, details, expected) => {
    mocks.verifyOwnPassword.mockResolvedValue({ ok: false, error: { code, ...details } });

    const state = await approve(formData({ ...PARAMS, lifetime: "30d", password: PASSWORD }));

    expect(state).toEqual(expected);
    expect(mocks.createCode).not.toHaveBeenCalled();
  });

  it("leads to the login page when the session ended meanwhile, without a code", async () => {
    mocks.verifyOwnPassword.mockResolvedValue({ ok: false, error: { code: "not-logged-in" } });

    await expect(approve(formData({ ...PARAMS, password: PASSWORD }))).rejects.toMatchObject({ path: "/login" });

    expect(mocks.createCode).not.toHaveBeenCalled();
  });

  it("is not asked while OAuth is off", async () => {
    mocks.getServerEnv.mockReturnValue({});

    await approve(formData({ ...PARAMS, password: PASSWORD }));

    expect(mocks.verifyOwnPassword).not.toHaveBeenCalled();
  });

  it("is not needed to deny", async () => {
    const state = await deny(formData(PARAMS));

    expect(mocks.verifyOwnPassword).not.toHaveBeenCalled();
    expect(answerOf(state)).toMatchObject({ error: "access_denied" });
  });
});

describe("deny", () => {
  it("checks the submitted request again and returns the address of the client with access_denied, state and iss", async () => {
    const state = await deny(formData({ ...PARAMS, lifetime: "90d" }));

    expect(mocks.checkAuthorizationRequest).toHaveBeenCalledExactlyOnceWith(USER, PARAMS);
    expect(answerOf(state)).toEqual({
      tenant: "a",
      error: "access_denied",
      error_description: "The user denied the request",
      state: "state of the client",
      iss: "https://wiki.example.com",
    });
    expect(mocks.createCode).not.toHaveBeenCalled();
  });

  it("does not reach the service without a logged-in user", async () => {
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

    await expect(deny(formData(PARAMS))).rejects.toMatchObject({ path: "/login" });

    expect(mocks.checkAuthorizationRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown-client", "This request is no longer valid. Go back to the app and connect again."],
    ["foreign-redirect-uri", "This request is no longer valid. Go back to the app and connect again."],
    ["failed", "The answer could not be sent. Please try again."],
  ])("shows the message of the code %s and sends the browser nowhere", async (code, message) => {
    mocks.checkAuthorizationRequest.mockResolvedValue({ ok: false, error: { code } });

    await expect(deny(formData(PARAMS))).resolves.toEqual({ message });
  });

  it("sends a request that the service refuses back to the client with the error of the service", async () => {
    mocks.checkAuthorizationRequest.mockResolvedValue({ ok: false, error: REFUSED });

    expect(answerOf(await deny(formData(PARAMS)))).toMatchObject({ error: "invalid_request" });
  });

  it("answers with a message and reaches no service while OAuth is off", async () => {
    mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: undefined });

    await expect(deny(formData(PARAMS))).resolves.toEqual({
      message: "Connecting apps is switched off in this wiki.",
    });

    expect(mocks.checkAuthorizationRequest).not.toHaveBeenCalled();
  });
});
