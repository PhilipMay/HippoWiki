import { describe, expect, it } from "vitest";

import { fileNamePatterns, type FileNamePatterns } from "@/features/search/file-names";
import { parseSearch } from "@/features/search/words";

function patterns(input: string): FileNamePatterns | null {
  const result = parseSearch(input);
  if (!result.ok) throw new Error(`not parsed: ${result.error.code}`);
  return fileNamePatterns(result.value, input.trim());
}

/** Whether the name without its extension is found by the search, as the service matches it with `~`. */
function finds(input: string, base: string): boolean {
  const found = patterns(input);
  if (!found) return false;
  const matches = (pattern: string) => new RegExp(pattern, "u").test(base);
  return (
    found.clauses.every((alternatives) => alternatives.some((term) => matches(term.weak))) &&
    !found.excluded.some(matches)
  );
}

/** The level of the match as the service orders it: 1 the whole name, 2 every word strong, 3 the rest. */
function level(input: string, base: string): number {
  const found = patterns(input);
  if (!found) throw new Error("no patterns");
  if (base === found.wholeName) return 1;
  const strong = found.clauses.every((alternatives) =>
    alternatives.some((term) => new RegExp(term.strong, "u").test(base)),
  );
  return strong ? 2 : 3;
}

describe("fileNamePatterns", () => {
  it("matches a part exactly, by its start and as a part of a word", () => {
    expect(finds("diagram", "network-diagram")).toBe(true);
    expect(finds("diag", "network-diagram")).toBe(true);
    expect(finds("work", "network-diagram")).toBe(true);
    expect(finds("diagrams", "network-diagram")).toBe(false);
  });

  it("matches a word of 1 or 2 letters only as a whole part", () => {
    expect(finds("v2", "network-diagram-v2")).toBe(true);
    expect(finds("v2", "network-v23")).toBe(false);
    expect(finds("ne", "network-diagram")).toBe(false);
  });

  it("matches every word, in any case", () => {
    expect(finds("Network DIAGRAM", "network-diagram")).toBe(true);
    expect(finds("network setup", "network-diagram")).toBe(false);
  });

  it("matches a phrase and the pieces of a word in parts that follow each other", () => {
    expect(finds('"network diagram"', "network-diagram-v2")).toBe(true);
    expect(finds('"diagram network"', "network-diagram-v2")).toBe(false);
    expect(finds("network-diagram", "network-diagram-v2")).toBe(true);
    expect(finds("network_diagram", "network-diagram-v2")).toBe(true);
    expect(finds('"work diag"', "network-diagram")).toBe(true);
  });

  it("matches the name without its extension", () => {
    expect(finds("png", "network-diagram")).toBe(false);
    expect(finds("diagram.png", "network-diagram")).toBe(false);
  });

  it("matches either side of or", () => {
    expect(finds("report or diagram", "network-diagram")).toBe(true);
    expect(finds("report or manual", "network-diagram")).toBe(false);
  });

  it("leaves out a name with an excluded word as a whole part", () => {
    expect(finds("diagram -network", "network-diagram")).toBe(false);
    expect(finds("diagram -net", "network-diagram")).toBe(true);
    expect(finds("diagram -old-network", "old-network-diagram")).toBe(false);
  });

  it("orders the whole name first, then the start of a part, then a part of a word", () => {
    expect(level("network diagram", "network-diagram")).toBe(1);
    expect(level("diagram", "network-diagram")).toBe(2);
    expect(level("net diag", "network-diagram")).toBe(2);
    expect(level("work", "network-diagram")).toBe(3);
  });

  it("finds nothing for a word that no name can hold, and leaves out such an excluded word", () => {
    expect(patterns("diagrämm")).toBeNull();
    expect(patterns("diagrämm or diagram")?.clauses).toHaveLength(1);
    expect(patterns("diagram -käse")?.excluded).toEqual([]);
  });

  it("puts nothing typed into a pattern but lowercase letters, digits and its own syntax", () => {
    const found = patterns(String.raw`x.* (a|b)+ [x] \d ^$y "a.b{2}" -c|d`);
    if (!found) throw new Error("no patterns");
    const all = [
      ...found.clauses.flat().flatMap((term) => [term.strong, term.weak]),
      ...found.excluded,
      found.wholeName,
    ];
    for (const pattern of all) {
      const typed = pattern.replaceAll("(^|-)", "").replaceAll("(-|$)", "").replaceAll("[a-z0-9]*", "");
      expect(typed).toMatch(/^[a-z0-9-]+$/u);
    }
    expect(finds("x.*", "network-diagram")).toBe(false);
  });
});
