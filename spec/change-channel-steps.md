# Change Channel – Steps

## Goal

Every folder, tab and page stores how it was last changed: in the browser (`web`) or by an AI app through MCP (`mcp`).
The browser shows the channel after the user name wherever it shows the last editor ("by mike via mcp"), and AI apps
are told it by `read_page`, `list_folder` and the error of an outdated version. Readers can then see at a glance which
content an AI app changed last. The requirements are in `spec/change-channel-requirements.md` (R1 to R10).

## Scope

- In: the stored channel `web` or `mcp` of every folder, tab and page, set on exactly the writes that set the last
  editor (R1, R2); `web` for all content stored before (R3); the channel after the user name in every sentence of the
  browser that names the last editor (R4), in the change notice of optimistic locking (R6) and in the view of a deleted
  page (R5); a column "Via" in the list of all pages of a folder (R10) and in the deleted pages list (R5); the channel
  in `read_page` (R7) and in the error of an outdated version (R8); the last editor and the channel of every tab and
  page in `list_folder` (R9).
- Not in: which AI app or connection made a change; a history of changes or editors; other channels than `web` and
  `mcp`; filtering or sorting lists by channel; an explanation of the channel on hover; telling apart the content that
  AI apps changed before this feature; a change of the log lines, which keep naming the channel `browser` or `mcp` and
  the grant as today; a change of the instructions that a client gets when it connects; the admin overview
  `/folder-roles`, which keeps showing no last editor; the open finding of `review-report.md` about whole `TabSummary`
  rows in Client Components, which stays open (the channel reaches only users who see it in the tab list anyway).

## Checklist

- [x] Store the channel with the last editor
- [x] Show the channel in the browser
- [ ] Tell AI apps the channel through MCP
- [ ] Wrap-up

## Store the channel with the last editor

### Goal

Every write that records the last editor of a folder, tab or page also records its channel, in the same write, and
every read that returns the last editor returns the channel with it. Content stored before gets `web` (R1, R2, R3).

### Build

- `prisma/schema.prisma`: an enum of the stored channel with exactly the values `web` and `mcp`, and a required field
  of that enum on `Folder`, `Tab` and `Page` next to `lastEditedById` (for example `lastEditedVia`), with a doc comment
  that it changes on the same writes as the last editor. For a deleted page it is how the page was deleted.
- A hand-written migration in a new directory that sorts after `20261117120000_mcp_manager_role` (see "Database" in
  `architecture.md`): it creates the enum, adds the three columns as `NOT NULL DEFAULT 'web'`, so that every existing
  folder, tab and page, deleted pages included, gets `web` (R3), and then drops the default, so that no write can
  leave the channel out. `npm run db:migrate` must report that the database matches the schema.
- `src/features/folder-roles/service.ts`: one function next to `channelOf()` that gives the stored channel of a
  `ContentActor`: `web` for the actor of the browser, `mcp` for the actor of MCP. The actor's own channel stays
  `browser`, and the log lines stay as they are. Update the doc comment of `channelOf()`, which says that the content
  does not show the channel.
- `src/features/folders/service.ts` and `src/features/pages/service.ts`: every write that sets `lastEditedById` sets
  the channel from the actor in the same `data`: creating and renaming a folder, creating and renaming a tab, the
  pages deleted with a tab, and creating, editing, moving or renaming, deleting and restoring a page. No other write
  sets it, so a change inside a folder or tab leaves the channel of the folder or tab as it is (R2).
- `src/features/users/records.ts`: `LAST_EDITOR_SELECT` also selects the channel, and `LastEditor` and
  `withLastEditor()` carry it next to the name (for example `{ name, via }`), so that every read that returns the last
  editor (folder list, folder, tabs, pages, all pages, deleted pages, a page, a deleted page) returns the channel with
  it. Update the comments that describe the last editor.
- `prisma/seed.ts`: the seeded folders, tabs and pages get `web`.
- `e2e/support/database.ts`: the helpers that create a folder, a tab or a page take an optional channel, `web` unless
  given, so that the later steps can create content last changed through MCP.
- The unit and integration tests that build or compare rows with a last editor get the channel.

### Test

- Unit tests in `src/features/folder-roles/service.test.ts`: the stored channel is `web` for `inBrowser()` and `mcp`
  for `inMcp()`.
- Unit tests in `src/features/users/records.test.ts`: `withLastEditor()` returns the name and the channel and nothing
  else of the user.
- Integration tests in `integration/folder-service.test.ts` (R1, R2):
  - creating and renaming a folder in the browser give `web`;
  - creating and renaming a tab give `web` with the actor of the browser and `mcp` with the actor of MCP;
  - deleting a tab through MCP gives each of its pages `mcp`, and in the browser `web`; the folder keeps its channel;
  - a tab created through MCP in a folder last changed in the browser leaves the folder at `web`;
  - a refused write (a taken name, a role too low) leaves the channel as it was.
- Integration tests in `integration/page-service.test.ts` (R1, R2):
  - creating, editing, moving or renaming and deleting a page give `web` with the actor of the browser and `mcp` with
    the actor of MCP; restoring in the browser gives `web`, also for a page deleted through MCP;
  - a page edited through MCP and then in the browser has `web`, and the other way round `mcp`;
  - a save, move, rename or delete based on an older version is refused and leaves the channel, the last editor and
    the time as they were;
  - creating or moving a page into a tab leaves the channel of the tab and the folder as it was;
  - the reads that return the last editor return the channel with it.
- End-to-end: `e2e/mcp.spec.ts` checks in the database that `delete_page`, `delete_tab`, `create_tab`, `rename_tab`
  and the write tools of pages store `mcp`, next to the existing checks of `lastEditedById`; `e2e/delete-tab.spec.ts`
  checks that the pages of a tab deleted in the browser store `web`. Because the migration adds columns without a
  default that may not be empty, the step runs the complete `npm run test:e2e` (see "When a step is done" in
  `step-plan-workflow.md`).
- Manual check (R3): on a development database with content from before this step, `npm run db:migrate` applies the
  migration, and a query shows `web` for every folder, tab and page, deleted pages included.

## Show the channel in the browser

### Goal

The browser shows how each folder, tab and page was last changed wherever it shows the last editor: after the user
name as "via web" or "via mcp" in a sentence, and in a column "Via" in the two tables (R4, R5, R6, R10).

### Build

- One place that writes "by <user> via <channel>", so that all sentences read the same: the channel in lowercase, as
  plain text, with no explanation on hover.
- `src/features/pages/components/PageView.tsx`: the header reads "Last updated <time> by <user> via <channel>" (R4),
  and the notice of a refused change reads "This page was changed by <user> via <channel> at <time> after you opened
  it." (R6), for a refused save, move, rename and delete.
- `src/features/folders/components/FolderList.tsx` (the folder list), `src/features/folders/components/FolderContentsList.tsx`
  (the tabs in the contents of a folder) and `src/features/pages/components/PageListItem.tsx` (the pages in the
  contents of a folder and of a tab): "by <user> via <channel>" (R4).
- `src/features/pages/components/AllPagesList.tsx`: a column headed "Via" right after "Updated by", with `web` or `mcp`
  (R10).
- `src/features/pages/components/DeletedPagesList.tsx`: a column headed "Via" right after "Deleted by" (R5).
- `src/features/pages/components/DeletedPageView.tsx`: "Deleted <time> by <user> via <channel>" (R5).
- The tables keep fitting on a phone; the new column follows the layout of the existing ones.

### Test

- End-to-end tests, with content created through the helpers of `e2e/support/database.ts` with the channel `mcp` where
  a test needs a change through MCP:
  - `e2e/pages.spec.ts` and `e2e/edit-page.spec.ts`: a page last changed through MCP shows "Last updated <time> by
    <user> via mcp"; after an edit in the browser it shows "by <user> via web" (R4, scenarios 1 and 2).
  - `e2e/edit-page.spec.ts`, `e2e/move-or-rename-page.spec.ts` and `e2e/delete-page.spec.ts`: the notice of a refused
    save, move, rename and delete names the channel, "This page was changed by bob via web at <time> after you opened
    it." and with `mcp` for a page changed through MCP meanwhile (R6).
  - `e2e/folders.spec.ts`: the folder list and the contents of a folder show "via <channel>" after each last editor,
    for pages and tabs (R4).
  - `e2e/tabs.spec.ts`: the pages of a tab show "via <channel>" after each last editor (R4).
  - `e2e/all-pages.spec.ts`: the column "Via" follows "Updated by" and shows `mcp` and `web` for pages last changed
    each way (R10).
  - `e2e/deleted-pages.spec.ts` and `e2e/delete-tab.spec.ts`: the column "Via" follows "Deleted by" and shows `mcp`
    for a page deleted with the helper channel `mcp`, also one deleted with its tab, and `web` for a page deleted in
    the browser; the view of a deleted page reads "Deleted <time> by <user> via <channel>" (R5).
  - `e2e/restore-page.spec.ts`: a restored page shows "via web".
  - The helpers in the specs that match text ending with "by <user>" match "by <user> via <channel>".
  - `e2e/access.spec.ts`: an admin still sees no last editor and no channel anywhere.
- Manual check: on a phone width, the list of all pages and the deleted pages list with the new column stay readable.

## Tell AI apps the channel through MCP

### Goal

An AI app learns through MCP how a page was last changed when it reads it or is refused for an outdated version, and
`list_folder` tells it the last editor and the channel of every tab and page (R7, R8, R9).

### Build

- `src/features/mcp/tools.ts`:
  - `read_page`: a field for the channel next to `lastEditedBy` in the structured result and the text, `web` or `mcp`,
    with a description that says what each value means (R7).
  - `pageChanged()`: the tool error reads "The page was changed by <user> via <channel> at <time>, …" (R8), for every
    change and delete based on an older version.
  - `list_folder`: each tab and each page gets its last editor and its channel next to `lastChanged`, with
    descriptions in the output schema (R9). The services already return both.
- The descriptions of the tools that mention the last editor name the channel as well.

### Test

- Unit tests in `src/features/mcp/tools.test.ts`: `read_page` returns the channel in the structured result and the
  text; `list_folder` returns the user name and the channel of every tab and page; the error of an outdated version
  names the user, the channel and the time.
- End-to-end tests in `e2e/mcp.spec.ts`:
  - `read_page` of a page created in the browser gives `web`; after `replace_page_content` it gives `mcp` and the user
    of the connection (R7).
  - `list_folder` gives the user name and `web` or `mcp` for every tab and page, matching how each was last changed
    (R9).
  - Of two changes based on the same version, the second is refused with "changed by <user> via mcp at <time>"; a
    change based on a version older than an edit in the browser names `via web` (R8, scenario 4).
  - With a logged-in browser of the same user: after `replace_page_content` the page reads "by <user> via mcp"
    (scenario 1), and after `delete_tab` the deleted pages list shows `mcp` under "Via" for each page of the tab
    (scenario 3).

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed. For this feature, extend the existing
   specs instead of writing a new one:
   - `content-structure.md`: "Last editor" stores and shows the channel with the user, on the same writes, with `web`
     for content stored before; "Lists and order" names the column "Via" of the list of all pages; "Only users see
     content" keeps the channel as hidden from admins as the last editor; the decisions of the requirements (channel
     only, not the app; everywhere the last editor is; "via <channel>"; `web` for old content; the column "Via"; plain
     text); the migration in the code pointers.
   - `mcp.md`: `read_page` and `list_folder` with the channel and the last editor, the error of an outdated version,
     the rule that a change through MCP shows "via mcp"; replace the decision "A change through MCP shows only the user
     as the last editor …" and the limit that the page does not show that a change came through MCP; keep "via <app>"
     rejected.
   - `page-deletion.md`: the deleted pages list with the column "Via" and the view of a deleted page with the channel.
   - `optimistic-locking.md`: the notice and the MCP error name the channel.
   - `pages.md`: the page header shows the channel.
2. Remove the feature from `roadmap.md`.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
