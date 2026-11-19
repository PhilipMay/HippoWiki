import { describe, expect, it } from "vitest";

import { detectLanguage, SEARCH_LANGUAGES, type SearchLanguage } from "@/features/search/language";
import { pageText } from "@/features/search/text";
import { samplePage, type SampleLanguage } from "@/test/language-samples";

/** The language of a page with the given content, from its prose as a write derives it. */
function languageOf(content: string): Promise<SearchLanguage> {
  return detectLanguage(pageText(content).prose);
}

/** The languages whose inflections search finds ("Languages" in `spec/search.md`), each with its configuration. */
const STEMMED = SEARCH_LANGUAGES.filter((language) => language !== "simple");

describe("the language of a page", () => {
  it("knows a configuration for every language that PostgreSQL stems, and simple", () => {
    expect(STEMMED).toHaveLength(21);
    expect(SEARCH_LANGUAGES).toContain("simple");
  });

  it.each(STEMMED)("gives %s for a page in that language", async (language) => {
    expect(await languageOf(samplePage(language))).toBe(language);
  });

  it.each<[SampleLanguage, SearchLanguage]>([
    ["danish", "danish"],
    ["norwegian", "norwegian"],
    ["serbian", "serbian"],
    ["croatian", "simple"],
    ["spanish", "spanish"],
    ["portuguese", "portuguese"],
    ["german", "german"],
    ["dutch", "dutch"],
  ])("tells the languages that are easy to confuse apart: %s gives %s", async (sample, language) => {
    expect(await languageOf(samplePage(sample))).toBe(language);
  });

  it("gives german for a German page with many code blocks and links", async () => {
    const code = [
      "```sh",
      "pg_dump --format=custom --file=/var/backups/hippowiki.dump hippowiki",
      "pg_restore --clean --if-exists --dbname=hippowiki /var/backups/hippowiki.dump",
      "```",
      "",
      "See [the English docs](https://www.postgresql.org/docs/current/app-pgdump.html) and run `systemctl restart app`.",
      "",
    ].join("\n");
    const page = `${samplePage("german")}\n${code.repeat(8)}`;
    expect(await languageOf(page)).toBe("german");
  });

  it.each<SampleLanguage>(["polish", "czech", "irish"])(
    "gives simple for a %s page, which PostgreSQL cannot stem",
    async (sample) => {
      expect(await languageOf(samplePage(sample))).toBe("simple");
    },
  );

  it("gives a Ukrainian page simple, never russian", async () => {
    expect(await languageOf(samplePage("ukrainian"))).toBe("simple");
  });

  it("gives simple for a page of one short line", async () => {
    expect(await languageOf("# Notizen\n\nTODO morgen\n")).toBe("simple");
    expect(await languageOf("Server neu starten und Logs prüfen")).toBe("simple");
  });

  it("gives simple for a page without prose", async () => {
    expect(await languageOf("```\nls -la /var/backups\n```\n")).toBe("simple");
    expect(await detectLanguage("")).toBe("simple");
  });
});
