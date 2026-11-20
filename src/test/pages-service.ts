// The mocked database and logger of the unit tests of the pages service, which are split by concern into
// `src/features/pages/service-*.test.ts`. Each of those files mocks `@/lib/db` and `@/lib/logger` with `pagesDb()` and
// `logger` of this module, imported inside the factory of `vi.mock`, and resets the mocks with
// `resetPagesServiceMocks()` before each test. It imports no service. It is no test itself and is left out of the
// coverage (`vitest.config.ts`).
import { expect, vi } from "vitest";

import { foreignKeyViolation, knownError, uniqueViolation } from "./unit";

export const mocks = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  revisionFindFirst: vi.fn(),
  revisionCreate: vi.fn(),
  revisionFindMany: vi.fn(),
  revisionFindUnique: vi.fn(),
  roleFindFirst: vi.fn(),
  tabFindMany: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/** The client that the mocked `getDb()` returns. */
export function pagesDb() {
  return {
    page: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      create: mocks.create,
      updateMany: mocks.updateMany,
    },
    pageRevision: {
      findMany: mocks.revisionFindMany,
      findFirst: mocks.revisionFindFirst,
      findUnique: mocks.revisionFindUnique,
    },
    folderRole: { findFirst: mocks.roleFindFirst },
    tab: { findMany: mocks.tabFindMany },
    $transaction: mocks.transaction,
  };
}

/** The mocked logger. */
export const logger = { info: mocks.info, warn: mocks.warn, error: mocks.error };

/** Resets the mocks to the defaults of the tests: the actor is Owner, the newest revision has the number 3. */
export function resetPagesServiceMocks(): void {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.tabFindMany.mockResolvedValue([]);
  // The actor is Owner of every folder, unless a test says otherwise.
  mocks.roleFindFirst.mockResolvedValue({ role: "owner" });
  // An interactive transaction runs its callback with a client of its own.
  mocks.transaction.mockImplementation((run: (tx: unknown) => Promise<unknown>) =>
    run({
      page: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
      pageRevision: { findFirst: mocks.revisionFindFirst, create: mocks.revisionCreate },
    }),
  );
  // The newest revision of a page has the number 3, unless a test says otherwise.
  mocks.revisionFindFirst.mockResolvedValue({ number: 3 });
}

/** How often the pages and their revisions have been read; the role of the actor is not counted. */
export function readCount(): number {
  return [mocks.findMany, mocks.findFirst, mocks.revisionFindMany, mocks.revisionFindUnique, mocks.tabFindMany].reduce(
    (count, read) => count + read.mock.calls.length,
    0,
  );
}

/** The calls that write, or read for a write. */
export const databaseWrites = [
  mocks.create,
  mocks.updateMany,
  mocks.findUnique,
  mocks.transaction,
  mocks.revisionFindFirst,
  mocks.revisionCreate,
];

/** A write that stops before the database neither reads nor writes it, and logs nothing. */
export function expectDatabaseUntouched(): void {
  for (const call of databaseWrites) expect(call).not.toHaveBeenCalled();
  expect(readCount()).toBe(0);
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.warn).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
}

/** Names that are not valid as written: not lowercase, surrounding whitespace, a double hyphen, empty. */
export const MALFORMED_NAMES = ["Overview", " overview", "overview ", "release--notes", "-overview", ""];

/** The last editor as the database returns it for a read, and as the service returns it. */
export const EDITOR_ROW = { lastEditedBy: { username: "alice" }, lastEditedVia: "web" };
export const EDITOR = { lastEditedBy: { name: "alice", via: "web" } };

export const NAME_TAKEN = { ok: false, error: { code: "name-taken" } };
export const FAILED = { ok: false, error: { code: "failed" } };
export const NOT_ALLOWED = { ok: false, error: { code: "not-allowed" } };
export const FOLDER_NOT_FOUND = { ok: false, error: { code: "folder-not-found" } };
export const TAB_NOT_FOUND = { ok: false, error: { code: "tab-not-found" } };
export const PAGE_NOT_FOUND = { ok: false, error: { code: "page-not-found" } };
export const NAME_REQUIRED = {
  ok: false,
  error: { code: "invalid-input", fieldErrors: { name: ["Name is required"] } },
};
export const TITLE_MISSING = {
  ok: false,
  error: {
    code: "invalid-input",
    fieldErrors: { content: ["Content must start with a title heading: # Title"] },
  },
};

/** Foreign key violations of a folder or tab key, which the writes report as a missing folder or tab. */
export const placeKeyErrors = [
  ["without details", knownError("P2003")],
  ["on the folder key", foreignKeyViolation({ index: "Page_folderId_fkey" })],
  ["on the tab key", foreignKeyViolation({ index: "Page_tabId_folderId_fkey" })],
  ["on the tab field", foreignKeyViolation({ fields: ["tabId"] })],
] as const;

export const nameTakenErrors = [
  ["on the index of pages placed directly in a folder", uniqueViolation({ index: "Page_folderId_name_key" })],
  ["on the index of pages in a tab", uniqueViolation({ index: "Page_tabId_name_key" })],
  ["on the folder and name fields", uniqueViolation({ fields: ["folderId", "name"] })],
  ["on the tab and name fields", uniqueViolation({ fields: ["tabId", "name"] })],
] as const;

export const otherErrors = [
  ["a unique violation on another constraint", uniqueViolation({ index: "Page_other_key" })],
  ["another Prisma error", knownError("P2000")],
  ["any other error", new Error("connection lost")],
] as const;
