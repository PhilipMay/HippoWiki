# HippoWiki – Search

Search in one folder as built: users find the pages of a folder whose title they roughly know and the pages that are
about a topic, in the browser and through MCP, in the language each page is written in, by parts of words and with
typos, without anybody choosing a language. The research behind the decisions is `search-plan.md`; folders, tabs and
their addresses are described in `content-structure.md`, the tools of MCP in `mcp.md`.

Code: `src/features/search/`:

- `text.ts`: the search text and the prose of a page;
- `language.ts`: its language;
- `index-data.ts`: what a write stores, with `SEARCH_INDEX_VERSION`;
- `words.ts`: the parser of the search words;
- `query-text.ts`: the queries built from the words;
- `excerpt.ts`: the parts of a piece of text;
- `slots.ts`: the searches at the same time;
- `limits.ts`: every number of search;
- `service.ts`: `searchPages()` and `indexOutdatedPages()`;
- `queries.ts`;
- `components/`: the results view and the search field.

The tool `search_pages` is in `src/features/mcp/`. The database part is in the migrations
`prisma/migrations/20261119100000_search_database_check/` and `prisma/migrations/20261119110000_search_index/`. The
index at the start is `scripts/search-index.ts` and `scripts/image-search-index.sh`.

Tests:

- unit: the tests in `src/features/search/` and `src/features/mcp/tools.test.ts`;
- integration: `integration/search-database.test.ts`, `integration/search-index.test.ts` and
  `integration/search-service.test.ts`;
- cost: `integration/search-size.cost.test.ts`;
- end-to-end: `e2e/search.spec.ts`, `e2e/mcp-search.spec.ts` and `e2e/hydration.spec.ts`;
- the smoke test of the container image.

## Who searches

- Every user with a role on a folder, Reader to Owner, searches the whole folder, because every role reads all pages
  of its folder (see `folder-roles.md`).
- An AI app searches the folder of its connection, for every role of a connection, and no other folder.
- An admin reads no content and gets no search: the not-found page in the browser, without asking the database.
- A user without a role on a folder gets the not-found page and learns nothing about the folder.
- A search covers the whole folder, whichever of its addresses it was started from. It cannot be narrowed to a tab.
- A search finds only the pages of the folder that are not deleted, by their current state, right after every write:
  a new page, a change of the content or the title, a move, a rename and a restore.

## Search field

- The field "Search this folder" is the first row of every view of a folder, of its tabs and of its pages that has
  no action open, for every role:
  - the folder, a tab and a page;
  - the results;
  - all pages, roles and AI apps;
  - the history, a revision and a comparison of a page.
- The field is left out wherever an action is open: the editors and every dialog, the "Revert page" dialog over a
  revision included. A search therefore never discards unsaved work.
- The field is also left out on `/folders`, under `/deleted-pages` and on every other page of the app.
- Enter opens the results with the words as typed, also when they are exactly the title of a page.
- Enter in an empty field, or one of spaces only, does nothing.
- Typing sends nothing and shows no list.
- In the results view the field holds the words of the search.

## Results

- The results are the view `search` of the folder address, `/folders/<folder>?view=search&q=<words>`, built by
  `searchPath()` of `src/lib/addresses.ts`. They can be reloaded, bookmarked, shared and reached with back and
  forward.
- `q` belongs only to this view. The view needs `q` once and with more than spaces. The not-found page is shown for:
  - `?view=search` without `q`, with an empty `q`, with `q` of spaces only or with `q` twice;
  - `?view=search` together with an action;
  - `q` on any other address under `/folders` and `/deleted-pages`.
- Words that are too long are no address error: the view says so.
- The results are one list of at most the 100 best pages, without paging. When more pages match, a line says so and
  suggests more precise words.
- Each result shows:
  - the title of the page, as a link to it;
  - its name and its tab, if it is in one;
  - a short piece of its text around the match, with the matched words marked;
  - the time of its last change;
  - its last editor with the channel, "by <user> via <channel>".
- The piece of text is plain text: text of a page that looks like HTML is shown as text, never as markup.
- A page that matches by a typo or by a part of a word shows the text around the closest word, marked. A page that
  matches only by its title or its name shows the start of its text, unmarked.
- The results are the one list of the wiki that shows a piece of the content of each page; every other list shows
  names and metadata only (see "Lists and order" in `content-structure.md`).
- Words that find nothing show a message that no page of the folder matches them, with the words as typed, and one
  line on the syntax. Words without a letter or a digit, such as `---`, are answered the same way.
- The messages of a search that is too long, too broad or refused as busy stand at the top of the view, above the
  field.

## Search words

One syntax holds in the browser and through MCP (`words.ts`):

- Every word must match, each in its own way: exactly, by an inflection, by its start, as a part of a word or with a
  typo.
- Words in quotes must follow each other as a phrase.
- A word with a leading `-` excludes the pages that hold it, in every language.
- `or` between two words or phrases, in any case, means that either may match.
- Quotes, `-` and `or` in odd places are read as plain words and never cause an error. Examples: a quote without its
  partner, a `-` alone, `or` at the start or twice in a row, and a search of excluded words only.
- What has no letter and no digit is dropped.
- The start, the parts and the typos of a word count from 3 letters (`SEARCH_PART_MIN_LETTERS` in `limits.ts`). A
  word of 1 or 2 letters matches only as a whole word.
- A search has at most 200 characters and 10 words (`SEARCH_MAX_CHARACTERS` and `SEARCH_MAX_WORDS` in `limits.ts`).
  Each word counts once, also inside quotes and with a leading `-`; `or` between two words does not count.
  `"backup server" -old or new` counts as 4 words.
- Longer words are refused with a message that names both limits, and no search runs.
- No text of a search ever reaches the database as syntax: every word goes in as a bound parameter.

## What a page is found by

- A page is found by its title, its name and its content.
- The content is searched as plain text without the title heading. It includes the text of code blocks and inline
  code and the addresses of links and images, so that commands and linked domains are found.
- Parts of words and typos are matched in titles, names and content, against the words that the pages of the folder
  hold, never against the whole text of each page.

## Languages

- Each page has one search language, detected from its prose, never chosen. The prose is the title and the text
  without code, inline code and addresses, which lead a detector astray.
- The languages whose inflections are found are Basque, Catalan, Danish, Dutch, English, Estonian, Finnish, French,
  German, Greek, Hungarian, Italian, Lithuanian, Norwegian, Portuguese, Romanian, Russian, Serbian, Spanish, Swedish
  and Turkish (`SEARCH_LANGUAGES` in `language.ts`). These are the European languages that PostgreSQL stems.
- Example inflections: "Häuser" finds a German page that holds only "Haus", and "maisons" a French page that holds
  only "maison".
- Pages of different languages are found in one search.
- A page in any other language is found by its exact words and the starts of its words, as are a page whose language
  the detector does not call reliable and a page of fewer than 80 letters of prose. Polish, Czech, Ukrainian and Irish
  are examples. Only the detected language is used, never a neighbour: a Ukrainian page does not get Russian.

## Order

The order is decided by the database. A page counts by the weakest match of its words:

1. pages whose title is exactly the words of the search, compared without case and surrounding spaces;
2. pages whose every word matches exactly, by an inflection or by its start, in the title or the name;
3. pages whose every word matches that way anywhere;
4. pages with a word that matches only as a part of a word or with a typo, in the title or the name;
5. the other pages with such a word.

Within each group, the page where the words occur more often and closer together comes first, then the page changed
last, then the id. There is no other order to choose.

## Limits

- A search stops after 5 seconds, all its statements together (`SEARCH_TIME_LIMIT_MS`), and is then answered as too
  broad, with the advice to use more precise words.
- At most 3 searches run at the same time in one server process, in the browser and through MCP together
  (`SEARCH_MAX_RUNNING`). HippoWiki runs one instance, so this holds for the whole wiki. A further search is answered
  at once with a message to try again in a few seconds, and runs nothing; it never waits.
- The other pages of the wiki load normally while searches wait.
- A search in a folder of 3,000 pages of about 20,000 characters finishes within 2 seconds, with and without a typo or
  a part of a word. `integration/search-size.cost.test.ts` keeps it so.
- Measured on the development machine (Mac16,7, Podman machine with 7 CPUs), in a folder of 3,000 pages of about
  20,000 characters, 100 of them at the content limit, in all 22 configurations, with a vocabulary of 200,000 words
  drawn by Zipf's law:

  | Search                                      | Time         |
  | ------------------------------------------- | ------------ |
  | a correct word                              | about 0.43 s |
  | a word with a typo                          | about 0.55 s |
  | a part of a word                            | about 0.38 s |
  | two words                                   | about 0.33 s |
  | a phrase                                    | about 0.57 s |
  | a word that most pages hold                 | about 0.41 s |
  | a search over every language                | about 0.56 s |
  | a search whose 100 results are at the limit | about 0.9 s  |

  A new page at the content limit was stored in about 0.15 s, and a save of new content into it in about 0.09 s.

- Each search is logged in one line at the level `info`, with these fields:
  - the user, the channel and, through MCP, the grant;
  - the folder;
  - the outcome and the number of results;
  - the time it took;
  - the number of characters and words.

  No line ever holds a word of a search, because people search for names and incidents.

- The words stand in the address of the results, so they reach the history of the browser and the access log of a
  reverse proxy. HippoWiki never sends its addresses to other sites. Keeping `q` out of the access log is one of the
  checks of the deployment (see "Things to Check" in `roadmap.md`).

## Search through MCP

The read tool `search_pages` is given to every connection: Reader, Writer and Manager (see "Tools" in `mcp.md`).

- It takes `query`, the words in the syntax above. There is no folder and no tab.
- It returns 10 results without `limit`, at most 25 per call (`SEARCH_TOOL_DEFAULT_RESULTS` and
  `SEARCH_TOOL_MAX_RESULTS` in `limits.ts`), from `offset` on.
- It reaches only the same 100 best results as the browser. The answer gives the offset of the next results, and says
  when more than 100 pages match.
- Each result names:
  - the title;
  - the page name and the tab, which `read_page` takes;
  - the address;
  - the piece of text as plain text without marks;
  - the time of the last change;
  - the last editor with the channel.
- The result starts with the note on text written by users, and the description ends with it (see "Prompt injection"
  in `mcp.md`).
- These are tool errors, with the texts of the browser where the browser has one:
  - an empty query, or one without words;
  - a query that is too long;
  - a `limit` above 25, which names 25;
  - an offset beyond the 100 best results;
  - a search that is too broad;
  - a search beyond the 3 running ones.

  No tool error holds a title or a text of a page.

- The log line of the tool call holds no word of the query. The line of the search names the grant.

## Operation

- The database must have the encoding UTF8 with a UTF-8 character type, such as `C.UTF-8` or `en_US.utf8`, and the
  extension `pg_trgm`. The stock `postgres` image and the development database have both.
- The migrations create `pg_trgm` where the database user may. A database where the operator created it before passes
  without that right.
- The first migration of search only checks the database, before anything of search is created. It stops with a
  message that names the fix in these cases:
  - the character type is `C` or `POSIX`, or the encoding is not UTF8: the message names a UTF-8 locale;
  - the server does not offer `pg_trgm`: the message asks the operator to install the contrib extensions;
  - the user may not create `pg_trgm`: the message says that the operator must create it, or give the user the right.
- A migration that stops this way stays recorded as failed, and no later migration applies until it is marked with
  `prisma migrate resolve --rolled-back 20261119100000_search_database_check`. Every message names that step, also for
  the container image (see "Start and database setup" in `container-image.md`).
- A new installation either passes or stops at the init migration, because that migration needs the right to create
  objects in the database, which is also the right to create the trusted extension `pg_trgm`.
- Every write of a page stores its search text, its language and the version of the derivation in the same write.
  This holds for every write: through the pages service, a test helper or the seed. The database then keeps the
  vector of the page and the words of its folder current.
- The pages stored before search, and every page after an update that changes how the text or the language is
  derived, are derived again before the server serves:
  - `indexOutdatedPages()` derives every page whose stored version differs from `SEARCH_INDEX_VERSION`, deleted pages
    included, so that a restore needs nothing more;
  - it changes neither the time of the last change, nor the last editor, nor the version of a page;
  - it logs how many pages it derived and how long it took;
  - two runs at the same time do no harm.
- On the development machine it is `npm run search:index`, after `npm run db:migrate` on a database with pages. The
  container image runs it at every start (see `container-image.md`).
- The first start after the update of search, and after a change of the derivation, takes longer once; later starts
  read one empty batch.
- The language detector is loaded on the first derivation, which takes about 50 ms, and then holds about 33 MB of
  heap. Deriving the text and the language of content at the content limit takes at most about 200 ms, for the slow
  inputs of the Markdown parse.

## Decisions

**Scope of a search**

- Search works on one folder only, in the browser and through MCP, because a folder is the unit of roles and an MCP
  connection reaches one folder. Rejected: a search over all folders with a role.
- The results cover the whole folder and cannot be narrowed to a tab, which keeps the first version simple. Rejected:
  an optional tab filter in the browser and in the search tool.
- Deleted pages are never searched, for any role. Rejected: a search in the deleted pages of a folder for Managers and
  Owners, which can come later.
- Code and the addresses of links are searched, so that commands and linked domains are found. Rejected: prose only,
  and code without link addresses.

**The search field and the results**

- Search starts with Enter and shows a list of results; there are no suggestions while typing. A known page is found
  because title matches come first.
- Enter always opens the results, also for an exact title, so that pages with the same or a similar title stay
  visible. Rejected: opening the page with that title at once.
- The results have an address of their own, as a view of the folder, so that they can be reloaded, bookmarked and
  shared. Rejected: results without an address.
- The field is shown on every view of the folder, its tabs and its pages, and hidden while an action is open.
  Rejected: the field also during an action, where a search would discard unsaved text.
- Enter in an empty field does nothing, and a search that finds nothing says so with a hint on the syntax. Rejected:
  a view with the hint for an empty field.
- Each result shows what the other lists show, plus a piece of text around the match. Rejected: title and tab only.
- A typo or a part of a word shows the text around the closest word; a match in the title or name alone shows the
  start of the text. Rejected: always the start of the text, and no piece of text.
- One list of at most the 100 best results, without paging: a broader search needs more precise words. Rejected: 20 or
  50 results per page with paging up to 500.

**Order and syntax**

- One order, the best match, with the newest change among equal matches. Pages found only by a typo or a part of a
  word come after all exact matches, so that a near miss never pushes an exact hit down. Within a group, the page
  where the words occur more often and closer together comes first. Rejected:
  - a choice of ordering by the last change;
  - typo matches mixed with exact ones by closeness;
  - the page changed last only.
- Each word of a search may match in its own way, and a page counts by its weakest word, so that "Häuser konfiguraton"
  finds a page with "Haus" and "Konfiguration". Rejected: all words of a search matching in one way.
- One syntax for the browser and AI apps, with phrases, `-word` and `or`, because users expect them from other
  products. Rejected: plain words only, and words with phrases only.
- The start of a word counts from 3 letters, so that a short word does not match a large part of all words.
  Rejected: 2 letters, and any length.
- Each word counts once towards the 10 words, also inside quotes and with a leading `-`; `or` does not count.
  Rejected: a phrase counting as one word, and counting `or`.
- At most 200 characters and 10 words, which bounds the cost of every search. Rejected: 500 characters and 20 words.

**Languages**

- The language of a page is detected, never chosen: a choice in the browser is wrong as soon as someone forgets it.
- Every European language that PostgreSQL can stem gets its inflections, and every other language its exact words and
  word starts. Rejected: German and English only, and five Western European languages.
- The detector is eld (Apache-2.0) with its smallest database, `eld/extrasmall`. It tells every sample of
  `src/test/language-samples.ts` apart and holds about 33 MB of heap, against about 50 MB for `small` and 125 MB for
  `large`. It is a JavaScript package, so TypeScript derives the search text and the language, and the database does
  everything else. Irish is found by exact words and word starts, because the detector does not know Irish. Rejected:
  another detector, which would be a native package of about 100 MB or one without a mature Node.js package.
- Prose of fewer than 80 letters gets the plain configuration. From 60 letters on, no sample window was given a wrong
  language, only an unreliable one; below that, a short line such as "Notizen. TODO morgen" counted as reliably Dutch.

**Parts of words, typos and time**

- Parts of words and typos are matched with `pg_trgm`, a trusted extension of PostgreSQL. They are matched against the
  words of the pages of the folder, which a table keeps current in the same write as the page, and not against the
  whole text of each page:
  - comparing a word with the whole text of each page cost about 6.5 s for every search on 3,000 pages, also one
    without a typo, while the words of the folder took about 1 ms;
  - the list of words shows nothing that a user of the folder could not read, because every role reads every page.

  Rejected: parts of words in the content with typos in titles and names only; titles and names only; and typos
  compared with the whole text, which would make almost every search in such a folder stop as too broad.

- No trigram index on the whole text of the pages, no `unaccent`, no BM25 extension and no external search engine (see
  `search-plan.md`).
- A search in a folder of 3,000 pages finishes within 2 seconds. Rejected: 1 second, and no promised time with the
  time limit alone.
- A search stops after 5 seconds, which bounds the searches that take longer than that promise. Rejected: 2 seconds,
  which would leave no room for larger folders, and 10 seconds of waiting.
- The time limit is `statement_timeout`, set before each statement of the search to what is left of the 5 seconds.
  Rejected: `transaction_timeout` of PostgreSQL 17 and later, which ends the connection.
- At most 3 searches run at the same time, because each search may hold a connection to the database for up to 5
  seconds, and enough broad searches at once would make every page of the wiki wait. A further search is turned away
  at once instead of waiting. Rejected: 2 at a time, which turns searches away more often on a busy wiki, and 5, which
  leaves too few connections for loading pages.

**Search through MCP**

- The search tool returns 10 results by default, at most 25 per call, up to the 100 best results, because every
  result fills the context of the AI app. Rejected: always the 20 best, and all 100 in one call.
- The search tool is named `search_pages`, beside `list_folder` and `read_page`. Rejected: `search`.

**The index in the database**

- The vector of a page is built by a row trigger before the write. The words of the folders are kept by statement
  triggers after it, with transition tables:
  - the changes of all rows of a statement, such as the pages deleted with their tab, are summed and applied in one
    ordered statement;
  - row triggers would lock the words of one page after the other and could wait for each other in a circle.
- Every page is searchable right away, because a page is indexed in the same save. The existing pages are made
  searchable before the server serves, at the first start after the update and after a change of the derivation, so
  that every search is complete from the first request. Rejected: a command that the operator runs after the update,
  and filling the pages in the background while pages not yet done would be found only partly.
- A database with the character type `C` is refused, so that search never runs half broken. Rejected: a warning, and a
  search that finds parts of words and typos with umlauts wrongly.
- A database without `pg_trgm` where the user may not create it stops the migrations with a message that names the
  fix. Rejected: the plain error of the database, which names the missing right but not the fix.
- The piece of text is cut from the search text with a control character in place of every `<`, which the parts get
  back, because `ts_headline()` drops what the parser of PostgreSQL reads as an HTML tag.

**Logging and the address**

- The words of a search are never logged. Rejected: logging them.
- The words stand in the address of the results, so they reach the access log of a reverse proxy and the history of
  the browser. This is accepted, and the checks of the deployment name keeping them out of the access log. Rejected:
  accepting it without a note for operators.

## Current limits

- no search across several folders or the whole wiki
- no suggestions while typing, and no opening of a page directly from the search field
- no narrowing to a tab, no choice of the order, no paging through more than 100 results
- no inflections of Irish and of languages PostgreSQL cannot stem
- no search for admins, no search in revisions of pages or in deleted pages
- no rate limits of searches per user or app, which stay the job of the reverse proxy (see "Rate limits and quotas" in
  `roadmap.md`)
- no semantic search (see "Search" in `roadmap.md`)
