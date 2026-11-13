import { beforeEach, describe, expect, it, vi } from "vitest";

import { listTokens } from "@/features/tokens/queries";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  requireUser: vi.fn(),
  listTokens: vi.fn(),
}));

vi.mock("@/features/tokens/service", () => ({ listTokens: mocks.listTokens }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/server", () => ({ connection: mocks.connection }));

/** Thrown by the mocked `requireUser()`, like the redirect to the login page that the real one throws. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

const ALICE = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", mustChangePassword: false };
const TOKENS = [
  {
    id: crypto.randomUUID(),
    name: "MCP client",
    scopes: ["read"],
    createdAt: new Date(),
    expiresAt: new Date(),
    lastUsedAt: null,
  },
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe("listTokens", () => {
  // Without `connection()` Next.js would prerender the calling route at build time and serve a stale snapshot.
  it("waits for connection() before it asks for the user and calls the service", async () => {
    let release = () => {};
    mocks.connection.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    mocks.requireUser.mockResolvedValue(ALICE);
    mocks.listTokens.mockResolvedValue(TOKENS);

    const result = listTokens();
    // Lets everything run that does not wait for the connection.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.listTokens).not.toHaveBeenCalled();

    release();
    await expect(result).resolves.toBe(TOKENS);
  });

  it("waits for requireUser() and calls the service with that user as the actor", async () => {
    let release: (user: typeof ALICE) => void = () => {};
    mocks.requireUser.mockReturnValue(new Promise<typeof ALICE>((resolve) => (release = resolve)));
    mocks.listTokens.mockResolvedValue(TOKENS);

    const result = listTokens();
    // Lets everything run that does not wait for the user.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.listTokens).not.toHaveBeenCalled();

    release(ALICE);
    await expect(result).resolves.toBe(TOKENS);
    expect(mocks.listTokens).toHaveBeenCalledExactlyOnceWith(ALICE);
  });

  it("does not reach the service when requireUser() redirects to the login page", async () => {
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

    await expect(listTokens()).rejects.toMatchObject({ path: "/login" });

    expect(mocks.listTokens).not.toHaveBeenCalled();
  });
});
