// How the words of a search match the names of files, built from its parsed words. Pure: the service binds every
// pattern as a parameter of the regular expression operator `~` of PostgreSQL, never as SQL.
//
// A file is found by its name without the extension, whose parts are split at the hyphens (`network-diagram-v2` has
// the parts `network`, `diagram` and `v2`). A word matches a part exactly or by its start, and a word of at least
// `SEARCH_PART_MIN_LETTERS` letters also as a part of a word; a word of 1 or 2 letters matches only a whole part. The
// words of a phrase, and the pieces of a word such as `network-diagram` or `diagram.png`, must match parts that follow
// each other. Names are no prose, so there are no inflections and no typos.
//
// A name holds only lowercase ASCII letters, digits and hyphens. Every piece of a word is split at what is no letter
// and no digit and turned into lower case; a piece with any other character, such as `ü`, can match no name, and its
// word is left out. So a pattern holds only lowercase ASCII letters, digits and the fixed syntax below: nothing typed is
// ever read as an operator of a regular expression.

import { SEARCH_PART_MIN_LETTERS } from "@/features/search/limits";
import type { ParsedSearch, SearchTerm, SearchWord } from "@/features/search/words";

/** The patterns of one word or phrase of a search, each for `~` against the name of a file without its extension. */
export type FileNameTerm = {
  /** Every piece exactly or by its start, in parts that follow each other. */
  strong: string;
  /** As `strong`, and the first piece also as the end of a part, so that a piece of 3 letters matches inside a part. */
  weak: string;
};

/** The patterns of a search of the names of files. */
export type FileNamePatterns = {
  /** The words of the search as a name, which the name without its extension is compared with first. */
  wholeName: string;
  /** The clauses that must all match; each holds its alternatives, of which one must match. */
  clauses: FileNameTerm[][];
  /** Patterns of the excluded words: a name that matches any of them is left out. */
  excluded: string[];
};

/** The characters of a name besides the hyphen. */
const NAME_PART = "[a-z0-9]*";
const PIECE = /[\p{L}\p{N}]+/gu;
const NAME_PIECE = /^[a-z0-9]+$/;

/** The pieces of the words, in lower case, or `null` when one of them can match no name. */
function piecesOf(words: readonly SearchWord[]): string[] | null {
  const pieces = words.flatMap((word) => word.text.toLowerCase().match(PIECE) ?? []);
  if (pieces.length === 0 || !pieces.every((piece) => NAME_PIECE.test(piece))) return null;
  return pieces;
}

function isLong(piece: string): boolean {
  return piece.length >= SEARCH_PART_MIN_LETTERS;
}

/** The pieces as parts that follow each other, each exactly or, from 3 letters, by its start. */
function inParts(pieces: readonly string[], insideFirst: boolean): string {
  const body = pieces
    .map((piece, index) => {
      const start = index === 0 && insideFirst && isLong(piece) ? NAME_PART : "";
      return `${start}${piece}${isLong(piece) ? NAME_PART : ""}`;
    })
    .join("-");
  return `(^|-)${body}(-|$)`;
}

function termOf(term: SearchTerm): FileNameTerm | null {
  const pieces = piecesOf(term.kind === "word" ? [term.word] : term.words);
  if (!pieces) return null;
  return { strong: inParts(pieces, false), weak: inParts(pieces, true) };
}

/**
 * The patterns of the parsed search for the names of files, with the trimmed input as typed for the whole name, or
 * `null` when no name can match it: a clause none of whose alternatives can match any name.
 */
export function fileNamePatterns(search: ParsedSearch, input: string): FileNamePatterns | null {
  const clauses: FileNameTerm[][] = [];
  for (const alternatives of search.clauses) {
    const terms = alternatives.flatMap((term) => termOf(term) ?? []);
    if (terms.length === 0) return null;
    clauses.push(terms);
  }
  const excluded = search.excluded.flatMap((word) => {
    const pieces = piecesOf([word]);
    return pieces ? [`(^|-)${pieces.join("-")}(-|$)`] : [];
  });
  const wholeName = (input.toLowerCase().match(PIECE) ?? []).join("-");
  return { wholeName, clauses, excluded };
}
