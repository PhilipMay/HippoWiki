# Unchanged Moves and Roles – Requirements

Status: approved

## Goal

A move or rename of a page that keeps its name and place, and a change of a role on a folder to the role the user
already has, change nothing and must store nothing. Today such a move still makes the user the last editor of the page,
sets a new time of the last change and counts the version of the page up, so that an editor or dialog another user has
open on the page fails as changed for no reason; such a role change still writes the role and is logged as a change.
The feature makes them behave like content saves without a change and renames of folders and tabs to their own name.

## Users and roles

- Writers, Managers and Owners of a folder, who may move and rename pages, in the browser and through MCP with
  `move_or_rename_page` from a Writer or Manager connection.
- Owners of a folder, who give, change and remove roles on it.
- Readers and admins move no pages and change no roles; nothing changes for them.

## Scenarios

- Anna opens "Move or rename page" for the page `setup`, looks at the name and the place and decides to keep both.
  "Save" stays disabled, so she closes the dialog. Ben, who has the page open in the editor at the same time, saves
  his change without a refusal.
- An AI app calls `move_or_rename_page` with the current name and tab of a page and the version it read. The page
  keeps its last editor, its time of the last change and its version; the tool answers with the page as before.
- A request sets the role of a user on a folder to the role the user already has. The role stays as it is, and the
  log does not show it as a role change.

## Requirements

### Moving or renaming a page to its own name and place

- R1: A move or rename of a page to the name and the place it has stored must store nothing: the page must keep its
  last editor, its channel, its time of the last change and its version. The place is the same when it is the tab the
  page is in, or directly in the folder for a page that is in no tab.
  - Acceptance: after a save of the dialog's form with the current name and place, sent although "Save" is disabled,
    and after such a call of `move_or_rename_page`, the page shows the same last editor, channel and time as before,
    and its version is the same.
- R11: A name must count as the same when it equals the stored name once its surrounding spaces are removed, as the
  name is checked before it is stored.
  - Acceptance: a move of the page `setup` to its own place with the name " setup " stores nothing, in the browser and
    through `move_or_rename_page`.
- R2: The rule must hold for every caller of the page service, in the browser and through MCP alike.
  - Acceptance: the same unchanged move through the dialog and through `move_or_rename_page` leaves the page alike.
- R3: An editor or dialog that another user opened on the page before such a save must not be refused as changed
  because of it.
  - Acceptance: user B opens the editor, user A saves an unchanged move, user B saves the content without a refusal.
- R6: Such a save must be checked like every move or rename, in the same order: whoever may not move or rename the
  page, a deleted or missing page, a tab that does not exist, a name that breaks the name rule and a save based on
  another version than the page has, or on none, must be refused as with any other move. Only then is the name and
  place compared with the stored ones.
  - Acceptance: an unchanged move based on an older version is refused as changed: the dialog shows the current name
    and place with the message who changed the page, how and when; `move_or_rename_page` gives its tool error that
    tells the agent to read the page again. A Reader's unchanged move is refused as not allowed.
- R7: Such a save must be answered as every move or rename is: the browser leads to the page address without a
  notice, and `move_or_rename_page` returns the page as stored, with the version the call stated.
  - Acceptance: after an unchanged save of the dialog's form the browser shows the page address with no notice; the
    result of `move_or_rename_page` names the page, its tab, its address and the version that was sent.
- R8: The server log must record such a save in a line of its own, with the page and the channel, not as a move or
  rename.
  - Acceptance: an unchanged move logs a line that differs from "page moved or renamed" and names the page and the
    channel.

### The "Move or rename page" dialog

- R4: "Save" of the "Move or rename page" dialog must be disabled while the name in the field and the chosen place
  are the name and the place the page had when the dialog was opened. The name is compared without its surrounding
  spaces, as the server does (R11), so that the button and the server always agree.
  - Acceptance: the dialog opens with "Save" disabled; changing the name or the place enables it; changing it back, or
    only adding spaces around the name, disables it again.
- R12: While "Save" is disabled, Enter in the name field must submit nothing. The dialog must show no extra text about
  it; the name field keeps its hint about the name rule. An empty name field differs from the current name, so "Save"
  is enabled and the server answers that a name is required.
  - Acceptance: Enter in the unchanged dialog sends no request and leaves the dialog open; no text about the disabled
    "Save" appears; with an empty field "Save" is enabled and saving shows that a name is required.
- R13: After a move refused because the page changed meanwhile, the dialog shows the current name and place, as now,
  and "Save" must be disabled until the user changes the name or the place again.
  - Acceptance: after the refusal the dialog shows the message who changed the page, the current name and place, and
    a disabled "Save"; changing the name enables it, and saving moves the page.

### Changing a role to the same role

- R5: A change of a user's role on a folder to the role the user already has must store nothing.
  - Acceptance: after such a change the role is stored as before, unchanged.
- R9: A change to the same role must be checked like every role change, in the same order: an admin, someone who is
  not an Owner of the folder and a user without a role on the folder must be refused as with any other role. Only
  then is the role compared with the stored one.
  - Acceptance: a change to the same role by a Writer of the folder is refused as not allowed; for a user without a
    role it is refused as for any other role.
- R10: A change to the same role must be answered like every role change, and the server log must record it in a line
  of its own, with the folder, the user, the role and the Owner, not as "role changed".
  - Acceptance: the Owner stays in the roles view without an error; the log shows a line that differs from "role
    changed".

## Scope

- In: moves and renames of pages to their own name and place, in the browser and through MCP; the "Move or rename
  page" dialog; changes of a role on a folder to the same role.
- Not in: content saves, reverts and renames of folders and tabs, which already store nothing without a change;
  restoring a deleted page; creating pages, tabs and folders; giving and removing roles.

## Effect on existing features

- `pages.md`, `content-structure.md` and `optimistic-locking.md` say that a move or rename of a page to its own name
  and place makes the user the last editor and counts the version up, and list covering it as rejected for now. That
  rule changes (R1).
- `mcp.md`: `move_or_rename_page` with the current name and place changes nothing.
- `folder-roles.md`: a change to the same role is no role change and is logged in a line of its own; the rule that
  every role change is logged stays true for real changes.
- The "Move or rename page" dialog opens with "Save" disabled, where it was enabled once the page had loaded.
- Nothing changes for content saves, reverts, renames of folders and tabs, deleting and restoring pages, the history
  of a page, connected apps and OAuth.

## Decisions

- An unchanged move or rename stores nothing, like a content save without a change. Rejected: refusing it with a
  message.
- The rule holds in the browser and through MCP. Rejected: the browser only.
- "Save" of the "Move or rename page" dialog is disabled while nothing changed, like that of the rename dialogs of
  folders and tabs. Rejected: keeping it enabled.
- Changes of a role to the same role are part of the feature. Rejected: covering only pages.
- An unchanged move based on an older version is refused as changed, like an unchanged content save, so that one rule
  holds for every change of a page. Rejected: accepting it without checking the version.
- An unchanged move is answered as every move is, like unchanged content saves and renames. Rejected: a notice in the
  browser and a note in the result of `move_or_rename_page`.
- An unchanged move is logged in a line of its own, like unchanged content saves and renames. Rejected: no log line;
  logging it as a move.
- A change to the same role is checked in the usual order with the comparison last, answered like every role change
  and logged in a line of its own. Rejected: refusing it with an error that the role is already set.
- The name is compared without its surrounding spaces, by the dialog and by the server alike, as for folders and tabs.
  Rejected: comparing the exact text.
- Enter submits nothing while "Save" is disabled, and the dialog shows no extra text, as the rename dialogs of folders
  and tabs. Rejected: a hint such as "Change the name or place to save"; Enter sending the unchanged name and place.
- The dialog compares with the name and place it was opened with, also after a refusal reloaded it with the current
  page, so that "Save" is disabled then until the user enters the move again. Rejected: keeping "Save" enabled after
  the refusal.

## Open questions
