import { beforeEach, describe, expect, it, vi } from "vitest";

import { listUsers } from "@/features/users/queries";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  requireUser: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock("@/features/users/service", () => ({ listUsers: mocks.listUsers }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/server", () => ({ connection: mocks.connection }));

/** Thrown by the mocked `requireUser()`, like the redirect to the login page that the real one throws. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

const ADMIN = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1001", name: "admin", mustChangePassword: false };
const USERS = [{ id: ADMIN.id, name: "admin", createdAt: new Date(), mustChangePassword: false }];

beforeEach(() => {
  vi.resetAllMocks();
});

describe("listUsers", () => {
  // Without `connection()` Next.js would prerender the calling route at build time and serve a stale snapshot.
  it("waits for connection() before it asks for the user and calls the service", async () => {
    let release = () => {};
    mocks.connection.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    mocks.requireUser.mockResolvedValue(ADMIN);
    mocks.listUsers.mockResolvedValue(USERS);

    const result = listUsers();
    // Lets everything run that does not wait for the connection.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();

    release();
    await expect(result).resolves.toBe(USERS);
  });

  it("waits for requireUser() and calls the service with that user as the actor", async () => {
    let release: (user: typeof ADMIN) => void = () => {};
    mocks.requireUser.mockReturnValue(new Promise<typeof ADMIN>((resolve) => (release = resolve)));
    mocks.listUsers.mockResolvedValue(USERS);

    const result = listUsers();
    // Lets everything run that does not wait for the user.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.listUsers).not.toHaveBeenCalled();

    release(ADMIN);
    await expect(result).resolves.toBe(USERS);
    expect(mocks.listUsers).toHaveBeenCalledExactlyOnceWith(ADMIN);
  });

  it("passes on the null of the service for a user who is not the admin", async () => {
    const alice = { ...ADMIN, name: "alice" };
    mocks.requireUser.mockResolvedValue(alice);
    mocks.listUsers.mockResolvedValue(null);

    await expect(listUsers()).resolves.toBeNull();

    expect(mocks.listUsers).toHaveBeenCalledExactlyOnceWith(alice);
  });

  it("does not reach the service when requireUser() redirects to the login page", async () => {
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

    await expect(listUsers()).rejects.toMatchObject({ path: "/login" });

    expect(mocks.listUsers).not.toHaveBeenCalled();
  });
});
