import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { getFolderByName, getTab, listFolders, listTabs } from "@/features/folders/queries";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  requireUser: vi.fn(),
  listFolders: vi.fn(),
  getFolderByName: vi.fn(),
  listTabs: vi.fn(),
  getTab: vi.fn(),
}));

vi.mock("@/features/folders/service", () => ({
  listFolders: mocks.listFolders,
  getFolderByName: mocks.getFolderByName,
  listTabs: mocks.listTabs,
  getTab: mocks.getTab,
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));

const serviceReads = [mocks.listFolders, mocks.getFolderByName, mocks.listTabs, mocks.getTab];

/** How often the service has been called. */
function readCount(): number {
  return serviceReads.reduce((count, read) => count + read.mock.calls.length, 0);
}

/** The logged-in user that the mocked `requireUser()` returns: the actor of every service read. */
const USER = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", type: "user", mustChangePassword: false };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
});

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";

/** Every query with a call of it, the service read of the same name and the arguments that read gets. */
const QUERIES: [string, () => Promise<unknown>, Mock, unknown[]][] = [
  ["listFolders", () => listFolders(), mocks.listFolders, []],
  ["listTabs", () => listTabs(FOLDER_ID), mocks.listTabs, [FOLDER_ID]],
  ["getFolderByName", () => getFolderByName("handbook"), mocks.getFolderByName, ["handbook"]],
  ["getTab", () => getTab("handbook", "guides"), mocks.getTab, ["handbook", "guides"]],
];

/** Thrown by the mocked `requireUser()`, like the redirect to the login page that the real one throws. */
class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

describe("every query", () => {
  // Without `connection()` Next.js would prerender the calling route at build time and serve a stale snapshot. The
  // end-to-end tests run the development server, which never prerenders, so only these tests notice a missing call.
  it.each(QUERIES)(
    "%s waits for connection() before it calls the service read of the same name",
    async (_name, query, read, args) => {
      let release = () => {};
      mocks.connection.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
      const found = { id: FOLDER_ID };
      read.mockResolvedValue(found);

      const result = query();
      // Lets everything run that does not wait for the connection.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mocks.connection).toHaveBeenCalledOnce();
      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(readCount()).toBe(0);

      release();
      await expect(result).resolves.toBe(found);
      expect(readCount()).toBe(1);
      // The logged-in user is the actor, in the browser: the service decides what the user may read.
      expect(read).toHaveBeenCalledExactlyOnceWith(
        { id: USER.id, name: USER.name, type: USER.type, channel: "browser" },
        ...args,
      );
    },
  );

  // Nothing is read without a login, whoever calls the query: the check is in the query itself, not only in the page.
  it.each(QUERIES)(
    "%s waits for requireUser() after connection() and before it calls the service read",
    async (_name, query, read) => {
      let release: (user: typeof USER) => void = () => {};
      mocks.requireUser.mockReturnValue(new Promise<typeof USER>((resolve) => (release = resolve)));
      const found = { id: FOLDER_ID };
      read.mockResolvedValue(found);

      const result = query();
      // Lets everything run that does not wait for the user.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mocks.connection).toHaveBeenCalledOnce();
      expect(mocks.requireUser).toHaveBeenCalledOnce();
      expect(mocks.connection.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.requireUser.mock.invocationCallOrder[0] ?? 0,
      );
      expect(readCount()).toBe(0);

      release(USER);
      await expect(result).resolves.toBe(found);
      expect(readCount()).toBe(1);
    },
  );

  it.each(QUERIES)("%s passes on the null of the service for an admin", async (_name, query, read, args) => {
    const admin = { ...USER, name: "maria", type: "admin" };
    mocks.requireUser.mockResolvedValue(admin);
    read.mockResolvedValue(null);

    await expect(query()).resolves.toBeNull();

    expect(read).toHaveBeenCalledExactlyOnceWith(
      { id: USER.id, name: "maria", type: "admin", channel: "browser" },
      ...args,
    );
  });

  it.each(QUERIES)(
    "%s does not reach the service when requireUser() redirects to the login page",
    async (_name, query) => {
      mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

      await expect(query()).rejects.toMatchObject({ path: "/login" });

      expect(readCount()).toBe(0);
    },
  );
});
