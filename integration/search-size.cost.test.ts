// The budgets of search in a full folder (`npm run test:integration:cost`): one folder of 3,000 pages of about 20,000
// characters, 100 of them at the content limit, in every language of search, with the vocabulary of real text: few
// words that most pages hold and many rare ones. The rows are written in bulk, through the triggers that build the
// vectors and the words of the folder; each budget is a search through the search service, or a save through the pages
// service.
import { beforeAll, describe, expect, it } from "vitest";

import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import * as pageService from "@/features/pages/service";
import { SEARCH_INDEX_VERSION } from "@/features/search/index-data";
import { SEARCH_LANGUAGES, type SearchLanguage } from "@/features/search/language";
import { SEARCH_MAX_RESULTS } from "@/features/search/limits";
import { searchPages, type SearchResults } from "@/features/search/service";
import type { Folder, Prisma, User } from "@/generated/prisma/client";
import { samplePage, type SampleLanguage } from "@/test/language-samples";

import { createFolder, createUser, emptyTestDatabase, getTestDb } from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";
import { owners } from "./helpers";

const PAGES = 3_000;
/** The pages at the content limit, among the `PAGES`. */
const LARGE_PAGES = SEARCH_MAX_RESULTS;
const PAGE_LENGTH = 20_000;
/** A word that only the pages at the content limit hold, several times each. */
const LARGE_MARKER = "grossarchivierung";
/** The number of different words that are not of a language sample, drawn by Zipf's law: most of them are rare. */
const VOCABULARY = 200_000;
/** How many pages are written in one statement. */
const BATCH = 50;

const SEARCH_BUDGET_MS = 2_000;
const LARGE_RESULTS_BUDGET_MS = 5_000;
const SAVE_BUDGET_MS = 1_000;

/** The sample whose words a page of the configuration holds; `simple` stands for every language without one. */
const SAMPLE_OF: Readonly<Record<SearchLanguage, SampleLanguage>> = {
  ...(Object.fromEntries(SEARCH_LANGUAGES.filter((language) => language !== "simple").map((l) => [l, l])) as Record<
    Exclude<SearchLanguage, "simple">,
    SampleLanguage
  >),
  simple: "polish",
};

/** A pseudo-random number generator with a seed, so that every run fills the same folder (mulberry32). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const SYLLABLES =
  "ka to ve ru mi lo sa ne di po ta be gu fe ri no ma se ku lu pa re do ni tu ba ge fo hi ja le mu si va zo ki ra".split(
    " ",
  );

/** The word of the vocabulary with the given rank, from 0: syllables of the rank, at least three. */
function vocabularyWord(rank: number): string {
  let value = rank + SYLLABLES.length ** 2;
  let word = "";
  while (value > 0) {
    word += SYLLABLES[value % SYLLABLES.length] ?? "";
    value = Math.floor(value / SYLLABLES.length);
  }
  return word;
}

/** Draws ranks of the vocabulary by Zipf's law: rank r with a weight of 1 / (r + 1). */
function zipf(next: () => number): () => number {
  const cumulative = new Float64Array(VOCABULARY);
  let total = 0;
  for (let rank = 0; rank < VOCABULARY; rank++) {
    total += 1 / (rank + 1);
    cumulative[rank] = total;
  }
  return () => {
    const target = next() * total;
    let low = 0;
    let high = VOCABULARY - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((cumulative[middle] ?? 0) < target) low = middle + 1;
      else high = middle;
    }
    return low;
  };
}

/** The words of the sample of the language, in lower case. */
function sampleWords(language: SampleLanguage): string[] {
  return [
    ...new Set(
      samplePage(language)
        .toLowerCase()
        .match(/\p{L}+/gu) ?? [],
    ),
  ];
}

const next = random(20261119);
const rank = zipf(next);
const SAMPLE_WORDS = new Map(SEARCH_LANGUAGES.map((language) => [language, sampleWords(SAMPLE_OF[language])]));

/** Text of about the given length: sentences of words of the language and of the vocabulary, paragraphs apart. */
function text(language: SearchLanguage, length: number, extra?: string): string {
  const own = SAMPLE_WORDS.get(language) ?? [];
  const paragraphs: string[] = [];
  let size = 0;
  while (size < length) {
    const sentences: string[] = [];
    for (let sentence = 0; sentence < 6; sentence++) {
      const words: string[] = [];
      const count = 8 + Math.floor(next() * 8);
      for (let index = 0; index < count; index++) {
        words.push(next() < 0.35 ? (own[Math.floor(next() * own.length)] ?? "") : vocabularyWord(rank()));
      }
      if (extra !== undefined && next() < 0.3) words.splice(Math.floor(next() * words.length), 0, extra);
      const line = words.join(" ");
      sentences.push(`${line.charAt(0).toUpperCase()}${line.slice(1)}.`);
    }
    const paragraph = sentences.join(" ");
    paragraphs.push(paragraph);
    size += paragraph.length + 2;
  }
  return paragraphs.join("\n\n").slice(0, length);
}

let user: User;
let actor: BrowserActor;
let folder: Folder;

/** Fills the folder with the pages, in batches, through the triggers. */
async function fillFolder(): Promise<void> {
  for (let start = 0; start < PAGES; start += BATCH) {
    const data: Prisma.PageCreateManyInput[] = [];
    for (let index = start; index < Math.min(start + BATCH, PAGES); index++) {
      const language = SEARCH_LANGUAGES[index % SEARCH_LANGUAGES.length] ?? "simple";
      const large = index % (PAGES / LARGE_PAGES) === 0;
      const title = `${vocabularyWord(rank())} ${vocabularyWord(rank())} ${index}`;
      const body = large
        ? text(language, CONTENT_MAX_LENGTH - title.length - 10, LARGE_MARKER)
        : text(language, PAGE_LENGTH);
      data.push({
        folderId: folder.id,
        name: `page-${index}`,
        title,
        content: `# ${title}\n\n${body}\n`,
        searchText: body,
        searchLanguage: language,
        searchIndexVersion: SEARCH_INDEX_VERSION,
        lastEditedById: user.id,
        lastEditedVia: "web",
      });
    }
    await getTestDb().page.createMany({ data });
  }
  // As after autovacuum on an installation: the pending entries of the indexes merged, and the statistics read.
  await getTestDb().$executeRawUnsafe('VACUUM ANALYZE "Page", "SearchWord"');
}

/** The time a piece of work took, in milliseconds, with its value. */
async function timed<Value>(work: () => Promise<Value>): Promise<{ value: Value; ms: number }> {
  const started = performance.now();
  const value = await work();
  return { value, ms: Math.round(performance.now() - started) };
}

/** Searches the folder, prints the time and returns the results with it; fails when the search found no results. */
async function measuredSearch(name: string, input: string): Promise<{ results: SearchResults; ms: number }> {
  const { value, ms } = await timed(() => searchPages(actor, folder.id, input));
  if (value === null || !value.ok) throw new Error(`search refused: ${JSON.stringify(value)}`);
  console.info(`${name} (${value.value.total}${value.value.more ? "+" : ""} results): ${ms} ms`);
  expect(value.value.total).toBeGreaterThan(0);
  return { results: value.value, ms };
}

/** A word of the vocabulary that pages of the folder hold, with a letter changed in its middle. */
function withTypo(word: string): string {
  const middle = Math.floor(word.length / 2);
  return `${word.slice(0, middle)}${word.charAt(middle) === "x" ? "y" : "x"}${word.slice(middle + 1)}`;
}

beforeAll(async () => {
  await emptyTestDatabase();
  user = await createUser({ id: KNOWN_USER.id, name: "alice" });
  actor = inBrowser(user);
  folder = await createFolder({ roles: owners(user) });
  const { ms } = await timed(fillFolder);
  console.info(`filled ${PAGES} pages in ${ms} ms`);
});

describe(`a search in a folder of ${PAGES} pages`, () => {
  // A word of moderate frequency, the tenth thousandth of the vocabulary; the frequent word is the first.
  const word = vocabularyWord(1_000);

  it("finds a correctly spelled word within the budget", async () => {
    const { ms } = await measuredSearch("correct word", word);
    expect(ms).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it("finds a word with a typo within the budget", async () => {
    const { ms } = await measuredSearch("word with a typo", withTypo(vocabularyWord(1_200)));
    expect(ms).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it("finds a part of a word within the budget", async () => {
    const whole = vocabularyWord(150_000);
    const { ms } = await measuredSearch("part of a word", whole.slice(1, 6));
    expect(ms).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it("finds two words within the budget", async () => {
    const { ms } = await measuredSearch("two words", `${vocabularyWord(300)} ${vocabularyWord(400)}`);
    expect(ms).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it("finds a phrase within the budget", async () => {
    const { ms } = await measuredSearch("phrase", `"${vocabularyWord(0)} ${vocabularyWord(1)}"`);
    expect(ms).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it("finds a word that most pages hold within the budget", async () => {
    const { results, ms } = await measuredSearch("frequent word", vocabularyWord(0));
    expect(results.more).toBe(true);
    expect(ms).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it("finds words of pages of every language within the budget", async () => {
    const { results, ms } = await measuredSearch("every language", `${vocabularyWord(0)} or ${vocabularyWord(2)}`);
    const languages = await getTestDb().page.findMany({
      where: { folderId: folder.id, deletedAt: null },
      distinct: ["searchLanguage"],
      select: { searchLanguage: true },
    });
    expect(languages).toHaveLength(SEARCH_LANGUAGES.length);
    expect(results.more).toBe(true);
    expect(ms).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it("returns 100 results that are pages at the content limit within the budget", async () => {
    const { results, ms } = await measuredSearch("100 large results", LARGE_MARKER);
    expect(results.total).toBe(LARGE_PAGES);
    expect(results.results.every(({ excerpt }) => excerpt.some(({ match }) => match))).toBe(true);
    expect(ms).toBeLessThan(LARGE_RESULTS_BUDGET_MS);
  });

  it("saves a page at the content limit into the full folder within the budget", async () => {
    const content = (body: string) => `# Large page\n\n${body}`.slice(0, CONTENT_MAX_LENGTH);
    const created = await timed(() =>
      pageService.createPage(actor, folder.id, { content: content(text("german", CONTENT_MAX_LENGTH)), tabId: null }),
    );
    if (!created.value.ok) throw new Error(`page not created: ${created.value.error.code}`);
    const saved = await timed(() =>
      pageService.updatePageContent(actor, created.value.ok ? created.value.value.id : "", {
        content: content(text("english", CONTENT_MAX_LENGTH)),
        version: 1,
      }),
    );
    console.info(`new page at the content limit: ${created.ms} ms, save of new content: ${saved.ms} ms`);
    expect(saved.value.ok).toBe(true);
    expect(created.ms).toBeLessThan(SAVE_BUDGET_MS);
    expect(saved.ms).toBeLessThan(SAVE_BUDGET_MS);
  });
});
