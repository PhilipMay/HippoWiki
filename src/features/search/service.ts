// The search service. It knows nothing about Next.js, forms or addresses, so that the GUI, MCP and the scripts of the
// container image can use it, also outside a request.
//
// A search works on one folder, for an actor who may read it, and finds the pages of the folder that are not deleted.
// It first looks the words of the search up in the words of the folder (`SearchWord`): the words that hold a search
// word or are close to it, for parts of words and typos. Then one query matches the pages through their vectors, one
// branch per language of the pages of the folder, so that the index of the vectors is used and an excluded word
// excludes in every language; no search compares a word with the whole text of every page. The order is decided in
// the database (`ORDER_LEVEL` below).
//
// The pages that exist when search is installed, and every page after an update that changes how the search text or
// the language of a page is derived, are derived again before the server serves (`indexOutdatedPages()`, run by
// `scripts/search-index.ts` at every start of the container image), so that every search is complete from the first
// request.

import { channelOf, type ContentActor } from "@/features/folder-roles/actors";
import { mayReadFolder } from "@/features/folder-roles/service";
import { parseFolderId } from "@/features/folders/schema";
import { excerptParts, LESS_THAN_STAND_IN, MATCH_END, MATCH_START, type ExcerptPart } from "@/features/search/excerpt";
import { SEARCH_INDEX_VERSION, searchIndexData } from "@/features/search/index-data";
import { SEARCH_LANGUAGES, type SearchLanguage } from "@/features/search/language";
import {
  SEARCH_FOUND_WORDS_CAP,
  SEARCH_MAX_RESULTS,
  SEARCH_MAX_RUNNING,
  SEARCH_SIMILARITY_THRESHOLD,
  SEARCH_TIME_LIMIT_MS,
} from "@/features/search/limits";
import { partWords, queryTexts, type FoundWords, type QueryTexts } from "@/features/search/query-text";
import { createSlots, type Slots } from "@/features/search/slots";
import { parseSearch, type ParsedSearch, type SearchWordsError } from "@/features/search/words";
import { isAdmin } from "@/features/users/user-type";
import { LAST_EDITOR_SELECT, withLastEditor, type LastEditor } from "@/features/users/records";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { isStatementTimeout } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import type { Failed, Result } from "@/lib/result";

/** How many pages are read and derived at a time, so that the content of every page is never in memory at once. */
const INDEX_BATCH_SIZE = 50;

/**
 * Derives the search text and the language of every page whose stored version of the derivation differs from
 * `SEARCH_INDEX_VERSION`, deleted pages included, so that a restore needs nothing more, and returns how many it
 * derived. It changes only the search columns: the time of the last change, the last editor and the version of a page
 * stay as they are, so a derived page counts as no edit. The trigger of the database then builds the vector and the
 * words of the folder. It does nothing when no page is left. Two runs at the same time do no harm: a page that the
 * other run, or a save of the server, derived in the meantime has the current version and is left as it is.
 */
export async function indexOutdatedPages(): Promise<Result<{ pages: number }, Failed>> {
  const start = performance.now();
  let pages = 0;
  try {
    // By id after the last page of the batch before, so that a page that could not be written is not read again.
    let after: string | undefined;
    for (;;) {
      const batch = await getDb().page.findMany({
        where: {
          searchIndexVersion: { not: SEARCH_INDEX_VERSION },
          ...(after === undefined ? {} : { id: { gt: after } }),
        },
        orderBy: { id: "asc" },
        take: INDEX_BATCH_SIZE,
        select: { id: true, content: true, updatedAt: true },
      });
      for (const page of batch) {
        const search = await searchIndexData(page.content);
        // `updatedAt` as stored, because Prisma would set it to now: deriving a page is no change of it.
        const { count } = await getDb().page.updateMany({
          where: { id: page.id, searchIndexVersion: { not: SEARCH_INDEX_VERSION } },
          data: { ...search, updatedAt: page.updatedAt },
        });
        pages += count;
      }
      after = batch.at(-1)?.id;
      if (batch.length < INDEX_BATCH_SIZE) break;
    }
  } catch (err) {
    logger.error({ err, pages }, "failed to derive the search index of the pages");
    return { ok: false, error: { code: "failed" } };
  }
  logger.info(
    { pages, durationMs: Math.round(performance.now() - start), version: SEARCH_INDEX_VERSION },
    pages === 0 ? "search index up to date, no page derived" : "search index of the pages derived",
  );
  return { ok: true, value: { pages } };
}

/** A page that a search found: what the lists show of it, with its tab and a piece of its text around the match. */
type SearchResult = {
  id: string;
  name: string;
  title: string;
  tab: { name: string } | null;
  updatedAt: Date;
  lastEditedBy: LastEditor;
  excerpt: ExcerptPart[];
};

/** The results of a search: the pages of the window, in the order of the best match. */
export type SearchResults = {
  results: SearchResult[];
  /** How many of the `SEARCH_MAX_RESULTS` best pages there are, the window aside. */
  total: number;
  /** Whether more pages than `SEARCH_MAX_RESULTS` match. */
  more: boolean;
};

/**
 * Why a search returned no results: its words are no search ("no-words", "too-long"), it ran longer than
 * `SEARCH_TIME_LIMIT_MS` ("too-broad"), or `SEARCH_MAX_RUNNING` searches were running already ("busy").
 */
export type SearchError = SearchWordsError | { code: "too-broad" } | { code: "busy" };

/** The part of the best results that a search returns, by its offset and its number of results. */
export type SearchWindow = { offset: number; limit: number };

/** The client of the transaction of a search. */
type Transaction = Prisma.TransactionClient;

/** One of the best pages, in the order of the match, before its fields are read. */
type RankedPage = { id: string; language: SearchLanguage; level: number };

/**
 * The slots of the searches of this server process, on `globalThis`, so that the modules of the browser and of MCP,
 * which Next.js may bundle apart, and a hot reload share them.
 */
const globalForSearch = globalThis as typeof globalThis & { hippowikiSearchSlots?: Slots };

function searchSlots(): Slots {
  globalForSearch.hippowikiSearchSlots ??= createSlots(SEARCH_MAX_RUNNING);
  return globalForSearch.hippowikiSearchSlots;
}

/** The Prisma client may hold the transaction longer than the database lets a search run, so the database ends it. */
const TRANSACTION_TIMEOUT_MS = SEARCH_TIME_LIMIT_MS + 5_000;

/** How the database cuts the piece of text of a result, with the marker characters of `excerpt.ts`. */
const EXCERPT_OPTIONS = `StartSel=${MATCH_START}, StopSel=${MATCH_END}, MaxWords=35, MinWords=15, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "`;

/** What the log line of a search says about its outcome. */
type Outcome = "found" | SearchError["code"];

/**
 * Searches the folder with the given words and returns its best pages, at most `SEARCH_MAX_RESULTS`, or the window of
 * them that is given, each with a piece of its text. `null` for an admin, without asking the database, for a malformed
 * folder id and for a folder that the actor may not read. It takes no tab: a search always covers the whole folder.
 *
 * Words that are no search are answered before anything runs. A search runs in a slot of its own, at most
 * `SEARCH_MAX_RUNNING` at the same time, and is answered as "busy" at once when none is free; the database stops it
 * after `SEARCH_TIME_LIMIT_MS`, all its statements together, as "too broad". Every search is logged in one line, with
 * the length of its words but never a word. Other database errors are logged and thrown.
 */
export async function searchPages(
  actor: ContentActor,
  folderId: string,
  input: string,
  window: SearchWindow = { offset: 0, limit: SEARCH_MAX_RESULTS },
): Promise<Result<SearchResults, SearchError> | null> {
  const start = performance.now();
  if (isAdmin(actor)) return null;
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId || !(await mayReadFolder(actor, parsedFolderId))) return null;

  const parsed = parseSearch(input);
  const log = (outcome: Outcome, results: number | null) =>
    logger.info(
      {
        actorId: actor.id,
        ...channelOf(actor),
        folderId: parsedFolderId,
        outcome,
        results,
        durationMs: Math.round(performance.now() - start),
        characters: [...input.trim()].length,
        words: parsed.ok ? parsed.value.words : null,
      },
      "search",
    );
  if (!parsed.ok) {
    log(parsed.error.code, null);
    return parsed;
  }

  const running = searchSlots().tryRun(() =>
    getDb().$transaction((tx) => search(tx, parsedFolderId, parsed.value, input, window), {
      timeout: TRANSACTION_TIMEOUT_MS,
    }),
  );
  if (running === null) {
    log("busy", null);
    return { ok: false, error: { code: "busy" } };
  }
  try {
    const results = await running;
    log("found", results.total);
    return { ok: true, value: results };
  } catch (err) {
    if (isStatementTimeout(err)) {
      log("too-broad", null);
      return { ok: false, error: { code: "too-broad" } };
    }
    logger.error({ err, actorId: actor.id, ...channelOf(actor), folderId: parsedFolderId }, "search failed");
    throw err;
  }
}

/**
 * The search itself, in its transaction: each statement may run only for what is left of `SEARCH_TIME_LIMIT_MS`, so
 * that the database stops the whole search after that time.
 */
async function search(
  tx: Transaction,
  folderId: string,
  parsed: ParsedSearch,
  input: string,
  window: SearchWindow,
): Promise<SearchResults> {
  const deadline = performance.now() + SEARCH_TIME_LIMIT_MS;
  const limited = () => limitTime(tx, deadline);
  const found = await foundWords(tx, limited, folderId, partWords(parsed));
  const texts = queryTexts(parsed, found);
  const ranked = await rankedPages(tx, limited, folderId, texts, input);
  const best = ranked.slice(0, SEARCH_MAX_RESULTS);
  const windowed = best.slice(window.offset, window.offset + window.limit);
  const results = await resultsOf(tx, limited, folderId, windowed, texts);
  return { results, total: best.length, more: ranked.length > SEARCH_MAX_RESULTS };
}

/** Lets the next statements of the transaction run only until the deadline; at least 1 ms, since 0 means no limit. */
async function limitTime(tx: Transaction, deadline: number): Promise<void> {
  const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
  await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(remaining)}, true)`;
}

/**
 * The words of the folder that hold each of the given search words, or are close to it by the similarity of
 * `pg_trgm`, the closest first, at most `SEARCH_FOUND_WORDS_CAP` for each. The words of the folder are in lower case,
 * as the configuration `simple` holds them, so the search word is compared in lower case too.
 */
async function foundWords(
  tx: Transaction,
  limited: () => Promise<void>,
  folderId: string,
  words: string[],
): Promise<FoundWords> {
  if (words.length === 0) return new Map();
  await limited();
  // `%` compares with this threshold, and may use the trigram index for it; only for this transaction.
  await tx.$queryRaw`SELECT set_config('pg_trgm.similarity_threshold', ${String(SEARCH_SIMILARITY_THRESHOLD)}, true)`;
  const rows = await tx.$queryRaw<{ input: string; word: string }[]>`
    SELECT search.input, found.word
    FROM unnest(${words}::text[]) AS search(input),
      LATERAL (SELECT lower(search.input) AS word) AS lowered,
      -- The search word holds no wildcard of LIKE: "!" escapes them, and itself.
      LATERAL (
        SELECT sw.word
        FROM "SearchWord" AS sw
        WHERE sw."folderId" = ${folderId}::uuid
          AND sw.word <> lowered.word
          AND (
            sw.word LIKE '%' || replace(replace(replace(lowered.word, '!', '!!'), '%', '!%'), '_', '!_') || '%' ESCAPE '!'
            OR sw.word % lowered.word
          )
        ORDER BY similarity(sw.word, lowered.word) DESC, sw.word
        LIMIT ${SEARCH_FOUND_WORDS_CAP}
      ) AS found`;
  const found = new Map<string, string[]>();
  for (const { input, word } of rows) found.set(input, [...(found.get(input) ?? []), word]);
  return found;
}

/**
 * The order of a match, decided in the database: 1 a title that is exactly the words of the search, without case and
 * surrounding spaces; 2 every word strong in the title or the name; 3 every word strong; 4 every word at least weak in
 * the title or the name; 5 the rest. A page counts by the weakest match of its words.
 */
function orderLevel(language: SearchLanguage, texts: QueryTexts, input: string): Prisma.Sql {
  return Prisma.sql`CASE
      WHEN lower(btrim(p.title)) = lower(btrim(${input})) THEN 1
      WHEN ts_filter(p."searchVector", '{a}') @@ to_tsquery(${language}::regconfig, ${texts.strong}) THEN 2
      WHEN p."searchVector" @@ to_tsquery(${language}::regconfig, ${texts.strong}) THEN 3
      WHEN ts_filter(p."searchVector", '{a}') @@ to_tsquery(${language}::regconfig, ${texts.weak}) THEN 4
      ELSE 5
    END`;
}

/**
 * The branch of the query of the pages of one language. "Not deleted" and the folder are part of it, so that no branch
 * without them can be built.
 */
function languageBranch(folderId: string, language: SearchLanguage, texts: QueryTexts, input: string): Prisma.Sql {
  const excluded =
    texts.excluded === null
      ? Prisma.empty
      : Prisma.sql`AND NOT p."searchVector" @@ to_tsquery(${language}::regconfig, ${texts.excluded})`;
  return Prisma.sql`
    SELECT matched.id, ${language} AS language, matched."updatedAt", matched.level,
      ts_rank_cd(matched."searchVector",
        to_tsquery(${language}::regconfig, CASE WHEN matched.level <= 3 THEN ${texts.strong} ELSE ${texts.weak} END))
        AS rank
    FROM (
      SELECT p.id, p."updatedAt", p."searchVector", ${orderLevel(language, texts, input)} AS level
      FROM "Page" AS p
      WHERE p."folderId" = ${folderId}::uuid
        AND p."deletedAt" IS NULL
        AND p."searchLanguage" = ${language}
        AND p."searchVector" @@ to_tsquery(${language}::regconfig, ${texts.weak})
        ${excluded}
    ) AS matched`;
}

/**
 * The best pages of the folder that match, one more than `SEARCH_MAX_RESULTS` to tell whether more match: by the
 * level of their match, then by the rank of PostgreSQL that counts how often and how close together the words occur,
 * then newest first, then by id.
 */
async function rankedPages(
  tx: Transaction,
  limited: () => Promise<void>,
  folderId: string,
  texts: QueryTexts,
  input: string,
): Promise<RankedPage[]> {
  await limited();
  const languages = await languagesOf(tx, folderId);
  if (languages.length === 0) return [];
  const branches = languages.map((language) => languageBranch(folderId, language, texts, input));
  await limited();
  return tx.$queryRaw<RankedPage[]>`
    SELECT id, language, level FROM (${Prisma.join(branches, " UNION ALL ")}) AS matches
    ORDER BY level, rank DESC, "updatedAt" DESC, id
    LIMIT ${SEARCH_MAX_RESULTS + 1}`;
}

/** The languages of the pages of the folder that are not deleted and whose search text is derived. */
async function languagesOf(tx: Transaction, folderId: string): Promise<SearchLanguage[]> {
  const rows = await tx.page.findMany({
    where: { folderId, deletedAt: null, searchLanguage: { not: null } },
    distinct: ["searchLanguage"],
    select: { searchLanguage: true },
  });
  return SEARCH_LANGUAGES.filter((language) => rows.some((row) => row.searchLanguage === language));
}

/**
 * The fields of the given pages of the folder, in the given order, each with the piece of its search text around the
 * match, cut and marked by the database with the query of its level: the strong form for a strong match, the weak form
 * otherwise. A page that matches only by its title or its name gets the start of its text without a mark. A page
 * deleted in the meantime is left out.
 */
async function resultsOf(
  tx: Transaction,
  limited: () => Promise<void>,
  folderId: string,
  ranked: RankedPage[],
  texts: QueryTexts,
): Promise<SearchResult[]> {
  if (ranked.length === 0) return [];
  await limited();
  const rows = await tx.page.findMany({
    where: { id: { in: ranked.map(({ id }) => id) }, folderId, deletedAt: null },
    select: {
      id: true,
      name: true,
      title: true,
      updatedAt: true,
      tab: { select: { name: true } },
      ...LAST_EDITOR_SELECT,
    },
  });
  await limited();
  const excerpts = await tx.$queryRaw<{ id: string; excerpt: string }[]>`
    SELECT p.id, ts_headline(r.language::regconfig, replace(p."searchText", '<', ${LESS_THAN_STAND_IN}),
        to_tsquery(r.language::regconfig, CASE WHEN r.level <= 3 THEN ${texts.strong} ELSE ${texts.weak} END),
        ${EXCERPT_OPTIONS}) AS excerpt
    FROM unnest(${ranked.map(({ id }) => id)}::uuid[], ${ranked.map(({ language }) => language)}::text[],
        ${ranked.map(({ level }) => level)}::integer[]) AS r(id, language, level)
      JOIN "Page" AS p ON p.id = r.id
    WHERE p."folderId" = ${folderId}::uuid AND p."deletedAt" IS NULL`;
  const excerptOf = new Map(excerpts.map(({ id, excerpt }) => [id, excerptParts(excerpt)]));
  const byId = new Map(rows.map((row) => [row.id, withLastEditor(row)]));
  return ranked.flatMap(({ id }) => {
    const row = byId.get(id);
    return row ? [{ ...row, excerpt: excerptOf.get(id) ?? [] }] : [];
  });
}
