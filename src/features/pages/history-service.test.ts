// The unit tests of the history service: the reads of the history of a page. The mocked database and logger are those of
// `src/test/pages-service.ts`; the integration tests in `integration/page-service.test.ts` prove the queries.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPageRevision, getRevisionComparison, listPageRevisions } from "@/features/pages/history-service";
import { mocks, readCount, resetPagesServiceMocks } from "@/test/pages-service";
import { PAGE_ID, MALFORMED_ID, ACTOR, MALFORMED_ACTOR } from "@/test/unit";

vi.mock("@/lib/db", async () => ({ getDb: (await import("@/test/pages-service")).pagesDb }));
vi.mock("@/lib/logger", async () => ({ logger: (await import("@/test/pages-service")).logger }));

beforeEach(resetPagesServiceMocks);

describe("listPageRevisions", () => {
  const createdAt = new Date("2026-11-12T10:00:00Z");
  const ROW = { number: 5, title: "Intro", createdAt, user: { username: "mike" }, via: "mcp", revertedTo: 2 };

  it("returns the revisions with who made them, and the number of the newest revision", async () => {
    mocks.findFirst.mockResolvedValue({ revisions: [{ number: 5 }] });
    mocks.revisionFindMany.mockResolvedValue([ROW]);

    await expect(listPageRevisions(ACTOR, PAGE_ID, { before: null })).resolves.toEqual({
      newest: 5,
      revisions: [{ number: 5, title: "Intro", createdAt, madeBy: { name: "mike", via: "mcp" }, revertedTo: 2 }],
    });
  });

  it("returns null for a page that the actor may not read or that does not exist", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(listPageRevisions(ACTOR, PAGE_ID, { before: null })).resolves.toBeNull();
  });

  it.each([
    ["a malformed id", () => listPageRevisions(ACTOR, MALFORMED_ID, { before: null })],
    ["a revision number that is no whole number", () => listPageRevisions(ACTOR, PAGE_ID, { before: 1.5 })],
    ["a revision number below 1", () => listPageRevisions(ACTOR, PAGE_ID, { before: 0 })],
    ["an admin", () => listPageRevisions({ ...ACTOR, type: "admin" }, PAGE_ID, { before: null })],
    ["a malformed actor id", () => listPageRevisions(MALFORMED_ACTOR, PAGE_ID, { before: null })],
  ])("returns null for %s without reading the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });
});

describe("getPageRevision", () => {
  const createdAt = new Date("2026-11-12T10:00:00Z");
  const ROW = {
    number: 3,
    title: "Intro",
    createdAt,
    user: { username: "mike" },
    via: "web",
    revertedTo: null,
    content: "# Intro\n\nOld",
  };

  it("returns the revision with its content, the newest number and whether it is the content of the page now", async () => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro\n\nNew", revisions: [{ number: 5 }] });
    mocks.revisionFindUnique.mockResolvedValue(ROW);

    await expect(getPageRevision(ACTOR, PAGE_ID, 3)).resolves.toEqual({
      number: 3,
      title: "Intro",
      createdAt,
      madeBy: { name: "mike", via: "web" },
      revertedTo: null,
      content: "# Intro\n\nOld",
      newest: 5,
      isCurrent: false,
    });
  });

  it("says whether the content of the revision is the content of the page now", async () => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro\n\nOld", revisions: [{ number: 5 }] });
    mocks.revisionFindUnique.mockResolvedValue(ROW);

    await expect(getPageRevision(ACTOR, PAGE_ID, 3)).resolves.toMatchObject({ isCurrent: true });
  });

  it("returns null for a revision the page does not have", async () => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro", revisions: [{ number: 5 }] });
    mocks.revisionFindUnique.mockResolvedValue(null);

    await expect(getPageRevision(ACTOR, PAGE_ID, 6)).resolves.toBeNull();
  });

  it("returns null for a page that the actor may not read or that does not exist", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(getPageRevision(ACTOR, PAGE_ID, 1)).resolves.toBeNull();
  });

  it.each([
    ["a malformed id", () => getPageRevision(ACTOR, MALFORMED_ID, 1)],
    ["a number below 1", () => getPageRevision(ACTOR, PAGE_ID, 0)],
    ["a number that is no whole number", () => getPageRevision(ACTOR, PAGE_ID, 2.5)],
    ["a number too large for the column", () => getPageRevision(ACTOR, PAGE_ID, 2_147_483_648)],
    ["an admin", () => getPageRevision({ ...ACTOR, type: "admin" }, PAGE_ID, 1)],
  ])("returns null for %s without reading the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });
});

describe("getRevisionComparison", () => {
  const createdAt = new Date("2026-11-12T10:00:00Z");
  /** A revision as the database returns it, with its content. */
  function row(number: number) {
    return {
      number,
      title: "Intro",
      createdAt,
      user: { username: "mike" },
      via: "web",
      revertedTo: null,
      content: `# Intro\n\n${number}`,
    };
  }
  /** The same revision as the service returns it. */
  function revision(number: number) {
    const { title, content, revertedTo } = row(number);
    return { number, title, createdAt, madeBy: { name: "mike", via: "web" }, revertedTo, content };
  }

  it.each([
    [2, 5],
    [5, 2],
  ])("returns the revisions %d and %d older first, with the number of the newest revision", async (a, b) => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro", revisions: [{ number: 7 }] });
    // The database returns them in any order.
    mocks.revisionFindMany.mockResolvedValue([row(5), row(2)]);

    await expect(getRevisionComparison(ACTOR, PAGE_ID, a, b)).resolves.toEqual({
      newest: 7,
      older: revision(2),
      newer: revision(5),
    });
  });

  it("returns a revision compared with itself on both sides", async () => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro", revisions: [{ number: 7 }] });
    mocks.revisionFindMany.mockResolvedValue([row(3)]);

    await expect(getRevisionComparison(ACTOR, PAGE_ID, 3, 3)).resolves.toEqual({
      newest: 7,
      older: revision(3),
      newer: revision(3),
    });
  });

  it("returns null when the page does not have one of the revisions", async () => {
    mocks.findFirst.mockResolvedValue({ content: "# Intro", revisions: [{ number: 7 }] });
    mocks.revisionFindMany.mockResolvedValue([row(2)]);

    await expect(getRevisionComparison(ACTOR, PAGE_ID, 2, 8)).resolves.toBeNull();
  });

  it("returns null for a page that the actor may not read or that does not exist", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(getRevisionComparison(ACTOR, PAGE_ID, 1, 2)).resolves.toBeNull();
  });

  it.each([
    ["a malformed id", () => getRevisionComparison(ACTOR, MALFORMED_ID, 1, 2)],
    ["a first number below 1", () => getRevisionComparison(ACTOR, PAGE_ID, 0, 2)],
    ["a second number that is no whole number", () => getRevisionComparison(ACTOR, PAGE_ID, 1, 1.5)],
    ["an admin", () => getRevisionComparison({ ...ACTOR, type: "admin" }, PAGE_ID, 1, 2)],
  ])("returns null for %s without reading the database", async (_name, read) => {
    await expect(read()).resolves.toBeNull();
    expect(readCount()).toBe(0);
  });
});
