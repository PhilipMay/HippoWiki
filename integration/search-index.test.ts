// The search index against the test database: the vector of a page and the words of its folder, which the triggers of
// the migration of the search index keep current in every write of a page, through the pages and folders services.
import { beforeEach, describe, expect, it } from "vitest";

import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import * as folderService from "@/features/folders/service";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import * as pageService from "@/features/pages/service";
import type { Folder, User } from "@/generated/prisma/client";

import { createFolder, createTab, createUser, getTestDb } from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";
import { owners, storedPage } from "./helpers";

let user: User;
let actor: BrowserActor;
let folder: Folder;

beforeEach(async () => {
  user = await createUser({ id: KNOWN_USER.id, name: "alice" });
  actor = inBrowser(user);
  folder = await createFolder({ roles: owners(user) });
});

/** The words of the folder with the number of pages that hold each. */
async function wordsOf(folderId: string = folder.id): Promise<Record<string, number>> {
  const rows = await getTestDb().searchWord.findMany({ where: { folderId }, select: { word: true, pages: true } });
  return Object.fromEntries(rows.map(({ word, pages }) => [word, pages]));
}

/** The words of the folder as the pages that are not deleted hold them now, counted from scratch by the database. */
async function recountedWordsOf(folderId: string = folder.id): Promise<Record<string, number>> {
  const rows = await getTestDb().$queryRaw<{ word: string; pages: number }[]>`
    SELECT word, count(*)::integer AS pages
    FROM "Page" AS p, unnest(search_words(p.title, p.name, p."searchText")) AS word
    WHERE p."folderId" = ${folderId}::uuid AND p."deletedAt" IS NULL AND p."searchText" IS NOT NULL
    GROUP BY word`;
  return Object.fromEntries(rows.map(({ word, pages }) => [word, pages]));
}

/** The vector of the page as text, or `null` for none. */
async function vectorOf(pageId: string): Promise<string | null> {
  const [row] = await getTestDb().$queryRaw<{ vector: string | null }[]>`
    SELECT "searchVector"::text AS vector FROM "Page" WHERE id = ${pageId}::uuid`;
  return row?.vector ?? null;
}

/** Whether the vector of the page matches the text search query, parsed with the given configuration. */
async function matches(pageId: string, configuration: string, query: string): Promise<boolean> {
  const [row] = await getTestDb().$queryRaw<{ matches: boolean }[]>`
    SELECT "searchVector" @@ plainto_tsquery(${configuration}::regconfig, ${query}) AS matches
    FROM "Page" WHERE id = ${pageId}::uuid`;
  return row?.matches ?? false;
}

/** Creates a page through the pages service and returns its id. */
async function newPage(content: string, options: { name?: string; tabId?: string | null } = {}): Promise<string> {
  const result = await pageService.createPage(actor, folder.id, { content, tabId: null, ...options });
  if (!result.ok) throw new Error(`page not created: ${result.error.code}`);
  return result.value.id;
}

/** Saves the content of the page through the pages service, based on its stored version. */
async function save(pageId: string, content: string) {
  const { version } = await storedPage(pageId);
  return pageService.updatePageContent(actor, pageId, { content, version });
}

describe("the words and the vector of a page", () => {
  it("are those of the title, the name and the content of a new page", async () => {
    const id = await newPage("# Backup plan\n\nNightly dumps go to `storage.example.com`.", { name: "nightly-job" });

    expect(await wordsOf()).toEqual({
      backup: 1,
      plan: 1,
      nightly: 1,
      job: 1,
      dumps: 1,
      go: 1,
      to: 1,
      "storage.example.com": 1,
    });
    expect(await matches(id, "simple", "backup")).toBe(true);
    expect(await matches(id, "simple", "job")).toBe(true);
    expect(await vectorOf(id)).toContain("'backup':1A");
  });

  it("gets the inflections of the language of the page", async () => {
    const id = await newPage(
      "# Haus der Datenbank\n\nJede Nacht schreibt der Server eine vollständige Sicherung der Datenbank in den " +
        "Speicher des zweiten Rechenzentrums, und die Sicherungen werden dreißig Tage lang aufbewahrt.",
    );

    expect((await storedPage(id)).searchLanguage).toBe("german");
    expect(await matches(id, "german", "Häuser")).toBe(true);
    expect(await matches(id, "german", "Datenbanken")).toBe(true);
  });

  it("change with the content: an added word joins the words and a removed one leaves them", async () => {
    const id = await newPage("# Notes\n\nalpha beta");

    await save(id, "# Notes\n\nbeta gamma");

    expect(await wordsOf()).toEqual({ notes: 1, beta: 1, gamma: 1 });
    expect(await matches(id, "simple", "gamma")).toBe(true);
    expect(await matches(id, "simple", "alpha")).toBe(false);
  });

  it("change with a new title and a rename, and not with a move", async () => {
    const id = await newPage("# Alpha notes\n\nText", { name: "beta-page" });

    await save(id, "# Gamma notes\n\nText");
    expect(await wordsOf()).toEqual({ gamma: 1, notes: 1, beta: 1, page: 1, text: 1 });

    const page = await storedPage(id);
    await pageService.moveOrRenamePage(actor, id, { name: "delta-page", tabId: null, version: page.version });
    expect(await wordsOf()).toEqual({ gamma: 1, notes: 1, delta: 1, page: 1, text: 1 });
    expect(await matches(id, "simple", "delta")).toBe(true);
    expect(await matches(id, "simple", "beta")).toBe(false);

    const words = await wordsOf();
    const vector = await vectorOf(id);
    const tab = await createTab({ folder });
    const renamed = await storedPage(id);
    const moved = await pageService.moveOrRenamePage(actor, id, {
      name: renamed.name,
      tabId: tab.id,
      version: renamed.version,
    });
    expect(moved.ok).toBe(true);
    expect(await wordsOf()).toEqual(words);
    expect(await vectorOf(id)).toBe(vector);
  });

  it("count a word of two pages twice, and keep it when one of them is deleted", async () => {
    const first = await newPage("# First\n\nshared word");
    await newPage("# Second\n\nshared word");
    expect(await wordsOf()).toMatchObject({ shared: 2, word: 2, first: 1, second: 1 });

    await pageService.deletePage(actor, first, { version: (await storedPage(first)).version });

    expect(await wordsOf()).toEqual({ shared: 1, word: 1, second: 1 });
  });

  it("leave the folder when a page is deleted, alone or with its tab, and come back with a restore", async () => {
    const alone = await newPage("# Alone\n\nsolitary");
    const tab = await createTab({ folder });
    await newPage("# Tabbed\n\nfirst", { tabId: tab.id });
    await newPage("# Tabbed too\n\nsecond", { tabId: tab.id });

    await pageService.deletePage(actor, alone, { version: (await storedPage(alone)).version });
    expect(await wordsOf()).toEqual({ tabbed: 2, too: 1, first: 1, second: 1 });

    expect((await folderService.deleteTab(actor, folder.id, tab.id)).ok).toBe(true);
    expect(await wordsOf()).toEqual({});

    expect((await pageService.restorePage(actor, alone, { name: "alone", tabId: null })).ok).toBe(true);
    expect(await wordsOf()).toEqual({ alone: 1, solitary: 1 });
    expect(await matches(alone, "simple", "solitary")).toBe(true);
  });

  it("are not written by a content save without a change", async () => {
    const content = "# Same\n\nunchanged text";
    const id = await newPage(content);
    const before = { page: await storedPage(id), words: await wordsOf(), vector: await vectorOf(id) };

    expect((await save(id, content)).ok).toBe(true);

    expect({ page: await storedPage(id), words: await wordsOf(), vector: await vectorOf(id) }).toEqual(before);
  });

  it("stay right for writes of one folder at the same time, without a deadlock", async () => {
    const vocabulary = Array.from({ length: 40 }, (_, index) => `word${index}`);
    /** Some words of the vocabulary in a random order, so that the writes touch the same words in other orders. */
    const someWords = () => vocabulary.filter(() => Math.random() < 0.5).sort(() => Math.random() - 0.5);
    const ids = await Promise.all(
      Array.from({ length: 10 }, (_, index) => newPage(`# Page ${index}\n\n${someWords().join(" ")}`)),
    );

    for (let round = 0; round < 5; round++) {
      const results = await Promise.all([
        ...ids.map((id, index) => save(id, `# Page ${index}\n\n${someWords().join(" ")} round${round}`)),
        newPage(`# Extra ${round}\n\n${someWords().join(" ")}`),
      ]);
      expect(results.slice(0, ids.length).every((result) => typeof result !== "string" && result.ok)).toBe(true);
    }

    expect(await wordsOf()).toEqual(await recountedWordsOf());
  });

  it("are stored for a page at the content limit with many different words and 3- and 4-byte characters", async () => {
    const words: string[] = [];
    for (let index = 0, length = 0; length < CONTENT_MAX_LENGTH - 100; index++) {
      // Three bytes for "ü" and "€", four for "𝄞", a letter outside the basic plane.
      const word = `${index % 3 === 0 ? "€" : index % 3 === 1 ? "𝄞" : "ü"}w${index.toString(36)}`;
      words.push(word);
      length += word.length + 1;
    }
    const content = `# Large page\n\n${words.join(" ")}`.slice(0, CONTENT_MAX_LENGTH);

    const id = await newPage(content);

    expect(await vectorOf(id)).not.toBeNull();
    const stored = await wordsOf();
    expect(Object.keys(stored).length).toBeGreaterThan(10_000);
    expect(stored).toEqual(await recountedWordsOf());
    expect(await matches(id, "simple", "üw2")).toBe(true);
  });

  it("are built from a shorter text when the whole text would pass the limit of a vector", async () => {
    // About 2 MB of different words: twice what a vector holds, far beyond content at the content limit.
    const [row] = await getTestDb().$queryRaw<{ lexemes: number; words: number }[]>`
      WITH long AS (SELECT string_agg(md5(i::text), ' ') AS text FROM generate_series(1, 60000) AS i)
      SELECT length(search_vector('simple', 'Title', 'name', long.text))::integer AS lexemes,
        cardinality(search_words('Title', 'name', long.text))::integer AS words
      FROM long`;

    expect(row?.lexemes).toBeGreaterThan(10_000);
    expect(row?.lexemes).toBeLessThan(60_000);
    expect(row?.words).toBeGreaterThan(10_000);
  });

  it("stay as they were when the write fails", async () => {
    const id = await newPage("# Kept\n\nold words");
    const before = { words: await wordsOf(), vector: await vectorOf(id) };
    const db = getTestDb();
    // A trigger of the test refuses the revision of the save, which rolls the whole write back.
    await db.$executeRawUnsafe(`
      CREATE FUNCTION refuse_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'revision refused by the test'; END $$`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER refuse_revision BEFORE INSERT ON "PageRevision" FOR EACH ROW EXECUTE FUNCTION refuse_revision()`,
    );
    try {
      expect(await save(id, "# Kept\n\nnew words")).toEqual({ ok: false, error: { code: "failed" } });
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER refuse_revision ON "PageRevision"`);
      await db.$executeRawUnsafe(`DROP FUNCTION refuse_revision()`);
    }

    expect({ words: await wordsOf(), vector: await vectorOf(id) }).toEqual(before);
  });
});
