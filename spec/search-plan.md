# HippoWiki – Search Plan

Comparable projects all make the same choice: the search that ships by default lives in the database the product
already has, and a separate search engine is something large installations opt into. Outline, Docmost and the current
Wiki.js all ended up with a weighted `tsvector` column and a GIN index in PostgreSQL. They build their own
`to_tsquery` with prefix matching, use `ILIKE` for what the parser breaks, filter by permission inside the SQL and run
`ts_headline` only on the returned rows. MediaWiki, Confluence, XWiki and Drupal keep Elasticsearch, OpenSearch or Solr
optional, because an external engine brings version lock-in, a sync pipeline and reindex downtime. For HippoWiki the
plan is:

- Full-text search in PostgreSQL 18 with built-in features, plus the trusted contrib extension `pg_trgm` and no other
  extension. `pg_trgm` ships in the stock `postgres` image and on Amazon RDS, and a database user without superuser
  rights can create it. The promise "the migrations need no database extensions" (`spec/container-image.md`) becomes
  "the migrations need `pg_trgm` and no other extension".
- Trigram matching with `pg_trgm` on the title and the name of a page, beside the full-text match. It finds a word
  inside a compound ("bank" finds "Datenbank-Übersicht"), a title with a typo ("Konfiguraton" finds "Konfiguration")
  and a half-typed word whatever the stemmer makes of it. It needs a database whose character type knows UTF-8, such
  as the `en_US.utf8` of the stock image.
- One vector per page, built from the title, the name and the Markdown stripped to plain text. A trigger keeps it up
  to date in the same transaction as the save.
- The language of each page detected automatically at save, in TypeScript with the pure JavaScript detector eld, and
  the page stemmed with the Snowball configuration of that language. PostgreSQL ships one for most European languages;
  the others, and pages too short to detect, fall back to the language-neutral `simple`.
- The query is not detected: one to three words are too short. It is parsed in every language, and each page is
  matched with the query of its own language, in a form that keeps the GIN index.
- The readable folders of the user as a filter of the same query, so that ranking, counts and paging see only pages
  the user may read.
- A `search_pages` MCP tool for every connection role, bound to the folder of the connection and marked like the
  other results that carry page text.

The weak points are language quality and ranking cost. Languages without a Snowball stemmer, such as Polish or Czech,
get no stemming, mixed-language pages are stemmed in their main language only, and a word inside a compound or with
a typo is found in titles and names only, not in the content. Ranking gets expensive when a very common term matches most pages. Both are bounded at
the size of a team wiki, and both have known upgrade paths. Semantic search with pgvector can be added later as a
second ranked list, combined by Reciprocal Rank Fusion, if the search SQL is one module from the start.

This plan is research input to the requirements of search (see `spec/requirements-workflow.md`), not the requirements
themselves. A statement with a link was checked against that source on 2026-11-19. _Inference_ marks a conclusion of
this plan, _Decision_ a choice the user has made for the requirements, and _Gap_ something the research could not
verify.

## Comparable projects keep search inside the database they already run

### PostgreSQL-native wikis settled on a weighted tsvector with GIN

The closest models for HippoWiki are the Node.js and TypeScript wikis on PostgreSQL. **Outline** builds its search as
a `PostgresSearchProvider` behind a provider interface. Database triggers do the indexing, so the provider's index
methods do nothing
([PostgresSearchProvider.ts](https://github.com/outline/outline/blob/main/plugins/search-postgres/server/PostgresSearchProvider.ts)).
It weights the title `A`, previous titles `C` and the text `D`, all with the `english` configuration
([migration](https://github.com/outline/outline/blob/main/server/migrations/20260921120000-tolerate-tsvector-limit-in-document-search-trigger.js)).
In 2026 it moved to a composite GIN index on the team id and the vector through `btree_gin`
([migration](https://github.com/outline/outline/blob/main/server/migrations/20260803143858-add-documents-team-search-vector-index.js)).

**Docmost** fills a `tsv` column by trigger from a separate plain-text column, title `A` and text `B`. Since 2026-11 the
trigger fires only on `UPDATE OF title, text_content` and returns early when neither changed
([migration](https://github.com/docmost/docmost/blob/main/apps/server/src/database/migrations/20261110T200644-search-indexing.ts)).
It added `unaccent` and `pg_trgm`, with an IMMUTABLE wrapper `f_unaccent`, and uses trigram `word_similarity` for
title-only search
([migration](https://github.com/docmost/docmost/blob/main/apps/server/src/database/migrations/20250729T213756-add-unaccent-pg_trm-update-tsvector..ts),
[search.service.ts](https://github.com/docmost/docmost/blob/main/apps/server/src/core/search/search.service.ts)).

**Wiki.js** went the furthest. Version 2 offered nine pluggable search modules, Elasticsearch, Algolia and Solr among
them ([modules](https://github.com/requarks/wiki/tree/v2.5.307/server/modules/search)). The current default branch
dropped the modules for a `ts` column on the pages table, a dictionary per locale and `pg_trgm` indexes on title and
path for as-you-type suggestions ([search spec](https://github.com/requarks/wiki/blob/scarlett/dev/specs/search.md),
[search.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/search.ts)). _Gap_: which branch ships as the
next major version was not verified. Its code is described in detail in "Wiki.js in detail" below.

Other projects show the variety and its failure modes. **Discourse** keeps separate `*_search_data` tables with a
versioned reindex
([search_indexer.rb](https://github.com/discourse/discourse/blob/main/app/services/search_indexer.rb)).
**GitLab** stores weighted vectors in side tables written after the commit
([pg_full_text_searchable.rb](https://gitlab.com/gitlab-org/gitlab/-/blob/master/app/models/concerns/pg_full_text_searchable.rb)).
**Mattermost** uses expression indexes that need no upkeep code
([migration](https://github.com/mattermost/mattermost/blob/master/server/channels/db/migrations/postgres/000020_create_posts.up.sql)).
**BookStack** writes its own term-score table in PHP and prefix-matches it with `LIKE`
([SearchIndex.php](https://github.com/BookStackApp/BookStack/blob/development/app/Search/SearchIndex.php)). **Memos**
and **Trilium** have no index at all
([render.go](https://github.com/usememos/memos/blob/main/filter/render.go),
[note_content_fulltext.ts](https://github.com/TriliumNext/Trilium/blob/main/packages/trilium-core/src/services/search/expressions/note_content_fulltext.ts)).

### Engine-based systems keep the engine optional and pay for it in operations

Every mature engine-based system still ships a default that needs no extra service:

- **MediaWiki** has a database search table, or `tsvector` columns on PostgreSQL
  ([Manual:Searchindex table](https://www.mediawiki.org/wiki/Manual:Searchindex_table)).
- **Confluence Data Center** has embedded Lucene, with OpenSearch opt-in since 9.0
  ([Configuring OpenSearch](https://confluence.atlassian.com/doc/configuring-opensearch-for-confluence-1387594125.html)).
- **XWiki** has embedded Solr, with a remote one opt-in
  ([Solr Search API](https://extensions.xwiki.org/xwiki/bin/view/Extension/Solr%20Search%20API)).
- **Drupal** has a database backend next to the recommended Solr
  ([Search API backends](https://www.drupal.org/docs/8/modules/search-api/getting-started/server-backends-and-features)).

The costs of the engine are documented in detail:

- CirrusSearch must match exact Elasticsearch or OpenSearch versions per MediaWiki release
  ([Extension:CirrusSearch](https://www.mediawiki.org/wiki/Extension:CirrusSearch)).
- Wikimedia rebuilt an eight-year-old update pipeline on Kafka and Flink to keep the update lag bounded
  ([T317045](https://phabricator.wikimedia.org/T317045)).
- XWiki reindexes thousands of documents after a restart
  ([forum](https://forum.xwiki.org/t/why-and-what-is-xwiki-indexing-after-a-a-fresh-boot/11441)).
- Search on a Confluence node is unavailable during a Lucene site reindex
  ([Content Index Administration](https://confluence.atlassian.com/doc/content-index-administration-148844.html)).
- Notion's old reindexer took weeks and reached only about 90% consistency
  ([Notion blog](https://www.notion.com/blog/rebuilding-notions-lexical-search-reindexer)).

A 2026 Drupal proposal puts the dilemma in one sentence: the database backend is easy to run but ranks poorly, while
Solr ranks well but is another service to install, secure, monitor and upgrade
([drupal.org 3617860](https://www.drupal.org/i/3617860)).

Client-side indexes do not fit a wiki with permissions. Ghost's built-in search loads content through a public Content
API key into FlexSearch in the browser, so anything indexed is effectively public
([Ghost changelog](https://forum.ghost.org/t/native-search-ghost-changelog/31303)). VitePress uses an in-browser
MiniSearch index ([VitePress](https://vitepress.dev/reference/default-theme-search)).

### Comparison

| Project       | Default search           | Index upkeep            | Language          | Permission filter    |
| ------------- | ------------------------ | ----------------------- | ----------------- | -------------------- |
| Outline       | tsvector, provider class | trigger, overflow retry | english           | readable ids in SQL  |
| Docmost       | tsvector, pg_trgm titles | trigger on text change  | english, unaccent | SQL, then post-check |
| Wiki.js       | tsvector, pg_trgm hints  | app code, rebuild task  | per locale        | app code, pre-paging |
| Discourse     | tsvector side tables     | app code, versioned     | one per site      | in the SQL           |
| BookStack     | own term-score table     | app code, chunked       | no stemming       | permitted base query |
| GitLab        | ILIKE; OpenSearch opt-in | after the commit        | english           | in the query         |
| Mattermost    | expression GIN index     | none needed             | english           | membership subquery  |
| MediaWiki     | DB table; CirrusSearch   | on save; job queue      | one per wiki      | wikis mostly public  |
| Confluence DC | Lucene; OpenSearch       | index queue, rebuild UI | _Gap_             | copied into index    |
| XWiki         | Solr; remote opt-in      | queue, check after boot | _Gap_             | _Gap_                |
| Drupal        | DB backend; Solr         | _Gap_                   | per backend       | indexed state        |
| Notion        | Elasticsearch, vectors   | online plus reindex     | _Gap_             | resolved at indexing |

Wiki.js is its current default branch. Sources for the table are the links above and in "Sources". The Drupal access
note comes from [drupal.org 1130806](https://www.drupal.org/project/search_api/issues/1130806), the Confluence one
from
[Page Restrictions Performance Considerations](https://support.atlassian.com/confluence/kb/page-restrictions-performance-considerations/).

### Lessons that come back across projects

- The 1 MB `tsvector` limit blocks saves. Outline catches `program_limit_exceeded` and retries with half the text, and
  long Chinese documents still fail ([outline#14645](https://github.com/outline/outline/issues/14645)). GitLab writes
  the vector outside the save transaction, so a page that is too long only loses its search data.
- Raw input passed to `to_tsquery` causes syntax errors and 500 answers
  ([mattermost#25660](https://github.com/mattermost/mattermost/issues/25660)).
- The text search configuration of the index expression and of the query must be identical, or the index is not used
  ([mattermost#22249](https://github.com/mattermost/mattermost/issues/22249)).
- Prefix matching on top of stemming surprises users: "offic" finds a page that "office" does not, and "Apple" finds
  "applications" ([docmost#1293](https://github.com/docmost/docmost/issues/1293),
  [docmost#2093](https://github.com/docmost/docmost/issues/2093)).
- `ts_headline` is slow on long text, and its output is not safe HTML. Discourse cuts its input to 2,500 characters and
  had to fix an XSS in it in 2026 ([search.rb](https://github.com/discourse/discourse/blob/main/lib/search.rb),
  [discourse#45770](https://github.com/discourse/discourse/pull/45770)).
- Checking permissions after the `LIMIT` leaves pages of results short or empty, and the totals count hidden pages.
  Wiki.js moved to "decide before paging" for this reason
  ([search.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/search.ts)).
- Term-prefix designs miss infix matches: in BookStack "boarding" does not find "onboarding"
  ([BookStack#5658](https://github.com/BookStackApp/BookStack/issues/5658)).

### Wiki.js in detail

Wiki.js is the closest model in features: a wiki in TypeScript on PostgreSQL, with a search page, suggestions while
typing, permissions per page and an MCP server. This section is read from a local fork of its `scarlett` branch at
commit 2d182b18 of 2026-11-12. The links go to the same files upstream, which may have moved on since. The search
lives in [search.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/search.ts), the query parser in
[searchQuery.ts](https://github.com/requarks/wiki/blob/scarlett/backend/helpers/searchQuery.ts) and the design of the
suggestions in the [search spec](https://github.com/requarks/wiki/blob/scarlett/dev/specs/search.md).

Data and upkeep:

- The pages table has a `ts` column of type `tsvector` with a GIN index (`pages_ts_idx`), and a `searchContent` text
  column with the page as plain text
  ([schema.ts](https://github.com/requarks/wiki/blob/scarlett/backend/db/schema.ts)).
- The Markdown is rendered in the browser. The server sanitizes the HTML it receives and extracts the plain text from
  it, without scripts and styles and with a space after each SVG `text` element
  ([rendering.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/rendering.ts)).
- The vector is `setweight(title, 'A') || setweight(description, 'B') || setweight(searchContent, 'C')`, built with
  the dictionary of the page's locale.
- Application code writes it, not a trigger: `indexPage` runs after each create, update, move, restore and re-render
  of a page, as an `UPDATE` of its own after the save
  ([pages.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/pages.ts)). It never throws: a failure is
  logged as a warning, "the next rebuild puts it right". A page whose vector fails, for example at the 1 MB limit,
  keeps its old vector until then. _Inference_.
- A rebuild task recomputes every vector, one `UPDATE` per locale. It runs over all pages, the unsearchable ones too,
  so that making a page searchable again needs no reindex
  ([rebuild-search-index.ts](https://github.com/requarks/wiki/blob/scarlett/backend/tasks/simple/rebuild-search-index.ts)).
- `pg_trgm` and `ltree` are required extensions, created at startup
  ([db.ts](https://github.com/requarks/wiki/blob/scarlett/backend/core/db.ts)).

Language:

- `DEFAULT_DICTIONARIES` maps 29 languages to their Snowball configuration (`de` to `german`, `en` to `english`), and
  `simple` is the fallback. An admin can override the mapping per language or per regional locale.
- The configurations the server really has are read from `pg_ts_config` as `oid::regconfig::text`, so that a name in
  another schema, such as one for a Chinese parser in `public`, resolves. A mapping that is not installed falls back
  to `simple` with a warning.
- The query is parsed with the dictionary of each row: the first argument of `to_tsquery` is a `CASE p.locale`
  expression with one arm per searched locale, such as `WHEN 'de' THEN 'german'::regconfig`, and `simple` in its
  `ELSE`. A search over several locales therefore stems an English page as English and a German page as German. The
  name is bound as a parameter and cast to `regconfig`, never spliced into the SQL.
- A query that depends on the row cannot use the GIN index. In a test on PostgreSQL 18.6 this form ran as a
  sequential scan over every page (see "Querying all languages at once, measured").

Query:

- The parser turns the search box syntax into `to_tsquery` text: words are ANDed, `-` or `!` at the start of a term
  negates it, `foo*` is a prefix, `,`, `|` and `or` mean OR and bind tighter than AND, and quotes are a phrase.
- Every operand goes in as a quoted string, so the dictionary still stems it and drops stop words, but "nothing typed
  can reach the tsquery syntax". An operand without a letter or digit is dropped, and an empty result matches nothing.
  The code says it exists because `websearch_to_tsquery` "has no prefix operator".
- The REST route accepts a query of up to 2,048 characters
  ([pages.ts API](https://github.com/requarks/wiki/blob/scarlett/backend/api/pages.ts)).

Ranking, filters and paging:

- The rank is `ts_rank` with the default weights, ties broken by the time of the last update. Other orders are id,
  path, title, created and updated, ascending or descending.
- Filters: a path prefix (`LIKE` with the wildcards escaped), locales, tags with all or any, editor, publish state,
  creator and last editor. Without a query the same function lists the pages that match the filters, newest first, so
  a search for tags only is a browse.
- `isSearchable = false` keeps a page out for everyone; redirects are never searchable. Pages that are not published
  are listed only to someone who may write or manage pages.
- A password-protected page is matched and ranked only on its title and description, `ts_filter(ts, '{a,b}')`, and
  gets no excerpt, for every searcher. Otherwise a search for a phrase would confirm that the phrase is behind the
  password.

Permissions:

- Page rules can be regular expressions or tag sets, so Wiki.js says they cannot go into the `WHERE`. For everyone but
  `manage:system` the first query therefore ranks every match without a `LIMIT`, reading only the columns a rule needs.
  The rows are filtered in TypeScript, then sliced for the page. The total is the number of readable matches.
- A second query fetches the full rows, and the excerpt, for the ids of that page only, by `id = ANY($1)`, and
  restores the order of the first.
- An admin with `manage:system` gets the database's own `LIMIT`, `OFFSET` and `COUNT(*) OVER()`.
- _Inference_: the cost of a search grows with the number of matches, not with the page size. A common word in a large
  wiki ranks and transfers every matching row on each request. Wiki.js accepts this to keep pages full and totals
  free of hidden pages.

Excerpts:

- `ts_headline` with `MaxWords=25, MinWords=10, MaxFragments=1` runs over the whole `searchContent`, only for the rows
  of the page, and only when "term highlighting" is switched on in the search settings; it is off by default.
- The markers are the control characters U+0002 and U+0003. The excerpt is HTML-escaped first and only then are the
  markers turned into `<b>`, so page text that reads `<script>` cannot come back as markup. The search page shows it
  with `v-html` ([Search.vue](https://github.com/requarks/wiki/blob/scarlett/frontend/src/pages/Search.vue)).

Suggestions while typing:

- A separate route answers on each keystroke from titles and paths only, never from the text: every word must occur in
  the title (`ILIKE`) or the path (`LIKE`), in any order, with the LIKE wildcards escaped. GIN trigram indexes on both
  columns answer the `%word%` patterns.
- Only the first 8 words count, the query is at most 255 characters, the limit is 1 to 20 with a default of 8, and
  only the reader's locale is searched.
- The rank has six tiers: the whole phrase is the title or the path, the title starts with it, a word of the title
  starts with it, the title contains it, the title contains every word, and a match only in the path. Ties go to the
  shorter title.
- The same per-page check applies, but to at most 200 candidates in rank order, stopping once enough pass. A reader
  who may open little of a large wiki can get fewer suggestions than exist, which the API states.
- The header search box asks nothing under 2 characters, debounces 150 ms, aborts the request in flight, keeps the
  previous list while the next loads, and treats Enter on keydown and not during IME composition. It is an ARIA
  `combobox` with a `listbox` of `option`s, and its rows are real links.
- Word completion is designed and not built: one vocabulary per distinct set of groups, of display words built with
  `simple`, and only words found on at least about 3 pages, so that rare words, the most telling ones, do not leak.

MCP:

- The `search_pages` tool calls the same search function as the REST route, as the caller, so the same rules apply
  ([discover.ts](https://github.com/requarks/wiki/blob/scarlett/backend/mcp/tools/discover.ts)).
- Input: `query` (at most 500 characters), `path`, `tags`, `tagsMatch`, `locales`, `limit` (1 to 25, default 10, "below
  what the REST API allows: every result lands in a context window") and `offset` (at most 10,000). It is marked
  read-only and idempotent.
- Output: `totalHits`, the results with the page fields and a `snippet` in which the `<b>` markers become Markdown
  `**`, and `nextOffset` while more results exist.
- The description tells the AI app to search first, to open promising pages with `get_page` "rather than answering
  from snippets", and to cite pages by their `url`. `recent_changes` lists the readable pages by the same function
  without a query.

What HippoWiki can take from it, _Inference_:

- The parser fits HippoWiki as it is; this plan already recommends one in its style.
- The second query for the rows of the page, with the excerpt, keeps `ts_headline` off every row that is not shown.
- The mapping from a language to its configuration, the check against `pg_ts_config` and the fallback to `simple`
  are a worked pattern for a language per page. The `CASE` inside `to_tsquery` is not: HippoWiki needs a form that
  keeps the index (see "Several European languages, detected automatically").
- The permission filter in TypeScript is not needed: the readable folders of a HippoWiki user are a plain list of
  folder ids, so paging and totals can stay in the database for every user.
- Weights give `ts_filter` a second use: the title part of one vector, as this plan proposes for quick search. The GIN
  index still finds the candidates on the whole vector, and `ts_filter` rechecks them.
- An index written after the save, never failing it, is the opposite of the trigger this plan proposes. The choice
  between a stale vector and a refused save is open in the requirements.
- Suggestions by title and path with `ILIKE` and trigram indexes are what `pg_trgm` gives HippoWiki too (see
  "pg_trgm on titles and names, unaccent stays out").
- The MCP tool is a template for `search_pages` in HippoWiki: a lower limit than the browser, `nextOffset`, Markdown
  bold in the snippet, and a description that sends the AI app to the page instead of the snippet.

## Built-in full-text search covers most of the baseline

### The vector, its upkeep and Prisma

The documented pattern is a stored `tsvector` column with a GIN index. An index on an expression is used only when
the query repeats the same expression with an explicit configuration, so a stored column is easier to query
([PG docs: Tables and Indexes](https://www.postgresql.org/docs/current/textsearch-tables.html)). Three ways keep the
column up to date:

- A generated column is declarative, but it cannot catch an overflow error. An overlong vector would then make the
  page impossible to save (_Inference_).
- A trigger can skip writes that leave the text unchanged and can catch overflow errors (the Docmost and Outline
  patterns).
- Application code after the commit (GitLab) never fails a save, but it can leave a page without search data.

HippoWiki already keeps triggers as hand-written SQL at the end of its init migration (`spec/architecture.md`), so a
trigger fits the project.

Prisma adds friction:

- Prisma 4 produced an invalid migration for a generated column on an `Unsupported(...)` field. The workarounds are
  `Unsupported("tsvector")` without a default, or a trigger instead of the generated column
  ([prisma#14799](https://github.com/prisma/prisma/issues/14799)).
- Prisma can drop columns and indexes that its schema does not know
  ([prisma#24180](https://github.com/prisma/prisma/issues/24180)).
- Columns of an unsupported type cannot be read through the client, only through raw queries.
- TypedSQL needs a live database at `prisma generate` time
  ([Prisma TypedSQL](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/typedsql)). That would add a database
  to the build.

_Gap_: whether Prisma 7.10, the installed version, still has the drift problem of generated columns was not checked.

_Inference_: declare `searchVector Unsupported("tsvector")?` on `Page` in `prisma/schema.prisma`, so that Prisma knows
the column and keeps it. Write the GIN index and the trigger by hand in the migration. Query with tagged `$queryRaw`
and `Prisma.sql`, never with `$queryRawUnsafe`.

### Weights and ranking stay cheap at the size of a team wiki

- `ts_rank` takes its weights in the order `{D, C, B, A}`, by default `{0.1, 0.2, 0.4, 1.0}`. A title hit at `A`
  therefore scores ten times a body hit at `D`
  ([PG docs: Controlling Text Search](https://www.postgresql.org/docs/current/textsearch-controls.html)).
- `ts_rank_cd` also rewards proximity. The normalization flag 32 only rescales the score and does not change the order.
- The documentation warns that ranking "requires consulting the tsvector of each matching document, which can be I/O
  bound and therefore slow".
- Field reports from 2011 and 2012 measured about 140 ranked documents per second, with up to 700 MB read from TOAST
  per query, on indexes of 200k to 1M documents
  ([pgsql-general](https://postgresql.org/message-id/CAG3yVS7Gdzzgr5%2B5z9Hq0X-YTLto5%2BFrcg_hrqDyg2Vm01Ob3w%40mail.gmail.com),
  [Bartunov](https://www.postgresql.org/message-id/Pine.LNX.4.64.1107130023480.17363%40sn.sai.msu.ru)).
- _Gap_: no recent benchmark on PostgreSQL 16 to 18 was found.

Projects mix the text rank with signals of their own:

- Outline multiplies it by a logarithm of popularity and breaks ties by `updatedAt`
  ([PostgresSearchProvider.ts](https://github.com/outline/outline/blob/main/plugins/search-postgres/server/PostgresSearchProvider.ts)).
- Discourse adds an exact-title boost and category priorities
  ([search.rb](https://github.com/discourse/discourse/blob/main/lib/search.rb)).
- CirrusSearch boosts words that appear in the query's order and offers a recency boost
  ([Help:CirrusSearch](https://www.mediawiki.org/wiki/Help:CirrusSearch)).

_Inference_: HippoWiki limits content to 100,000 characters (`CONTENT_MAX_LENGTH` in `src/features/pages/limits.ts`),
and its candidate set is already cut down to the folders of one user. That keeps ranking cheap for thousands to tens
of thousands of pages. A cap on candidates before ranking and a statement timeout bound the worst case of a term that
matches almost every page. An exact-title boost and the time of the last change as a tie-breaker are enough. Link
signals become possible once wiki links and backlinks exist (`spec/roadmap.md`).

### Build the tsquery yourself, with every operand quoted

PostgreSQL offers four ways to turn input into a query
([PG docs](https://www.postgresql.org/docs/current/textsearch-controls.html)):

- `to_tsquery` raises errors on raw input.
- `plainto_tsquery` drops all operators.
- `phraseto_tsquery` joins the words with `<->`.
- `websearch_to_tsquery` maps quotes to `<->`, `or` to `|` and `-` to `!`, and never raises an error. It has no
  prefix operator.

The projects therefore build the query string themselves. Outline and Docmost use the `pg-tsquery` package and append
a `*` for a prefix match. Outline turns quoted phrases, URLs and identifiers into `ILIKE`, retries a query that found
nothing as a phrase, and detects queries made only of stop words with `numnode`
([PostgresSearchProvider.ts](https://github.com/outline/outline/blob/main/plugins/search-postgres/server/PostgresSearchProvider.ts)).
The current Wiki.js has a small parser of its own: AND by default, `-` and `!` for NOT, `*` for a prefix, `,`, `|` or
`or` for OR, and quotes for phrases. Every operand is passed as a quoted string, so that "nothing typed can reach the
tsquery syntax" ([searchQuery.ts](https://github.com/requarks/wiki/blob/scarlett/backend/helpers/searchQuery.ts)).

_Inference_: a parser in the style of Wiki.js, of about a hundred lines with unit tests, gives HippoWiki prefix
matching for search as you type and keeps every input away from the tsquery syntax. The alternative,
`websearch_to_tsquery` for the results page and a prefix query only for quick search, gives two syntaxes that behave
differently.

### Prefix, phrases and the hard limits of tsvector

The limits of PostgreSQL are:

- a lexeme is shorter than 2 KB
- a lexeme has at most 256 positions
- positions are clamped at 16,383
- a vector and a query are each smaller than 1 MB
- the distance of `<N>` is at most 16,384

([PG docs: Limitations](https://www.postgresql.org/docs/current/textsearch-limitations.html))

The same `to_tsquery` can limit a term to a weight and a prefix, such as `'supern:*A'`. Quick search on titles can
therefore use the same GIN index as full search, without `pg_trgm` (_Inference_ from the documented syntax).

_Inference_ on HippoWiki's limits:

- With one configuration, 100,000 characters can hold at most about 50,000 tokens. Their lexemes, positions and entry
  headers stay in the order of several hundred KB, below 1 MB.
- A vector joined from several configurations (see "Language") can pass 1 MB. The recommended design has one
  configuration per page, plus `simple` for the short title and name only, so it stays near the single size. The
  trigger therefore needs a guard either way, and a cost test should use hostile content: many unique tokens and 3-
  and 4-byte characters.
- A page near the length limit has about 15,000 words, close to the position clamp, so phrase matches near its end
  get less exact.
- A prefix of one or two characters expands to a large part of the vocabulary. A minimum prefix length bounds the
  cost.

### Snippets: ts_headline on the result page only, behind sentinel markers

`ts_headline` works on the original document, "can be slow", and its output is "not guaranteed to be safe for direct
inclusion in web pages" ([PG docs](https://www.postgresql.org/docs/current/textsearch-controls.html)). The projects
handle this in three ways:

- Docmost and Wiki.js compute it only for the rows of the result page, in a second step: Docmost over the first
  100,000 characters of its plain text, Wiki.js with its own start and stop markers
  ([search.service.ts](https://github.com/docmost/docmost/blob/main/apps/server/src/core/search/search.service.ts),
  [search.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/search.ts)).
- Outline skips `ts_headline` and cuts about 250 characters of plain text around the first match in TypeScript. Its
  client turns the matches into React `<mark>` elements without `dangerouslySetInnerHTML`
  ([PostgresSearchProvider.ts](https://github.com/outline/outline/blob/main/plugins/search-postgres/server/PostgresSearchProvider.ts),
  [Highlight.tsx](https://github.com/outline/outline/blob/main/app/components/Highlight.tsx)).
- GitHub returns a fragment and the offsets of its matches, not HTML
  ([GitHub REST: Search](https://docs.github.com/en/rest/search/search)).

_Inference_ for HippoWiki, where raw HTML in Markdown is shown as text (`spec/pages.md`), so the plain text can contain
`<script>` literally:

- Run `ts_headline` over the stored plain text, only for the page of results.
- Use two private-use characters as `StartSel` and `StopSel`, removed from the text before it is indexed, so that page
  text can never fake a highlight.
- Split the result on the server into a list of `{ text, match }` parts, and render it as React text nodes and
  `<mark>`.

Outline also hides the snippet when the query already matches the title, which is a cheap gain in clarity.

### Language: what the projects do

What the projects do:

- Outline, Docmost, Mattermost and GitLab hard-code `english`.
- Discourse picks one configuration per site and segments Chinese and Japanese in Ruby
  ([search.rb](https://github.com/discourse/discourse/blob/main/lib/search.rb)).
- The current Wiki.js maps about 30 locales to Snowball configurations. It checks `pg_ts_config` for the ones the
  server actually has and falls back to `simple`, which "indexes words without stemming — still searchable"
  ([search.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/search.ts)).

PostgreSQL supports a configuration per row through a `regconfig` column in the index expression
([PG docs: Tables and Indexes](https://www.postgresql.org/docs/current/textsearch-tables.html)). Splitting German
compounds needs Ispell or Hunspell files in `$SHAREDIR/tsearch_data`. "The standard PostgreSQL distribution does not
include any Ispell configuration files", and PostgreSQL implements only basic compound operations
([PG docs: Dictionaries](https://www.postgresql.org/docs/current/textsearch-dictionaries.html)). Users report that the
German splitting is inconsistent
([pgsql-general](https://www.postgresql.org/message-id/5566F66C.3070701%40tbz-pariv.de)).
Even Wikimedia's German analyzer has edge cases with folding: "Maße" matches "Masse"
([T281379](https://phabricator.wikimedia.org/T281379)).

_Inference_, the options for HippoWiki, where one folder can mix pages in several languages and one page can mix
them:

- `simple` alone is language-neutral, predictable with prefix matching, and does not have the stemming surprises of
  Docmost. "Haus" finds "Hausbau" and "Hauses" by prefix, but not "Häuser". "bank" does not find "Datenbank". Stop
  words stay in the index.
- `simple` joined with `german` and `english` puts three vectors in one column, queried with the OR of the three
  queries. The cost is about three times the index, and a `-word` exclusion leaks across the languages (see the next
  section).
- A language per folder or page chosen by the user is exact for single-language folders, but needs a setting in the
  browser and is wrong as soon as someone forgets it.
- A language per page, detected automatically at save, needs no setting and stems every page with its own language.
  This is the recommendation; the next section describes it.
- `pg_trgm` on title and name gives infix and typo-tolerant matching for compounds. It is the one extension chosen
  (see "pg_trgm on titles and names, unaccent stays out").

### Several European languages, detected automatically

The goal: pages in any European language are found with the stemming of their own language ("Häuser" finds "Haus",
"maisons" finds "maison"), without anybody choosing a language, and one search box finds pages of all languages.

#### Which languages PostgreSQL can stem

The Snowball configurations PostgreSQL ships decide which languages are worth detecting at all. PostgreSQL 18.6 (the
`postgres:18.6` image, listed from `pg_ts_config` on 2026-11-19) has these European ones: `basque`, `catalan`,
`danish`, `dutch`, `english`, `estonian`, `finnish`, `french`, `german`, `greek`, `hungarian`, `irish`, `italian`,
`lithuanian`, `norwegian`, `portuguese`, `romanian`, `russian`, `serbian`, `spanish`, `swedish` and `turkish`, plus
`armenian` and `yiddish`. `estonian` is new in PostgreSQL 18, and the development branch adds `polish`
([snowball_create.pl REL_18](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/snowball/snowball_create.pl),
[master](https://raw.githubusercontent.com/postgres/postgres/master/src/backend/snowball/snowball_create.pl)).

There is no built-in stemmer for Polish (before PostgreSQL 19), Czech, Slovak, Slovenian, Croatian, Bosnian,
Bulgarian, Ukrainian, Belarusian, Latvian, Icelandic, Galician, Albanian or Macedonian. Pages in these languages are
indexed with `simple`: found by their exact words and by prefix, without stemming. _Inference_:

- Detection is still worth it for these languages: it keeps a Polish or Czech page away from a wrong stemmer, and the
  stored language can switch to `polish` once PostgreSQL 19 is the minimum.
- A confusion between two languages that both map to `simple`, such as Czech and Slovak, costs nothing. Serbian is the
  exception: it has a stemmer, Croatian and Bosnian do not, and the detector confuses them easily. A Croatian page
  stemmed as Serbian is probably still better than `simple`, since the languages are close, but that needs a test.
- Ukrainian must not fall to `russian`. Only the detected language maps to a configuration, never a neighbour.

#### Detecting the language of a page in Node.js

The candidates, from their repositories and published benchmarks (notes in the research of 2026-11-19):

| Library                | Version, date     | License    | Languages | Runtime                | Notes                                         |
| ---------------------- | ----------------- | ---------- | --------- | ---------------------- | --------------------------------------------- |
| eld                    | 2.1.1, 2026-11-05 | Apache-2.0 | 60        | pure JS, ESM, types    | subset filter, `isReliable()`, 37–138 MB RAM  |
| franc / franc-min      | 6.2.0, 2024-01    | MIT        | 82–414    | pure JS, ESM, types    | `only`, `minLength`; weak on short text       |
| tinyld                 | 1.3.4, 2023-05    | MIT        | 64        | pure JS                | unmaintained, no Slovenian or Croatian        |
| lande                  | 1.0.10, 2023-01   | MIT        | 50        | pure JS, ESM, types    | no published accuracy                         |
| CLD3 (cld3-asm)        | 4.0.0, 2023-12    | MIT        | about 101 | WASM                   | upstream archived in 2024; 140 bytes minimum  |
| CLD2 (`cld`)           | 2.10.1, 2025-03   | _Gap_      | 160+      | native, built at setup | 108 MB package                                |
| fastText lid.176       | 1.0.0, 2024-04    | CC BY-SA   | 176       | WASM ports only        | share-alike model license in the image        |
| Lingua (Rust bindings) | 1.8.0             | Apache-2.0 | 75        | native, new wrappers   | most accurate; Node wrappers days old in 2026 |

Sources: [eld](https://github.com/nitotm/efficient-language-detector-js), [franc](https://github.com/wooorm/franc),
[tinyld](https://github.com/komodojp/tinyld), [lande](https://github.com/fabiospampinato/lande),
[cld3](https://github.com/google/cld3), [cld3-asm](https://github.com/kwonoj/cld3-asm),
[cld](https://registry.npmjs.org/cld), [fastText](https://fasttext.cc/docs/en/language-identification.html),
[lingua-rs](https://github.com/pemistahl/lingua-rs), [lingua-js](https://github.com/pemistahl/lingua-js).

Accuracy depends on the length of the text far more than on the library:

- In the benchmark of eld's author, eld's large database reaches 99.2% on sentences, 90.4% on word pairs and 76.9% on
  single words. Lingua reaches 98.6%, 93.1% and 80.0%, CLD3 94.7%, 69.0% and 51.5%, franc 90.5%, 65.9% and 52.9%. eld
  ran in about 0.4 s where Lingua in Python took 4,790 s
  ([eld README](https://raw.githubusercontent.com/nitotm/efficient-language-detector-js/main/README.md)). It is the
  author's own benchmark.
- Lingua's independent tables over 75 languages give German 74% on single words, 94% on word pairs and 100% on
  sentences, but Bosnian 29%, 35% and 41%, Croatian 53%, 74% and 90%, and Norwegian Bokmål 39%, 59% and 77%
  ([single words](https://raw.githubusercontent.com/pemistahl/lingua-py/main/tables/SINGLE_WORDS_ACCURACY_TABLE.md),
  [word pairs](https://raw.githubusercontent.com/pemistahl/lingua-py/main/tables/WORD_PAIRS_ACCURACY_TABLE.md),
  [sentences](https://raw.githubusercontent.com/pemistahl/lingua-py/main/tables/SENTENCES_ACCURACY_TABLE.md)).
- franc warns that it is "easily confused on small samples" and ignores text under 10 characters by default
  ([franc](https://github.com/wooorm/franc)). CLD3 needs 140 bytes by default
  ([nnet_language_identifier.h](https://raw.githubusercontent.com/google/cld3/master/src/nnet_language_identifier.h)).
  Elastic states that detection works best with more than 50 characters
  ([Elastic blog](https://www.elastic.co/blog/multilingual-search-using-language-identification-in-elasticsearch)).
- Restricting the candidates to the expected languages improves the result; Lingua, Solr (`langid.allowlist`), Algolia
  and Meilisearch all offer this
  ([Solr](https://solr.apache.org/guide/solr/latest/indexing-guide/language-detection.html),
  [Meilisearch](https://www.meilisearch.com/docs/capabilities/indexing/how_to/handle_multilingual_data.md)).

_Inference_: eld fits HippoWiki best. It is pure JavaScript with no native build, so the container image needs no
prebuilt binaries; it is maintained, typed and ESM; its license is Apache-2.0; it covers every European language that
matters here except Irish, Galician, Bosnian and Macedonian; and `setLanguageSubset()` and `isReliable()` are the two
features the design needs. Its memory, 37 MB for the smallest and 138 MB for the largest database, is the cost; which
size is enough for whole pages is a measurement for the step plan. Lingua is more accurate on short text but has no
mature Node package yet.

#### The query is not detected

A search query has one to three words, where even the best detector is wrong a quarter of the time. Wikimedia found
about 6% of the language guesses it showed to be wrong, and 4% to 40% of the queries too ambiguous to guess
([Wikimedia review](<https://www.mediawiki.org/wiki/User:TJones_(WMF)/Notes/Review_of_Language_Identification_in_Production,_with_a_Special_Focus_on_Stupid_Identification_Tricks>)).
Elastic advises querying every language field instead, or taking the language from the user interface
([Elastic blog](https://www.elastic.co/blog/multilingual-search-using-language-identification-in-elasticsearch)).
Meilisearch notes that short queries are harder to identify, and gives the query a `locales` parameter that wins over
detection ([Meilisearch](https://www.meilisearch.com/docs/capabilities/indexing/how_to/handle_multilingual_data.md)).
Algolia (`queryLanguages`), Typesense (a locale per field) and Discourse (one configuration per site) do not detect at
all ([Algolia](https://www.algolia.com/doc/api-reference/api-parameters/queryLanguages/),
[Typesense](https://typesense.org/docs/latest/api/collections.html)).

HippoWiki does not need the language of the query: each page is compared with the query parsed in the page's own
language. How that stays fast is the next part.

#### Querying all languages at once, measured

A test on 2026-11-19 against `postgres:18.6`: 200,000 pages in four languages, each with a `lang regconfig` column and
a weighted vector with a GIN index, searching for "Häuser" (50,000 matches). Four ways to write the query:

| Query                                                                          | Plan                                  | Time  |
| ------------------------------------------------------------------------------ | ------------------------------------- | ----- |
| `v @@ to_tsquery(lang, $q)`, the query parsed per row as Wiki.js does          | parallel sequential scan, no index    | 64 ms |
| `v @@ (to_tsquery('german', $q) \|\| to_tsquery('english', $q) \|\| …)`        | one bitmap index scan                 | 13 ms |
| `(lang = 'german' AND v @@ to_tsquery('german', $q)) OR (lang = 'english' …)`  | `BitmapOr` of one index scan per lang | _Gap_ |
| the OR of all languages for the index, plus `CASE lang` with its own as filter | one bitmap index scan, then a filter  | 15 ms |

Findings:

- A query that depends on the row cannot use the index. Wiki.js's `CASE p.locale` in `to_tsquery` has this
  property, so its search reads every page, whatever the query. The cost grows with the size of the wiki.
- The OR of the query in every language (`||` of tsqueries) is one constant and uses the index. Alone it is wrong for
  exclusions: a German page with "Häuser" is not excluded by `-Häuser`, because the English branch looks for the
  lexeme `häuser` while the page holds `haus`. The test returned true for the OR and false for the German query
  alone.
- Each language as a branch with its own condition on `lang` is exact, and PostgreSQL turns it into a `BitmapOr` of
  index scans. The last row is exact too, with only one index scan: the OR finds the candidates, and the query of the
  page's own language decides.
- With AND and prefixes the OR stays correct, because AND stays inside each language:
  `'haus' & 'stadt' | 'häuser' & 'stadt'`. A typed prefix is stemmed before `:*` is added: `'häus':*` becomes
  `'haus':*` in `german`.
- A query word that is a stop word in a language vanishes from that language's query with a NOTICE: "die" is dropped
  in `german` and kept in `english`. A query of German stop words alone finds no German page.

_Gap_: the time of the third form was not measured, and none of the forms was measured with 20 languages instead of
four. With every European configuration the query holds about 20 branches; the cost test of the step plan must cover
it. An alternative is to build the branches only for the languages that occur in the readable folders.

#### Mixed-language pages

A page gets one language, the one the detector finds for most of its text. _Inference_:

- English words on a German page are still found by an English query, because the page compares the query in
  `german` too: the same stemmer runs over the page and over the query, and an unchanged or equally changed word
  matches. Only inflections of the other language are lost.
- Detecting per paragraph and joining one vector per paragraph works in PostgreSQL (the test joined a German and an
  English vector, and an English query matched). But the page then has no single language for the exact check, and the
  exclusion leaks again. Per paragraph is therefore not recommended for the first version.
- Stop words of the page's language that are words in another language, such as German "will" or "man", are lost on
  that page.

#### The design

- Detection runs in TypeScript in the pages service, at every write of the content, from the same plain text the index
  is built from. Fenced code, inline code, URLs and link addresses are removed first; they are not prose and lead the
  detector astray. The title is detected together with the text, since it is too short on its own.
- The candidate set is the European languages of the detector, through `setLanguageSubset()`. Each maps to its
  Snowball configuration, or to `simple` when PostgreSQL has none.
- `simple` is also the answer when the text is too short (a threshold such as 50 letters, to be measured), or when
  `isReliable()` says no.
- The result is stored in a column `searchLanguage` on `Page` as the name of the configuration, a plain `String` for
  Prisma, checked against a fixed list in code and by a `CHECK` constraint. The trigger builds the vector with
  `NEW."searchLanguage"::regconfig` and also fires on a change of the language.
- The query is parsed once by the project's parser, and the SQL has one branch per language, in the third or fourth
  form of the table. Rank and snippet use the query of the page's own language:
  `ts_rank_cd(v, CASE "searchLanguage" WHEN … END)` and `ts_headline` with that configuration. These run only on
  matched or returned rows, so the row dependence costs nothing there.
- Prefix and stemming disagree while a word is half typed: `connecti` stays `connecti` in `english` and does not match
  the stored `connect`. For quick search, the title and the name can also go into the vector as `simple` with their
  own weight (`B`), so that the prefix of an unstemmed title word always matches; titles are short, so this costs
  little. The trigram match on title and name covers the same case (see "pg_trgm on titles and names, unaccent stays
  out"). The results page keeps the stemmed query.
- Every page is re-detected by the rebuild command of `scripts/admin.ts` when the detector, its database or the
  mapping changes. A revision restore is a write of the content and re-detects.
- No language is shown or chosen in the browser in the first version. The stored language can later be shown on the
  page, or overridden per page or folder, if detection proves wrong too often.
- Tests: unit tests of the detection with pages and short texts in the main languages, the hard pairs (Danish and
  Norwegian, Croatian and Serbian, Spanish and Portuguese, German and Dutch) and code-heavy pages; integration tests
  that a German query finds a German inflection, that an English word on a German page is found, that `-word`
  excludes on pages of every language, and that the search uses the index; a cost test with all branches.

### pg_trgm on titles and names, unaccent stays out

`pg_trgm` adds `similarity`, `word_similarity` and GIN or GiST indexes for `LIKE` and `ILIKE`. It is marked trusted, so
a database owner without superuser rights can install it
([PG docs: pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)).
Amazon RDS lists `pg_trgm` 1.6 and `unaccent` 1.1
([AWS RDS extensions](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html)).
`unaccent` used inside an index needs an IMMUTABLE wrapper (Docmost's `f_unaccent`), or it can serve as a dictionary of
a text search configuration of its own (_Inference_, not checked against the documentation).

A test on 2026-11-19 against `postgres:18.6`:

- `pg_available_extension_versions` lists `pg_trgm` 1.6 and `unaccent` 1.1, both trusted.
- The image creates its database with the libc locale `en_US.utf8`. There, `show_trgm('Häuser')` keeps the trigrams
  across the "ä", `'Datenbank-Übersicht' ILIKE '%übersicht%'` is true, and
  `word_similarity('Konfiguraton', 'Konfiguration der Datenbank')` is 0.77, above the default threshold of 0.6. A
  database with the libc locale `C.UTF-8` behaves the same.
- Under the character type `C`, `pg_trgm` treats every letter outside ASCII as a word break: "Häuser" becomes the words
  "h" and "user". This holds with the libc provider, and also with the ICU provider (`und`) and the builtin provider
  (`C.UTF-8`) when `LC_CTYPE` is `C`. With libc `C`, the `ILIKE` above is false, and
  `to_tsvector('simple', 'ÄRGER')` keeps `'Ärger'` in capitals, so even the built-in full-text search breaks there.
  With ICU or builtin, the full-text search lowers the words correctly.
- The Snowball `german` stemmer folds umlauts itself: `to_tsvector('german', 'Übersicht')` gives `'ubersicht'`.

_Decision_: `pg_trgm` is part of the plan, on the title and the name of a page. `unaccent` is not.

_Inference_, how `pg_trgm` fits:

- What is indexed: the title and the name, each with a partial GIN index `gin_trgm_ops` `WHERE "deletedAt" IS NULL`.
  `pg_trgm` lowers the text and treats a hyphen as a word break, so the name needs no rewriting. The content gets no
  trigram index in the first version: the index of a page of up to 100,000 characters is several times its text and
  is rewritten on every save. _Gap_: its size and write cost were not measured. A measurement in the step plan decides
  whether the content follows later.
- What matches: a page matches when the full-text query matches it, or when its title or name matches every word of
  the query by trigram. A word matches as a substring (`ILIKE '%word%'`, with `%`, `_` and `\` escaped) or by word
  similarity (`word <% title`). A word shorter than three characters has no trigram, so it matches only through the
  full-text query. A `-word` excludes on both sides, and a phrase matches only through the full-text query.
- Ranking: a full-text hit keeps its `ts_rank_cd`, a hit by trigram alone is ranked by `word_similarity`, scaled below
  a full-text hit in the title, and the exact-title boost stays on top. Tests set the weights.
- Quick search: substring and similarity on title and name do not depend on the stemmer, so `connecti` finds
  "Connection guide". This makes the copy of title and name as `simple` at weight `B` unnecessary; the step plan
  decides whether to drop it.
- Permissions: the trigram conditions sit in the same `WHERE` as the folder filter and `"deletedAt" IS NULL`, so
  everything derived from results stays under the filter. `word_similarity` looks only at the row itself, so, unlike
  BM25, nothing in other folders shifts the order.
- Limits: `pg_trgm.word_similarity_threshold` is set with `SET LOCAL` in the transaction of the search, next to
  `statement_timeout`. Its value lives in the limits module.
- Installing: the migration runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`. A trusted extension needs the `CREATE`
  privilege on the database, so either the user of HippoWiki has it, or the operator creates the extension beforehand.
  `spec/container-image.md` then names `pg_trgm` and that privilege. _Gap_: whether `IF NOT EXISTS` passes without the
  privilege when the extension already exists was not tested.
- Character type: a database with the character type `C` breaks `pg_trgm` for every letter outside ASCII, and with
  libc it also breaks the lowercasing of full-text search. HippoWiki should therefore check `datctype` of its database
  and refuse `C`, with a message that names the fix: a UTF-8 locale such as `C.UTF-8` or `en_US.utf8`. Whether the
  check runs in the migration or at the start is for the step plan. The stock image and the test container of
  `scripts/db.sh` use `en_US.utf8`.
- Prisma: the indexes can be declared in `prisma/schema.prisma` as
  `@@index([title(ops: raw("gin_trgm_ops"))], type: Gin, where: …)` if Prisma 7.10 allows an operator class together
  with a partial index; otherwise they are written by hand in the migration. _Gap_: not checked.

`unaccent` stays out:

- For German, folding umlauts changes meaning ("Maße" against "Masse"), so it is not clearly better for the main
  language of the wiki.
- The `german` stemmer already folds umlauts in its stems. Neither it nor `unaccent` makes "ae" find "ä": `unaccent`
  turns "ä" into "a", and the trigrams of "Haeuser" and "Häuser" share too little for the similarity threshold
  (_Inference_ from how trigrams are built, not measured).
- It can follow later through the same trigger and the rebuild command, as a dictionary of a configuration of its own.

_Gap_: which extensions Azure, Neon and Supabase allow was not verified.

### BM25 extensions and external engines stay out of the baseline

| Option                    | What it needs                 | License          | Fit for HippoWiki     |
| ------------------------- | ----------------------------- | ---------------- | --------------------- |
| Built-in tsvector and GIN | nothing                       | PostgreSQL       | baseline              |
| pg_trgm                   | trusted contrib extension     | PostgreSQL       | titles and names      |
| unaccent                  | trusted contrib extension     | PostgreSQL       | no, maybe later       |
| pg_textsearch (BM25)      | preload library, restart      | PostgreSQL       | later, if the DB fits |
| ParadeDB pg_search (BM25) | custom image or Neon          | AGPL-3.0         | no                    |
| VectorChord-bm25          | custom image, pg_tokenizer    | AGPL-3.0 or ELv2 | no                    |
| Meilisearch, Typesense    | second service, sync pipeline | MIT CE; GPL-3    | no                    |
| Elasticsearch/OpenSearch  | JVM cluster, version coupling | various          | no                    |
| In-process JS index       | Node memory, rebuild on start | MIT and similar  | no                    |

Sources:

- pg_textsearch reached general availability under the PostgreSQL license, reuses PostgreSQL text search
  configurations and needs `shared_preload_libraries`
  ([pg_textsearch](https://github.com/timescale/pg_textsearch),
  [PG news](https://www.postgresql.org/about/news/pg_textsearch-v10-3264)).
- ParadeDB pg_search is AGPL-3.0 ([ParadeDB](https://paradedb.com/blog/agpl)). Its vendor benchmark on 10M rows shows a
  ranked top-10 in 81 ms against 38,797 ms with GIN ([Neon blog](https://neon.com/blog/pgsearch-on-neon)).
- VectorChord-bm25 is dual-licensed ([Pigsty](https://pigsty.io/ext/e/vchord_bm25/)).
- Meilisearch is MIT in its Community Edition and Typesense is GPL-3
  ([Meilisearch comparison](https://www.meilisearch.com/docs/resources/comparisons/typesense)).

_Gap_: the license and fit of the in-process libraries is prior knowledge, not checked against sources.

_Inference_:

- The license check planned in `spec/roadmap.md` rules out the AGPL options for anything the project ships.
- An external engine would duplicate the folder permissions in its index, and index lag would become permission lag,
  as Drupal's node access on the indexed state shows.
- An external engine contradicts the one image plus one database of `spec/container-image.md`.
- Reports put PostgreSQL full-text search at enough for hundreds of thousands to a few million documents with
  moderate load ([Fueled](https://fueled.com/blog/fulltext-search-postgresql-vs-elasticsearch/),
  [Xata](https://xata.io/blog/postgres-full-text-search-postgres-vs-elasticsearch)). That is far beyond a self-hosted
  team wiki.

## Permissions decide the candidate set before anything is ranked

The projects that filter inside the query rank, count and page correctly:

- Outline resolves the readable collection ids and the documents with a membership first, so that "the search query
  needs no membership joins".
- Mattermost uses a membership subquery.
- Docmost adds a check of page permissions after `LIMIT`, so a page of results can hold fewer rows than asked for
  ([search.service.ts](https://github.com/docmost/docmost/blob/main/apps/server/src/core/search/search.service.ts)).
- Confluence copies page restrictions into every index document. A change of a restriction then means reindexing the
  whole hierarchy, and unsynced attachments "could still" show content
  ([Atlassian KB](https://support.atlassian.com/confluence/kb/page-restrictions-performance-considerations/)).
- Wiki.js states the rule for suggestions: "A suggestion never tells a reader more than the full search would". It
  built page suggestions only and set aside word completion from one shared vocabulary, because that would leak words
  of pages a reader cannot open; its plan is one vocabulary per distinct set of groups
  ([search spec](https://github.com/requarks/wiki/blob/scarlett/dev/specs/search.md)).

### The rule: a search sees exactly the pages the user could open

Folder roles are per folder, not per page: any role, Reader or higher, reads every page of its folder, and a folder
without a role reads like one that does not exist (`spec/folder-roles.md`). For search this gives one rule: a result,
and everything derived from results, comes only from pages that the same actor could open at the same moment in the
same channel. Nothing may tell a user that a folder they have no role on holds a matching page, not a title, a
snippet, a count, a suggestion, an error or a noticeably different answer time.

#### One source for the readable folders

The folders service already answers "which folders may this actor read": `readableFolderWhere(actor, fn)` in
`src/features/folder-roles/service.ts` returns the Prisma condition on a folder, used by `listFolders()` for the
folder list. It already holds every rule that search needs:

- an admin gets `null`, and so reads no content at all;
- in the browser, a role of the user on the folder that allows the function, here `read`, which every role allows;
- through MCP, additionally only the folder of the connection, and only if the role of the connection allows the
  function.

_Inference_: the search must take its folders from this function and from nowhere else, so that the browser, MCP and
any later caller cannot drift apart. The search SQL is raw SQL (see "The vector, its upkeep and Prisma"), so it
cannot take the Prisma condition directly. Two ways:

- Resolve first, as Outline does: `folder.findMany({ where: readableFolderWhere(actor), select: { id: true } })` gives
  the ids, and the search SQL filters on `p."folderId" = ANY($folderIds::uuid[])`. The rules stay in one place, and an
  empty list answers "no results" without running the search. It costs one small query, and the list is as long as
  the folders the user has a role on.
- Repeat the condition as a subquery on `"FolderRole"` inside the search SQL. That is one statement, but the rules of
  admins, MCP and functions are then written twice, once in Prisma and once in SQL, and must be kept equal by tests.

The recommendation is the first. The role check and the search are then two statements, as they are for every read
of the pages service today (`roleOnFolderOfPage()` and then the read). A role removed between the two takes effect
with the next request, which is the rule of `spec/folder-roles.md`.

The search function itself, in the pages service, takes the actor, never a user id or a list of folders from its
caller. The raw SQL sits in a module of its own that takes the folder ids as a required, non-empty parameter, so
that no query without the filter can be written by accident. Only the pages service calls it; a test checks that the
SQL contains the filter.

#### Where the filter sits in the query

The filter is a condition of the same `WHERE` that matches, ranks, counts and pages, so rank, total, `LIMIT` and
`OFFSET` all see only readable pages. Post-filtering is out: it leaves pages of results short and totals that count
hidden pages, which is what Docmost does and what Wiki.js gave up (see above).

A test on 2026-11-19 against `postgres:18.6`, 200,000 pages in 1,000 folders, a user with a role on three of them,
and a word on every page:

- Without an index on the folder, PostgreSQL scanned the table and threw away about 6,000 rows to find 20.
- With a partial B-tree index on `"folderId"` `WHERE "deletedAt" IS NULL`, it read the 600 pages of the three
  folders through that index and checked the vector only on them (0.06 ms). For a rare word it still started from the
  folder index, since that was the smaller set.

_Inference_:

- `Page` has no plain index on `"folderId"` today, only the partial unique index on folder and name for pages without
  a tab. Search should add `@@index([folderId], where: …)` with the `partialIndexes` feature already in use.
- PostgreSQL then picks the smaller side per query: the folder index for a user with few folders, the GIN index for a
  rare word. A user with a role on few folders of a big wiki pays for their own pages only.
- The time of a search can still grow with matches in folders the user cannot read, when the GIN index drives the
  plan. The difference is small next to network noise and does not name a page; the statement timeout of "Security
  and limits" bounds it. This is accepted, and named here so that it is a decision.
- Ranking must not use numbers from outside the readable pages. `ts_rank` and `ts_rank_cd` look only at the row
  itself, so they are safe. A BM25 extension computes term statistics over the whole table, and pg_textsearch says
  that rows hidden by row-level security still count (see "BM25 extensions and external engines stay out of the
  baseline"). How rare a word is in the hidden folders would then shift the order of the visible results.

#### Everything derived from results is under the same filter

- The total and any count per folder or per tab come from the same filtered query, never from a separate count of
  all matches.
- Snippets are computed only for the returned rows, which are already filtered.
- Quick search uses the same function with a smaller limit. It offers pages, never words: a completion built from the
  vocabulary of the wiki (`ts_stat` over all pages) would leak words of folders without a role, as Wiki.js explains.
- "Did you mean" and the retry of a query that found nothing, if they come, run under the same filter and suggest
  only from readable pages.
- A result links to the page by folder, tab and page name, and shows the last editor and the time of the last change,
  all of a readable page. The name of a user is visible on `/users` anyway.
- No search result is cached across requests or users: no `"use cache"`, no shared cache of the route, so that a role
  removed or a page deleted takes effect with the next search. The project uses no such cache today.
- Logged search terms are content written by the user, not by the folder. If queries are logged at all, the log line
  holds the actor and the number of results, not the folders the results came from.

#### Filtering by folder or tab

The results page can be narrowed to one folder, or to one tab of it, and a search started in a folder may start
narrowed to it.

- The folder or tab of the request is checked like every other read: `mayReadFolder()` or `mayReadTab()`. A folder
  without a role, a folder that does not exist and a malformed id answer the same, with the not-found page or an empty
  answer, so that nothing tells whether the folder exists.
- The requested folder narrows the list of readable folders; it never widens it. The search SQL still gets only ids
  from `readableFolderWhere()`.
- A tab filter is a second condition, `p."tabId" = $tab`, after the tab was checked to be in a readable folder.

#### MCP

- An AI app searches only the folder of its connection. `readableFolderWhere()` already narrows the list to that one
  folder, and to none if the role of the connection may not read. The tool therefore has no folder argument; a tab
  argument is checked like in the browser.
- The role of the connection is the lower of the user's role and the role of the address, checked live on every
  request (`spec/mcp.md`). A user whose role was lowered below the connection's role is refused before the tool runs.
- Other folders of the same user stay invisible through MCP, also when the user has a role on them. This is the rule
  of `spec/folder-roles.md`, not a limit of search.

#### Admins

- An admin reads no content, so `readableFolderWhere()` returns `null` and the search answers nothing without asking
  the database, like every read of content (`spec/content-structure.md`).
- _Inference_: the search box is not offered to admins at all, as the folder list under `/folders` is not, so that
  an admin is never shown an empty search that looks like an empty wiki.

#### Deleted pages and revisions

- Deleted pages are filtered with `"deletedAt" IS NULL` in every search, through MCP for every role. They stay in the
  table, so a restored page is searchable again at once without a reindex. A search in the deleted pages of a folder
  for a Manager or Owner, in the browser only, would go beyond what Confluence offers
  ([CONFSERVER-95993](https://jira.atlassian.com/browse/CONFSERVER-95993)). It is an option for later, not the
  baseline.
- Revisions are not searched. No surveyed project indexes old versions. `PageRevision` keeps the title and content of
  each revision, so a search over the history would be a separate index of its own.
- A partial GIN index `WHERE "deletedAt" IS NULL` keeps deleted pages out of the index. A composite index on folder
  and vector, as in Outline, would need the `btree_gin` extension; the plain B-tree index on the folder above gives
  most of its effect without one.

#### Tests of the filter

Leaking results is the worst failure search can have, so the filter gets tests of its own, beyond the search tests:

- Integration tests against the database container, with a user who has a role on folder X and none on folder Y, and
  the same word on pages in both: the results, the total, the counts, the snippets and quick search hold only pages
  of X; a filter on Y answers like a folder that does not exist; after the role on X is removed, the next search finds
  nothing; after a role on Y is given, the next search finds its pages.
- The same for every role, Reader to Owner, since every role reads.
- An admin finds nothing, and the database is not asked.
- MCP: a connection on X does not find pages of Z, although the user has a role on Z; a Reader connection of a user who
  became a Writer still finds pages of X; a connection whose role is above the user's current role is refused.
- Deleted pages of X are not found, through either channel and for every role; restored, they are found again.
- A test that the raw search SQL cannot run without folder ids, and one that its `WHERE` holds the folder filter.
- End-to-end tests in the browser and through MCP for a user with and without a role on a folder.

## Two tiers of search for people

Every product surveyed has two tiers:

- A quick search opened from the keyboard: Ctrl or Cmd+K in GitBook, Cmd+P in Notion, "/" in Confluence. It shows
  recent pages before anything is typed and title-first results while typing.
- A results page, reached with Enter, with highlighted snippets, breadcrumbs, the time of the last change and filters.

The filters and features in use:

- Notion filters by title only, creator, teamspace, an ancestor page and date, and sorts by best match, last edited or
  created ([Notion Help](https://www.notion.com/help/search)).
- Confluence filters by space, contributor, type, last modified, labels, "pages under" and "titles only"
  ([Atlassian](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/)).
- GitBook and Docmost rank results from the current section or space first instead of limiting the search to it
  ([GitBook](https://gitbook.com/docs/create-content/searching-your-content/quick-find.md),
  [search.service.ts](https://github.com/docmost/docmost/blob/main/apps/server/src/core/search/search.service.ts)).
- MediaWiki's "Go" jumps straight to a page whose title is exactly the query
  ([Help:CirrusSearch](https://www.mediawiki.org/wiki/Help:CirrusSearch)).
- Outline collapses the keystrokes of search as you type into one logged search
  ([SearchQuery.ts](https://github.com/outline/outline/blob/main/server/models/SearchQuery.ts)).

Users expect quoted phrases everywhere, `-` and `or` often, and `*` sometimes. Confluence allows no wildcard at the
start of a word ([Confluence syntax](https://support.atlassian.com/confluence-cloud/docs/confluence-search-syntax/)).
BookStack adds `{filter:value}` filters and caps the number of terms
([BookStack: Searching](https://www.bookstackapp.com/docs/user/searching/)).

A search box with a popup of results follows the WAI-ARIA combobox pattern: focus stays in the input,
`aria-activedescendant` marks the active option, and Escape closes the popup
([APG Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)).

_Inference_, for HippoWiki:

- Quick search sits in the app bar and opens with Ctrl or Cmd+K. It is built on MUI `Autocomplete` (freeSolo), which
  implements the combobox pattern.
- Quick search matches title and name by prefix through the weight-`A` part of the same vector, and by substring and
  similarity through the trigram indexes, so that a half-typed word, a part of a compound and a typo all find the
  page. It lists the current folder first, and shows at most about ten pages with their folder and tab. Enter without a chosen option opens the
  results page.
- The results page shows title, folder, tab, snippet, time of the last change, last editor and channel ("by mike via
  mcp", as in the lists).
- The results page filters by folder (all folders with a role by default, or the current folder) and by tab within one
  folder. Titles only, last editor, channel and a range of the last change are possible further filters. It sorts by
  relevance or by the last change.
- The syntax is words with AND, `"phrase"`, `-word` and `or`, with prefix matching on every word, or only on the last.
  There are no field prefixes at first.
- When nothing is found, the results page retries the query as a phrase, the way Outline does.
- The address is the open point. HippoWiki keeps all content under `/folders`, accepts only known query parameters,
  and shows the not-found page for anything else (`spec/content-structure.md`). A wiki-wide search needs a route of its
  own, such as `/search?q=`. A search within one folder could be a view of the folder (`?view=search&q=`), which the
  list of views in `spec/content-structure.md` would have to name.

## Security and limits

The caps in use:

- GitHub allows at most 256 characters and five boolean operators per query, 1,000 results per search and 100 per
  page. It limits search to 30 requests per minute and marks timed-out searches as incomplete
  ([GitHub REST: Search](https://docs.github.com/en/rest/search/search)).
- Outline caps the query at 1,000 characters "as we're using regex against untrusted input"
  ([PostgresSearchProvider.ts](https://github.com/outline/outline/blob/main/plugins/search-postgres/server/PostgresSearchProvider.ts)).
- BookStack caps terms, phrases and filters ([BookStack](https://www.bookstackapp.com/docs/user/searching/)).
- Discourse rejects over-long terms because cover-density ranking "becomes expensive"
  ([search.rb](https://github.com/discourse/discourse/blob/main/lib/search.rb)).

On paging, large offsets cost the database and drift when rows change. Keyset paging is stable but needs a unique sort
order ([Use The Index, Luke](https://use-the-index-luke.com/no-offset)). Outline logs queries truncated to 255
characters with a 365-day retention
([CleanupOldSearchQueriesTask.ts](https://github.com/outline/outline/blob/main/server/queues/tasks/CleanupOldSearchQueriesTask.ts)).
OWASP advises keeping personal data out of logs
([OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)).

_Inference_, for HippoWiki:

- The query is at most about 200 characters, with at most about 8 terms and a minimum prefix length of 2 or 3
  characters. A query that is empty or made only of stop words gives an empty result without an error.
- A page holds at most 50 results, the offset is capped so that at most about 500 results can be reached, and the
  count is given as "more than N" above the cap.
- Each search runs under `SET LOCAL statement_timeout` in its transaction, and a timeout is answered as "search too
  broad".
- Quick search waits for a pause in typing, cancels requests that are out of date, and asks the server only from two
  characters on.
- Snippets are plain text with sentinel markers and are rendered as React nodes. They never pass through
  `dangerouslySetInnerHTML`.
- The log line of a search names the user, the channel, the scope, the number of results, the duration and the query
  length, but not the query text. This follows the MCP rule that a log line never holds content or titles
  (`spec/mcp.md`), since people search for names and incidents.
- Rate limits stay the reverse proxy's job until "Rate limits and quotas" of `spec/roadmap.md` is built. The checks
  of the deployment there should then name the search addresses.

## The MCP search tool for AI apps

The dominant shape is a read-only `search` tool that takes a query, optional scope filters and a limit, and returns
for each page an id, a title, an address, a short snippet and times, next to a `fetch` or `read` tool:

- Outline's `list_documents` takes `query`, `collectionId`, `includeArchived`, `offset` and `limit` (1 to 100, 25 by
  default), returns a snippet `context` with a breadcrumb, and sets `readOnlyHint: true`
  ([documents.ts](https://github.com/outline/outline/blob/main/server/mcp/tools/documents.ts)). It ships a skill that
  tells agents to search with short key terms, then fetch and cite
  ([SKILL.md](https://github.com/outline/outline/blob/main/server/mcp/skills/find-and-cite/SKILL.md)).
- Notion's `notion-search` returns up to 50 results
  ([Notion MCP reference](https://developers.notion.com/guides/mcp/tools-search-reference.md)).
- OpenAI's deep-research compatibility expects exactly `search(query) -> {results: [{id, title, url}]}` and
  `fetch(id) -> {id, title, text, url, metadata}`, both as structured content and as JSON text
  ([OpenAI: MCP](https://developers.openai.com/api/docs/mcp)).
- The MCP specification makes invalid input a tool error with `isError`. Its cursor paging covers only list methods,
  not tool results ([MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
  [MCP Pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination)).
- Anthropic's guidance favours purpose-built search tools with sensible default limits, readable names over bare ids,
  and actionable errors ([Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)).

_Inference_, a `search_pages` tool that fits the rules of `spec/mcp.md`:

- It is a read tool for every connection role, so the tool counts become three, seven and eleven. It carries
  `readOnlyHint` and works on the folder of the connection without a folder argument.
- Input: `query` (a plain string, so that a bad query is a tool error with the syntax and the limits), an optional
  `tab` (the tab argument of the other tools), `limit` (10 by default, at most 50) and `offset`.
- Output: first the field `note` with `USER_TEXT_NOTE` of `src/features/mcp/tool-schemas.ts`, since titles and
  snippets are page text. Then a list of pages, each with name, title, tab, address, snippet, last change, last
  editor and channel, and finally whether more results exist. Each page carries exactly the name and tab that
  `read_page` takes, so no id is needed. The snippet is plain text without markers or with simple ones, and is never
  HTML.
- The description ends with the note sentence, says that every word must match, how phrases and `or` work, and that
  the agent should read the hits with `read_page`. The instructions of `initialize` name the tool for every role.
- No deleted page is ever a result, for any role. A query that is empty or too long is a tool error that states the
  limits and holds no page text.
- `run()` of `src/features/mcp/tools.ts` logs the call with its outcome and the number of results, without the query
  text, like the other arguments that are not names.
- The browser and MCP share one search function of a service. Outline does the same for its MCP and its search page,
  "so access control matches the search path exactly"
  ([documents.ts](https://github.com/outline/outline/blob/main/server/mcp/tools/documents.ts)).
- Whether `search` and `fetch` aliases for ChatGPT deep research are wanted is a question for the requirements phase.
  `fetch` takes an id, while `read_page` takes a tab and a name.

## Preparing for semantic and hybrid search

Supabase's reference function fuses two ranked lists by Reciprocal Rank Fusion, each in a CTE limited to about twice
the requested count. One list is full text with `ts_rank_cd` over `websearch_to_tsquery`, the other a vector distance
over an HNSW index. The fused score is `1 / (k + rank)` with `k = 50` and a weight per list
([Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search)). Notion splits long pages into spans
before it embeds them ([Notion blog](https://www.notion.com/en-gb/blog/two-years-of-vector-search-at-notion)).

_Inference_, what to prepare now:

- The search SQL lives in one module that returns `(pageId, rank)` with all filters (folder, `deletedAt`, tab) inside
  the query, so that it can become one CTE of a fused query. Filters must sit inside each CTE, because a vector search
  filtered afterwards returns too few rows.
- Keep the stored plain text of a page. Chunks for embeddings (one per heading section) can later be derived from it
  into a table of their own with page, position, heading, text and embedding.
- pgvector is not in the stock `postgres` image pinned in `scripts/Containerfile`. Semantic search therefore brings
  an extension that, unlike `pg_trgm`, needs a database image of its own or a managed database that offers it, plus an
  embedding model and its hosting (_Gap_: not researched).

## Recommended design for HippoWiki

The recommendation, as input to the requirements:

- Data: three columns on `Page`.
  - `searchText` holds the content as plain text. The pages service derives it in TypeScript from the markdown-it
    tokens of `src/features/pages/markdown.ts`, like the title, and writes it in the same write as the content.
  - `searchLanguage` holds the name of the text search configuration of the page, detected by eld at the same write
    (see "Several European languages, detected automatically"), `simple` when unsure.
  - `searchVector` is `Unsupported("tsvector")?`.
- Upkeep: a `BEFORE INSERT OR UPDATE OF title, name, "searchText", "searchLanguage"` trigger that returns early when
  nothing changed. It builds `setweight(title, 'A') || setweight(name with hyphens as spaces, 'A') ||
setweight(searchText, 'D')` with the page's configuration, plus title and name with `simple` as `B` for quick
  search. On `program_limit_exceeded` it retries with a shorter prefix of the text. A migration fills the existing
  pages, and a command of `scripts/admin.ts` re-detects the languages and rebuilds the vectors when the detector or the
  mapping changes. Moves and deletes change no text and do not touch the vector; a rename, and a restore under another
  name, rebuild it.
- Index: a partial GIN index on `searchVector` `WHERE "deletedAt" IS NULL`, and a partial GIN index `gin_trgm_ops`
  each on the title and the name.
- Database: `pg_trgm` created by the migration, the only extension, and a check that refuses a database with the
  character type `C` (see "pg_trgm on titles and names, unaccent stays out").
- Query: a parser of its own that produces quoted operands with AND, OR, NOT, phrases and prefixes. The text is bound
  as a parameter and parsed with each configuration of the fixed list, one branch per language, each restricted to
  the pages of that language. A second condition, joined with OR, matches a page whose title or name holds every
  word by substring or by word similarity.
- Ranking: `ts_rank_cd` with the default weights and the query of the page's own language, plus an exact-title boost,
  with ties broken by the time of the last change. A hit by trigram alone ranks by `word_similarity`, below a
  full-text hit in the title.
- Snippets: `ts_headline` with the page's configuration over `searchText` for the returned rows only, with sentinel
  markers, as a list of parts.
- Permissions: readable folder ids resolved first through `readableFolderWhere()` and passed to the search SQL as a
  required filter, with a partial B-tree index on the folder of a page, admins answered without a query, MCP limited to
  the folder of the connection, deleted pages never, revisions not (see "The rule: a search sees exactly the pages
  the user could open").
- Browser: quick search in the app bar on the title part of the vector and the trigram indexes, a results page with folder and tab filters
  and two sort orders, and the address left to the requirements.
- MCP: `search_pages` as described above, for every role.
- Limits: query length, number of terms, minimum prefix, page size, offset cap, statement timeout and the threshold of
  word similarity. Every limit
  sits in one module, like `src/features/pages/limits.ts`, and has a cost test of the largest query and the largest
  page.
- Tests: unit tests of the parser and the snippet splitting. Integration tests against the database container for
  ranking, permissions, deleted pages, the 1 MB guard and German and English examples, and for the trigram match: a
  part of a compound and a typo in a title are found, umlauts match inside a word, a word of two characters is not
  matched by trigram, `-word` excludes a trigram hit, a trigram hit in a folder without a role is never found, and
  the search uses the trigram indexes. A test that the check refuses a database with the character type `C`.
  End-to-end tests of quick
  search, the results page and the MCP tool for each role.

A sketch of the core SQL, to be checked during the step plan:

```sql
-- trigger function, simplified
NEW."searchVector" :=
  setweight(to_tsvector(NEW."searchLanguage"::regconfig, coalesce(NEW.title, '')), 'A') ||
  setweight(to_tsvector(NEW."searchLanguage"::regconfig, replace(NEW.name, '-', ' ')), 'A') ||
  setweight(to_tsvector('simple', coalesce(NEW.title, '') || ' ' || replace(NEW.name, '-', ' ')), 'B') ||
  setweight(to_tsvector(NEW."searchLanguage"::regconfig, coalesce(NEW."searchText", '')), 'D');

-- search for a user; one branch per configuration of the fixed list, generated in code
SELECT p.id,
       ts_rank_cd(p."searchVector",
                  CASE p."searchLanguage" WHEN 'german' THEN to_tsquery('german', $1)
                                          WHEN 'english' THEN to_tsquery('english', $1)
                                          ELSE to_tsquery('simple', $1) END)
         -- a hit by trigram alone has a text rank of 0 and ranks by similarity, scaled down
         + 0.1 * word_similarity($5, p.title) AS rank
FROM "Page" p
WHERE ((p."searchLanguage" = 'german' AND p."searchVector" @@ to_tsquery('german', $1))
    OR (p."searchLanguage" = 'english' AND p."searchVector" @@ to_tsquery('english', $1))
    OR (p."searchLanguage" = 'simple' AND p."searchVector" @@ to_tsquery('simple', $1))
    -- trigram: one block per query word of three or more characters, generated in code; $6 is the word with
    -- % _ and \ escaped; exclusions with -word are left out of this sketch
    OR (p.title ILIKE '%' || $6 || '%' OR $6 <% p.title
        OR p.name ILIKE '%' || $6 || '%' OR $6 <% p.name))
  AND p."deletedAt" IS NULL
  -- $2: the ids of readableFolderWhere(actor), resolved before; never empty, an empty list returns without a query
  AND p."folderId" = ANY($2::uuid[])
ORDER BY rank DESC, p."updatedAt" DESC, p.id
LIMIT $3 OFFSET $4;
```

## Open questions for the requirements phase

- Language: which European languages are in the fixed list, and is a language without a stemmer (Polish, Czech)
  stored as itself and indexed with `simple`, or stored as `simple`? Which examples must find each other per language:
  inflections, compounds, umlauts written as "ae"?
- Detection: which eld database size, which minimum text length, and is a page that falls below it indexed with
  `simple` or with the language of its folder's other pages? Is the detected language shown anywhere, and may a
  Writer override it per page later?
- Mixed pages: is one language per page enough, or are paragraphs in another language detected on their own, with
  the exclusion problem that brings?
- Trigram: is the content also matched by trigram, after a measurement of the index size and the write cost, or only
  the title and the name? Which threshold of word similarity? Does HippoWiki refuse to start on a database with the
  character type `C`, or only warn?
- Scope: wiki-wide search across all folders with a role, search in one folder, or both? Does a search started inside
  a folder default to that folder or rank it first?
- Address: a route of its own such as `/search`, a view of the folder, or both?
- What is indexed: title, name and content, and also the tab name? Is code inside fenced blocks indexed? Are link
  addresses dropped?
- Prefix matching: on every word or only on the last? What is the minimum prefix length?
- Filters and sorting for the first version: folder and tab only, or also last editor, channel, date and titles only?
- Deleted pages: never searchable, or a search in the deleted pages of a folder for a Manager or Owner, in the browser?
- Revisions: confirm that they are not searched.
- Limits: the exact numbers for query length, terms, page size, result window and timeout. Is the query text logged,
  and if so with which retention?
- MCP: the name `search_pages`, the limit default and maximum, offset or cursor, the snippet with or without markers,
  and whether ChatGPT `search` and `fetch` aliases are wanted.
- Quick search: titles and names only, or also content? Recent pages as the empty state, which HippoWiki does not
  record yet?
- Semantic search: confirm that it stays a later feature, and decide whether the plain-text column is kept with that
  in mind.

## Gaps of this research

- Prisma 7.10 with generated `tsvector` columns and drift was not tested. TypedSQL's preview status in Prisma 7 was
  not confirmed.
- No recent benchmark of `ts_rank` and `ts_headline` at 10k to 1M pages on PostgreSQL 16 to 18 was found. The changes
  to text search in PostgreSQL 18 were not checked.
- Which extensions Azure, Neon and Supabase offer, among them `pg_trgm`, and the managed availability of pg_textsearch
  were not verified on provider pages.
- Whether Prisma 7.10 declares a GIN index with `gin_trgm_ops` and a `where` together, and whether
  `CREATE EXTENSION IF NOT EXISTS` passes for a user without the `CREATE` privilege when the extension exists, were
  not tested.
- The XWiki and DokuWiki documentation refused automated fetches. Their permission handling and query syntax are not
  covered.
- No measured comparison of `simple`, `german` and Hunspell on wiki text exists in the sources. The trick of joining
  three configurations in one vector is not documented by any project read.
- The size and write cost of a trigram index on bodies and the memory of Meilisearch or Typesense at 100k pages were
  not measured.
- eld was not tried hands-on. Its accuracy figures are its author's; no independent benchmark gives its numbers for
  the hard pairs. How much stripping code and URLs helps detection is not measured anywhere.
- The query with one branch per language was measured with four languages and 200,000 synthetic pages only, and the
  `BitmapOr` form not timed. Whether a Croatian page fares better with `serbian` or with `simple` was not tested.

## Conclusion

For a single-container wiki the hard part of search is not the engine. It is putting the permission filter, the
handling of deleted pages and the parsing of hostile input in exactly one SQL path that the browser and MCP share.
The failures documented in the surveyed projects (filtering after paging, raw `to_tsquery`, HTML from `ts_headline`,
vectors that block saves) all happened on top of an engine that worked. HippoWiki's existing rules already point the
way: roles read live per request, a soft delete with `deletedAt`, a 100,000-character content limit, page text marked
for AI apps, and a cost test for every expensive path. Stemming each page in its detected language improves the quality with
the Snowball configurations that are built in, and the trusted `pg_trgm` on titles and names adds parts of compounds
and typos at the cost of one extension and a database with a UTF-8 character type. Trigrams on the content, and
`unaccent`, can follow later through the same trigger and the rebuild command.

## Sources

PostgreSQL documentation:

- [Controlling Text Search](https://www.postgresql.org/docs/current/textsearch-controls.html)
- [Tables and Indexes](https://www.postgresql.org/docs/current/textsearch-tables.html)
- [Limitations](https://www.postgresql.org/docs/current/textsearch-limitations.html)
- [Dictionaries](https://www.postgresql.org/docs/current/textsearch-dictionaries.html)
- [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)
- [pgsql-general on ranking cost](https://postgresql.org/message-id/CAG3yVS7Gdzzgr5%2B5z9Hq0X-YTLto5%2BFrcg_hrqDyg2Vm01Ob3w%40mail.gmail.com)
- [Bartunov on TOAST reads](https://www.postgresql.org/message-id/Pine.LNX.4.64.1107130023480.17363%40sn.sai.msu.ru)
- [German compound splitting](https://www.postgresql.org/message-id/5566F66C.3070701%40tbz-pariv.de)
- [AWS RDS extensions](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html)
- [Snowball configurations, REL_18_STABLE](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/snowball/snowball_create.pl)
- [Snowball configurations, master](https://raw.githubusercontent.com/postgres/postgres/master/src/backend/snowball/snowball_create.pl)

Language detection:

- [eld](https://github.com/nitotm/efficient-language-detector-js) and its
  [benchmark](https://raw.githubusercontent.com/nitotm/efficient-language-detector-js/main/README.md)
- [franc](https://github.com/wooorm/franc)
- [tinyld](https://github.com/komodojp/tinyld)
- [lande](https://github.com/fabiospampinato/lande)
- [cld3](https://github.com/google/cld3), [cld3-asm](https://github.com/kwonoj/cld3-asm)
- [cld](https://registry.npmjs.org/cld)
- [fastText language identification](https://fasttext.cc/docs/en/language-identification.html)
- [lingua-rs](https://github.com/pemistahl/lingua-rs), [lingua-js](https://github.com/pemistahl/lingua-js)
- [Lingua accuracy, single words](https://raw.githubusercontent.com/pemistahl/lingua-py/main/tables/SINGLE_WORDS_ACCURACY_TABLE.md),
  [word pairs](https://raw.githubusercontent.com/pemistahl/lingua-py/main/tables/WORD_PAIRS_ACCURACY_TABLE.md),
  [sentences](https://raw.githubusercontent.com/pemistahl/lingua-py/main/tables/SENTENCES_ACCURACY_TABLE.md)
- [Elastic: multilingual search with language identification](https://www.elastic.co/blog/multilingual-search-using-language-identification-in-elasticsearch)
- [Solr language detection](https://solr.apache.org/guide/solr/latest/indexing-guide/language-detection.html)
- [Meilisearch multilingual data](https://www.meilisearch.com/docs/capabilities/indexing/how_to/handle_multilingual_data.md)
- [Algolia queryLanguages](https://www.algolia.com/doc/api-reference/api-parameters/queryLanguages/)
- [Typesense collections](https://typesense.org/docs/latest/api/collections.html)
- [Wikimedia language identification review](<https://www.mediawiki.org/wiki/User:TJones_(WMF)/Notes/Review_of_Language_Identification_in_Production,_with_a_Special_Focus_on_Stupid_Identification_Tricks>)

PostgreSQL-native projects:

- [Outline PostgresSearchProvider.ts](https://github.com/outline/outline/blob/main/plugins/search-postgres/server/PostgresSearchProvider.ts)
- [Outline trigger migration](https://github.com/outline/outline/blob/main/server/migrations/20260921120000-tolerate-tsvector-limit-in-document-search-trigger.js)
- [Outline index migration](https://github.com/outline/outline/blob/main/server/migrations/20260803143858-add-documents-team-search-vector-index.js)
- [outline#14645](https://github.com/outline/outline/issues/14645)
- [Outline Highlight.tsx](https://github.com/outline/outline/blob/main/app/components/Highlight.tsx)
- [Outline SearchQuery.ts](https://github.com/outline/outline/blob/main/server/models/SearchQuery.ts)
- [Outline CleanupOldSearchQueriesTask.ts](https://github.com/outline/outline/blob/main/server/queues/tasks/CleanupOldSearchQueriesTask.ts)
- [Outline MCP documents.ts](https://github.com/outline/outline/blob/main/server/mcp/tools/documents.ts)
- [Outline find-and-cite SKILL.md](https://github.com/outline/outline/blob/main/server/mcp/skills/find-and-cite/SKILL.md)
- [Docmost search.service.ts](https://github.com/docmost/docmost/blob/main/apps/server/src/core/search/search.service.ts)
- [Docmost search-indexing migration](https://github.com/docmost/docmost/blob/main/apps/server/src/database/migrations/20261110T200644-search-indexing.ts)
- [Docmost unaccent and pg_trgm migration](https://github.com/docmost/docmost/blob/main/apps/server/src/database/migrations/20250729T213756-add-unaccent-pg_trm-update-tsvector..ts)
- [docmost#1293](https://github.com/docmost/docmost/issues/1293)
- [docmost#2093](https://github.com/docmost/docmost/issues/2093)
- [Wiki.js v2 search modules](https://github.com/requarks/wiki/tree/v2.5.307/server/modules/search)
- [Wiki.js search spec](https://github.com/requarks/wiki/blob/scarlett/dev/specs/search.md)
- [Wiki.js search.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/search.ts)
- [Wiki.js searchQuery.ts](https://github.com/requarks/wiki/blob/scarlett/backend/helpers/searchQuery.ts)
- [Wiki.js schema.ts](https://github.com/requarks/wiki/blob/scarlett/backend/db/schema.ts)
- [Wiki.js pages.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/pages.ts)
- [Wiki.js rendering.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/rendering.ts)
- [Wiki.js db.ts](https://github.com/requarks/wiki/blob/scarlett/backend/core/db.ts)
- [Wiki.js MCP discover.ts](https://github.com/requarks/wiki/blob/scarlett/backend/mcp/tools/discover.ts)
- [Wiki.js Search.vue](https://github.com/requarks/wiki/blob/scarlett/frontend/src/pages/Search.vue)
- [Discourse search.rb](https://github.com/discourse/discourse/blob/main/lib/search.rb)
- [Discourse search_indexer.rb](https://github.com/discourse/discourse/blob/main/app/services/search_indexer.rb)
- [discourse#45770](https://github.com/discourse/discourse/pull/45770)
- [GitLab pg_full_text_searchable.rb](https://gitlab.com/gitlab-org/gitlab/-/blob/master/app/models/concerns/pg_full_text_searchable.rb)
- [Mattermost posts migration](https://github.com/mattermost/mattermost/blob/master/server/channels/db/migrations/postgres/000020_create_posts.up.sql)
- [mattermost#22249](https://github.com/mattermost/mattermost/issues/22249)
- [mattermost#25660](https://github.com/mattermost/mattermost/issues/25660)
- [BookStack SearchIndex.php](https://github.com/BookStackApp/BookStack/blob/development/app/Search/SearchIndex.php)
- [BookStack#5658](https://github.com/BookStackApp/BookStack/issues/5658)
- [BookStack: Searching](https://www.bookstackapp.com/docs/user/searching/)
- [Memos render.go](https://github.com/usememos/memos/blob/main/filter/render.go)
- [Trilium note_content_fulltext.ts](https://github.com/TriliumNext/Trilium/blob/main/packages/trilium-core/src/services/search/expressions/note_content_fulltext.ts)

Engine-based projects:

- [MediaWiki Manual:Searchindex table](https://www.mediawiki.org/wiki/Manual:Searchindex_table)
- [Extension:CirrusSearch](https://www.mediawiki.org/wiki/Extension:CirrusSearch)
- [Help:CirrusSearch](https://www.mediawiki.org/wiki/Help:CirrusSearch)
- [Phabricator T317045](https://phabricator.wikimedia.org/T317045)
- [Phabricator T281379](https://phabricator.wikimedia.org/T281379)
- [Configuring OpenSearch for Confluence](https://confluence.atlassian.com/doc/configuring-opensearch-for-confluence-1387594125.html)
- [Confluence Content Index Administration](https://confluence.atlassian.com/doc/content-index-administration-148844.html)
- [Confluence Page Restrictions Performance Considerations](https://support.atlassian.com/confluence/kb/page-restrictions-performance-considerations/)
- [CONFSERVER-95993](https://jira.atlassian.com/browse/CONFSERVER-95993)
- [XWiki Solr Search API](https://extensions.xwiki.org/xwiki/bin/view/Extension/Solr%20Search%20API)
- [XWiki forum on indexing after boot](https://forum.xwiki.org/t/why-and-what-is-xwiki-indexing-after-a-a-fresh-boot/11441)
- [Drupal Search API backends](https://www.drupal.org/docs/8/modules/search-api/getting-started/server-backends-and-features)
- [drupal.org 3617860](https://www.drupal.org/i/3617860)
- [drupal.org 1130806](https://www.drupal.org/project/search_api/issues/1130806)
- [Notion lexical search reindexer](https://www.notion.com/blog/rebuilding-notions-lexical-search-reindexer)
- [Notion vector search](https://www.notion.com/en-gb/blog/two-years-of-vector-search-at-notion)
- [Ghost native search changelog](https://forum.ghost.org/t/native-search-ghost-changelog/31303)
- [VitePress search](https://vitepress.dev/reference/default-theme-search)

UX, security and MCP:

- [Notion Help: Search](https://www.notion.com/help/search)
- [Atlassian: Search for pages and posts](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/)
- [Atlassian: Confluence search syntax](https://support.atlassian.com/confluence-cloud/docs/confluence-search-syntax/)
- [GitBook: Quick find](https://gitbook.com/docs/create-content/searching-your-content/quick-find.md)
- [WAI-ARIA APG: Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [GitHub REST: Search](https://docs.github.com/en/rest/search/search)
- [Use The Index, Luke: No Offset](https://use-the-index-luke.com/no-offset)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [OpenAI: MCP](https://developers.openai.com/api/docs/mcp)
- [MCP specification: Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP specification: Pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination)
- [Anthropic: Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Notion MCP: Search reference](https://developers.notion.com/guides/mcp/tools-search-reference.md)

Extensions, engines and Prisma:

- [pg_textsearch](https://github.com/timescale/pg_textsearch)
- [pg_textsearch v1.0 news](https://www.postgresql.org/about/news/pg_textsearch-v10-3264)
- [ParadeDB on AGPL](https://paradedb.com/blog/agpl)
- [pg_search on Neon](https://neon.com/blog/pgsearch-on-neon)
- [Pigsty vchord_bm25](https://pigsty.io/ext/e/vchord_bm25/)
- [Meilisearch vs Typesense](https://www.meilisearch.com/docs/resources/comparisons/typesense)
- [Fueled: PostgreSQL vs Elasticsearch](https://fueled.com/blog/fulltext-search-postgresql-vs-elasticsearch/)
- [Xata: PostgreSQL vs Elasticsearch](https://xata.io/blog/postgres-full-text-search-postgres-vs-elasticsearch)
- [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search)
- [prisma#14799](https://github.com/prisma/prisma/issues/14799)
- [prisma#24180](https://github.com/prisma/prisma/issues/24180)
- [Prisma TypedSQL](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/typedsql)
