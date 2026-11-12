import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  getDeletedPage,
  getPage,
  listAllFolderPages,
  listDeletedPages,
  listFolderPages,
  listTabPages,
} from "@/features/pages/queries";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  requireUser: vi.fn(),
  listFolderPages: vi.fn(),
  listTabPages: vi.fn(),
  listAllFolderPages: vi.fn(),
  getPage: vi.fn(),
  listDeletedPages: vi.fn(),
  getDeletedPage: vi.fn(),
}));

vi.mock("@/features/pages/service", () => ({
  listFolderPages: mocks.listFolderPages,
  listTabPages: mocks.listTabPages,
  listAllFolderPages: mocks.listAllFolderPages,
  getPage: mocks.getPage,
  listDeletedPages: mocks.listDeletedPages,
  getDeletedPage: mocks.getDeletedPage,
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));

const serviceReads = [
  mocks.listFolderPages,
  mocks.listTabPages,
  mocks.listAllFolderPages,
  mocks.getPage,
  mocks.listDeletedPages,
  mocks.getDeletedPage,
];

/** How often the service has been called. */
function readCount(): number {
  return serviceReads.reduce((count, read) => count + read.mock.calls.length, 0);
}

beforeEach(() => {
  vi.resetAllMocks();
});

const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
const TAB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";
const PAGE_ID = "9c4d2b7e-1a3f-4c5d-8e6f-7a8b9c0d1e22";

/** Every query with a call of it, the service read of the same name and the arguments that read gets. */
const QUERIES: [string, () => Promise<unknown>, Mock, unknown[]][] = [
  ["listFolderPages", () => listFolderPages(FOLDER_ID), mocks.listFolderPages, [FOLDER_ID]],
  ["listTabPages", () => listTabPages(TAB_ID), mocks.listTabPages, [TAB_ID]],
  ["listAllFolderPages", () => listAllFolderPages(FOLDER_ID), mocks.listAllFolderPages, [FOLDER_ID]],
  ["getPage", () => getPage("handbook", null, "overview"), mocks.getPage, ["handbook", null, "overview"]],
  ["listDeletedPages", () => listDeletedPages(FOLDER_ID), mocks.listDeletedPages, [FOLDER_ID]],
  ["getDeletedPage", () => getDeletedPage("handbook", PAGE_ID), mocks.getDeletedPage, ["handbook", PAGE_ID]],
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
      const found = { id: PAGE_ID };
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
      expect(read).toHaveBeenCalledWith(...args);
    },
  );

  // Nothing is read without a login, whoever calls the query: the check is in the query itself, not only in the page.
  it.each(QUERIES)(
    "%s waits for requireUser() after connection() and before it calls the service read",
    async (_name, query, read) => {
      let release = () => {};
      mocks.requireUser.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
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

      release();
      await expect(result).resolves.toBe(found);
      expect(readCount()).toBe(1);
    },
  );

  it.each(QUERIES)(
    "%s does not reach the service when requireUser() redirects to the login page",
    async (_name, query) => {
      mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

      await expect(query()).rejects.toMatchObject({ path: "/login" });

      expect(readCount()).toBe(0);
    },
  );
});
