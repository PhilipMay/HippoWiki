import { describe, expect, it } from "vitest";

import { SEARCH_MAX_CHARACTERS, SEARCH_MAX_WORDS } from "@/features/search/limits";
import { parseSearch, type ParsedSearch, type SearchTerm, type SearchWord } from "@/features/search/words";

/** The parsed search, or a failure of the test. */
function parsed(input: string): ParsedSearch {
  const result = parseSearch(input);
  if (!result.ok) throw new Error(`not parsed: ${result.error.code}`);
  return result.value;
}

function word(text: string): SearchWord {
  return { text, wholeWord: text.replace(/[^\p{L}\p{N}]/gu, "").length < 3 };
}

function term(text: string): SearchTerm {
  return { kind: "word", word: word(text) };
}

function phrase(...words: string[]): SearchTerm {
  return { kind: "phrase", words: words.map(word) };
}

/** The clauses and exclusions of the parsed search. */
function structure(input: string): Pick<ParsedSearch, "clauses" | "excluded"> {
  const { clauses, excluded } = parsed(input);
  return { clauses, excluded };
}

describe("the syntax of the search words", () => {
  it("reads words separated by spaces as words that must all match", () => {
    expect(structure("backup server")).toEqual({ clauses: [[term("backup")], [term("server")]], excluded: [] });
    expect(structure("  backup \t\n server  ")).toEqual({
      clauses: [[term("backup")], [term("server")]],
      excluded: [],
    });
  });

  it("reads words in quotes as a phrase", () => {
    expect(structure('"backup server"')).toEqual({ clauses: [[phrase("backup", "server")]], excluded: [] });
    expect(structure('restore "backup server" now')).toEqual({
      clauses: [[term("restore")], [phrase("backup", "server")], [term("now")]],
      excluded: [],
    });
  });

  it("reads a phrase of one word as the word", () => {
    expect(structure('"backup"')).toEqual({ clauses: [[term("backup")]], excluded: [] });
  });

  it("reads a word with a leading - as excluded", () => {
    expect(structure("backup -server")).toEqual({ clauses: [[term("backup")]], excluded: [word("server")] });
  });

  it("reads or between two words or phrases as either, in any case", () => {
    expect(structure("backup or restore")).toEqual({ clauses: [[term("backup"), term("restore")]], excluded: [] });
    expect(structure("backup OR restore Or dump")).toEqual({
      clauses: [[term("backup"), term("restore"), term("dump")]],
      excluded: [],
    });
    expect(structure('"backup server" or restore nightly')).toEqual({
      clauses: [[phrase("backup", "server"), term("restore")], [term("nightly")]],
      excluded: [],
    });
  });

  it("drops what has no letter and no digit", () => {
    expect(structure("backup ... !!! & | ( ) — server")).toEqual({
      clauses: [[term("backup")], [term("server")]],
      excluded: [],
    });
    expect(structure('"... backup !! server"')).toEqual({ clauses: [[phrase("backup", "server")]], excluded: [] });
  });

  it("marks a word of 1 or 2 letters to match only as a whole word", () => {
    const { clauses } = parsed("a ko kon ab- k8s");
    expect(clauses.flat()).toEqual([
      { kind: "word", word: { text: "a", wholeWord: true } },
      { kind: "word", word: { text: "ko", wholeWord: true } },
      { kind: "word", word: { text: "kon", wholeWord: false } },
      { kind: "word", word: { text: "ab-", wholeWord: true } },
      { kind: "word", word: { text: "k8s", wholeWord: false } },
    ]);
  });

  it("keeps the case, umlauts and other scripts as typed", () => {
    expect(structure("Häuser KONFIG Резервні 数据库 ελληνικά")).toEqual({
      clauses: [[term("Häuser")], [term("KONFIG")], [term("Резервні")], [term("数据库")], [term("ελληνικά")]],
      excluded: [],
    });
  });
});

describe("the syntax in odd places", () => {
  it("reads a quote without its partner as a space", () => {
    expect(structure('backup "server')).toEqual({ clauses: [[term("backup")], [term("server")]], excluded: [] });
    expect(structure('"a b" "c')).toEqual({ clauses: [[phrase("a", "b")], [term("c")]], excluded: [] });
    expect(structure('back"up')).toEqual({ clauses: [[term("back")], [term("up")]], excluded: [] });
  });

  it("drops a - alone and a - before a phrase", () => {
    expect(structure("backup - server")).toEqual({ clauses: [[term("backup")], [term("server")]], excluded: [] });
    expect(structure('backup -"old server"')).toEqual({
      clauses: [[term("backup")], [phrase("old", "server")]],
      excluded: [],
    });
  });

  it("reads - and or inside quotes as plain text", () => {
    expect(structure('"backup or -old"')).toEqual({ clauses: [[phrase("backup", "or", "-old")]], excluded: [] });
  });

  it("reads or at the start, at the end and twice in a row as the word", () => {
    expect(structure("or backup")).toEqual({ clauses: [[term("or")], [term("backup")]], excluded: [] });
    expect(structure("backup or")).toEqual({ clauses: [[term("backup")], [term("or")]], excluded: [] });
    expect(structure("backup or or restore")).toEqual({
      clauses: [[term("backup")], [term("or")], [term("or")], [term("restore")]],
      excluded: [],
    });
    expect(structure("or")).toEqual({ clauses: [[term("or")]], excluded: [] });
  });

  it("reads or next to an excluded word as nothing", () => {
    expect(structure("backup -old or new")).toEqual({
      clauses: [[term("backup")], [term("new")]],
      excluded: [word("old")],
    });
    expect(structure("backup or -old")).toEqual({ clauses: [[term("backup")]], excluded: [word("old")] });
  });

  it("searches excluded words when there are only excluded words", () => {
    expect(structure("-backup -server")).toEqual({ clauses: [[term("backup")], [term("server")]], excluded: [] });
  });

  it("reads a word that starts with several - as excluded without the first", () => {
    expect(structure("backup --old")).toEqual({ clauses: [[term("backup")]], excluded: [word("-old")] });
  });
});

describe("the count of the words", () => {
  it('counts "backup server" -old or new as 4 words', () => {
    expect(parsed('"backup server" -old or new').words).toBe(4);
  });

  it("counts each word once, also inside quotes and excluded, and a connecting or not", () => {
    expect(parsed("backup or restore").words).toBe(2);
    expect(parsed('"a b c" -d e').words).toBe(5);
    expect(parsed("backup or").words).toBe(2);
    expect(parsed("a a a").words).toBe(3);
  });

  it("counts the characters of the trimmed input", () => {
    expect(parsed("  Häuser  ").characters).toBe(6);
    expect(parsed("😀 backup").characters).toBe(8);
  });

  it("accepts 200 characters and 10 words", () => {
    const characters = "x".repeat(SEARCH_MAX_CHARACTERS);
    expect(parsed(characters).characters).toBe(SEARCH_MAX_CHARACTERS);
    const words = Array.from({ length: SEARCH_MAX_WORDS }, (_, index) => `word${index}`).join(" ");
    expect(parsed(words).words).toBe(SEARCH_MAX_WORDS);
    // Surrounding spaces do not count.
    expect(parseSearch(`  ${characters}  `).ok).toBe(true);
    // A letter beyond the basic plane counts once.
    expect(parseSearch("𝐀".repeat(SEARCH_MAX_CHARACTERS)).ok).toBe(true);
  });

  it("refuses 201 characters and 11 words as too long", () => {
    expect(parseSearch("x".repeat(SEARCH_MAX_CHARACTERS + 1))).toEqual({ ok: false, error: { code: "too-long" } });
    expect(parseSearch("😀".repeat(SEARCH_MAX_CHARACTERS + 1))).toEqual({ ok: false, error: { code: "too-long" } });
    const words = Array.from({ length: SEARCH_MAX_WORDS + 1 }, (_, index) => `w${index}`).join(" ");
    expect(parseSearch(words)).toEqual({ ok: false, error: { code: "too-long" } });
    expect(parseSearch(`"${words}"`)).toEqual({ ok: false, error: { code: "too-long" } });
    expect(
      parseSearch(
        words
          .split(" ")
          .map((w) => `-${w}`)
          .join(" "),
      ),
    ).toEqual({
      ok: false,
      error: { code: "too-long" },
    });
  });

  it("accepts 10 words with connecting or between them", () => {
    const words = Array.from({ length: SEARCH_MAX_WORDS }, (_, index) => `w${index}`).join(" or ");
    expect(parsed(words).words).toBe(SEARCH_MAX_WORDS);
  });

  it("gives no words for an input without a letter or a digit", () => {
    for (const input of ["", "   ", '""', '" "', "-", "- -", "...", "& | !"]) {
      expect(parseSearch(input), input).toEqual({ ok: false, error: { code: "no-words" } });
    }
  });
});

describe("hostile input", () => {
  const HOSTILE = [
    "a & b",
    "a | b",
    "!a",
    "a <-> b",
    "a <2> b",
    "a:*",
    "a:*AB",
    "(a | b) & !c",
    "'a'",
    "a''b",
    "\\",
    "a\\'b",
    '\'; DROP TABLE "Page"; --',
    "%_%",
    "\u0000\u0002\u0003",
    "\u0002backup\u0003",
    '"""',
    '""""',
    '-"',
    '"-"',
    "or or or",
    "-or",
    "--",
    "\ud800",
    "a​b",
    "x".repeat(10_000),
    " ".repeat(10_000),
    '"'.repeat(1_000),
  ];

  it.each(HOSTILE)("never throws: %j", (input) => {
    expect(() => parseSearch(input)).not.toThrow();
  });

  it("keeps the operators of a text search query in the words as plain text", () => {
    expect(structure("a:* (b|c)")).toEqual({ clauses: [[term("a:*")], [term("(b|c)")]], excluded: [] });
    expect(structure("it's")).toEqual({ clauses: [[term("it's")]], excluded: [] });
  });
});
