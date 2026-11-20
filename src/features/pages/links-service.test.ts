// The unit tests of the links service: who may read the linking pages, and what a database error gives. The
// integration tests in `integration/wiki-links-service.test.ts` prove the queries and the writes.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { indexOutdatedLinks, listLinkingPages } from "@/features/pages/links-service";
import { ACTOR, ADMIN, MALFORMED_ID, mcpActor, OTHER_FOLDER_ID, PAGE_ID } from "@/test/unit";

const mocks = vi.hoisted(() => ({
  pageFindFirst: vi.fn(),
  pageFindMany: vi.fn(),
  linkFindMany: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    page: { findFirst: mocks.pageFindFirst, findMany: mocks.pageFindMany },
    pageLink: { findMany: mocks.linkFindMany },
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, error: mocks.error } }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pageFindFirst.mockResolvedValue({ folderId: OTHER_FOLDER_ID, name: "setup", tab: { name: "guides" } });
  mocks.linkFindMany.mockResolvedValue([]);
});

describe("listLinkingPages", () => {
  it("returns the linking pages that the database finds", async () => {
    const onboarding = { id: "p2", name: "onboarding", title: "Onboarding", tab: { name: "guides" } };
    mocks.linkFindMany.mockResolvedValue([{ page: onboarding }]);

    await expect(listLinkingPages(ACTOR, PAGE_ID)).resolves.toEqual([onboarding]);
  });

  it("gives null to an admin and for a malformed id, without asking the database", async () => {
    await expect(listLinkingPages(ADMIN, PAGE_ID)).resolves.toBeNull();
    await expect(listLinkingPages(ACTOR, MALFORMED_ID)).resolves.toBeNull();

    expect(mocks.pageFindFirst).not.toHaveBeenCalled();
    expect(mocks.linkFindMany).not.toHaveBeenCalled();
  });

  it("gives null when the page is not found among the pages the actor may read, without reading the links", async () => {
    mocks.pageFindFirst.mockResolvedValue(null);

    await expect(listLinkingPages(ACTOR, PAGE_ID)).resolves.toBeNull();
    await expect(listLinkingPages(mcpActor("reader"), PAGE_ID)).resolves.toBeNull();
    expect(mocks.linkFindMany).not.toHaveBeenCalled();
  });

  it("throws a database error", async () => {
    mocks.linkFindMany.mockRejectedValue(new Error("connection lost"));

    await expect(listLinkingPages(ACTOR, PAGE_ID)).rejects.toThrow("connection lost");
  });
});

describe("indexOutdatedLinks", () => {
  it("gives failed for a database error, logged with the pages derived so far", async () => {
    const err = new Error("connection lost");
    mocks.pageFindMany.mockRejectedValue(err);

    await expect(indexOutdatedLinks()).resolves.toEqual({ ok: false, error: { code: "failed" } });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { err, pages: 0 },
      "failed to derive the wiki links of the pages",
    );
  });

  it("logs that nothing was left to derive", async () => {
    mocks.pageFindMany.mockResolvedValue([]);

    await expect(indexOutdatedLinks()).resolves.toEqual({ ok: true, value: { pages: 0 } });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pages: 0 }),
      "wiki links up to date, no page derived",
    );
  });
});
