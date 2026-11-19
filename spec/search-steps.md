# Search – Steps

The step plan of `search-requirements.md`, which has the status `approved`. The research behind it is
`search-plan.md`. Each step names the requirements it covers by their IDs.

## Goal

Users find the pages of a folder: a page whose title they roughly know, and the pages that are about a topic. A search
field on every address of a folder leads to a results view of the whole folder, and AI apps search the folder of their
connection with the tool `search_pages`. Pages are found in the language they are written in, by parts of words and
with typos, without anybody choosing a language.

## Scope

- In: search in one folder in the browser and through MCP; the automatic language of each page; parts of words and
  typos in titles, names and content; one list of the 100 best results; a time limit of 5 seconds for every search; at
  most 2 seconds for a search in a folder of 3,000 pages; at most 3 searches at the same time; the check of the
  database for `pg_trgm` and a UTF-8 character type; making the existing pages searchable at the start of the server.
- Not in: search across several folders or the whole wiki; suggestions while typing; opening a page directly from the
  search field; narrowing the results to a tab; a choice of the order of the results; paging through more than 100
  results; inflections of Irish and of languages the database cannot stem; search for admins; search in revisions of
  pages; search in the deleted pages of a folder, for any role; logging the words of a search; rate limits of searches
  per user or app.
- Not in, of the options of `search-plan.md`: a trigram index on the whole text of the pages, `unaccent`, a language
  that a user chooses or sees, a command that the operator runs to rebuild the index, a BM25 extension and an external
  search engine.

## Design

What the steps build together. A step that proves one of these points wrong updates this file first, as
`step-plan-workflow.md` says.

- The code of search is a feature of its own, `src/features/search/`: the pure modules for the text and the language
  of a page and for the search words, the limits, the service, the queries and the components. The pages service
  imports from it what a write of a page stores.
- A page stores what search needs, next to its content:
  - its search text: the content as plain text, without the title heading, with the text of code blocks, inline code
    and the addresses of links;
  - its search language: the name of a text search configuration of PostgreSQL, detected from the prose of the page,
    or `simple`;
  - the version of the code that derived the two, so that the server knows which pages to derive again;
  - its search vector, which a trigger of the database builds from the title, the name and the search text with the
    configuration of the page.
- A table holds the words of the pages of each folder that are not deleted, each with the number of pages that hold
  it. The same trigger keeps it current in the write of the page. It has a trigram index of `pg_trgm`.
- A search first looks the words of the search up in this table: the words of the folder that start with a search
  word, that contain it, or that are close to it. Then one query matches the pages of the folder through their search
  vectors, with the search words and the words found for them, so that no search compares a word with the whole text
  of every page.
- A match is strong when every word matches exactly, by an inflection or by its start, and weak when a word matches
  only as a part of a word or with a typo. The order of R13 follows from that and from where the words match.
- TypeScript derives the search text and the language, because the language detector is a JavaScript package. The
  database does everything else, so that every write of a page, also one of a test helper or the seed, keeps the
  vector and the words of the folder current.

## Sessions

The plan has two stop points:

- after "Existing pages at the start of the server": every page is indexed and stays indexed, and nothing searches yet;
- after "Search at size": the search service is complete and measured, and nothing in the browser or MCP uses it yet.

## Notes for the wrap-up

What the steps found out that the wrap-up moves into the other specs.

- A migration that stops at the check stays recorded as failed in `_prisma_migrations` (P3018), and
  `prisma migrate deploy` applies nothing more until it is marked with
  `prisma migrate resolve --rolled-back 20261119100000_search_database_check` (P3009); each message of the check names
  that step, also for the container image (`/app/migrate`).
- The init migration creates the schema `public` if it is missing, which needs the right to create objects in the
  database, and that right lets a user create the trusted extension `pg_trgm`. So only an installation from before
  search whose user lost that right later stops for `pg_trgm`; a new installation either passes or stops at the init
  migration.
- The language detector is eld 2.1.1 (Apache-2.0) with its smallest database, `eld/extrasmall`: it tells every sample
  of `src/test/language-samples.ts` apart, and takes about 33 MB of heap once loaded, against about 50 MB for `small`
  and 125 MB for `large`. It is loaded on the first derivation, which takes about 50 ms.
- Prose of fewer than 80 letters gets `simple`: from 60 letters on, no window of any sample was given a wrong
  language, only an unreliable one; below that a short line such as "Notizen. TODO morgen" counted as reliably Dutch.
- Deriving the text and the language of content at the content limit takes at most about 200 ms, for the slow inputs of
  the Markdown parse.
- The vector is built by a row trigger before the write; the words of the folders by statement triggers after it,
  with transition tables: the changes of all rows of a statement, such as the pages deleted with their tab, are summed
  and applied in one ordered statement, because row triggers would lock the words of one page after the other and
  could wait for each other in a circle. Prisma expresses every index, the GIN index on the vector included; only the
  check constraints, the functions and the triggers are written by hand.

## Checklist

- [x] Database check and `pg_trgm`
- [x] Search text and language of a page
- [x] Search index with every write
- [ ] Existing pages at the start of the server
- [ ] Search words
- [ ] Matching and order
- [ ] Pieces of text, limits and log
- [ ] Search at size
- [ ] Results view
- [ ] Search field
- [ ] Search tool for AI apps
- [ ] Wrap-up

## Database check and `pg_trgm`

### Goal

The migrations stop with a message that names the fix on a database that search cannot work on, before anything is
changed, and create `pg_trgm` where they may. Covers R11.

### Build

- A migration of its own, hand-written, that changes no table. It sorts before the migration of the search index, so
  that a database that fails the check gets nothing of search.
- Its first statement checks the database and raises an error with the fix, in this order:
  - the character type is `C` or `POSIX`, whatever the locale provider, or the encoding is not UTF-8: the message asks
    for a database with a UTF-8 locale such as `C.UTF-8` or `en_US.utf8`;
  - `pg_trgm` is not created and the server does not offer it: the message asks the operator to install the contrib
    extensions of PostgreSQL;
  - `pg_trgm` is not created and the database user may not create it: the message says that the operator must create
    `pg_trgm` in the database, or give the user the right to create it.
- Then it creates `pg_trgm` if it is missing. A database where the operator created it before passes without the
  right.
- Find out what a migration that stops this way leaves in the migration history of Prisma, and what the operator has
  to do before the next start, such as `prisma migrate resolve`. The message of the check names that step when one is
  needed.
- `README.md`: what the database has to offer, next to the commands of the development database.

### Test

- Integration, `integration/search-database.test.ts`, against throwaway databases of the test container, with the
  migrations applied as the global setup applies them:
  - a database with the character type `C` stops with the message of the UTF-8 locale; no extension and no table of
    search exists afterwards;
  - a database whose user may not create extensions stops with the message of `pg_trgm`;
  - the same database passes once `pg_trgm` was created for it;
  - the database of the stock image passes and has `pg_trgm`.
- End-to-end: `e2e/smoke.spec.ts`.

## Search text and language of a page

### Goal

Pure code derives what search stores of a page: its search text and its language. Covers the derivation of R8, R17 and
R18.

### Build

- Add the language detector `eld` in its latest stable version. Check its license, and that it knows every language
  of R8. If it lacks one, the scope changes: stop and ask, as `step-plan-workflow.md` says.
- `src/features/search/text.ts`, from the tokens of `src/features/pages/markdown.ts`:
  - the search text: the text of every block without the title heading, the text of code blocks and inline code and
    the addresses of links and images included, blocks apart from each other, and without control characters, so that
    the two marker characters of the pieces of text never occur in it;
  - the prose for the detection: the title and the text without code blocks, inline code and addresses, which lead a
    detector astray.
- `src/features/search/language.ts`:
  - one constant with the configurations of R8: `basque`, `catalan`, `danish`, `dutch`, `english`, `estonian`,
    `finnish`, `french`, `german`, `greek`, `hungarian`, `italian`, `lithuanian`, `norwegian`, `portuguese`,
    `romanian`, `russian`, `serbian`, `spanish`, `swedish` and `turkish`, and `simple`;
  - the detection of the language of the prose, among the European languages the detector knows. Only the detected
    language maps to a configuration, never a neighbour: Polish, Czech and Ukrainian give `simple`. Prose that is too
    short, and a result the detector does not call reliable, give `simple`. The minimum length is measured in this
    step with the texts of the tests.
  - the detector loads on first use, not on import, and is never part of a bundle for the browser.
- Use the smallest database of the detector that passes the tests of this step, and note its memory for the wrap-up.
- `SEARCH_INDEX_VERSION`, counted up with every change of how the text or the language is derived, and one function
  that returns what a write stores of a page: the search text, the language and this version.

### Test

- Unit, `src/features/search/text.test.ts`: a command in a code block, inline code, the address of a link and of a
  bare link are in the search text; the title heading is not; raw HTML stays text; the prose has no code and no
  address; the marker characters are removed.
- Unit, `src/features/search/language.test.ts`: a page in each language of R8 gives its configuration; the pairs that
  are easy to confuse (Danish and Norwegian, Croatian and Serbian, Spanish and Portuguese, German and Dutch) with
  texts of the length of a wiki page; a German page with many code blocks and links gives `german`; a Polish and an
  Irish page and a page of one short line give `simple`; a Ukrainian page does not give `russian`.
- Cost, `src/features/search/text.cost.test.ts`: the text and the language of content at the content limit, prose and
  the slow inputs of `src/features/pages/markdown.cost.test.ts`, are derived within 2 s.
- `src/features/services.test.ts` still passes.
- Manual: after `npm run build`, no chunk for the browser holds the detector.
- No end-to-end spec: nothing that the app runs imports the modules yet.

## Search index with every write

### Goal

Every page that is written has its search text, its language, its vector and its words in the list of its folder, in
the same write. Covers R30 and the base of R5 and R6.

### Build

- `prisma/schema.prisma` and a migration, hand-written where Prisma cannot express it:
  - on `Page`: the search text, the search language with a check constraint on the configurations of the constant, the
    version of the derivation, 0 for a page that was never derived, and the search vector as an unsupported type, so
    that Prisma keeps the column;
  - the table of the words of a folder: the folder, the word and the number of pages, with the folder and the word as
    its key. Its rows are derived data and go with their folder;
  - a GIN index on the vector of the pages that are not deleted, a trigram index on the words, and an index on the
    folder of the pages that are not deleted;
  - indexes in the schema where Prisma can express them, by hand otherwise. `npm run db:migrate` must find the
    database in line with the schema afterwards.
- The trigger on `Page`, at an insert and at an update that changes the title, the name, the search text, the search
  language or the deletion:
  - the vector: the title and the name, with hyphens as spaces, with the highest weight, the search text with the
    lowest, all with the configuration of the page;
  - the words: every word of the title, the name and the search text, as the text search parser of PostgreSQL splits
    them, so that the words of the list and of the vector are the same. A page that is not deleted counts for each of
    its words; a deleted page counts for none; a word that no page holds has no row;
  - an update that changes none of these, such as a move, changes neither the vector nor the words;
  - the words of one write are written in a fixed order, so that two writes in one folder never wait for each other in
    a circle;
  - a vector beyond the limit of PostgreSQL never fails the save: the trigger builds it from a shorter text.
- A page whose search text is not derived yet has no vector and no words until it is derived.
- The pages service stores the search text, the language and the version wherever it stores content: a new page, a
  content save and a revert. A move, a rename, a delete, a restore and the delete of a tab store nothing more: the
  trigger sees them.
- `createPage()` and `createRevisions()` of `e2e/support/database.ts` and `prisma/seed.ts` store the same, like a save,
  with the function of the last step. Check that `emptyTestDatabase()` empties the new table.

### Test

- Unit, `src/features/pages/service-writes.test.ts`: the stored data of a new page, a content save and a revert holds
  the search text, the language and the version of their content.
- Integration, `integration/search-index.test.ts`, through the pages and folders services, reading the vector and the
  words with the client of the test:
  - a new page has its words; a word added to the content joins the list and a removed one leaves it; a new title and
    a rename change the words of the title and the name; a move changes nothing;
  - a word that two pages hold counts twice and stays after one of them is deleted;
  - a deleted page, alone or with its tab, takes its words out; a restore brings them back;
  - a content save without a change writes nothing;
  - writes of pages of one folder at the same time, in rounds with `Promise.all`, end with the right counts and
    without a deadlock;
  - a page at the content limit with many different words and with 3- and 4-byte characters is saved and indexed;
  - a write that fails leaves the vector and the words as they were.
- End-to-end: the specs that write pages, in the browser and through MCP, and `e2e/smoke.spec.ts`.

## Existing pages at the start of the server

### Goal

The pages that exist when search is installed are searchable before the server serves its first request, without a
step of the operator, and again after an update that changes how the text or the language is derived. Covers R29 and
the start of the container of R11.

### Build

- A function of the search service that derives every page whose stored version differs from `SEARCH_INDEX_VERSION`,
  deleted pages included, so that a restore needs nothing more. It works in batches, changes only the search columns
  (not the time of the last change, the last editor or the version of a page), logs how many pages it derived and how
  long it took, and does nothing when no page is left. Two runs at the same time do no harm.
- `scripts/search-index.ts`, which calls it and exits with 0 or 1 like `scripts/admin.ts`, with
  `npm run search:index` for the development machine.
- The image: the script as one bundled file, like the admin setup, with the detector in it; a start script
  `scripts/image-search-index.sh`; `scripts/image-start.sh` runs the migration, the admin setup, the index and then
  the server. When the index fails, the container exits without serving.
- The smoke test of `scripts/image.sh`:
  - a container against a database with the character type `C` does not serve, and its output names the fix;
  - pages that are in the database before a start, with the version 0, are derived after it;
  - a later start and the start script alone change nothing.
- `README.md`: `npm run search:index`, and that it follows `npm run db:migrate` on a database with pages.

### Test

- Integration, in `integration/search-index.test.ts`:
  - pages stored without search columns get their text, language, vector and words, the inflections of their language
    included, and keep their time of the last change, last editor and version;
  - a deleted page is derived and counts for no word;
  - a second run changes nothing and derives no page;
  - after the version of the code changed, every page is derived again, once.
- Manual: `npm run image:build` and `npm run image:smoke` pass.
- End-to-end: the complete suite, because the session ends here.

## Search words

### Goal

One parser reads the words of a search, for the browser and for AI apps, and no input makes it fail. Covers the syntax
of R16 and the counting of R25.

### Build

- `src/features/search/limits.ts` with every number of search in one place: 200 characters, 10 words, 3 letters for
  the start and the parts of a word, 100 results, 5 seconds, 3 searches at a time, and 10 and 25 results for a call
  of the search tool. The later steps add theirs.
- `src/features/search/words.ts`, a pure module without server-only imports:
  - words separated by spaces must all match; words in quotes are a phrase; a word with a leading `-` is excluded;
    `or` between two words or phrases, in any case, means either;
  - a quote without its partner, a `-` alone or before a phrase, `or` at the start, at the end or twice in a row, and
    a search of excluded words only are read as plain words, never as an error;
  - what has no letter and no digit is dropped;
  - a word of 1 or 2 letters is marked to match only as a whole word;
  - the count: each word once, also inside quotes and with a leading `-`; `or` between two words does not count. More
    than 200 characters or 10 words give "too long" instead of a search; no word at all gives "no words".
- The result is a structure of words, phrases, alternatives and exclusions that the service turns into queries. It
  never holds text that reaches a query as syntax.

### Test

- Unit, `src/features/search/words.test.ts`: every example of the acceptance of R16 and R25, among them
  `"backup server" -old or new` as 4 words, 200 characters and 10 words accepted, 201 and 11 refused; quotes, `-` and
  `or` in every odd place; words of 1 and 2 letters; upper and lower case, umlauts and other scripts; a table of
  hostile inputs, such as the operators of a text search query, none of which throws.
- No end-to-end spec: nothing that the app runs imports the module yet.

## Matching and order

### Goal

The search service finds the pages of a folder that match the words and returns the 100 best in the order of R13,
only to an actor who may read the folder. Covers R2, R5, R6, R7, R8, R9, R13, R15, R16, R17, R18, R21 and R30.

### Build

- `searchPages(actor, folderId, input)` in `src/features/search/service.ts`, for the actor of the browser and of MCP:
  - `null` for an admin, without asking the database, and for a folder that the actor may not read, checked with the
    functions of the folder-roles service like every other read;
  - the folder is a required argument of the function that builds the query, and "not deleted" is part of that query,
    so that no search without the two can be written;
  - it takes no tab.
- The words found for each search word of 3 letters or more, from the words of the folder: those that start with it,
  those that contain it, and those close to it by the similarity of `pg_trgm`. The closest ones up to a cap; the cap
  and the threshold of the similarity live in `limits.ts` and are set with the tests of this step and of "Search at
  size". A word of 1 or 2 letters gets none.
- The query of the pages:
  - the query text is built from the parsed words with every word quoted, bound as a parameter with tagged
    `$queryRaw`, never spliced into the SQL;
  - it is parsed with the configuration of each language that the pages of the folder have, one branch per language,
    each for the pages of that language, so that the index is used and an excluded word excludes in every language;
  - the strong form holds each word with the words that start with it, the weak form also those that contain it or
    are close to it.
- The order, decided in the database:
  1. pages whose title is exactly the words of the search, compared without case and surrounding spaces;
  2. pages that match the strong form in their title or name;
  3. pages that match the strong form;
  4. pages that match only the weak form, in their title or name;
  5. pages that match only the weak form.
- Within each of these five: the rank of PostgreSQL that counts how often and how close together the words occur,
  then the time of the last change, newest first, then the id.
- It returns at most the 100 best pages, each with its name, title, tab, time of the last change, last editor and
  channel, and whether more pages match. A window of these 100, by an offset and a number, serves the search tool.
- `src/features/services.test.ts` gets the new service.

### Test

- Unit, `src/features/search/service.test.ts`: an admin and a malformed folder id never reach the database; a
  database error is thrown.
- Integration, `integration/search-service.test.ts`, with pages written through the pages service:
  - the folder and deletion: a word on pages of two folders finds only those of the folder searched; a deleted page
    is never found, a restored one is; pages placed directly in the folder and in every tab are found;
  - every role, Reader to Owner, searches; a user without a role and an admin get `null`; an actor of MCP searches the
    folder of its connection for every role of a connection, and gets `null` for another folder on which the user has
    a role;
  - a word only in the title, only in the name and only in the content finds its page;
  - the order: the exact title first; a title match before a content match; a page found only by a typo after every
    page with the exact words; a page with one exact word and one typo among the typo matches; more occurrences first;
    equal matches newest first;
  - the syntax, with the examples of R16: both words, the phrase, the excluded word, `or`, "konfig" and "kon" find
    "Konfiguration" and "ko" does not, and "Häuser konfiguraton" finds a German page with "Haus" and "Konfiguration";
  - languages: "Häuser" finds a German page with "Haus", "maisons" a French page with "maison"; a German and an
    English page in one search; a German page with many code blocks; an English word on a German page; a Polish and an
    Irish page and a page of one short line by a word and by its start; an excluded word excludes on pages of several
    languages;
  - parts and typos: "bank" finds "Datenbank-Übersicht" in a title and "Datenbank" in a text; "Konfiguraton" finds
    "Konfiguration" in a title and in a text; umlauts match inside a word;
  - code and links: a command only in a code block and a domain only in the address of a link find their page;
  - 150 matching pages give 100 and "more match", 30 give 30 and nothing more;
  - after a write: an added word finds the page with the next search and a removed one no longer does; a renamed page
    is found by its new name and not its old one; a moved page comes back with its new tab.
- No end-to-end spec: nothing that the app runs calls the service yet.

## Pieces of text, limits and log

### Goal

Each result carries a piece of the text of its page, every search is bounded, and every search is logged without its
words. Covers the data of R14, and R22, R24, R25, R28 and R33.

### Build

- The piece of text, only for the pages that are returned:
  - cut by the database from the search text around the match, with the configuration of the page, and marked with
    two control characters that no search text holds;
  - split in the service into parts of plain text, each marked as a match or not; nothing of it is ever HTML;
  - a match by a part of a word or a typo shows the text around the closest word of the page, marked;
  - a page that matches only by its title or its name shows the start of its text without a mark.
- What a search returns besides results, each as a code of its own:
  - "no words" and "too long", from the parser, before anything runs;
  - "too broad": the whole search, all its statements together, is stopped by the database after 5 seconds. The
    transaction of the Prisma client gets a longer time than the database, so that the limit of the database is the
    one that ends it;
  - "busy": at most 3 searches run at the same time in one server process, in the browser and through MCP together.
    A further one is answered at once and runs nothing; it never waits. A slot is freed when its search ends, also
    when it fails or is stopped.
- One log line per search at the level `info`: the user, the channel and through MCP the grant, the folder, the number
  of results, the time it took and the length of the words. A search that was too long, too broad or refused as busy
  is logged with its outcome. No line ever holds a word of a search.

### Test

- Unit, in `src/features/search/`: the parts of a piece of text from marked text; text that looks like HTML stays one
  plain part; the slots with work that the test controls: three run, a fourth is refused at once, a slot is free again
  after a failure; the log line of every outcome holds its fields and no word.
- Integration, in `integration/search-service.test.ts`:
  - "Konfiguraton" returns the text around "Konfiguration", marked; "bank" the text around "Datenbank", marked; a
    page found only by its title the start of its text without a mark; an exact match the text around the word;
  - the marked words are the ones that matched, also for an inflection;
  - a search that waits for a table that a transaction of the test holds is answered as "too broad" after the time
    limit, and the next search works;
  - while three searches wait that way, a fourth is "busy" at once, a read of the pages service answers normally, and
    after one of the three ended the next search runs;
  - 201 characters and 11 words run nothing.
- No end-to-end spec: nothing that the app runs calls the service yet.

## Search at size

### Goal

A search in a folder of 3,000 pages of about 20,000 characters finishes within 2 seconds, with and without a typo or a
part of a word, and a test keeps it so. Covers R32.

### Build

- A Vitest project `integration-cost` for tests against the test database with a wall-clock budget:
  `integration/*.cost.test.ts`, left out of the project `integration`, run with `npm run test:integration:cost`.
  `scripts/check.ts` runs it in `npm run check:all` after the integration tests and the build, alone, like the cost
  tests, and the workflow `integration_tests` runs it as a step of its own. `README.md` and "Running the Checks" in
  `CLAUDE.md` name the command.
- `integration/search-size.cost.test.ts` fills one folder with 3,000 pages of about 20,000 characters, in several
  languages and with the vocabulary of real text: many rare words and few frequent ones. The rows are written in bulk,
  through the trigger.
- The budgets, each a search through the search service:
  - 2 s: a correctly spelled word, a word with a typo, a part of a word, two words, a phrase, and a word that most
    pages hold;
  - 2 s: a search in a folder whose pages have every language of R8;
  - 5 s: a search whose 100 results are pages at the content limit;
  - 1 s: the save of a page at the content limit into the full folder.
- A budget that fails is fixed within the design: the caps, the threshold, the indexes or the query. A fix that changes
  the design changes this file first.
- Add the measured times to the notes for the wrap-up.

### Test

- `npm run test:integration:cost` passes three times in a row on the development machine, each budget with a clear
  margin.
- `npm run check:all` runs the new project last and alone.
- End-to-end: the complete suite, because the session ends here.

## Results view

### Goal

The results of a search are a view of the folder with an address of its own, which shows the results, or why there
are none. Covers R4, R14, R20, R21, R22, R25, R31 and R33 in the browser.

### Build

- `src/lib/addresses.ts`: the address of the results, `/folders/<folder>?view=search&q=<words>`, built by a helper.
- `src/features/folders/folder-query.ts`: the view `search` of a folder address, for every role, with the browser
  title "Search – <folder>".
  - It needs `q` once and not empty; a `q` of spaces only counts as empty.
  - `?view=search` without `q`, with an empty `q` or with `q` twice, and `?view=search` together with an action, show
    the not-found page.
  - `q` without the view `search` shows the not-found page on every address under `/folders` and `/deleted-pages`:
    the folder list, a folder, a tab and a page.
  - A `q` that is too long is no address error: the view shows the message of R25.
- `src/features/search/queries.ts` with the query of the search, as "Queries" in `architecture.md` says.
- The view, a Server Component of `src/features/search/components/`, with the breadcrumb of the folder and "Search":
  - the results as one list, in the order of the service, with no choice of an order or a tab. Each result: the title
    as a link to the page, its tab if it is in one, the piece of text with the matches in `mark` elements, built from
    the parts as React text, the time of the last change, and "by <user> via <channel>" as the other lists show it;
  - no results: "No pages in this folder match <words>", with the words as typed, shown as text, and one line on the
    syntax: all words must match, quotes, `-word` and `or`;
  - more than 100 matching pages: a line that says that more pages match and suggests more precise words;
  - too long: "Search at most 200 characters and 10 words", and no search runs;
  - too broad: a message that the search is too broad and asks for more precise words;
  - busy: "Too many searches are running. Try again in a few seconds."
  - The three messages are alerts at the top of the view, where the search field of the next step comes below them.
- The route of the folder shows the view. A user without a role and an admin get the not-found page as on every
  address of the folder.

### Test

- Unit: `src/features/folders/folder-query.test.ts`, `src/features/pages/page-query.test.ts` and
  `src/lib/addresses.test.ts` for the address and every case of R31; `src/features/search/queries.test.ts`.
- End-to-end, `e2e/search.spec.ts`:
  - the address: a reload shows the same results; back and forward work; another user with a role on the folder sees
    the results; an admin and a user without a role see the not-found page; every case of R31 shows the not-found
    page;
  - a search for the exact title of a page shows the results with that page first, not the page;
  - a result shows its title, tab, piece of text with the marked words, time, last editor and channel, and its link
    opens the page; a page changed through MCP shows "via mcp"; text of a page that looks like HTML is shown as text,
    and no element of it exists in the page;
  - words that find nothing show the message with the words as typed and the hint;
  - 150 matching pages show 100 and the line about more; 30 show 30 and no such line;
  - 201 characters and 11 words in the address show the message and send no search; 200 characters and 10 words are
    searched;
  - while a transaction of the test holds the table of the words of the folders: a search shows "too broad" after the
    time limit; with three searches waiting, a fourth shows the busy message at once and a page of the folder loads
    normally; after the transaction ends, a search works;
  - the browser reports no errors.
- End-to-end, `e2e/access.spec.ts`: the address of the results leads to the login page without a login.

## Search field

### Goal

Every address of a folder, its tabs and its pages offers a search field that opens the results of the whole folder
with Enter. Covers R1, R2, R3, R12, R19 and R23.

### Build

- A Client Component of `src/features/search/components/`: one text field with a label, in a form. It imports its
  values only from modules without server-only imports, as "UI" in `architecture.md` says.
  - Enter opens the address of the results with the words as typed, always, also when they are the title of a page.
  - Enter in an empty field, or one of spaces only, does nothing.
  - Typing sends nothing and shows no list.
  - The field is read-only until the component has hydrated.
  - In the results view it holds the words of the search.
- It is the first row of every view of a folder, a tab and a page without an action: the folder, a tab, a page, the
  results, all pages, the roles, the AI apps, the history, a revision and a comparison of a page.
- It is left out wherever an action is open: the editor of a new page, the edit form and every dialog, the revert
  dialog over a revision included. It is left out under `/deleted-pages`, the history of a deleted page included,
  which shares its components with the history of a page.
- The messages of the results view stand above the field.

### Test

- End-to-end, in `e2e/search.spec.ts`:
  - the field shows on the address of the folder, of a tab, of a page placed directly in the folder and of a page in
    a tab, and on each of their views, for a Reader, a Writer, a Manager and an Owner;
  - it does not show with any action of a folder, a tab and a page, on `/folders`, under `/deleted-pages`, on
    `/users` and on `/account`;
  - typing without Enter sends no request and shows no list; Enter opens the results;
  - Enter in an empty field and in one of spaces only keeps the address and sends no request;
  - the results view of "backup server" holds "backup server" in the field, and changed words with Enter open their
    results;
  - a search started on a page in a tab finds pages placed directly in the folder and in every tab;
  - the scenarios of the requirements: "datenbank konfig" lists "Konfiguration der Datenbank" first, and "Häuser"
    lists the pages that hold "Haus" or "Häuser" with their pieces of text;
  - the messages for too long, too broad and busy stand above the field.
- End-to-end, `e2e/hydration.spec.ts`: the field is read-only with JavaScript disabled.

## Search tool for AI apps

### Goal

An AI app searches the folder of its connection with the tool `search_pages`, for every role of a connection. Covers
R10, R15, R26 and R27, and R22, R25, R28 and R33 through MCP.

### Build

- `src/features/mcp/tool-schemas.ts`, `tools.ts` and `server.ts`: the read tool `search_pages`, registered like
  `list_folder` and `read_page`, so that a connection gets three, seven or eleven tools.
- Input: `query`, a plain string; `limit`, optional, 10 without it; `offset`, optional. The schema refuses no value
  that the tool can answer with a better error. There is no folder and no tab.
- Output, as structured data and as the same data in text:
  - first the field `note` with `USER_TEXT_NOTE`;
  - the results, each with the title, the page name, the tab, the address, the piece of text as plain text without
    marks, the time of the last change, and the last editor with the channel. The name and the tab are what
    `read_page` takes;
  - the offset of the next results, or none, and whether more than 100 pages match.
- Tool errors, none of which holds a title or text of a page: an empty query; a query that is too long, with the same
  limits as the browser; a `limit` above 25, which names 25; an offset beyond the 100 results; a search that is too
  broad, with the advice to use more precise words; "Too many searches are running. Try again in a few seconds."
- The description says that every word must match, how phrases, `-word` and `or` work, and that the app reads the best
  results with `read_page`; it ends with the note. The instructions of every role name the tool.
- The log line of a tool call holds no word of the query; the line of the search service names the grant.

### Test

- Unit, `src/features/mcp/tools.test.ts`: the tools of each role, with `search_pages` for all three; every outcome of
  the service gives its result or its tool error; the note comes first; no log line holds the query.
- End-to-end, `e2e/mcp-search.spec.ts`:
  - a Reader, a Writer and a Manager connection list the tool, and its description ends with the note;
  - it finds pages of its folder and none of another folder on which the user has a role; it never finds a deleted
    page; a result is read with `read_page` by its name and tab;
  - a call without a number returns 10 results; a call for 30 is a tool error that names 25; a second call returns
    results 11 to 20; no call reaches a result past the 100th, and the answer says when more pages match; each result
    holds every field;
  - the result starts with the note; a tool error holds no title and no text of a page;
  - 201 characters and 11 words are tool errors with the limits; a search that is too broad and a fourth search at a
    time are tool errors with the texts of the browser, set up as in `e2e/search.spec.ts`;
  - the scenario of the requirements: a search for "backup" returns the matching pages of the folder.
- End-to-end: the complete suite, because this is the last step that changes more than documentation.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe search as built in a new `spec/search.md`, as "Feature specs" in `step-plan-workflow.md` says, and move the
   rules and decisions of `search-requirements.md` that still hold into it, with the numbers a user or an operator
   relies on and the measured times. Then bring the other specs in line:
   - `content-structure.md`: the view `search` in the list of views of a folder address; the results as the one list
     that shows a piece of the text of each page, in "Lists and order"; "no search" leaves the current limits;
   - `pages.md`: "no search" leaves the current limits;
   - `mcp.md`: three, seven and eleven tools; `search_pages` among the read tools and among the tools whose results
     and descriptions carry the note; "no search tool" leaves the current limits;
   - `container-image.md`: the migrations need `pg_trgm` and a database with a UTF-8 character type, with what the
     migrations do without them and the way out of a stopped migration; the index at the start, with the longer first
     start after the update and after a change of the derivation; the memory of the language detector;
   - `architecture.md`: the feature `search` in the table of the features; "There is no search yet" in "Database"
     becomes how search reads the database; the outcomes of the search read in "Services";
   - `testing.md`: the project `integration-cost`, the integration tests and the end-to-end specs of search, and the
     workflow step;
   - `tech.md`: `pg_trgm` and the language detector;
   - "Checks on the deployment" of `review-report.md`: the reverse proxy keeps the search words, `q` of the results
     address, out of its access log;
   - `search-plan.md` stays as the research behind the decisions: its opening says that search as built is described
     in `search.md`.
2. Remove "Full-text search" and "MCP search tool" from `roadmap.md`; "Semantic search" stays. Add the check of the
   access log of the reverse proxy to "Things to Check".
3. Check that `README.md` has `npm run search:index`, `npm run test:integration:cost` and what the database has to
   offer, and that its summary of what the prototype can do covers search in the browser and through MCP.
4. Delete this step file and `search-requirements.md`. Replace every requirement ID in the comments of the code and
   the tests by the section of `search.md` that holds the rule now, or drop it with its sentence kept.
5. Update the spec catalog in `CLAUDE.md`: add `spec/search.md`, remove this step file and `search-requirements.md`.
   Check whether the entry of `search-plan.md` still names the question the file answers.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass: `npm run check` alone when the step
  changed documentation only; all of them, with the complete end-to-end suite, when item 4 changed a comment in the
  code or the tests.
- No file of `spec/`, `README.md` or `CLAUDE.md` names `search-requirements.md` or this step file any more.
