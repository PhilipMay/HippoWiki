# HippoWiki – Page History

The page history as built: every change of a page's content, in the browser and through MCP, is kept as a revision.
Users with a role on the folder see the history of a page, open a revision rendered or as its Markdown source and
compare two revisions; Writers and up set a page back to an earlier revision in the browser. A content change by a
person or by an AI app can so be undone without retyping it. Pages themselves are described in `pages.md`, their
addresses in `content-structure.md`, deleted pages in `page-deletion.md`.

Code: `src/features/pages/` (`listPageRevisions`, `getPageRevision`, `getRevisionComparison` and `revertPage` in
`service.ts`, where `createPage` and `updatePageContent` record the revisions; `diff.ts`; the views `PageHistory`,
`RevisionView`, `RevisionComparison` and `RevertPageDialog` in `components/`, shared by both kinds of addresses through
`HistoryAddress.tsx` and `history-place.ts`), the model `PageRevision` in `prisma/schema.prisma` and its migration
`prisma/migrations/20261117140000_page_revisions/`. Tests: `e2e/page-history.spec.ts`, `e2e/revert-page.spec.ts`,
`integration/page-service.test.ts`, `src/features/pages/diff.test.ts`, `src/features/pages/diff.cost.test.ts`.

## Revisions

- Every content change of a page is recorded as a revision: creating the page and every content save, in the browser
  and through MCP (`create_page`, `replace_page_content`), and every revert.
- A revision keeps the content and the title of the page after the change, the time of the change, the user who made
  it and how (`web` or `mcp`), and, for a revert, the number of the revision it went back to. Revisions are numbered
  per page, 1 for the oldest.
- A revision is stored in the same write as the content change it records, like the last editor and the version of
  the page: a save that is refused or fails records nothing, and after every stored content change the newest
  revision has the content of the page.
- A content save whose content is the same as that of the newest revision records no revision. The save itself works
  as before: it makes the user the last editor and counts the version up (see `optimistic-locking.md`).
- Moving, renaming, deleting and restoring a page record no revision, and neither does deleting a tab with its pages.
- Revisions are kept for as long as the page exists, deleted pages included, with no limit on their number or age. No
  revision is ever changed or removed.
- Every page that existed when the feature was deployed, deleted pages included, got one first revision with its
  content and title at that time, its last editor and channel, and the time of its last change of any kind as the
  time; for a deleted page that is its deletion.

## Seeing the history

- The history, a revision and a comparison are views of the page address: `?view=history`,
  `?view=revision&revision=<n>`, with `&format=raw` for the Markdown source, and `?view=compare&from=<n>&to=<n>` (see
  "Actions and views" in `content-structure.md`). A moved or renamed page keeps its history at its new address.
- A user with any role on the folder, the Reader included, opens the history from the page with "History". Admins see
  no content and so no history; for every other user without a role the addresses show the not-found page.
- The history lists the revisions newest first, each with its number, time, user, channel and title, and "Reverted to
  revision N" for one that a revert recorded. It shows 100 revisions at a time (`REVISIONS_PER_PAGE` in
  `src/features/pages/limits.ts`), with "Newer revisions" and "Older revisions"; the older ones are addressed with
  `&before=<n>`, the revisions before revision `n`, from 2 up to the newest.
- A revision opens rendered like the page. The switch "Rendered | Raw" above it is part of the address, so the raw
  form can be linked. Above the content the revision line says "Revision 5 of 12 · <time> by mike via mcp", and every
  revision but the newest has a notice that it is an old revision, with a link to the current page.
- "Compare" on every revision but the first compares an earlier revision with the open one: a number field, preset to
  the revision right before and limited to the earlier ones, in a form that works without JavaScript.
- A comparison always goes from the older to the newer revision, in whatever order they were given, and shows the
  Markdown lines of both in one column, added and removed lines marked by color and by `+` or `−` in front. Equal
  content, and content that differs only in a line break at its end, says "No differences"; the same revision twice
  is allowed.
- Comparing stays fast for revisions up to the length limit of a page: when more than 2,000 lines are added and
  removed together (`DIFF_MAX_EDIT_LENGTH` in `src/features/pages/diff.ts`), the comparison says that the revisions
  are too different to compare instead of showing a diff.
- An unknown view, a missing, malformed, repeated or unknown revision number, a `format` other than `raw`, a parameter
  of another view or action, and a view together with an action show the not-found page.

## Reverting

- A Writer and up sets a page back to an earlier revision with "Revert" on the revision, which opens the "Revert page"
  dialog (`?action=revert&revision=<n>`) naming the revision by its number, time and user. Only confirming reverts the
  page; it then shows the page.
- "Revert" is offered only on a revision whose content differs from the page now, so never on the newest revision;
  for any other revision, and for a role below Writer, the revert address shows the not-found page. A revert always
  changes the content.
- A revert is a content save: it records a new revision with the content of the chosen revision, made by the
  reverting user via `web`, marked with the revision it went back to. No revision is removed, so a revert can itself
  be reverted.
- A revert is checked like "Edit": it is refused when the page was changed after the dialog was opened, and the dialog
  is shown again with the message that names who changed the page, how and when (see `optimistic-locking.md`). It
  checks the content of the revision with the limits in force at the time of the revert (see `pages.md`): content
  that breaks one is refused, nothing changes, and the dialog names the limit.

## Deleted pages

- The history of a deleted page is kept. A Manager and an Owner open it from the deleted page with "History", with the
  same views at `/deleted-pages/<folder>/<id>`, read-only: no "Revert", and no action besides "Restore" on the deleted
  page itself. The notice of an old revision links to the deleted page. Every other role gets the not-found page.
- A restored page has its whole history again.

## Browser only

- The history and reverting are offered only in the browser. MCP has no tool for them; the content writes of MCP are
  recorded like those of the browser (see `mcp.md`).

## Decisions

- Content changes through MCP are recorded as well, so that a user can undo an AI app's change in the browser.
  Rejected: recording only browser changes.
- Reader and up see the history, Writer and up revert: a Reader may already read the page and its last editor, and a
  revert is a content change. Rejected: history from Writer up, or both only for Manager and Owner.
- All revisions are kept for as long as the page exists. Rejected: keeping only the last N revisions, or only those of
  a time window, which would lose old states.
- A revision is a full copy of the content, not a difference to the one before, so that every revision can be shown
  and compared on its own.
- A revision opens rendered, like the page, with a switch to the raw form that is part of the address. Rejected:
  opening raw first; both forms at once, which shows a long page twice.
- The view of a revision says which revision it is and, for an old one, that it is not the current page, with a link
  to it. Rejected: the revision line alone.
- Any two revisions can be compared as a unified diff of their lines, which also fits narrow screens. Two revisions
  are picked by opening one and choosing an earlier one with "Compare", in a number field instead of a list, so that
  the view stays fast for pages with thousands of revisions. Rejected: side by side columns; comparing only with the
  revision before and the current page; picking both in the history list; selectors for both sides in the comparison.
- A comparison always goes from the older to the newer revision, and says "No differences" for equal content.
  Rejected: the order as chosen; an empty diff.
- The diff comes from jsdiff (`diff`), a small and widely used package without dependencies, with `maxEditLength` as
  the cap past which the revisions are too different; the cap is chosen with the cost test, which compares completely
  different revisions at the length limit in a few hundred milliseconds. Rejected: own diff code, which is more to
  maintain; the package without a cap, which can take seconds on two very different large revisions; a time limit,
  whose result would depend on the load of the server.
- The history shows 100 revisions at a time, addressed by the revision before which they start, so that a page with
  thousands of revisions stays fast and a page of the history stays the same when revisions are added. Rejected:
  showing all at once; numbered pages of the history, which shift with every save.
- The history, revisions and comparisons are views of the page address and the revert is an action of it, like all
  other views and actions; the history moves with the page. Rejected: an own route per page that never changes.
- A revert records a new revision and never removes one, and it is checked like "Edit": the history stays complete,
  and a revert never overwrites a change the user has not seen. Rejected: reverting without the check; dropping the
  revisions after the chosen one.
- A revert is confirmed in a dialog, like a delete, and the revision it records names the revision it went back to.
  Rejected: reverting at once with a button; no mark.
- "Revert" is offered only where it would change the content, and a revert always records a revision. Rejected:
  offering it everywhere, with a revert to the same content recording nothing.
- A revert checks the limits in force, so that every stored content is within them. The raw form of the revision can
  still be copied and fixed in the editor. Rejected: reverting past the limits.
- A save without a change records no revision, so that the history lists only real changes. Rejected: a revision per
  save.
- A revision is stored in the same write as its content change, so that the history and the page never disagree.
  Rejected: storing it afterwards on a best-effort basis.
- The history of a deleted page is kept and can be read by a Manager and an Owner, who already see the deleted page.
  Rejected: hiding it until the page is restored.
- Pages from before the feature start their history with one revision of their current state, timed by their last
  change of any kind, because the time of the last content change was not stored. Rejected: an empty history until
  the next save.
- The history is offered only in the browser. Rejected: history or revert through MCP.

## Current limits

- Moves and renames of a page are not part of its history, and there is no history of a folder and no folder revert
  (see "History and Revisions" in `roadmap.md`).
- Conflicting edits are not merged; a revert refused because of a newer change has to be confirmed again.
- No MCP tool reads the history or reverts.
- A revision can be neither changed nor deleted, and there is no limit on the number or the age of revisions; a page
  with many large revisions keeps all of them for as long as it exists.
- Users cannot be deleted; the history keeps the name of every user who changed a page, which a later deletion of
  users has to take into account (see `users-and-login.md`).
- Two revisions that differ in more than 2,000 lines cannot be compared in the browser; each can still be opened.
