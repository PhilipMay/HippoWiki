# Unchanged Renames – Requirements

Status: approved

## Goal

Renaming a folder or a tab to the name it already has must change nothing, so that the time of the last change, the
last editor and the channel name only who really changed it. Today such a rename stores the item all the same and makes
the user its last editor. The rename dialogs of folders and tabs also keep "Save" disabled while the name is the
current one, so that a user does not save a rename that changes nothing.

## Users and roles

- An Owner of a folder renames the folder, in the browser only.
- A Manager or an Owner of a folder renames its tabs in the browser, and a Manager connection of an AI app renames
  them through MCP with `rename_tab`.
- The roles that may rename stay as they are (see `folder-roles.md`); admins reach no content. An unchanged rename is
  refused to everyone who may not rename, as every rename is.

## Scenarios

- An Owner opens "Rename folder", looks at the name and does not change it. "Save" stays disabled and Enter does
  nothing, so the Owner cancels. The folder keeps its time of the last change and its last editor.
- A Manager opens "Rename tab", changes the name and then changes it back to the current name. "Save" is disabled
  again. Typing a different name enables it.
- A Manager opens "Rename tab" for the tab `guides`. Meanwhile another Manager renames it to `news`. The first Manager
  types `news` and saves: nothing is stored, and the browser leads to the tab `news`.
- An AI app calls `rename_tab` with the current name of the tab. Nothing is stored; the tool returns its usual result,
  and the tab keeps its time of the last change, its last editor and its channel.

## Requirements

### Rename without a change

- R1: A rename of a folder or a tab to the name it already has must store nothing: the item must keep its time of the
  last change, its last editor and its channel.
  - Acceptance: after a rename of a folder to its own name in the browser, the folder list and the folder show the
    same time of the last change and the same last editor with the same channel as before. The same holds for a tab
    renamed to its own name in the browser and through `rename_tab`, in the contents of its folder, the tab itself and
    the result of `list_folder`.
- R2: A name must count as the same when it equals the stored name once its surrounding spaces are removed, as the name
  is checked before it is stored.
  - Acceptance: a rename of the tab `guides` to " guides " stores nothing.
- R6: An unchanged rename must be checked like every rename, in the same order: the role first, then the name rule,
  and only then the comparison with the stored name. A user or connection without the role, an admin, and a folder or
  tab that does not exist must be refused as today, also with the current name.
  - Acceptance: a Writer who submits the current name of a tab, and a Manager connection that calls `rename_tab` for a
    tab that does not exist, get the same refusal as with any other name; nothing is stored.
- R7: The server must compare with the name stored at the moment of the save, not with the name the item had when the
  dialog was opened. Renames of folders and tabs stay unchecked against changes meanwhile: the last save wins.
  - Acceptance: a tab renamed from `guides` to `news` while a "Rename tab" dialog for it is open, and then saved in
    that dialog as `news`, stores nothing and leads to the tab `news`.

### Answer

- R3: An unchanged rename must be answered as every rename is: the browser leads to the address of the item without a
  notice, and `rename_tab` returns its usual result with the tab and its address.
  - Acceptance: an unchanged rename of a folder or tab in the browser ends on the address of the item, with no notice
    shown; `rename_tab` with the current name returns the same result as a rename to a new name would, for the current
    name.

### Save button

- R4: In the "Rename folder" and the "Rename tab" dialog, "Save" must be disabled while the name in the field, without
  its surrounding spaces, is the name the item had when the dialog was opened, and enabled as soon as it differs. The
  dialog shows no extra text about it: the field keeps its hint about the name rule.
  - Acceptance: the dialog opens with "Save" disabled; typing a different name enables it; typing the current name
    again, also with surrounding spaces, disables it. The hint below the field is the same in both cases.
- R8: While "Save" is disabled because the name is unchanged, pressing Enter in the name field must submit nothing.
  - Acceptance: Enter in the field of a dialog with the unchanged name leaves the dialog open and sends no save; with a
    changed name, Enter saves as before.

### Log

- R5: The server log must record an unchanged rename in a line of its own, with the item and the channel, and not as
  "folder renamed" or "tab renamed".
  - Acceptance: an unchanged rename of a folder or tab writes one log line that differs from the line of a rename and
    names the item and the channel.

## Scope

- In: renaming a folder and a tab to its own name, in the browser and through MCP; the "Save" button and the Enter key
  of the two rename dialogs.
- Not in:
  - moving or renaming a page to its own name and place, which keeps making the user its last editor and counting the
    version of the page up
  - the "New folder" and "New tab" dialogs, and the name field of pages
  - a check of folder and tab renames against changes meanwhile
  - an empty name: it differs from the current name, so "Save" is enabled and the server answers "Name is required" as
    today

## Effect on existing features

- `pages.md`, "Saves without a change": renaming a folder or tab to its own name no longer makes the user the last
  editor; the decision that rejected covering renames of folders and tabs for now changes for them. Moves and renames
  of pages stay as they are.
- `content-structure.md`, "Last editor": a rename of a folder or tab to its own name is no edit, and the rename dialogs
  of folders and tabs disable "Save" while the name is unchanged.
- `mcp.md`: `rename_tab` with the current name changes nothing and returns its usual result.
- Optimistic locking, roles, addresses and the history of pages do not change.

## Decisions

- Only folders and tabs are covered, as asked. Rejected for now: moves and renames of pages to their own name and
  place, which touch the version of a page and optimistic locking.
- "Save" compares the name without its surrounding spaces, as the server does, so that the button and the server
  always agree. Rejected: comparing the exact text of the field.
- An unchanged rename is answered as every rename is, as unchanged content saves of pages are. Rejected: a notice in
  the browser and a note in the result of `rename_tab`; a tool error for `rename_tab`.
- An unchanged rename is logged in a line of its own, as unchanged content saves of pages are. Rejected: no log line;
  logging it as a rename.
- An unchanged rename is checked in the order of every rename, the comparison last, as unchanged content saves of pages
  are, so that it never tells someone without the role the current name. Rejected: comparing first.
- The dialog compares with the name it was opened with, the server with the stored name. Rejected: refusing a save
  after a rename meanwhile with a notice, which needs a version for folders and tabs.
- The dialog shows no extra text while "Save" is disabled. Rejected: a hint such as "Enter a new name to save".
- Enter submits nothing while "Save" is disabled, so that the keyboard and the button behave the same. Rejected:
  Enter sending the unchanged name.

## Open questions
