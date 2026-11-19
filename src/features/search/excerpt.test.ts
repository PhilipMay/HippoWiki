import { describe, expect, it } from "vitest";

import { excerptParts, LESS_THAN_STAND_IN, MATCH_END, MATCH_START } from "@/features/search/excerpt";

/** The text with the given words marked as the database marks them. */
function marked(...pieces: (string | { match: string })[]): string {
  return pieces
    .map((piece) => (typeof piece === "string" ? piece : `${MATCH_START}${piece.match}${MATCH_END}`))
    .join("");
}

describe("excerptParts", () => {
  it("splits marked text into plain parts and matches", () => {
    expect(
      excerptParts(marked("Die ", { match: "Häuser" }, " stehen am Ende … über ", { match: "Haus" }, ".")),
    ).toEqual([
      { text: "Die ", match: false },
      { text: "Häuser", match: true },
      { text: " stehen am Ende … über ", match: false },
      { text: "Haus", match: true },
      { text: ".", match: false },
    ]);
  });

  it("gives one plain part for text without a match", () => {
    expect(excerptParts("The start of the text")).toEqual([{ text: "The start of the text", match: false }]);
    expect(excerptParts("")).toEqual([]);
  });

  it("keeps text that looks like HTML as one plain part", () => {
    expect(excerptParts('<script>alert(1)</script> <b onclick="x()">bold</b>')).toEqual([
      { text: '<script>alert(1)</script> <b onclick="x()">bold</b>', match: false },
    ]);
    expect(excerptParts(marked({ match: "<img src=x>" }))).toEqual([{ text: "<img src=x>", match: true }]);
  });

  it("puts < back in place of its stand-in", () => {
    expect(
      excerptParts(
        `${LESS_THAN_STAND_IN}b>bold${LESS_THAN_STAND_IN}/b> ${MATCH_START}a${LESS_THAN_STAND_IN}b${MATCH_END}`,
      ),
    ).toEqual([
      { text: "<b>bold</b> ", match: false },
      { text: "a<b", match: true },
    ]);
  });

  it("joins matches that follow each other", () => {
    expect(excerptParts(marked({ match: "backup" }, { match: "server" }, " runs"))).toEqual([
      { text: "backupserver", match: true },
      { text: " runs", match: false },
    ]);
  });

  it("drops markers without their partner", () => {
    expect(excerptParts(`a ${MATCH_END}b ${MATCH_START}c`)).toEqual([{ text: "a b c", match: false }]);
    expect(excerptParts(`${MATCH_START}${MATCH_END}x`)).toEqual([{ text: "x", match: false }]);
  });
});
