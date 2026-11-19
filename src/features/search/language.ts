// The language of a page for search: the name of the text search configuration of PostgreSQL that stems its words,
// detected from its prose with the language detector eld, never chosen. No database and no server-only imports, but
// the detector is loaded on first use, not on import, so that nothing that merely imports this module loads it.

/**
 * The text search configurations a page can have: one for every European language that PostgreSQL can stem, and
 * `simple`, which stems nothing, for every other language and for prose too short to tell. A check constraint of the
 * migration of the search index holds the same list.
 */
export const SEARCH_LANGUAGES = [
  "basque",
  "catalan",
  "danish",
  "dutch",
  "english",
  "estonian",
  "finnish",
  "french",
  "german",
  "greek",
  "hungarian",
  "italian",
  "lithuanian",
  "norwegian",
  "portuguese",
  "romanian",
  "russian",
  "serbian",
  "spanish",
  "swedish",
  "turkish",
  "simple",
] as const;

/** A text search configuration of `SEARCH_LANGUAGES`. */
export type SearchLanguage = (typeof SEARCH_LANGUAGES)[number];

/**
 * The configuration of each language that eld detects and PostgreSQL stems, by the ISO 639-1 code of eld. Only the
 * detected language maps, never a neighbour: Croatian (`hr`) is not given `serbian`, Ukrainian (`uk`) not `russian`.
 */
const CONFIGURATION_OF: Readonly<Record<string, SearchLanguage>> = {
  eu: "basque",
  ca: "catalan",
  da: "danish",
  nl: "dutch",
  en: "english",
  et: "estonian",
  fi: "finnish",
  fr: "french",
  de: "german",
  el: "greek",
  hu: "hungarian",
  it: "italian",
  lt: "lithuanian",
  no: "norwegian",
  pt: "portuguese",
  ro: "romanian",
  ru: "russian",
  sr: "serbian",
  es: "spanish",
  sv: "swedish",
  tr: "turkish",
};

/**
 * The European languages that eld knows, which the detection chooses among: the languages of `CONFIGURATION_OF` and
 * their neighbours that PostgreSQL cannot stem, so that a Polish, Czech or Ukrainian page is detected as such and gets
 * `simple` instead of the closest language that has a configuration. Irish is missing: eld does not know it.
 */
const EUROPEAN_LANGUAGES = [
  ...Object.keys(CONFIGURATION_OF),
  "be",
  "bg",
  "cs",
  "hr",
  "is",
  "lv",
  "pl",
  "sk",
  "sl",
  "sq",
  "uk",
];

/**
 * The fewest letters of prose that are detected; shorter prose gets `simple`. Measured with the samples of
 * `src/test/language-samples.ts`: from 60 letters on, no window of any sample was given a wrong language, only none,
 * while below that a short line such as "Notizen. TODO morgen" counted as reliably Dutch.
 */
const MIN_PROSE_LETTERS = 80;

const LETTER = /\p{L}/u;

/** The detector as eld exports it: its smallest database, which tells every sample apart. */
type Detector = (typeof import("eld/extrasmall"))["eld"];

let detector: Promise<Detector> | undefined;

/** The detector, loaded on first use and limited to the European languages; about 33 MB of memory. */
function loadDetector(): Promise<Detector> {
  detector ??= import("eld/extrasmall").then(({ eld }) => {
    eld.setLanguageSubset(EUROPEAN_LANGUAGES);
    return eld;
  });
  return detector;
}

/** Whether the prose has at least `MIN_PROSE_LETTERS` letters. */
function longEnough(prose: string): boolean {
  let letters = 0;
  for (const character of prose) {
    if (LETTER.test(character) && ++letters >= MIN_PROSE_LETTERS) return true;
  }
  return false;
}

/**
 * The configuration of the language of the prose: the one of the detected language, or `simple` for prose that is too
 * short, a language without a configuration and a result that the detector does not call reliable.
 */
export async function detectLanguage(prose: string): Promise<SearchLanguage> {
  if (!longEnough(prose)) return "simple";
  const result = (await loadDetector()).detect(prose);
  if (!result.isReliable()) return "simple";
  return CONFIGURATION_OF[result.language] ?? "simple";
}
