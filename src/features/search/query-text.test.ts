import { describe, expect, it } from "vitest";

import { partWords, queryTexts, quoted } from "@/features/search/query-text";
import { parseSearch, type ParsedSearch } from "@/features/search/words";

function parsed(input: string): ParsedSearch {
  const result = parseSearch(input);
  if (!result.ok) throw new Error(`not parsed: ${result.error.code}`);
  return result.value;
}

describe("quoted", () => {
  it("quotes a word as a lexeme, with its quotes and backslashes escaped", () => {
    expect(quoted("backup")).toBe("'backup'");
    expect(quoted("it's")).toBe("'it''s'");
    expect(quoted("a\\b")).toBe("'a\\\\b'");
    expect(quoted("' | !x & ('")).toBe("''' | !x & ('''");
  });
});

describe("queryTexts", () => {
  it("matches a word by its start, and a word of 1 or 2 letters only as a whole word", () => {
    expect(queryTexts(parsed("backup kv"), new Map())).toEqual({
      strong: "'backup':* & 'kv'",
      weak: "'backup':* & 'kv'",
      excluded: null,
    });
  });

  it("adds the found words to the weak form only", () => {
    const texts = queryTexts(parsed("konfiguraton bank"), new Map([["konfiguraton", ["konfiguration"]]]));
    expect(texts.strong).toBe("'konfiguraton':* & 'bank':*");
    expect(texts.weak).toBe("('konfiguraton':* | 'konfiguration') & 'bank':*");
  });

  it("builds phrases, alternatives and the excluded words", () => {
    expect(queryTexts(parsed('"backup server" or restore -old -it\'s'), new Map())).toEqual({
      strong: "(('backup':* <-> 'server':*) | 'restore':*)",
      weak: "(('backup':* <-> 'server':*) | 'restore':*)",
      excluded: "'old' | 'it''s'",
    });
  });

  it("quotes every word, so that no operator of a typed word reaches the query", () => {
    expect(queryTexts(parsed("a:* !b (c|d)"), new Map()).strong).toBe("'a:*' & '!b' & '(c|d)'");
  });
});

describe("partWords", () => {
  it("names each word of 3 letters or more that must match once", () => {
    expect(partWords(parsed('backup "backup server" ko -old or new'))).toEqual(["backup", "server", "new"]);
  });
});
