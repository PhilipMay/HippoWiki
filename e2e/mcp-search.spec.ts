// The search tool of MCP: search_pages for every role of a connection, its results, the files it finds by their names,
// its windows and its tool errors.
import { USER_TEXT_NOTE } from "@/features/mcp/tool-schemas";

import { logInElsewhere, NO_STORAGE_STATE } from "./support/auth";
import { createFile, createFolder, createGrant, createPage, createTab, createUser } from "./support/database";
import { call, mcpPath, send, setUpProjects, type ToolResult } from "./support/mcp";
import { ISSUER } from "./support/oauth";
import { holdSearchWords, waitForHeldSearches } from "./support/search";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has the access token of its grant.
test.use({ storageState: NO_STORAGE_STATE });

let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let owner: Awaited<ReturnType<typeof setUpProjects>>["owner"];

test.beforeEach(async () => {
  ({ projects, owner } = await setUpProjects());
});

/** A result of `search_pages`. */
type SearchResult = {
  title: string;
  name: string;
  tab: string | null;
  address: string;
  excerpt: string;
  lastChanged: string;
  lastEditedBy: string;
  lastEditedVia: "web" | "mcp";
};

/** A file of the results of `search_pages`. */
type FileResult = {
  name: string;
  tab: string | null;
  type: string;
  size: number;
  width: number | null;
  height: number | null;
  address: string;
  detailsAddress: string;
  lastChanged: string;
  lastEditedBy: string;
  lastEditedVia: "web" | "mcp";
};

/** The structured content of a call of `search_pages` that worked. */
type SearchAnswer = {
  note: string;
  results: SearchResult[];
  files: FileResult[];
  moreFiles: boolean;
  nextOffset: number | null;
  more: boolean;
};

/** Calls `search_pages` at the Reader address of "projects" and returns its structured content. */
async function search(request: Parameters<typeof call>[0], args: Record<string, unknown>): Promise<SearchAnswer> {
  const result = await call(request, "search_pages", args);
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return result.structuredContent as SearchAnswer;
}

/** The message of a tool error, which carries no structured content and no note. */
function errorOf(result: ToolResult): string {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  const text = result.content[0]?.text ?? "";
  expect(text).not.toContain(USER_TEXT_NOTE);
  return text;
}

test("a Reader, a Writer and a Manager connection list the tool, whose description ends with the note", async ({
  request,
}) => {
  for (const role of ["reader", "writer", "manager"] as const) {
    const { accessToken } = await createGrant({ owner, folder: projects, role });
    const answer = await send(request, { method: "tools/list" }, accessToken, mcpPath(projects, role));
    const { tools } = ((await answer.json()) as { result: { tools: { name: string; description: string }[] } }).result;

    const searchTool = tools.find((tool) => tool.name === "search_pages");
    expect(searchTool, role).toBeDefined();
    expect(searchTool?.description.endsWith(USER_TEXT_NOTE), role).toBe(true);

    const result = await call(request, "search_pages", { query: "anything" }, accessToken, mcpPath(projects, role));
    expect(result.isError, role).toBeFalsy();
  }
});

test("finds the pages of its folder only, never a deleted page, and each result is read with read_page", async ({
  request,
}) => {
  const bob = await createUser({ name: "bob" });
  const other = await createFolder({ name: "other", roles: [{ user: owner, role: "owner" }] });
  await createPage({ folder: other, name: "elsewhere", content: "# Elsewhere\n\nThe backup of the other folder." });
  await createPage({ folder: projects, name: "old", content: "# Old\n\nThe old backup.", deletedAt: new Date() });
  const guides = await createTab({ folder: projects, name: "guides" });
  await createPage({
    tab: guides,
    name: "backup",
    content: "# Backup\n\nThe <b>backup</b> runs every night.",
    editor: bob,
    via: "mcp",
    updatedAt: new Date("2026-03-04T10:00:00Z"),
  });

  const answer = await search(request, { query: "backup" });

  expect(Object.keys(answer)[0]).toBe("note");
  expect(answer).toEqual({
    note: USER_TEXT_NOTE,
    results: [
      {
        title: "Backup",
        name: "backup",
        tab: "guides",
        address: `${ISSUER}/folders/projects/guides/backup.md`,
        excerpt: "The <b>backup</b> runs every night",
        lastChanged: "2026-03-04T10:00:00.000Z",
        lastEditedBy: "bob",
        lastEditedVia: "mcp",
      },
    ],
    files: [],
    moreFiles: false,
    nextOffset: null,
    more: false,
  });

  const [found] = answer.results;
  const read = await call(request, "read_page", { tab: found?.tab, page: found?.name });
  expect(read.structuredContent).toMatchObject({ name: "backup", tab: "guides", title: "Backup" });
});

test("returns 10 results without a number, at most 25 a call, the next ones by offset, and only the 100 best", async ({
  request,
}) => {
  test.setTimeout(60_000);
  for (let index = 0; index < 150; index += 1) {
    const number = String(index).padStart(3, "0");
    await createPage({ folder: projects, name: `meeting-${number}`, content: `# Meeting ${number}\n\nThe agenda.` });
  }

  const first = await search(request, { query: "agenda" });
  expect(first.results).toHaveLength(10);
  expect(first).toMatchObject({ nextOffset: 10, more: true });
  for (const result of first.results) {
    expect(Object.keys(result)).toEqual([
      "title",
      "name",
      "tab",
      "address",
      "excerpt",
      "lastChanged",
      "lastEditedBy",
      "lastEditedVia",
    ]);
    expect(result.excerpt).toContain("agenda");
  }

  expect(errorOf(await call(request, "search_pages", { query: "agenda", limit: 30 }))).toContain("at most 25");

  const second = await search(request, { query: "agenda", offset: 10 });
  const best = await search(request, { query: "agenda", limit: 20 });
  expect(second.results.map(({ name }) => name)).toEqual(best.results.slice(10).map(({ name }) => name));
  expect(second.nextOffset).toBe(20);

  const last = await search(request, { query: "agenda", offset: 75, limit: 25 });
  expect(last.results).toHaveLength(25);
  expect(last).toMatchObject({ nextOffset: null, more: true });
  expect(errorOf(await call(request, "search_pages", { query: "agenda", offset: 100 }))).toContain(
    "only the 100 best results can be reached",
  );
});

test("a search that matches 30 pages says nothing more after them", async ({ request }) => {
  for (let index = 0; index < 30; index += 1) {
    await createPage({ folder: projects, name: `budget-${index}`, content: `# Budget ${index}\n\nThe invoice.` });
  }

  const answer = await search(request, { query: "invoice", offset: 25, limit: 25 });

  expect(answer.results).toHaveLength(5);
  expect(answer).toMatchObject({ nextOffset: null, more: false });
});

test("201 characters and 11 words are tool errors with the limits", async ({ request }) => {
  await createPage({ folder: projects, name: "gateway", content: "# Gateway\n\nThe gateway." });

  for (const query of [["gateway", "x".repeat(193)].join(" "), Array.from({ length: 11 }, () => "gateway").join(" ")]) {
    expect(errorOf(await call(request, "search_pages", { query }))).toContain(
      "Search at most 200 characters and 10 words.",
    );
  }
  expect(errorOf(await call(request, "search_pages", { query: "  " }))).toContain("The query has no words");
  expect(
    (await search(request, { query: Array.from({ length: 10 }, () => "gateway").join(" ") })).results,
  ).toHaveLength(1);
});

test.describe("the time limit and the searches at the same time", () => {
  test.beforeEach(async ({ request }) => {
    await createPage({ folder: projects, name: "gateway", content: "# Gateway\n\nThe gateway of the office." });
    // Compiles and warms the route, so that the searches below start without waiting for it.
    expect((await search(request, { query: "gateway" })).results).toHaveLength(1);
  });

  test("a search that takes longer than the time limit is a tool error, and the next one works", async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const { release } = await holdSearchWords();
    try {
      expect(errorOf(await call(request, "search_pages", { query: "gateway" }))).toBe(
        "This search is too broad and took too long. Use more precise words.",
      );
    } finally {
      await release();
    }
    expect((await search(request, { query: "gateway" })).results).toHaveLength(1);
  });

  test("a fourth search at the same time is a tool error at once, with the text of the browser", async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const { release } = await holdSearchWords();
    let running: Promise<unknown>[] = [];
    try {
      running = [1, 2, 3].map(() => call(request, "search_pages", { query: "gateway" }));
      await waitForHeldSearches(3);

      const started = Date.now();
      expect(errorOf(await call(request, "search_pages", { query: "gateway" }))).toBe(
        "Too many searches are running. Try again in a few seconds.",
      );
      expect(Date.now() - started).toBeLessThan(3_000);
      // The other tools answer meanwhile.
      expect((await call(request, "read_page", { page: "gateway" })).isError).toBeFalsy();
    } finally {
      await release();
    }
    await Promise.all(running);
    expect((await search(request, { query: "gateway" })).results).toHaveLength(1);
  });
});

test("the scenario: an AI app searches for backup and gets the matching pages of the folder", async ({ request }) => {
  await createPage({ folder: projects, name: "backup-plan", content: "# Backup plan\n\nWhat is saved, and when." });
  await createPage({ folder: projects, name: "servers", content: "# Servers\n\nEach server has a nightly backup." });
  await createPage({ folder: projects, name: "holidays", content: "# Holidays\n\nThe office is closed." });

  const answer = await search(request, { query: "backup" });

  expect(answer.results.map(({ title }) => title)).toEqual(["Backup plan", "Servers"]);
});

test.describe("files", () => {
  test("finds guides/network-diagram.png by diagram, marked as a file, with the files of the browser and no content", async ({
    request,
    browser,
  }) => {
    const guides = await createTab({ folder: projects, name: "guides" });
    const diagram = await createFile({ tab: guides, name: "network-diagram.png", editor: owner });
    await createFile({ folder: projects, name: "diagram-notes.pdf", editor: owner });
    await createFile({ folder: projects, name: "old-diagram.png", editor: owner, deletedAt: new Date() });
    const other = await createFolder({ name: "other", roles: [{ user: owner, role: "owner" }] });
    await createFile({ folder: other, name: "diagram.png", editor: owner });
    await createPage({ folder: projects, name: "network", content: "# Network\n\nThe diagram of the network." });

    for (const role of ["reader", "writer", "manager"] as const) {
      const { accessToken } = await createGrant({ owner, folder: projects, role });
      const result = await call(request, "search_pages", { query: "diagram" }, accessToken, mcpPath(projects, role));
      expect(result.isError, role).toBeFalsy();
      const answer = result.structuredContent as SearchAnswer;
      expect(
        answer.results.map(({ title }) => title),
        role,
      ).toEqual(["Network"]);
      expect(
        answer.files.map(({ tab, name }) => (tab ? `${tab}/${name}` : name)),
        role,
      ).toEqual(["diagram-notes.pdf", "guides/network-diagram.png"]);
      expect(answer.moreFiles, role).toBe(false);
    }

    const answer = await search(request, { query: "diagram" });
    expect(answer.files.find(({ name }) => name === "network-diagram.png")).toEqual({
      name: "network-diagram.png",
      tab: "guides",
      type: "png",
      size: diagram.versions[0]?.size,
      width: diagram.versions[0]?.width,
      height: diagram.versions[0]?.height,
      address: `${ISSUER}/files/projects/guides/network-diagram.png`,
      detailsAddress: `${ISSUER}/folders/projects/guides/network-diagram.png`,
      lastChanged: diagram.updatedAt.toISOString(),
      lastEditedBy: owner.username,
      lastEditedVia: "web",
    });
    // No result holds the bytes of the image or the PDF, in the structured content or in its text.
    const raw = await call(request, "search_pages", { query: "diagram" });
    expect(raw.content.map(({ type }) => type)).toEqual(["text"]);
    const text = JSON.stringify(raw);
    expect(text).not.toContain("%PDF");
    expect(text).not.toContain("base64");

    // The browser lists the same files for the same words.
    const person = await logInElsewhere(browser, owner.username);
    await person.page.goto(`/folders/projects?view=search&q=diagram`);
    await expect(person.page.getByRole("list", { name: "Files" }).getByRole("listitem")).toHaveText([
      /^diagram-notes\.pdf/,
      /^guides \/ network-diagram\.png/,
    ]);
    await person.context.close();
  });

  test("lists the files only in the first call, not in the calls for the next results", async ({ request }) => {
    await createFile({ folder: projects, name: "backup-diagram.png", editor: owner });
    for (let index = 0; index < 12; index += 1) {
      await createPage({ folder: projects, name: `backup-${index}`, content: `# Backup ${index}\n\nThe backup.` });
    }

    const first = await search(request, { query: "backup" });
    expect(first.files.map(({ name }) => name)).toEqual(["backup-diagram.png"]);
    expect(first.nextOffset).toBe(10);
    const next = await search(request, { query: "backup", offset: 10 });
    expect(next.files).toEqual([]);
    expect(next.results).toHaveLength(2);
  });
});
