# Optimistic Locking – Requirements

Status: approved

## Goal

Two users who change the same page at the same time must not overwrite each other without noticing. A change to a
page is refused when it is based on an older state of the page than the one stored, instead of silently replacing the
newer change. The rule lives where every caller passes, so that the later MCP write tools use it unchanged.

## Users and roles

- Users who change pages in the browser, as their role on the folder allows (see `folder-roles.md`): Writers and
  above edit, move and rename pages, Managers and Owners delete them. Readers change no page, and admins see and change
  no content; for them nothing changes.
- Callers other than the browser, such as the later MCP write tools: no such caller changes pages yet. The feature
  sets the rule they have to follow.

## Scenarios

- Anna and Ben both open the editor of the page "Release plan". Anna saves first; her change is stored. Ben saves a
  minute later. His save is refused: the editor shows the page as Anna stored it, with a message that the page was
  changed in the meantime. Ben makes his change again on the current content and saves.
- Clara opens the "Delete page" dialog of a page. Before she confirms, Ben saves a change to the page. Clara's delete
  is refused, so that she does not delete a change she has not seen.
- Ben opens the "Move or rename page" dialog. Before he saves, Anna changes the page. Ben's move is refused.

## Requirements

### Refusing a change based on an older state

- R1: Saving the content of a page must be refused when the page was changed after the editor was opened.
  - Acceptance: two users open the editor of the same page; the first saves; the save of the second is refused, and
    the page keeps the content of the first.
- R2: Moving or renaming a page must be refused when the page was changed after the "Move or rename page" dialog was
  opened.
  - Acceptance: a user opens the dialog; another user saves a change to the page; the move or rename of the first
    user is refused, and the page keeps its name and place.
- R3: Deleting a page must be refused when the page was changed after the "Delete page" dialog was opened.
  - Acceptance: a Manager opens the dialog; a Writer saves a change to the page; the delete is refused, and the page
    is still shown at its address.
- R4: A change must succeed as today when the page was not changed after the editor or dialog was opened.
  - Acceptance: editing, moving, renaming and deleting a page that nobody changed in the meantime works as before; the
    existing end-to-end tests of these pass unchanged.
- R7: Every stored change of the page must count as a change in R1 to R3: a content save, a move and a rename, by any
  user.
  - Acceptance: a user opens the editor; another user renames the page; the content save of the first user is
    refused. A user opens the "Move or rename page" dialog; another user saves the content; the move is refused.
- R10: A change that the same user stored in another browser tab must count like a change by another user.
  - Acceptance: one user opens the editor of a page in two tabs, saves in the first and then in the second; the save
    in the second tab is refused.
- R11: A change of a page that was deleted after the editor or dialog was opened must be refused as today, with the
  message that the page no longer exists.
  - Acceptance: a user opens the editor; a Manager deletes the page; the save shows the message that the page no
    longer exists, as before this feature.
- R14: A change from the browser that does not state the state of the page it is based on, such as one from an editor
  or dialog opened before the feature was deployed, must be refused like a change based on an older state (R5, R8).
  - Acceptance: a content save, move, rename or delete without the state of the page is refused, changes nothing, and
    the editor or dialog is shown again with the current page and the message of R9.

### What the user sees after a refused change

- R5: When saving the content is refused, the editor must show the current content of the page and the message of
  R9. The text the user entered is not kept.
  - Acceptance: after the refused save of R1, the editor holds the content of the first save and shows the message.
    Saving it again without a change is no longer refused.
- R8: When a move, rename or delete is refused, its dialog must stay open and show the page as it is stored now (in
  the "Move or rename page" dialog its current name and place) and the message of R9. The name and place the user
  entered are not kept. Confirming again must then succeed, unless the page was changed once more.
  - Acceptance: after the refused move of R2, the dialog shows the name and place as stored and the message; saving
    the dialog again moves or renames the page. After the refused delete of R3, the dialog shows the message;
    confirming again deletes the page.
- R9: The message after a refused change must name the user who last changed the page and the time of that change,
  as the page shows them, for example "This page was changed by anna at 14:32 after you opened it."
  - Acceptance: the message of a refused change names the last editor and the time of the last change of the page.
- R12: When the page has a new address because it was moved or renamed in the meantime, the editor or dialog of R5 and
  R8 must be shown at the new address.
  - Acceptance: a user opens the editor; another user renames the page; after the refused save, the browser shows the
    editor at the page's new address.

### Callers other than the browser

- R6: The rule of R1 to R3 must not depend on the browser: a caller other than the browser must state, with every
  change of a page, the state of the page its change is based on, and is refused in the same cases. A change that
  does not state it must be refused, as in the browser (R14).
  - Acceptance: a change through the page service without the browser, based on an older state of the page, is
    refused like one from the browser; a change that states no state is refused and changes nothing.

### Restoring

- R13: Restoring a deleted page must stay as it is: it is not checked against a change in the meantime.
  - Acceptance: the existing end-to-end tests of restoring pass unchanged; two Managers who restore the same page at once get
    today's message that the page no longer exists among the deleted pages for the second restore.

## Scope

- In: refusing content saves, moves, renames and deletes of pages that are based on an older state of the page; what
  the user sees in the browser after a refused change; the rule for later callers other than the browser.
- Not in: folders and tabs (renaming them keeps "the last save wins"); creating pages, which a taken name already
  protects; merging two changes; a page history; showing who else is editing a page right now; the MCP write tools
  themselves.

## Effect on existing features

- `pages.md`: saving the content of a page can be refused because of a change in the meantime.
- `content-structure.md`: "no handling of concurrent changes" under "Current limits" no longer holds for pages; moving
  and renaming a page can be refused.
- `page-deletion.md`: deleting a page can be refused; restoring is not changed.
- `mcp.md`: nothing changes now; the MCP tools only read. The later write tools follow R6.
- Editors and dialogs that are open while the feature is deployed: their next change is refused once (R14).
- `roadmap.md`: the entry "Optimistic locking with versions" is done; "MCP write tools" still waits for page history.

## Decisions

- The feature protects the browser now and sets the rule for the later MCP write tools, so that those need no rule of
  their own. Rejected: protecting only the browser and leaving the rule for MCP to its own feature.
- Every change of a page is checked, delete included, not only content saves: a move, rename or delete should not
  happen to a page whose latest change the user has not seen. Rejected: checking only content saves, or content saves
  with moves and renames.
- Folders and tabs are left out: a rename changes only a name, and a taken name is already refused.
- After a refused content save, the editor is loaded again with the current content and the user's text is dropped.
  Rejected: keeping the user's text with a message and a link to the current page, and keeping it with the current
  content shown below the editor for comparison.
- Any stored change of the page counts, not only the kind of change being made: the rule is "the page is as you saw
  it, or your change is refused". Rejected: only content saves counting, which would make the rule differ per change.
- A refused move, rename or delete reloads its dialog, like the editor. Rejected: closing the dialog and showing the
  page with a message.
- The message names the last editor and the time, which the page already shows to everyone who may change it.
  Rejected: a message that says nothing about who or when.
- The user's own changes in another tab count like those of another user, so that one tab never overwrites the other
  silently. Rejected: refusing only changes of other users.
- Restoring is not checked: nothing changes a deleted page, and two restores at once are already told apart today.
  Rejected: checking restore as well, for the very rare delete, restore and delete again while the dialog is open.
- A caller other than the browser must always state the state of the page, so that an AI assistant cannot skip the
  check and overwrite a page it read minutes ago. Rejected: an optional state, with "the last save wins" without it.
- A browser change without the state of the page is refused as well, so that one rule holds for every caller. It
  costs a user at most one reload for an editor or dialog left open over the deployment. Rejected: accepting it as
  before, which would weaken R6 for the browser for good or need a later change to remove the exception; accepting it
  for one release only.

## Open questions
