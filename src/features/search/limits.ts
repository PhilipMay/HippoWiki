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
