// The texts of the text search queries of a search, built from its parsed words. Pure: the service binds each text as a
// parameter of `to_tsquery()` with the configuration of each language, never as SQL.
//
// Every word is quoted, so that nothing typed is read as an operator of the query: inside the quotes the parser of the
// configuration splits the word as it splits the text of a page, and stems it. A word of at least
// `SEARCH_PART_MIN_LETTERS` letters also matches by its start (`:*`), and in the weak form also by the words of the
// folder that hold it or are close to it, which the service found in the table of the words of the folder.

import type { ParsedSearch, SearchTerm, SearchWord } from "@/features/search/words";

/** The words of the folder found for each search word, by the search word as typed. */
export type FoundWords = ReadonlyMap<string, readonly string[]>;

/** The texts of the queries of a search, each for `to_tsquery()`. */
export type QueryTexts = {
  /** Every word exactly, by an inflection or by its start, without the excluded words. */
  strong: string;
  /** Every word as in `strong`, or as a part of a word or with a typo, without the excluded words. */
  weak: string;
  /**
   * Any of the excluded words, or `null` without one: a page that matches it is left out. A positive query, so that an
   * excluded word that the configuration drops, such as a stop word, excludes nothing instead of every page.
   */
  excluded: string | null;
};

/** The word as a quoted lexeme of a text search query, with its quotes and backslashes escaped. */
export function quoted(text: string): string {
  return `'${text.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function strongWord(word: SearchWord): string {
  return word.wholeWord ? quoted(word.text) : `${quoted(word.text)}:*`;
}

function weakWord(word: SearchWord, found: FoundWords): string {
  const others = word.wholeWord ? [] : (found.get(word.text) ?? []);
  if (others.length === 0) return strongWord(word);
  return `(${[strongWord(word), ...others.map(quoted)].join(" | ")})`;
}

function termText(term: SearchTerm, form: (word: SearchWord) => string): string {
  if (term.kind === "word") return form(term.word);
  return `(${term.words.map(form).join(" <-> ")})`;
}

function clausesText(clauses: readonly SearchTerm[][], form: (word: SearchWord) => string): string {
  return clauses
    .map((alternatives) => {
      const texts = alternatives.map((term) => termText(term, form));
      return texts.length === 1 ? (texts[0] ?? "") : `(${texts.join(" | ")})`;
    })
    .join(" & ");
}

/** The words of 3 letters or more that must match, whose parts and typos are looked up in the words of the folder. */
export function partWords(search: ParsedSearch): string[] {
  const words = search.clauses
    .flat()
    .flatMap((term) => (term.kind === "word" ? [term.word] : term.words))
    .filter((word) => !word.wholeWord)
    .map((word) => word.text);
  return [...new Set(words)];
}

/** The texts of the queries of the parsed search with the words found for its words. */
export function queryTexts(search: ParsedSearch, found: FoundWords): QueryTexts {
  return {
    strong: clausesText(search.clauses, strongWord),
    weak: clausesText(search.clauses, (word) => weakWord(word, found)),
    excluded: search.excluded.length === 0 ? null : search.excluded.map((word) => quoted(word.text)).join(" | "),
  };
}
