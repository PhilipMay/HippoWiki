// Every number of search in one place, so that the parser of the search words, the service and the components share
// them without importing each other. No imports, so Client Components can use it.

/** The most characters of the words of a search, counted as code points of the trimmed input. */
export const SEARCH_MAX_CHARACTERS = 200;

/** The most words of a search: each word once, also inside quotes and with a leading `-`; a connecting `or` not. */
export const SEARCH_MAX_WORDS = 10;

/**
 * The fewest letters and digits of a word that matches by its start, as a part of a word or with a typo; a shorter
 * word matches only as a whole word, so that it does not match a large part of all words.
 */
export const SEARCH_PART_MIN_LETTERS = 3;

/** The most pages a search returns, the best first; a search that matches more says so. */
export const SEARCH_MAX_RESULTS = 100;

/**
 * The words of a folder found for one search word as a part of a word or with a typo, the closest first. It bounds the
 * size of the query of the pages.
 */
export const SEARCH_FOUND_WORDS_CAP = 20;

/** The similarity of `pg_trgm` from which a word of a folder counts as the search word with a typo. */
export const SEARCH_SIMILARITY_THRESHOLD = 0.4;

/** How long a search may take, all its statements together, before the database stops it as too broad. */
export const SEARCH_TIME_LIMIT_MS = 5_000;

/** The most searches that run at the same time in one server process, in the browser and through MCP together. */
export const SEARCH_MAX_RUNNING = 3;

/** The results of one call of the search tool of AI apps without a number of its own. */
export const SEARCH_TOOL_DEFAULT_RESULTS = 10;

/** The most results of one call of the search tool of AI apps; each result fills the context of the app. */
export const SEARCH_TOOL_MAX_RESULTS = 25;
