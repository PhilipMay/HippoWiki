import { describe, expect, it } from "vitest";

import { parseWikiLinkTarget, wikiLinkTargetText } from "@/features/pages/wiki-link-target";
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
    expect(parseWikiLinkTarget(text)).toEqual(target);
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
  ])("refuses a target with %s", (_, text) => {
    expect(parseWikiLinkTarget(text)).toBeNull();
  });
});

describe("wikiLinkTargetText", () => {
  it("writes a target as a link names it", () => {
    expect(wikiLinkTargetText({ tab: null, name: "setup" })).toBe("setup");
    expect(wikiLinkTargetText({ tab: "guides", name: "setup" })).toBe("guides/setup");
  });
});
