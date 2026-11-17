# Page History – Steps

Written from `spec/page-history-requirements.md` (status `approved`); the requirement IDs below refer to it.

## Goal

Every change of a page's content, in the browser and through MCP, is kept as a revision. Users with a role on the
folder see the history of a page, open a revision rendered or as raw Markdown and compare it with an earlier one;
Writers and up set a page back to an earlier revision in the browser, which records a new revision. Moves, renames,
deletes and restores are not part of the history.

## Scope

- In: a revision for every content change from every channel, stored in the same write (R1, R2, R3, R14, R23), kept
  for as long as the page exists (R4); one first revision for every page that exists at the deployment (R13); the
  history list with 100 revisions at a time (R5, R17, R20); viewing a revision rendered and raw (R6, R24); comparing
  two revisions as a unified diff of their lines, with a cap (R7, R10, R22); reverting in the browser with a dialog and
  optimistic locking (R8, R11, R12, R16, R19, R21); the read-only history of a deleted page for Managers and Owners
  (R15); the views and the action of the page address (R18); no MCP tool for any of it (R9).
- Not in: a history of moves and renames; folder history and folder revert; merging conflicting edits; history or
  revert through MCP; deleting or changing a revision; a limit on the number or age of revisions.

Choices this plan makes where the requirements leave the form open:

- The pages of the history are addressed with `?view=history&before=<n>`: the 100 revisions before revision `n`. The
  first page, with the newest revisions, has no `before` (R17, R18).
- "Compare" on a revision view is a plain `GET` form with a number field "Compare with revision", preset to the
  revision right before the open one and limited to the earlier ones, which leads to
  `?view=compare&from=<chosen>&to=<open>`. A number field instead of a list keeps the view fast for pages with
  thousands of revisions, like the 100 at a time of the history (R7).
- The diff comes from the package `diff` (jsdiff), line by line, with `maxEditLength` as the cap past which the
  revisions are "too different to compare" (R10).
- The history lives in the pages feature (`src/features/pages/`), because a revision is written in the same write as
  the content of the page and a revert is a content save with the same locking.

## Checklist

- [x] Record revisions
- [x] History list
- [x] Revision view
- [ ] Compare revisions
- [ ] Revert a page
- [ ] History of deleted pages
- [ ] Wrap-up

## Record revisions

### Goal

Every content change of a page is stored as a revision in the same write, through the browser and MCP, and every page
that exists before the feature gets its first revision (R1, R2, R3, R4, R9, R13, R14, R23). Nothing shows the history
yet.

### Build

- `prisma/schema.prisma`: a model `PageRevision` with a UUID id, the page (`onDelete: Restrict`, pages are never
  removed), the number of the revision (1 for the oldest, counted up per page, unique per page), the title and the
  content after the change, the time (`timestamptz(3)`), the user who made it (`onDelete: Restrict`, like the last
  editor; users are not deleted) and the channel (`ChangeChannel`), and the number of the revision a revert went back
  to, `null` for every other revision. An index on the page and the number serves both the order of the history and
  the uniqueness. Document the model like the others in the schema.
- A hand-written migration (see "Database" in `architecture.md`), named so that it sorts after all existing ones: the
  SQL of `npx prisma migrate diff`, followed by one `INSERT ... SELECT` that gives every page, deleted pages included,
  revision 1 with its current content and title, its last editor and channel, and `updatedAt` as the time (R13). A
  comment says why `updatedAt` stands for the time of the last content change.
- The unique constraint on page and number gets a constant in `src/lib/db-errors.ts` and a case in
  `integration/db-errors.test.ts`.
- `src/features/pages/service.ts`:
  - `createPage()` stores revision 1 together with the page in one write (a nested create), with the actor and the
    channel of the write.
  - `updatePageContent()` runs its conditional `updateMany` and the revision in one interactive transaction: once the
    update matched, it reads the newest revision of the page and, if its content differs from the saved content,
    stores a revision with the next number (R14: a save without a change records nothing but still makes the actor
    the last editor and counts the version up). The `updateMany` locks the row of the page, so two saves at the same
    time cannot take the same number. A count of 0 records nothing and is told apart as before (R23).
  - `moveOrRenamePage()`, `deletePage()`, `restorePage()` and deleting a tab record nothing (R3); no change there
    beyond tests.
  - The MCP tools call the same functions, so their writes are recorded with the channel `mcp` without a change in
    `src/features/mcp/tools.ts` (R1, R9). The list of tools stays as it is.
- `e2e/support/database.ts`: `createPage()` also inserts revision 1 of the page, with its content, title, editor,
  channel and `updatedAt`, so that every page of a test has a history like a page after the migration. A new helper
  `createRevisions()` adds revisions to a page (count, content per number, editor, channel, time, the revision a
  revert went back to), for the histories of the later steps. `emptyTestDatabase()` reads the tables from `pg_tables`
  and needs no change; check that it empties the new table.
- The comment at the top of the pages service and the doc comments of the changed writes say that they record a
  revision.

### Test

- Unit (`src/features/pages/service.test.ts`): `createPage()` stores revision 1 with title, content, actor and
  channel; `updatePageContent()` stores a revision with the next number when the content changed, none when it is the
  same as the newest revision, and none when it is refused for invalid input, an older version, a missing page or a
  role; an error inside the transaction gives `failed` and is logged.
- Integration (`integration/page-service.test.ts`), on real data:
  - Creating a page and saving its content twice, once as the actor of the browser and once as the actor of MCP,
    leaves three revisions numbered 1 to 3 with the right users and channels (R1, R2).
  - A save refused for an older version or for invalid content leaves the revisions as they were; after every
    successful save the newest revision has the content and title of the page (R23).
  - A save without a change records no revision and makes the actor the last editor (R14).
  - Moving, renaming, deleting and restoring a page, and deleting its tab, leave the number of revisions unchanged
    (R3).
  - Two saves at the same time with the same version (sent with `Promise.all`): one succeeds with one new revision,
    the other is `page-changed`.
- Integration (`integration/db-errors.test.ts`): the new unique constraint is recognised by its constant and by no
  other.
- End-to-end: `e2e/edit-page.spec.ts` checks with `getTestDb()` that a page created and saved in the browser has a
  revision per change with the channel `web`, and that saving without a change adds none (R14);
  `e2e/mcp.spec.ts` checks that `create_page` and `replace_page_content` record revisions with the channel `mcp`, and
  the tool list of every connection stays the same (R9).
- The migration changes data, so the step runs the complete `npm run test:e2e`.
- Manual: before the migration is applied to the development database, make sure it holds pages, a deleted one
  included (create them with the app if not). After `npm run db:migrate`, check with `npm run db:psql` that every page
  has exactly one revision whose content, title, user, channel and time match the page (R13).

## History list

### Goal

A user with a role on the folder opens the history of a page from the page and sees its revisions newest first, 100
at a time (R4, R5, R17, R18, R20).

### Build

- `src/features/pages/schema.ts`: `parseRevisionNumber()`, which accepts only a whole number from 1 up, written
  without sign, leading zeros or other characters, and small enough for the column; anything else counts as missing.
  Unit tests in `schema.test.ts`.
- Pages service: `listPageRevisions(actor: BrowserActor, pageId, { before })`, only for the actor of the browser, so
  that MCP cannot reach it (R9). It needs the function `read` on the folder of a page that is not deleted and
  `deletedPages` on that of a deleted one, and returns `null` without it, for an admin and for a malformed id. It
  returns the number of the newest revision and at most 100 revisions newest first, before the given number if one is
  given, each with number, time, user with channel, title and the revision a revert went back to, without content.
  The limit of 100 is a constant of `src/features/pages/limits.ts`.
- `src/features/pages/queries.ts`: the query of the same name, with its unit test.
- `src/lib/addresses.ts`: the address of the history of a page, with `before` (`pageHistoryPath()`), with unit tests.
  The page addresses get the views `history`, `revision` and `compare`; this step allows `history`.
- Both page routes (`src/app/folders/[folder]/[item]/page.tsx` and `src/app/folders/[folder]/[item]/[page]/page.tsx`)
  accept `?view=history` with an optional `before` that must be a revision number from 2 up to the newest; a view
  together with an action, a `before` without the view, an invalid `before`, and a parameter that belongs to another
  view or action show the not-found page. Put the reading of the views of a page and their parameters into one
  function next to `parsePageNotice()`, which both routes and `generateMetadata` share, with the browser title of
  each view.
- A component `PageHistory` in `src/features/pages/components/`: the breadcrumb of the page with "History", a heading
  with the title of the page, and the list of revisions, each with its number as a link to the revision view (built in
  the next step, the address helper already now), time, user and channel (`editorWithChannel()`), title and, for a
  revision a revert recorded, "Reverted to revision N" (R20). Links "Newer revisions" and "Older revisions" where there
  are any (R17).
- `PageView`: a "History" button for every role on the folder, the Reader included (R5); the comment that a Reader gets
  no buttons changes with it.

### Test

- Unit: `parseRevisionNumber()`, the history address, the query, the service read (role checks: admin, no role,
  Reader of a page, Reader of a deleted page; malformed id; the condition with and without `before`).
- Integration: `listPageRevisions()` returns exactly the declared fields (`toStrictEqual`), newest first, at most 100,
  and the right ones before a number.
- End-to-end, a new spec `e2e/page-history.spec.ts`:
  - A Reader sees "History" on a page and the list of its revisions with number, time, user, channel and title; a
    user without a role gets the not-found page at the address of the history (R5).
  - A page with 250 revisions (`createRevisions()`) shows 250 to 151 first, "Older revisions" shows 150 to 51, then
    50 to 1, so revision 1 is still listed (R4, R17); "Newer revisions" leads back.
  - A revision recorded by a revert shows "Reverted to revision N" (R20), with data from `createRevisions()`.
  - After a rename, the history at the new address lists the same revisions (R18).
  - An invalid, empty or repeated `before`, a `before` beyond the newest, the view together with an action, and an
    unknown view show the not-found page (R18).
- `e2e/access.spec.ts`: the address of a history leads to the login page without a login.

## Revision view

### Goal

A click on a revision in the history opens it, rendered like the page, with a switch to its raw Markdown that is part
of the address; the view says which revision it is and, for an old one, links to the current page (R6, R18, R24).

### Build

- Pages service: `getPageRevision(actor: BrowserActor, pageId, number)` with the same role rules as the history; it
  returns the revision with content, number, time, user with channel, title and the revision a revert went back to,
  the number of the newest revision, and whether its content is the content of the page now (for "Revert" in a later
  step). `null` for a missing number.
- The query of the same name, with its unit test.
- Address helpers: the revision view with an optional raw form (`pageRevisionPath()`).
- Both page routes accept `?view=revision&revision=<n>` with an optional `format=raw`; a missing or invalid revision
  number, a revision the page does not have, and any other `format` show the not-found page.
- A component `RevisionView`: the breadcrumb of the page with "History" and the revision, then above the content the
  revision line "Revision 5 of 12 · <time> by mike via mcp", with "Reverted to revision N" where it applies; for every
  revision but the newest a notice that this is an old revision of the page, with a link to the current page (R24);
  then the switch "Rendered | Raw" as two links with the current one marked (R6), and the content: `MarkdownContent`
  for the rendered form, the Markdown source in a preformatted block that keeps its lines for the raw form. Leave room
  for "Compare" and "Revert" next to the switch.
- The browser title names the revision and the page.

### Test

- Unit: the address helper, the query, the service read (role rules, missing and malformed numbers, whether the
  content is the current one).
- Integration: `getPageRevision()` returns exactly the declared fields, for an old revision and the newest.
- End-to-end, in `e2e/page-history.spec.ts`:
  - Clicking an old revision in the history shows its rendered content, the revision line and the notice with a link
    that leads to the current page; "Raw" shows its Markdown source, also after a reload of the address; "Rendered"
    shows the rendered content again (R6, R24).
  - The newest revision shows no notice (R24).
  - A missing, invalid or unknown revision number and an unknown `format` show the not-found page (R18).
- `e2e/access.spec.ts`: the address of a revision leads to the login page without a login.

## Compare revisions

### Goal

The open revision offers "Compare" with an earlier revision, the one right before preselected; the comparison shows the
lines added and removed from the older to the newer revision, says "No differences" for equal content, and stays fast
by saying that two revisions are too different instead of computing a long diff (R7, R10, R18, R22).

### Build

- Add the package `diff` (jsdiff) in its latest stable version, with types if it does not ship its own.
- A pure module `src/features/pages/diff.ts` (no server-only imports): from the content of the older and the newer
  revision it returns the lines in one column, each marked as added, removed or unchanged, or "same" for equal
  content, or "too different" when jsdiff stops at the cap (`maxEditLength`). The cap is a constant there, chosen with
  the cost test below.
- Pages service: `getRevisionComparison(actor: BrowserActor, pageId, a, b)` with the role rules of the history; it
  reads both revisions, orders them older to newer whatever the order of `a` and `b` (R22), and returns both with
  number, time, user with channel and content. `null` if one of them is missing.
- The query of the same name, with its unit test.
- Address helper: `pageComparePath(folder, tab, page, from, to)`.
- Both page routes accept `?view=compare&from=<n>&to=<n>`; both numbers are required and must be revisions of the
  page, otherwise the not-found page. The same number twice is allowed and shows "No differences" (R22).
- A component `RevisionComparison`: the breadcrumb with "History", a heading that names the two revisions with links to
  their views and their revision lines, and then the diff from `diff.ts` as one column of the Markdown lines, added and
  removed lines marked by color and by a `+` or `−` in front, so that the marks do not rely on color alone; "No
  differences" or the message that the revisions are too different to compare instead of the diff (R10).
- `RevisionView`: for every revision but the first, "Compare" as a `GET` form that works without JavaScript: a number
  field "Compare with revision", preset to the revision right before and limited to 1 up to the one before, and a
  button that leads to the comparison of the chosen revision with the open one (R7). Revision 1 shows no "Compare".

### Test

- Unit (`src/features/pages/diff.test.ts`): added, removed and unchanged lines, a last line without a line break,
  equal content, empty content, and content past the cap.
- Cost (`src/features/pages/diff.cost.test.ts`, project `cost`): two completely different contents at
  `CONTENT_MAX_LENGTH`, with many short lines and with few long ones, each answer with a diff or "too different"
  within 2 s (R10).
- Unit: the address helper, the query, the service read (both orders give the same result, a missing number,
  role rules).
- End-to-end, in `e2e/page-history.spec.ts`:
  - Opening revision 5 and comparing it with the preselected revision shows exactly the lines added and removed since
    revision 4; choosing 1 instead compares 1 with 5; revision 1 shows no "Compare" (R7).
  - Comparing 5 with 2 by address shows the same diff as 2 with 5; a revision with itself shows "No differences"
    (R22).
  - Two completely different revisions at the length limit answer within a few seconds with a diff or the message
    (R10).
  - A missing or invalid `from` or `to`, or a number the page does not have, shows the not-found page (R18).
- `e2e/access.spec.ts`: the address of a comparison leads to the login page without a login.

## Revert a page

### Goal

A Writer and up sets a page back to an earlier revision from its view, confirmed in a "Revert page" dialog; the revert
is a content save checked like "Edit" and records a new revision that names the revision it went back to (R8, R11,
R12, R16, R19, R20, R21).

### Build

- Pages service: `revertPage(actor: BrowserActor, pageId, { revision, version })`, only for the actor of the browser
  (R9). In the order of every write: the actor, the id, the role `editPage` on the folder of the page, then the
  revision number. A missing or malformed number, and a revision whose content is the content of the page now, give a
  new code `revision-not-found` (R21). The content of the revision is checked with the page content schema and the
  limits in force, with `invalid-input` and its field errors when it breaks one (R16). Then, in one transaction like
  `updatePageContent()`, the conditional update of content, title, last editor, channel `web` and version, and a new
  revision with the next number, the actor, the channel `web` and the number it went back to (R11, R20); a version
  that does not match gives `page-changed` as for "Edit" (R12). Share the transaction with `updatePageContent()`
  instead of writing it twice. The declared error type `RevertPageError`; log every outcome like the other writes.
- `src/features/pages/forms.ts` and `actions.ts`: `revertPage(pageId, revision, ...)` reads the version from the form,
  calls the service, maps `page-changed` to a redirect to the revert address with `notice=changed`, `invalid-input`
  to a message that names the broken limit, `revision-not-found` and `not-allowed` to `notFound()`, `failed` to a
  message of its own; on success it revalidates and redirects to the page as stored (R19).
- Address helper: the revert address `?action=revert&revision=<n>`, with `notice=changed` after it.
- Both page routes accept the action `revert` with a revision number, for Writer and up only (`mayDoPageAction()` with
  `editPage`), and render the revision view of that number with the dialog on top. A revision whose content is the
  current content, the newest included, has no revert address: it shows the not-found page (R21). The notice
  `changed` is allowed with it like with the other actions.
- A Client Component `RevertPageDialog` like `DeletePageDialog`: "Revert page" names the revision by number, time and
  user; the version of the page and the revision number in hidden fields; the message of `notice=changed` that names
  who changed the page, how and when (R12); controls locked until hydration; closing leads to the revision view.
- `RevisionView`: "Revert" for Writer and up, only on a revision whose content differs from the page now (R21), as a
  link to the revert address.

### Test

- Unit (service): every code in the order of the checks: admin, no role, Reader, malformed id, missing and malformed
  revision number, a revision with the current content, content past a limit, a missing or older version, a deleted
  page, an error in the transaction; what is stored and logged.
- Unit (actions, forms): every error code gives its form state or redirect; success revalidates and redirects to the
  page; a malformed id or form never reaches the service.
- Integration: reverting to revision 2 of a page with 4 revisions leaves 5 revisions, and revision 5 has the content
  of revision 2, the reverting user, the channel `web` and the mark of revision 2 (R11, R20); a revert based on an
  older version changes nothing; a revert to a revision past the table cell limit is `invalid-input` and changes
  nothing (R16).
- End-to-end, a new spec `e2e/revert-page.spec.ts`:
  - A Writer reverts to an old revision: closing the dialog without confirming changes nothing; confirming shows the
    page with the content of the revision, and the history has one revision more, the newest marked "Reverted to
    revision N" (R8, R11, R19, R20).
  - A Reader sees "Compare" but no "Revert", and the revert address shows the not-found page; a revert submitted with
    the Reader's login (`becomeUser()` or a second user) changes nothing (R8, R24).
  - The newest revision and an older one with the same content as the page have no "Revert", and `?action=revert`
    with their numbers shows the not-found page (R21).
  - A revert opened before another user's save is refused with the message that names who changed the page, how and
    when, and the page keeps that save (R12).
  - Reverting to a revision whose content breaks the table cell limit shows the message of that limit, and the page
    stays as it was (R16).
- `e2e/hydration.spec.ts`: the dialog's controls are locked with JavaScript disabled.
- `e2e/access.spec.ts`: the revert address leads to the login page without a login.

## History of deleted pages

### Goal

A Manager or Owner opens the history of a deleted page from it and views and compares its revisions, without
reverting; a restored page has its whole history again (R15, R18).

### Build

- `src/app/deleted-pages/[folder]/[id]/page.tsx` accepts the views `history`, `revision` and `compare` with the same
  parameters as a page address, and no new action. The reads of the earlier steps already allow a deleted page for
  `deletedPages` only.
- Address helpers for the three views of a deleted page.
- `PageHistory`, `RevisionView` and `RevisionComparison` take the place of the page (a page address or the address
  of a deleted page) instead of building page addresses themselves, so that the same components serve both. They do
  so since the step "History list" (`src/features/pages/components/history-place.ts`); this step adds the place of a
  deleted page. On a deleted page the notice of an old revision links to the deleted page, and there is no "Revert"
  (R15, R24).
- `DeletedPageView`: a "History" button next to "Restore".

### Test

- Unit: the address helpers.
- End-to-end, in `e2e/page-history.spec.ts` or `e2e/deleted-pages.spec.ts`:
  - The deleted page offers "History" to a Manager; its history lists the revisions, a revision view links to the
    deleted page, and comparing works; there is no "Revert", and `?action=revert` shows the not-found page (R15).
  - A Writer and a Reader get the not-found page at the history of a deleted page (R15).
  - After a restore, the page lists the same revisions as before its deletion (R15, R3).
- `e2e/access.spec.ts`: the history of a deleted page leads to the login page without a login.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/page-history.md` (see "Feature specs" in `step-plan-workflow.md`), and move
   the rules and decisions of the requirements file that still hold into it, together with the choices of this plan
   (the address of the history pages, the number field of "Compare", jsdiff with its cap). Update the other specs as
   "Effect on existing features" of the requirements lists them: `pages.md` (a save without a change records no
   revision, a revert checks the limits, the history leaves the current limits), `optimistic-locking.md` (a revert is
   a content save under its rule, "No history" leaves the current limits), `page-deletion.md` (a deleted page keeps
   its history, "History" for Managers and Owners), `content-structure.md` (the views `history`, `revision` and
   `compare` and the action `revert` in "Actions and views", also for deleted pages), `users-and-login.md` (the
   history keeps the name of every user who changed a page), `mcp.md` (its content writes record revisions; no tool
   for the history). Update `architecture.md` (the code `revision-not-found`, writes that store a revision in one
   transaction), `testing.md` (`createPage()` records revision 1, `createRevisions()`, the cost test of the diff) and
   `tech.md` (the package `diff`) where conventions changed.
2. Remove the feature from `roadmap.md`: the entries "Page history" and "Page revert".
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
