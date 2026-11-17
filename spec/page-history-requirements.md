# Page History – Requirements

Status: approved

## Goal

Every change of a page's content is kept as a revision, so that users can see how a page developed, look at and
compare earlier states, and set the page back to an earlier revision. A content change by a person or by an AI app can
be undone in the browser without retyping it. Moves and renames of a page are not part of its history.

## Users and roles

- Users with a role on the folder of the page; admins see no content and so no history (see "Only users see content"
  in `content-structure.md`).
- Reader and up: see the history of a page, open, view and compare its revisions.
- Writer and up: revert a page to an earlier revision, since a revert is a content change like "Edit".
- AI apps through MCP: their content changes are recorded as revisions, but they neither see the history nor revert.

## Scenarios

- An AI app rewrites a page through MCP and drops a section. A Writer of the folder opens the history of the page, sees
  the revision "via mcp", opens it, compares it with the revision before, and reverts the page to the revision before. The page
  shows the old content again, and the history has one revision more.
- A Reader wonders why a page changed. They open its history, see who changed it, when and how, and open an older
  revision rendered and as raw Markdown.

## Requirements

### Recording revisions

- R1: Every content change of a page must be recorded as a revision: creating the page and every content save, in the
  browser and through MCP.
  - Acceptance: creating a page and saving its content twice, once in the browser and once through MCP, leaves three
    revisions in its history.
- R23: A revision must be stored in the same write as the content change it records, like the last editor and the
  version of the page: a save that fails records no revision, and every stored content change has its revision.
  - Acceptance: a save refused for an older version or for invalid content leaves the history as it was; after every
    successful content change the newest revision has the content of the page.
- R2: A revision must keep the content and the title of the page after the change, the time of the change, the user
  who made it and how (`web` or `mcp`).
  - Acceptance: the history shows each revision with time, user and channel, and opening a revision shows the content
    as it was saved.
- R3: Moving, renaming, deleting and restoring a page must not record a revision.
  - Acceptance: a page that was moved, renamed, deleted and restored has as many revisions as before.
- R14: A content save whose content is the same as that of the latest revision must not record a revision. The save
  itself works as today: it still makes the user the last editor of the page.
  - Acceptance: opening the editor and saving without a change leaves the number of revisions as it was, and the page
    shows the user as its last editor.

### Keeping revisions

- R4: Revisions must be kept for as long as the page exists, with no limit on their number or age.
  - Acceptance: the first revision of a page is still listed after many later saves.

### Seeing the history

- R17: The history must list the revisions of a page newest first, each with its number (1 for the oldest, counted up
  per page), the time, the user, the channel and the title. It must show at most 100 revisions at once, with links to
  the newer and the older ones.
  - Acceptance: a page with 250 revisions shows revisions 250 to 151 first, and the link to older ones shows 150 to 51.
- R5: A user with the role Reader or higher on the folder must be able to open the history of a page from the page in
  the browser.
  - Acceptance: a Reader sees "History" on a page and the list of its revisions; a user without a role on the folder
    gets the not-found page at the address of the history.
- R6: A user who may see the history must be able to click a revision in the history to open it: the page as it was
  in that revision, first rendered like the page itself. A switch "Rendered | Raw" above the content must show its
  Markdown source instead, and back. The switch is part of the address, so that the raw form can be linked and stays
  after a reload.
  - Acceptance: clicking an old revision in the history shows its rendered content; "Raw" shows its Markdown source,
    also after a reload of the address; "Rendered" shows the rendered content again.
- R24: Above its content, the view of a revision must show the revision line "Revision 5 of 12 · <time> by mike via
  mcp", with "Reverted to revision N" where R20 applies. For every revision but the newest it must show a notice that
  this is an old revision of the page, with a link to the current page (for a deleted page: to the deleted page). Then
  come "Compare" (R7) and, for a Writer and up, "Revert" (R21).
  - Acceptance: an old revision shows its revision line, the notice and the link, which leads to the current page; the
    newest revision shows no notice; a Reader sees "Compare" but no "Revert".
- R7: The open revision must offer "Compare", with which the user selects one of the earlier revisions of the page and
  compares it with the open one; the revision right before it is preselected. The difference is shown as one column
  of the Markdown lines, with added and removed lines marked. The first revision has no earlier one and offers no
  "Compare".
  - Acceptance: opening revision 5 and comparing it with the preselected revision shows exactly the lines added and
    removed since revision 4; selecting revision 1 instead compares 1 with 5; revision 1 shows no "Compare". Any two
    revisions can be compared by opening the newer one.
- R22: A comparison must always go from the older to the newer of the two revisions, in whatever order they were
  chosen. When both have the same content, it must say "No differences" instead of an empty diff.
  - Acceptance: comparing revision 5 with revision 2 shows the same diff as comparing 2 with 5; comparing a revision
    with itself shows "No differences".
- R10: Comparing must stay fast for revisions up to the length limit of a page. When two revisions differ too much to
  be compared quickly, the page must say that they are too different to compare instead of showing a diff.
  - Acceptance: comparing two completely different revisions at the length limit answers within a few seconds with
    either a diff or the message.

### Reverting

- R8: A user with the role Writer or higher must be able to revert a page to an earlier revision from the browser. The
  page then has the content of that revision.
  - Acceptance: after a revert the page shows the content of the chosen revision; a Reader is not offered "Revert",
    and a submitted revert by a Reader changes nothing.
- R11: A revert must record a new revision with the content of the chosen revision, made by the reverting user via
  `web`. No revision is ever removed or changed, so a revert can itself be reverted.
  - Acceptance: after reverting to revision 2 of a page with 4 revisions, the history has 5 revisions and revision 5
    has the content of revision 2.
- R21: "Revert" must be offered only on a revision whose content differs from the current content of the page, so
  never on the newest revision. For any other revision its revert address shows the not-found page.
  - Acceptance: the newest revision, and an older one with the same content as the page, have no "Revert", and
    `?action=revert` with their numbers shows the not-found page.
- R19: "Revert" on a revision must open a "Revert page" dialog that names the revision by its number, time and user.
  Only confirming it reverts the page, and it then shows the page.
  - Acceptance: closing the dialog without confirming changes nothing; confirming shows the page with the content of
    the revision.
- R12: A revert must be refused when the page was changed after the "Revert page" dialog was opened, as for "Edit"
  (see `optimistic-locking.md`): nothing is changed, and the dialog is shown again with a message that names who
  changed the page, how and when.
  - Acceptance: a revert opened before another user's save is refused with the message, and the page keeps that save.
- R20: The history must mark a revision that a revert recorded with the revision it went back to: "Reverted to
  revision N".
  - Acceptance: after reverting to revision 2, the newest revision in the history shows "Reverted to revision 2".
- R16: A revert must check the content of the chosen revision like every content save, with the limits in force at
  the time of the revert. Content that breaks one is refused, nothing changes, and the user sees which limit it
  breaks.
  - Acceptance: reverting to a revision whose content breaks the table cell limit is refused with the message of that
    limit, and the page stays as it was.

### Deleted pages

- R15: The history of a deleted page must be kept. A Manager or Owner of the folder must be able to open it read-only
  from the deleted page, with viewing and comparing but without reverting. A restored page has its whole history
  again.
  - Acceptance: the deleted page view offers "History" to a Manager; its history offers no "Revert"; after a restore
    the page lists the same revisions as before its deletion.

### Pages from before the feature

- R13: Every page that exists when the feature is deployed, deleted pages included, must get one first revision with
  its current content and title, its last editor, channel and time of the last change.
  - Acceptance: right after the deployment the history of an existing page lists one revision that matches its current
    content and "Last updated" line.

### Addresses

- R18: The history, a revision, a comparison and a revert must be views and an action of the page address, like the
  existing views and actions (see "Actions and views" in `content-structure.md`): `?view=history`,
  `?view=revision&revision=<n>` (with `&format=raw` for the raw form), `?view=compare&from=<n>&to=<n>` and `?action=revert&revision=<n>`. A deleted page has
  the same views at `/deleted-pages/<folder>/<id>`, without the action. A moved or renamed page keeps its history at
  its new address.
  - Acceptance: each address shows its view or dialog to a user with the role for it; an unknown, invalid or missing
    revision number, and a view or action beyond the user's role, show the not-found page; after a rename, the history
    at the new address lists the same revisions.

### Browser only

- R9: The history and reverting must be offered only in the browser. MCP gets no tool for them, and the existing MCP
  tools keep their behaviour.
  - Acceptance: the tool list of every MCP connection is unchanged.

## Scope

- In: revisions of page content from every channel, the history list, viewing a revision rendered and raw, comparing
  revisions, reverting in the browser.
- Not in: history of moves and renames; folder history and folder revert (separate entries in `roadmap.md`); merging of
  conflicting edits; history or revert through MCP.

## Effect on existing features

- `pages.md` and `optimistic-locking.md`: "no history" leaves their current limits.
- `optimistic-locking.md`: a revert is a content save and follows its rule (R12).
- New package: a small diff package for comparing revisions (R10).
- `page-deletion.md`: a deleted page keeps its history, and its view offers "History" to a Manager and an Owner (R15).
- `content-structure.md`: the views `history`, `revision` and `compare` and the action `revert` join the views and
  actions of a page address, and the views join those of a deleted page (R18).
- `users-and-login.md`: users cannot be deleted; the history keeps the name of every user who changed a page for as
  long as the page exists, which a later deletion of users has to take into account.
- `pages.md`: a content save checks the limits also when it is a revert (R16); a save without a change records no
  revision (R14).

## Decisions

- Content changes through MCP are recorded as well, so that a user can undo an AI app's change in the browser.
  Rejected: recording only browser changes.
- Reader and up see the history, Writer and up revert: a Reader may already read the page and its last editor, and a
  revert is a content change. Rejected: history from Writer up, or both only for Manager and Owner.
- All revisions are kept for as long as the page exists. Rejected: keeping only the last N revisions, or only those of
  a time window, which would lose old states.
- A revision can be viewed rendered and as raw Markdown, and any two revisions can be compared as a unified diff of
  their lines, which also fits narrow screens. Rejected: side by side columns; comparing only with the revision before
  and the current page.
- A revision opens rendered, like the page, with a switch to the raw form that is part of the address. Rejected:
  opening raw first; both forms at once, which shows a long page twice.
- The view of a revision says which revision it is and, for an old one, that it is not the current page, with a link
  to it. Rejected: the revision line alone.
- Two revisions are picked for a comparison by opening one from the history and selecting an earlier one with
  "Compare". Rejected: picking both in the history list with two columns of marks, and selectors for both sides in the
  comparison.
- The diff comes from a small, widely used package without dependencies (such as jsdiff), with a cap on the size of the
  difference, past which the page says the revisions are too different. Rejected: own diff code, which is more to
  maintain; the package without a cap, which can take seconds on two very different large revisions.
- A revert records a new revision and never removes one, and it is checked like "Edit": the history stays complete,
  and a revert never overwrites a change the user has not seen. Rejected: reverting without the check; dropping the
  revisions after the chosen one.
- A save without a change records no revision, so that the history lists only real changes. Rejected: a revision per
  save.
- The history of a deleted page is kept and can be read by a Manager and an Owner, who already see the deleted page.
  Rejected: hiding it until the page is restored.
- A revert checks the limits in force, so that every stored content is within them. The raw Markdown of the revision
  can still be copied and fixed in the editor. Rejected: reverting past the limits.
- The history shows 100 revisions at once, so that a page with thousands of revisions stays fast. Rejected: showing
  all at once.
- The history, revisions and comparisons are views of the page address and the revert is an action of it, like all
  other views and actions; the history moves with the page. Rejected: an own route per page that never changes.
- A revert is confirmed in a dialog, like a delete. Rejected: reverting at once with a button.
- A revision recorded by a revert names the revision it went back to. Rejected: no mark.
- "Revert" is offered only where it would change the content, so never on the newest revision, and a revert always
  records a revision. Rejected: offering it everywhere, with a revert to the same content recording nothing.
- A revision is stored in the same write as its content change, so that the history and the page never disagree.
  Rejected: storing it afterwards on a best-effort basis.
- A comparison always goes from the older to the newer revision, and says "No differences" for equal content.
  Rejected: the order as chosen; an empty diff.
- Pages from before the feature start their history with one revision of their current state. Rejected: an empty
  history until the next save.

## Open questions
