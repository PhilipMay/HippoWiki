import { beforeEach, describe, expect, it, vi } from "vitest";

import { searchPages } from "@/features/search/queries";
import { RedirectError } from "@/test/unit";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  requireUser: vi.fn(),
  searchPages: vi.fn(),
}));

vi.mock("@/features/search/service", () => ({ searchPages: mocks.searchPages }));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));

/** The logged-in user that the mocked `requireUser()` returns: the actor of the search. */
const USER = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", type: "user", mustChangePassword: false };

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
});

describe("searchPages", () => {
  // Without `connection()` Next.js would prerender the calling route at build time and serve a stale snapshot.
  it("waits for connection() and then requireUser() before it searches", async () => {
    let release = () => {};
    mocks.connection.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    const found = { ok: true, value: { results: [], total: 0, more: false } };
    mocks.searchPages.mockResolvedValue(found);

    const result = searchPages(FOLDER_ID, " backup server ");
    // Lets everything run that does not wait for the connection.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.searchPages).not.toHaveBeenCalled();

    release();
    await expect(result).resolves.toBe(found);
    expect(mocks.connection.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.requireUser.mock.invocationCallOrder[0] ?? 0,
    );
    // The logged-in user is the actor, in the browser, and the words go to the service as typed.
    expect(mocks.searchPages).toHaveBeenCalledExactlyOnceWith(
      { id: USER.id, name: USER.name, type: USER.type, channel: "web" },
      FOLDER_ID,
      " backup server ",
    );
  });

  it("passes on the null of the service for an admin", async () => {
    mocks.requireUser.mockResolvedValue({ ...USER, name: "maria", type: "admin" });
    mocks.searchPages.mockResolvedValue(null);

    await expect(searchPages(FOLDER_ID, "backup")).resolves.toBeNull();

    expect(mocks.searchPages).toHaveBeenCalledExactlyOnceWith(
      { id: USER.id, name: "maria", type: "admin", channel: "web" },
      FOLDER_ID,
      "backup",
    );
  });

  it("does not search when requireUser() redirects to the login page", async () => {
    mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

    await expect(searchPages(FOLDER_ID, "backup")).rejects.toMatchObject({ path: "/login" });

    expect(mocks.searchPages).not.toHaveBeenCalled();
  });
});
