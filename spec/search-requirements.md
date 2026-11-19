# Search – Requirements

Status: approved

## Goal

Users find the pages of a folder: a page whose title they roughly know, and the pages that are about a topic. Search
always works on one folder, in the browser and for AI apps through MCP, and finds pages in the language they are
written in without anybody choosing a language.

## Users and roles

- Every user with a role on a folder, Reader, Writer, Manager or Owner, searches that folder, because every role reads
  all pages of its folder (see `folder-roles.md`).
- An AI app searches the folder of its connection, for every role of a connection: Reader, Writer and Manager.
- An admin reads no content and gets no search.
- A user without a role on a folder cannot search it, and nothing tells them whether it exists.

## Scenarios

- Finding a known page: Anna is in the folder "handbook" and remembers a page about the configuration of the database.
  She types "datenbank konfig" into the search field of the folder and presses Enter. The page "Konfiguration der
  Datenbank" is the first result, and she opens it.
- Finding pages by topic: Ben is on a page in the tab "meetings" of the folder "project-x". He searches for "Häuser",
  and the results list the pages of the whole folder that mention "Haus" or "Häuser", in every tab, with a short piece
  of text around each match.
- Searching from an AI app: an AI app connected to the folder "handbook" searches for "backup", gets the matching
  pages of that folder and reads the best ones.

## Requirements

### Search field

- R1: A user with a role on a folder must be offered a search field on the folder, on each of its tabs and on each of
  its pages, together with their views, and nowhere else. It is hidden while an action is open, such as the editor or
  a dialog, so that a search never discards unsaved work.
  - Acceptance: the field shows on `/folders/<folder>`, `/folders/<folder>/<tab>` and on the address of every page of
    the folder, for every role, and on their views: the results, all pages, roles, AI apps and the history, a
    revision and a comparison of a page. It does not show with an action such as `?action=edit` or
    `?action=rename`, on `/folders`, under `/deleted-pages`, on the other pages of the app, or to an admin.
- R23: In the results view, the search field must hold the words of the search.
  - Acceptance: the results view of "backup server" shows "backup server" in the field, ready to be changed and
    searched again with Enter.
- R2: A search must always cover the whole folder, whichever of its addresses it was started from.
  - Acceptance: a search started on a page in a tab finds matching pages placed directly in the folder and in every
    tab of it.
- R3: Nothing must be searched while the user types; the search starts when the user presses Enter.
  - Acceptance: typing without Enter sends no search and shows no list; Enter opens the results.
- R12: Enter must always open the results, also when the words are exactly the title of a page.
  - Acceptance: a search for the exact title of a page opens the results, with that page first, and not the page
    itself.

### Results

- R4: The results of a search must be a view of the folder with an address of its own,
  `/folders/<folder>?view=search&q=<words>`.
  - Acceptance: reloading the address shows the same results; back and forward of the browser work; the address
    opened by another user with a role on the folder shows them the results; opened by an admin or by a user without a
    role on the folder, it shows the not-found page.
- R31: The address of the results must follow the rules of the other views of a folder: `q` belongs only to the view
  `search`, which needs it once and not empty.
  - Acceptance: `?view=search` without `q`, with an empty `q` or with `q` twice, `q` on any other address, and
    `?view=search` together with an action show the not-found page.
- R5: The results must hold only pages of the folder that are not deleted.
  - Acceptance: a word that occurs on pages of two folders finds only the pages of the folder searched; a deleted
    page is never a result; a restored page is found again.
- R6: Pages must be found by their title, their name and their content.
  - Acceptance: a word that occurs only in the title, only in the name, or only in the content of a page finds that
    page.
- R7: A page whose title matches the words of the search must come before pages that match only in their content.
  - Acceptance: of two pages that both hold the word, the one with the word in its title is listed first.
- R13: The results must always be ordered by how well a page matches: a page whose title is exactly the words first,
  then pages with the words in their title, then pages with the words only in their content, then pages found only
  by a typo or a part of a word, those in their title before those in their content; among equal matches the page
  changed last comes first. There is no other order to choose.
  - Acceptance: the exact title comes first, R7 holds, a page found only by a typo comes after every page that holds
    the exact words, two pages that match equally are listed newest first, and the results view offers no choice of
    order.
- R14: Each result must show the title of the page as a link to it, its tab if it is in one, a short piece of its
  text around the match with the matched words highlighted, the time of its last change, and its last editor with the
  channel, as in the other lists of the wiki ("by mike via mcp").
  - Acceptance: a result shows all of these; the link opens the page; the highlighted words are the ones that
    matched; text of the page that looks like HTML is shown as text and never as markup.
- R24: When a page matches by a typo or by a part of a word, its piece of text must be the text around the closest
  word, with that word highlighted; when it matches only by its title or its name, the start of its text, without a
  highlight.
  - Acceptance: "Konfiguraton" shows the text around "Konfiguration", highlighted; "bank" shows the text around
    "Datenbank", highlighted; a page found only by its title shows the start of its text with nothing highlighted.
- R15: The results must always cover the whole folder; they cannot be narrowed to a tab.
  - Acceptance: the results view offers no choice of a tab, and the search tool of AI apps takes no tab.

### Search words

- R16: The search words must follow one syntax, in the browser and for AI apps: every word must match; words in
  quotes must stand together as a phrase; a word with a leading `-` excludes the pages that hold it; `or` between two
  words means that either may match; the start of a word also finds the whole word.
  - Acceptance: "backup server" finds only pages with both words; "\"backup server\"" finds only pages where the two
    words follow each other; "backup -server" finds pages with "backup" and without "server"; "backup or restore"
    finds pages with either word; "konfig" finds "Konfiguration"; quotes, `-` and `or` typed in odd places never cause
    an error, and are then read as plain words.
- R17: Text in code blocks and inline code, and the addresses of links, must be searched like the rest of a page.
  - Acceptance: a command that occurs only in a code block finds its page; a domain that occurs only as the address
    of a link finds the page that links to it.

### Languages

- R8: A page must be found by inflected forms of its words in the language it is written in, without anybody choosing
  a language, for every European language that the database can stem: Basque, Catalan, Danish, Dutch, English,
  Estonian, Finnish, French, German, Greek, Hungarian, Italian, Lithuanian, Norwegian, Portuguese, Romanian, Russian,
  Serbian, Spanish, Swedish and Turkish.
  - Acceptance: "Häuser" finds a German page that holds only "Haus"; "maisons" finds a French page that holds only
    "maison"; a German page and an English page are both found in one search; a German page with many code blocks
    and links is still found by German inflections.
- R18: A page in any other language, or too short to tell its language, must still be found by its exact words and
  by the start of its words.
  - Acceptance: a Polish page and an Irish page are each found by a word they hold and by the start of that word; a
    page of one short line is found by its words.
- R9: A part of a word and a word with a typo must find a page by its title, its name and its content.
  - Acceptance: "bank" finds a page titled "Datenbank-Übersicht" and a page whose text holds "Datenbank";
    "Konfiguraton" finds a page titled "Konfiguration der Datenbank" and a page whose text holds "Konfiguration"; a
    page that matches the words exactly comes before one that matches only by a part of a word or a typo.

### Empty results and limits

- R19: Enter in an empty search field must do nothing.
  - Acceptance: with an empty field, or one of spaces only, Enter keeps the user on the address they are on and sends
    no search.
- R20: Words that find nothing must open the results view with the message "No pages in this folder match <words>"
  and a one-line hint on the syntax.
  - Acceptance: the message names the words as typed, shown as text; the hint names all words must match, quotes,
    `-word` and `or`.
- R21: The results view must show one list of at most the 100 best results, without paging; when more pages match,
  it must say so and suggest more precise words.
  - Acceptance: a search that matches 150 pages lists 100 and says that more pages match; one that matches 30 lists
    30 and says nothing more.
- R22: A search must stop after 5 seconds and then tell the user that it is too broad, instead of making them wait;
  this holds in the browser and for AI apps.
  - Acceptance: a search that runs longer than 5 seconds shows a message that the search is too broad and asks for
    more precise words; the search tool of AI apps answers it as a tool error with the same advice; the wiki stays
    usable for other users meanwhile.
- R32: A search in a folder of 3,000 pages of about 20,000 characters each must finish within 2 seconds, with and
  without a typo or a part of a word; the time limit of R22 is for searches beyond that.
  - Acceptance: in such a folder, a search for a correctly spelled word, one for a word with a typo and one for a part
    of a word each finish within 2 seconds; matching typos does not make a search for a correctly spelled word slower
    than that.
- R33: At most 3 searches must run at the same time in the whole wiki, in the browser and for AI apps together; a
  further search must be answered at once with the message "Too many searches are running. Try again in a few
  seconds." and must run nothing.
  - Acceptance: while 3 searches run, a fourth shows the message above the field at once, and the search tool of AI
    apps answers it as a tool error with the same text; the other pages of the wiki load normally meanwhile; once a
    search has ended, the next search runs.
- R25: The words of a search must be at most 200 characters and 10 words long; longer words must be refused with the
  message "Search at most 200 characters and 10 words", and no search runs.
  - Acceptance: 201 characters or 11 words show the message above the field, also when given in the address of the
    results view, and no search runs; 200 characters and 10 words are searched; the search tool of AI apps refuses
    them as a tool error with the same limits.

### AI apps

- R10: An AI app must be able to search the folder of its connection, for every role of a connection, and only that
  folder.
  - Acceptance: a connection of every role lists the tool `search_pages`; it finds pages of its folder and none of
    another folder, also when the user has a role on that folder; it never finds a deleted page; each result names the
    page so that it can be read with the tool that reads a page.
- R26: One call of the search tool must return 10 results unless the app asks for another number, at most 25, and the
  app must be able to ask for the next results, up to the same 100 best results as the browser. Each result names the
  title, the page name, the tab, the address, the piece of text, the time of the last change, and the last editor
  with the channel.
  - Acceptance: a call without a number returns 10 results; a call for 30 is a tool error that names the limit of 25;
    the app gets results 11 to 20 with a second call; no call reaches a result past the 100th, and the answer says
    when more pages match; each result holds every field named.
- R27: Results of the search tool must be marked as text written by users of the wiki, like the other results of
  pages through MCP (see "Prompt injection" in `mcp.md`).
  - Acceptance: the result starts with the note of `mcp.md`, and the description of the tool ends with it; a tool
    error holds no title or text of a page.

### Operation

- R11: The database of HippoWiki must offer the extension `pg_trgm` and a character type that knows UTF-8, such as
  `en_US.utf8` or `C.UTF-8`; on a database with the character type `C`, the migrations must stop with a message that
  names the fix.
  - Acceptance: the migrations create `pg_trgm` where the database user may; on a database with the character type
    `C` they stop before changing anything and name a UTF-8 locale such as `C.UTF-8` or `en_US.utf8`; the stock
    database image passes.
- R28: Each search must be logged with the user, the channel, the folder, the number of results, the time it took and
  the length of the words, but never with the words themselves.
  - Acceptance: the log line of a search holds these fields and no word of the search, in the browser and through
    MCP.
- R29: The pages that exist when search is installed must be found right after the update, without a step of the
  operator.
  - Acceptance: after the update of an installation with pages, a search finds them by title, name and content, with
    the inflections of their language.
- R30: A page must be found by its current state right after every change: a new page, a change of its content or
  title, a move, a rename and a restore.
  - Acceptance: a word added to a page finds it with the next search, and a removed word no longer does; a renamed
    page is found by its new name and not its old one; a moved page shows its new tab in the results.

## Scope

- In: search in one folder in the browser and through MCP; automatic language of each page; parts of words and typos
  in titles, names and content; one list of the 100 best results; a time limit for every search; a time of at most
  2 seconds for searches in a folder of 3,000 pages; at most 3 searches at the same time.
- Not in: search across several folders or the whole wiki; suggestions while typing; opening a page directly from
  the search field; narrowing the results to a tab; a choice of the order of the results; paging through more than
  100 results; inflections of Irish and of languages the database cannot stem; search for admins; search in
  revisions of pages; search in the deleted pages of a folder, for any role; logging the words of a search; rate
  limits of searches per user or app, which stay the job of the reverse proxy (see "Rate limits and quotas" in
  `roadmap.md`).

## Effect on existing features

- Folders: a folder address gets the view `?view=search`, and the list of views in `content-structure.md` names it.
- Lists: "Lists show names and metadata only, never page content" in "Lists and order" of `content-structure.md`
  does not hold for the results, which show a piece of the text of each page.
- MCP: every connection gets one more read tool, so the counts of tools in `mcp.md` change, `search_pages` joins the
  tools whose results and descriptions carry the note of "Prompt injection", and "no search tool" leaves its current
  limits.
- Container image: "The migrations need no database extensions" in `container-image.md` becomes a need for `pg_trgm`
  and a database with a UTF-8 character type.
- Pages: "no search" leaves the current limits of `pages.md` and `content-structure.md`.
- Architecture: "There is no search yet" in "Database" of `architecture.md` no longer holds.
- Roadmap: "Full-text search" and "MCP search tool" leave `roadmap.md`; "Semantic search" stays.

## Decisions

- Search works on one folder only, in the browser and through MCP: a folder is the unit of roles, and an MCP
  connection reaches one folder. Rejected: a search over all folders with a role.
- Search starts with Enter and shows a results list; there are no suggestions while typing. Finding a known page is
  served by title matches coming first (R7).
- The results have an address of their own as a view of the folder, so that they can be reloaded, bookmarked and
  shared. Rejected: results without an address.
- Enter always opens the results, also for an exact title, so that pages with the same or a similar title stay
  visible. Rejected: opening the page with that title at once.
- The results cover the whole folder and cannot be narrowed to a tab, which keeps the first version simple. Rejected:
  an optional tab filter in the browser and in the search tool.
- Each result shows what the other lists show, plus a piece of text around the match. Rejected: title and tab only.
- One order, the best match, with the newest change among equal matches. Pages found only by a typo or a part of a
  word come after all exact matches, so that a near miss never pushes an exact hit down. Rejected: a choice of
  ordering by the last change, and typo matches mixed with exact ones by closeness.
- One syntax of search words for the browser and AI apps, with phrases, `-word` and `or`, because users expect them
  from other products. Rejected: plain words only, and words with phrases only.
- Every European language that the database can stem gets its inflections, and every other language its exact words
  and word starts. Rejected: German and English only, and five Western European languages.
- Code and the addresses of links are searched, so that commands and linked domains can be found. Rejected: prose
  only, and code without link addresses.
- Parts of words and typos are matched in the content too, with a time limit for every search. A measurement on
  3,000 pages of about 18,000 characters showed the cost: a typo search in the content took about 6 s, a search for
  a part of a word about 0.4 s, and the save of a page of 100,000 characters went from about 18 ms to about 38 ms.
  A second measurement, on 3,000 pages of about 20,000 characters, showed that comparing a word with the whole text
  of each page costs about 6.5 s for every search, also one without a typo, because every word of a search is also
  checked for typos. Typos are therefore matched against the words that occur in the pages of the folder, which took
  about 1 ms, and not against the whole text of each page. This list of words shows nothing that a user of the
  folder could not read, because every role reads every page of its folder, and it is kept current in the same save
  as the page (R30). Rejected: parts of words in the content with typos in titles and names only, titles and names
  only, and typos compared with the whole text of each page, which would make almost every search in such a folder
  stop as too broad.
- A search in a folder of 3,000 pages of about 20,000 characters finishes within 2 seconds, with and without a typo.
  Rejected: 1 second, and no promised time with the time limit of R22 alone.
- At most 3 searches run at the same time in the whole wiki, because each search may hold a connection to the
  database for up to 5 seconds, and enough broad searches at once would make every page of the wiki wait. A further
  search is turned away at once instead of waiting. Rejected: 2 at a time, which turns searches away more often on a
  busy wiki, and 5, which leaves too few connections for loading pages.
- Irish pages are found by exact words and word starts, because the language detector of the plan does not know
  Irish. Rejected: looking for another detector, which would be a native package of about 100 MB or one without a
  mature Node.js package.
- Enter in an empty field does nothing, and a search that finds nothing says so with a hint on the syntax. Rejected:
  the hint view for an empty field.
- One list of at most the 100 best results, without paging: a broader search needs more precise words. Rejected: 20
  or 50 results per page with paging up to 500.
- A search stops after 5 seconds, which bounds the searches that take longer than R32 promises. Rejected: 2
  seconds, the time R32 promises, which would leave no room for larger folders, and 10 seconds of waiting.
- The search field is shown on every view of the folder, its tabs and pages, and hidden while an action is open.
  Rejected: the field also during an action, where a search would discard unsaved text.
- A typo or a part of a word shows the text around the closest word; a match in the title or name alone the start of
  the text. Rejected: always the start of the text, and no piece of text.
- At most 200 characters and 10 words, which bounds the cost of every search. Rejected: 500 characters and 20 words.
- Deleted pages are never searched, for any role. Rejected: a search in the deleted pages of a folder for Managers
  and Owners in the browser, which can come later.
- The search tool returns 10 results by default, at most 25 per call, up to the 100 best results, because every
  result fills the context of the AI app. Rejected: always the 20 best, and all 100 in one call.
- The words of a search are never logged, since people search for names and incidents. Rejected: logging them.
- A database with the character type `C` is refused, so that search never runs half broken. Rejected: a warning and
  a search that finds parts of words and typos with umlauts wrongly.
- The results are the one list that shows a piece of the text of each page; every other list keeps names and
  metadata only. Rejected: results without a piece of text.
- Every page is searchable right away: existing pages after the update without a step of the operator, and every
  change with the next search, because a page is indexed in the same save. A page is never left unsearchable.
  Rejected: a command that the operator runs after the update.
- The search tool is named `search_pages`, beside `list_folder` and `read_page`. Rejected: `search`.
- The language of a page is detected, never chosen: a choice in the browser is wrong as soon as someone forgets it.
- Parts of words and typos are matched with `pg_trgm`, a trusted extension of PostgreSQL, set by the user as a
  constraint; see `search-plan.md`.

## Open questions
