import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeFirstPassword, logIn, logOut } from "@/features/auth/actions";

/** `redirect` throws in Next.js; the mock throws this error, so code after it does not run. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

const mocks = vi.hoisted(() => ({
  logIn: vi.fn(),
  logOut: vi.fn(),
  changeFirstPassword: vi.fn(),
  requireSession: vi.fn(),
  headers: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  logClientAddressProbe: vi.fn(),
  getServerEnv: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/auth/service", () => ({
  logIn: mocks.logIn,
  logOut: mocks.logOut,
  changeFirstPassword: mocks.changeFirstPassword,
}));
vi.mock("@/features/auth/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/client-address-probe", () => ({ logClientAddressProbe: mocks.logClientAddressProbe }));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

/** Sets the number of trusted reverse proxies that the action reads from the server environment. */
function trustProxies(count: number): void {
  mocks.getServerEnv.mockReturnValue({
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    NODE_ENV: "production",
    HIPPOWIKI_LOG_CLIENT_ADDRESS: false,
    HIPPOWIKI_TRUSTED_PROXIES: count,
  });
}

const REQUEST_HEADERS = new Headers({ cookie: "better-auth.session_token=token.signature" });
const USER = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", mustChangePassword: false };

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const LOGIN_FORM = { name: "alice", password: "secret password" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headers.mockResolvedValue(REQUEST_HEADERS);
  trustProxies(0);
  mocks.redirect.mockImplementation((path: string) => {
    throw new RedirectError(path);
  });
});

describe("logIn", () => {
  it("logs in with the form and the headers of the request, revalidates everything and leads to the folders", async () => {
    mocks.logIn.mockResolvedValue({ ok: true, value: { user: USER, headers: new Headers() } });

    await expect(logIn({}, formData(LOGIN_FORM))).rejects.toMatchObject({ path: "/folders" });

    expect(mocks.logIn).toHaveBeenCalledExactlyOnceWith(LOGIN_FORM, REQUEST_HEADERS, "shared");
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it("hands the headers of the request to the client address probe before the service", async () => {
    mocks.logIn.mockResolvedValue({ ok: false, error: { code: "invalid-credentials" } });

    await logIn({}, formData(LOGIN_FORM));

    expect(mocks.logClientAddressProbe).toHaveBeenCalledExactlyOnceWith(REQUEST_HEADERS, { source: "login" });
    expect(mocks.logClientAddressProbe.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.logIn.mock.invocationCallOrder[0] ?? 0,
    );
  });

  describe("the client address group", () => {
    /** Logs in with the given request headers and returns the group the service got. */
    async function groupFor(requestHeaders: Headers): Promise<unknown> {
      mocks.headers.mockResolvedValue(requestHeaders);
      mocks.logIn.mockResolvedValue({ ok: false, error: { code: "invalid-credentials" } });
      await logIn({}, formData(LOGIN_FORM));
      return mocks.logIn.mock.calls[0]?.[2];
    }

    it.each([null, "203.0.113.7", "198.51.100.9, 203.0.113.7", "unknown"])(
      "is shared with 0 trusted proxies, whatever X-Forwarded-For says (%j), and nothing is logged",
      async (value) => {
        const requestHeaders = new Headers(value === null ? {} : { "x-forwarded-for": value });

        expect(await groupFor(requestHeaders)).toBe("shared");
        expect(mocks.warn).not.toHaveBeenCalled();
        expect(mocks.error).not.toHaveBeenCalled();
      },
    );

    it("is the rightmost entry of X-Forwarded-For with 1 trusted proxy", async () => {
      trustProxies(1);

      expect(await groupFor(new Headers({ "x-forwarded-for": "198.51.100.9, 203.0.113.7" }))).toBe("203.0.113.7");
      expect(mocks.warn).not.toHaveBeenCalled();
    });

    it.each([
      ["no header", {}, "missing-header"],
      ["an entry that is not an address", { "x-forwarded-for": "secret-looking-value" }, "not-an-address"],
    ])(
      "is shared with 1 trusted proxy and %s, with a warning that gives the reason but not the header",
      async (_case, requestHeaders: Record<string, string>, reason) => {
        trustProxies(1);

        expect(await groupFor(new Headers(requestHeaders))).toBe("shared");
        expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
          { reason },
          "no client address in X-Forwarded-For, the login counts in the shared group",
        );
        expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("secret-looking-value");
      },
    );

    it("is shared with 2 trusted proxies and a single entry, with the reason", async () => {
      trustProxies(2);

      expect(await groupFor(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("shared");
      expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
        { reason: "too-few-entries" },
        "no client address in X-Forwarded-For, the login counts in the shared group",
      );
    });
  });

  it("leads to the password change after a login with a first password", async () => {
    const user = { ...USER, mustChangePassword: true };
    mocks.logIn.mockResolvedValue({ ok: true, value: { user, headers: new Headers() } });

    await expect(logIn({}, formData(LOGIN_FORM))).rejects.toMatchObject({ path: "/change-password" });

    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it.each([
    ["invalid-credentials", { message: "Invalid user name or password" }],
    ["busy", { message: "Too many logins at the moment, please try again" }],
    ["failed", { message: "The login failed. Please try again." }],
  ])("shows the message of the code %s, without revalidating or redirecting", async (code, state) => {
    mocks.logIn.mockResolvedValue({ ok: false, error: { code } });

    await expect(logIn({}, formData(LOGIN_FORM))).resolves.toEqual(state);

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    [1, "1 minute"],
    [59_999, "1 minute"],
    [60_000, "1 minute"],
    [60_001, "2 minutes"],
    [4 * 60_000, "4 minutes"],
    [15 * 60_000, "15 minutes"],
  ])("shows the wait of %i ms as %s that are left, without revalidating or redirecting", async (waitMs, minutes) => {
    mocks.logIn.mockResolvedValue({ ok: false, error: { code: "wait", waitMs } });
    const state = { message: `Too many failed logins. Please try again in ${minutes}.` };

    await expect(logIn({}, formData(LOGIN_FORM))).resolves.toEqual(state);

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty name", { name: "", password: "secret password" }, { name: ["User name is required"] }],
    ["an empty password", { name: "alice", password: "" }, { password: ["Password is required"] }],
    [
      "an empty form",
      { name: "", password: "" },
      { name: ["User name is required"], password: ["Password is required"] },
    ],
  ])("shows the field errors of %s without reaching the service", async (_case, fields, fieldErrors) => {
    await expect(logIn({}, formData(fields))).resolves.toEqual({ fieldErrors });

    expect(mocks.logClientAddressProbe).not.toHaveBeenCalled();
    expect(mocks.logIn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("logOut", () => {
  it("ends the session of the request, revalidates everything and leads to the login page", async () => {
    mocks.logOut.mockResolvedValue({ ok: true, value: { headers: new Headers() } });

    await expect(logOut()).rejects.toMatchObject({ path: "/login" });

    expect(mocks.logOut).toHaveBeenCalledExactlyOnceWith(REQUEST_HEADERS);
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it("throws when the session could not be ended, without revalidating or redirecting", async () => {
    mocks.logOut.mockResolvedValue({ ok: false, error: { code: "failed" } });

    await expect(logOut()).rejects.toThrow("The logout failed.");

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("changeFirstPassword", () => {
  const FORM = {
    currentPassword: " first password ",
    newPassword: "my own password",
    repeatPassword: "my own password",
  };

  beforeEach(() => {
    mocks.requireSession.mockResolvedValue({ ...USER, mustChangePassword: true });
  });

  it("changes the password with the form and the headers of the request, revalidates everything and leads to the folders", async () => {
    mocks.changeFirstPassword.mockResolvedValue({ ok: true, value: { user: USER, headers: new Headers() } });

    await expect(changeFirstPassword({}, formData(FORM))).rejects.toMatchObject({ path: "/folders" });

    expect(mocks.changeFirstPassword).toHaveBeenCalledExactlyOnceWith(FORM, REQUEST_HEADERS);
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it.each([
    [
      "invalid-input",
      { fieldErrors: { newPassword: ["Reported by the service"] } },
      { fieldErrors: { newPassword: ["Reported by the service"] } },
    ],
    ["wrong-password", {}, { fieldErrors: { currentPassword: ["Current password is wrong"] } }],
    ["busy", {}, { message: "Too many logins at the moment, please try again" }],
    ["failed", {}, { message: "The password could not be changed. Please try again." }],
  ])("shows the form state of the code %s, without revalidating or redirecting", async (code, details, state) => {
    mocks.changeFirstPassword.mockResolvedValue({ ok: false, error: { code, ...details } });

    await expect(changeFirstPassword({}, formData(FORM))).resolves.toEqual(state);

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["not-logged-in", "/login"],
    ["not-required", "/folders"],
  ])("leads away for the code %s, to %s, without revalidating", async (code, path) => {
    mocks.changeFirstPassword.mockResolvedValue({ ok: false, error: { code } });

    await expect(changeFirstPassword({}, formData(FORM))).rejects.toMatchObject({ path });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not reach the service without a session", async () => {
    mocks.requireSession.mockRejectedValue(new RedirectError("/login"));

    await expect(changeFirstPassword({}, formData(FORM))).rejects.toMatchObject({ path: "/login" });

    expect(mocks.changeFirstPassword).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes on an empty form as empty passwords, for the service to judge", async () => {
    mocks.changeFirstPassword.mockResolvedValue({ ok: false, error: { code: "invalid-input", fieldErrors: {} } });

    await changeFirstPassword({}, new FormData());

    expect(mocks.changeFirstPassword).toHaveBeenCalledExactlyOnceWith(
      { currentPassword: "", newPassword: "", repeatPassword: "" },
      REQUEST_HEADERS,
    );
  });
});
