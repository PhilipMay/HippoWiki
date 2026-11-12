import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUser } from "@/features/users/actions";

/** Thrown by the mocked `redirect` and `notFound`, like the real ones throw, so that code after them never runs. */
class NavigationError extends Error {
  constructor(readonly target: string) {
    super(`navigation to ${target}`);
  }
}

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/features/users/service", () => ({ createUser: mocks.createUser }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

const ADMIN = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1001", name: "admin", mustChangePassword: false };
const PASSWORD = "Gx7pQ2mWk9RtZ4vNc8Hs";

function formData(name: string): FormData {
  const data = new FormData();
  data.set("name", name);
  return data;
}

function failure(code: string, fieldErrors?: Record<string, string[]>) {
  return { ok: false, error: { code, ...(fieldErrors && { fieldErrors }) } };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(ADMIN);
  mocks.redirect.mockImplementation((path: string) => {
    throw new NavigationError(path);
  });
  mocks.notFound.mockImplementation(() => {
    throw new NavigationError("not-found");
  });
});

describe("createUser", () => {
  it("creates the user as the logged-in user, revalidates the user list and returns the name with the password", async () => {
    mocks.createUser.mockResolvedValue({
      ok: true,
      value: { user: { id: crypto.randomUUID(), name: "stored-name", mustChangePassword: true }, password: PASSWORD },
    });

    const state = await createUser({}, formData(" jane "));

    // The name comes from the stored user, never from the submitted value.
    expect(state).toStrictEqual({ created: { name: "stored-name", password: PASSWORD } });
    expect(mocks.createUser).toHaveBeenCalledExactlyOnceWith(ADMIN, { name: "jane" });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/users");
    // No redirect: the password must not be part of an address or of a stored page.
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid-input", { name: ["Reported by the service"] }, { fieldErrors: { name: ["Reported by the service"] } }],
    ["name-taken", undefined, { fieldErrors: { name: ["Name is already in use"] } }],
    ["busy", undefined, { message: "Too many logins at the moment, please try again" }],
    ["failed", undefined, { message: "The user could not be created. Please try again." }],
  ])("shows the form state of the code %s, without revalidating", async (code, fieldErrors, state) => {
    mocks.createUser.mockResolvedValue(failure(code, fieldErrors));

    await expect(createUser({}, formData("jane"))).resolves.toEqual(state);

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("leads to the not-found page for the code not-allowed, like the user list", async () => {
    mocks.requireUser.mockResolvedValue({ ...ADMIN, name: "alice" });
    mocks.createUser.mockResolvedValue(failure("not-allowed"));

    await expect(createUser({}, formData("jane"))).rejects.toMatchObject({ target: "not-found" });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty name", "", "Name is required"],
    ["a name of 2 characters", "ab", "Name must be at least 3 characters"],
    ["a name that breaks the rule", "Jane Doe", "Use lowercase letters, digits and single hyphens"],
  ])("shows the field error of %s without reaching the service", async (_case, name, error) => {
    await expect(createUser({}, formData(name))).resolves.toEqual({ fieldErrors: { name: [error] } });

    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not reach the service without a logged-in user", async () => {
    mocks.requireUser.mockRejectedValue(new NavigationError("/login"));

    await expect(createUser({}, formData("jane"))).rejects.toMatchObject({ target: "/login" });

    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
