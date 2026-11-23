import { describe, expect, it } from "vitest";

import { embedLinkOf, parseWikiLinkTarget, wikiLinkOf, wikiLinkTargetText } from "@/features/pages/wiki-link-target";
import { NAME_MAX_LENGTH } from "@/lib/name-limits";

describe("parseWikiLinkTarget", () => {
  it.each([
    ["setup", { tab: null, name: "setup" }],
    ["release-notes-2", { tab: null, name: "release-notes-2" }],
    ["guides/setup", { tab: "guides", name: "setup" }],
    ["a/b", { tab: "a", name: "b" }],
    ["x".repeat(NAME_MAX_LENGTH), { tab: null, name: "x".repeat(NAME_MAX_LENGTH) }],
    [
      `${"t".repeat(NAME_MAX_LENGTH)}/${"p".repeat(NAME_MAX_LENGTH)}`,
      { tab: "t".repeat(NAME_MAX_LENGTH), name: "p".repeat(NAME_MAX_LENGTH) },
    ],
  ])("reads %j as a page", (text, target) => {
    expect(parseWikiLinkTarget(text)).toEqual({ kind: "page", ...target });
  });

  it.each([
    ["diagram.png", { tab: null, name: "diagram.png" }],
    ["guides/diagram.png", { tab: "guides", name: "diagram.png" }],
    ["photo.jpg", { tab: null, name: "photo.jpg" }],
    ["guides/anim.gif", { tab: "guides", name: "anim.gif" }],
    ["photo.webp", { tab: null, name: "photo.webp" }],
    ["guides/report.pdf", { tab: "guides", name: "report.pdf" }],
    [`${"x".repeat(NAME_MAX_LENGTH)}.png`, { tab: null, name: `${"x".repeat(NAME_MAX_LENGTH)}.png` }],
  ])("reads %j as a file", (text, target) => {
    expect(parseWikiLinkTarget(text)).toEqual({ kind: "file", ...target });
  });

  it.each([
    ["too long", "x".repeat(NAME_MAX_LENGTH + 1)],
    ["a tab name too long", `${"t".repeat(NAME_MAX_LENGTH + 1)}/setup`],
    ["a slash at the start", "/setup"],
    ["a slash at the end", "guides/"],
    ["two slashes", "guides/setup/more"],
    ["a double slash", "guides//setup"],
    ["upper case", "Setup"],
    ["upper case in the tab", "Guides/setup"],
    [".md", "setup.md"],
    ["#", "setup#install"],
    ["a space", "setup guide"],
    ["surrounding spaces", " setup "],
    ["a leading hyphen", "-setup"],
    ["two hyphens", "setup--guide"],
    ["an empty text", ""],
    ["a backslash", "setup\\"],
    [".jpeg", "photo.jpeg"],
    ["another extension", "report.docx"],
    ["an extension in upper case", "diagram.PNG"],
    ["a second dot", "a.b.png"],
    ["a file name too long", `${"x".repeat(NAME_MAX_LENGTH + 1)}.png`],
    ["a file name as the tab", "diagram.png/setup"],
    ["only an extension", ".png"],
  ])("refuses a target with %s", (_, text) => {
    expect(parseWikiLinkTarget(text)).toBeNull();
  });
});

describe("wikiLinkTargetText", () => {
  it("writes a target as a link names it", () => {
    expect(wikiLinkTargetText({ tab: null, name: "setup" })).toBe("setup");
    expect(wikiLinkTargetText({ tab: "guides", name: "setup" })).toBe("guides/setup");
    expect(wikiLinkTargetText({ tab: "guides", name: "diagram.png" })).toBe("guides/diagram.png");
  });
});

describe("wikiLinkOf and embedLinkOf", () => {
  it("write the wiki link and the embed link of an item placed directly in the folder, without a label", () => {
    expect(wikiLinkOf({ tab: null, name: "setup" })).toBe("[[setup]]");
    expect(wikiLinkOf({ tab: null, name: "diagram.png" })).toBe("[[diagram.png]]");
    expect(embedLinkOf({ tab: null, name: "diagram.png" })).toBe("![[diagram.png]]");
  });

  it("write the wiki link and the embed link of an item in a tab with the tab before its name, without a label", () => {
    expect(wikiLinkOf({ tab: "guides", name: "setup" })).toBe("[[guides/setup]]");
    expect(wikiLinkOf({ tab: "guides", name: "manual.pdf" })).toBe("[[guides/manual.pdf]]");
    expect(embedLinkOf({ tab: "guides", name: "diagram.png" })).toBe("![[guides/diagram.png]]");
  });
});
