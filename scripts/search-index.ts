// The search index and the index of wiki links of the existing pages: derives the search text and the language of every
// page of the database of DATABASE_URL that was stored before search, or by an older version of the derivation
// (`indexOutdatedPages()` of the search service), then the wiki links of every page stored before the index of links
// or by an older version of it (`indexOutdatedLinks()` of `src/features/pages/links-service.ts`), and does nothing
// otherwise. Run it with `npm run search:index` in development, after
// `npm run db:migrate` on a database with pages. In the container image it is bundled into one file
// (`npm run build:search-index`), with the language detector, and run by image-search-index.sh at every start, before
// the server serves; so it imports nothing that only exists on the development machine, such as dotenv.
//
// Exit codes: 0 when every page is derived, 1 when the pages could not be derived.
import { indexOutdatedLinks } from "../src/features/pages/links-service";
import { indexOutdatedPages } from "../src/features/search/service";
import { getDb } from "../src/lib/db";

/** Derives the pages and returns the exit code. */
async function main(): Promise<number> {
  const result = await indexOutdatedPages();
  if (!result.ok) {
    console.error("The search index of the pages could not be derived; the error is logged above.");
    return 1;
  }
  console.log(
    result.value.pages === 0
      ? "Search index up to date, no page derived."
      : `Search index derived for ${result.value.pages} pages.`,
  );
  const links = await indexOutdatedLinks();
  if (!links.ok) {
    console.error("The wiki links of the pages could not be derived; the error is logged above.");
    return 1;
  }
  console.log(
    links.value.pages === 0
      ? "Wiki links up to date, no page derived."
      : `Wiki links derived for ${links.value.pages} pages.`,
  );
  return 0;
}

async function run(): Promise<number> {
  try {
    return await main();
  } finally {
    await getDb().$disconnect();
  }
}

run().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    // E.g. a missing or malformed DATABASE_URL, which fails before the service can log.
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
