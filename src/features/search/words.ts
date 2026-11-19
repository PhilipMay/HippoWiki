// The one parser of the words of a search, for the browser and for AI apps. Pure, without server-only imports, and
// total: no input makes it throw. What it returns holds the words as plain strings, never text of a query syntax; the
// search service quotes every word itself.
//
// The syntax: words separated by spaces must all match; words in quotes are a phrase; a word with a leading `-` is
// excluded; `or` between two words or phrases, in any case, means either. What stands in an odd place is read as plain
// words: a quote without its partner is a space, a `-` before a phrase is dropped, `or` at the start, at the end or
// twice in a row is the word "or", and a search of excluded words only searches them. `or` between an excluded word and
// another word connects nothing and counts as no word, as every `or` between two words.

import { SEARCH_MAX_CHARACTERS, SEARCH_MAX_WORDS, SEARCH_PART_MIN_LETTERS } from "@/features/search/limits";
import type { Result } from "@/lib/result";

/** One word of a search, as typed. */
export type SearchWord = {
  text: string;
  /** A word of fewer than `SEARCH_PART_MIN_LETTERS` letters and digits, which matches only as a whole word. */
  wholeWord: boolean;
};

/** A word or a phrase, whose words must follow each other. */
export type SearchTerm = { kind: "word"; word: SearchWord } | { kind: "phrase"; words: SearchWord[] };

/** The words of a search as the service turns them into queries. */
export type ParsedSearch = {
  /** The clauses that must all match; each holds its alternatives, of which one must match. */
  clauses: SearchTerm[][];
  /** The words that a page must not hold. */
  excluded: SearchWord[];
  /** The number of words, as the limit counts them. */
  words: number;
  /** The number of characters of the trimmed input. */
  characters: number;
};

/** Why the input is no search: nothing to search, or more than the limits. */
export type SearchWordsError = { code: "no-words" } | { code: "too-long" };

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LETTERS_OR_DIGITS = /[\p{L}\p{N}]/gu;
const SPACE = /\s/u;

/** What the scan of the input finds: a word, possibly excluded, a phrase, or the word `or`. */
type Item = { kind: "word"; text: string; excluded: boolean } | { kind: "phrase"; words: string[] } | { kind: "or" };

function hasLetterOrDigit(text: string): boolean {
  return LETTER_OR_DIGIT.test(text);
}

function searchWord(text: string): SearchWord {
  const letters = text.match(LETTERS_OR_DIGITS)?.length ?? 0;
  return { text, wholeWord: letters < SEARCH_PART_MIN_LETTERS };
}

/** A word token outside quotes: excluded with a leading `-`, the connector `or`, or dropped without a letter or digit. */
function wordItem(token: string): Item | null {
  if (!hasLetterOrDigit(token)) return null;
  if (token.toLowerCase() === "or") return { kind: "or" };
  if (token.startsWith("-")) return { kind: "word", text: token.slice(1), excluded: true };
  return { kind: "word", text: token, excluded: false };
}

/** The words of a phrase that have a letter or a digit; inside quotes `-` and `or` are plain text. */
function phraseWords(text: string): string[] {
  return text.split(/\s+/u).filter(hasLetterOrDigit);
}

/** Splits the input into words, phrases and `or`. */
function scan(input: string): Item[] {
  const items: Item[] = [];
  let token = "";
  const flush = () => {
    const item = wordItem(token);
    if (item) items.push(item);
    token = "";
  };
  for (let index = 0; index < input.length; index++) {
    const character = input.charAt(index);
    if (character === '"') {
      const end = input.indexOf('"', index + 1);
      if (end === -1) {
        // A quote without its partner is a space.
        flush();
        continue;
      }
      // A `-` right before a phrase is dropped: a phrase is never excluded.
      if (token !== "-") flush();
      token = "";
      const words = phraseWords(input.slice(index + 1, end));
      if (words.length > 0) items.push({ kind: "phrase", words });
      index = end;
    } else if (SPACE.test(character)) {
      flush();
    } else {
      token += character;
    }
  }
  flush();
  return items;
}

/** Whether the item is a word or phrase that must match, which `or` can connect. */
function isIncluded(item: Item): boolean {
  return item.kind === "phrase" || (item.kind === "word" && !item.excluded);
}

/** What an `or` between the given neighbours is: a connector, nothing next to an excluded word, or the word "or". */
function orBetween(before: Item | undefined, after: Item | undefined): "connector" | "nothing" | "word" {
  if (before === undefined || after === undefined || before.kind === "or" || after.kind === "or") return "word";
  return isIncluded(before) && isIncluded(after) ? "connector" : "nothing";
}

function termOf(item: Item): SearchTerm {
  switch (item.kind) {
    case "phrase":
      return item.words.length === 1 && item.words[0] !== undefined
        ? { kind: "word", word: searchWord(item.words[0]) }
        : { kind: "phrase", words: item.words.map(searchWord) };
    case "word":
      return { kind: "word", word: searchWord(item.text) };
    case "or":
      return { kind: "word", word: searchWord("or") };
  }
}

function wordsOf(term: SearchTerm): number {
  return term.kind === "word" ? 1 : term.words.length;
}

/**
 * Parses the words of a search. "too-long" for more than `SEARCH_MAX_CHARACTERS` characters or `SEARCH_MAX_WORDS`
 * words, "no-words" when nothing with a letter or a digit is left.
 */
export function parseSearch(input: string): Result<ParsedSearch, SearchWordsError> {
  const trimmed = input.trim();
  // A code point takes at most two code units, so a longer string has more characters than the limit.
  if (trimmed.length > 2 * SEARCH_MAX_CHARACTERS) return { ok: false, error: { code: "too-long" } };
  const characters = [...trimmed].length;
  if (characters > SEARCH_MAX_CHARACTERS) return { ok: false, error: { code: "too-long" } };

  const items = scan(trimmed);
  const clauses: SearchTerm[][] = [];
  const excluded: SearchWord[] = [];
  // `or` connects only when it stands between two words or phrases that must match.
  let connect = false;
  items.forEach((item, index) => {
    if (item.kind === "or") {
      const role = orBetween(items[index - 1], items[index + 1]);
      if (role === "connector") connect = true;
      if (role !== "word") return;
    }
    if (item.kind === "word" && item.excluded) {
      excluded.push(searchWord(item.text));
      return;
    }
    const term = termOf(item);
    const last = clauses.at(-1);
    if (connect && last) last.push(term);
    else clauses.push([term]);
    connect = false;
  });
  // A search of excluded words only searches them.
  if (clauses.length === 0) {
    for (const word of excluded.splice(0)) clauses.push([{ kind: "word", word }]);
  }

  const words = clauses.flat().reduce((sum, term) => sum + wordsOf(term), 0) + excluded.length;
  if (words === 0) return { ok: false, error: { code: "no-words" } };
  if (words > SEARCH_MAX_WORDS) return { ok: false, error: { code: "too-long" } };
  return { ok: true, value: { clauses, excluded, words, characters } };
}
