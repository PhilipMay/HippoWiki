# MCP File Move and Delete – Requirements

Status: approved

## Goal

AI apps connected to a folder through MCP can move, rename and delete a single image or PDF, as a user of the same
role can in the browser today. MCP then offers for files what the browser offers, apart from reverting to an earlier
version, so that no task on a file has to wait for a person in the browser.

## Users and roles

- An AI app with a Writer connection moves a file of its folder into another existing tab, or directly into the
  folder, and renames it.
- An AI app with a Manager connection does the same and also deletes a file.
- A Reader connection does neither: it gets neither tool.
- The roles follow the browser: every role reads, a Writer moves and renames, a Manager or Owner deletes (see the table
  in `folder-roles.md`). As for every tool, the role of the connection is the most the app may do, and never more than
  the user's current role on the folder.
- A deleted file can be neither seen nor restored through MCP; a Manager or Owner restores it in the browser under
  "Deleted items".

## Scenarios

- An agent reorganises a folder: it moves the page `setup` into the tab `guides` and then the image `setup.png` that
  the page shows, so that both live in the same tab. Every page that shows or links the image is changed to its new
  place in the same change, and the agent sees which pages were changed.
- An agent uploads `scan.pdf` with an upload link, sees that the name is unclear and renames it to
  `network-manual.pdf`; the links to it follow.
- An agent on a Manager connection removes an old diagram that a newer one replaced. The file goes to the deleted
  items of the folder, the pages that still show it show it as missing, and a Manager can restore it in the browser.

## Requirements

### Moving and renaming a file

- R1: A Writer and a Manager connection must be able to move a file of the folder of the connection into another
  existing tab of the folder or directly into the folder, and to give it a new name, in one call of the tool
  `move_or_rename_file`.
  - Acceptance: a Writer connection lists `move_or_rename_file`; a Reader connection does not, and a call of it changes nothing. A
    call moves `setup.png` from the folder into the tab `guides` and renames it; afterwards `list_folder` and
    `read_file` show the file under its new name and place, and the old name and place are not found.
- R2: The file is found by its tab, if it is in one, and its current name with its extension, as `read_file` finds it.
  A file that does not exist, a deleted file included, must be a tool error that points to `list_folder`.
  - Acceptance: a call with an unknown name, the name of a page, or the name of a deleted file is a tool error that
    names `list_folder`, and nothing changes.
- R3: The new name must be given with its extension, like the names that `list_folder`, `read_file` and the wiki links
  use, and must keep the extension of the file's type. Another extension, a name that breaks the name rule of files and
  a name that another file at the target place has must be tool errors that say what to do, and nothing changes.
  - Acceptance: renaming `setup.png` to `setup.jpg` or to `setup` is a tool error that names `.png`; `Setup.png` is a
    tool error that states the name rule; a name another file in the target place has is a tool error; in each case
    the file is unchanged.
- R4: The move must state the lock version that `read_file` or `list_folder` gave for the file. A move based on another
  lock version must be refused with a tool error, and nothing changes.
  - Acceptance: a move after the file was given a new version in the browser, based on the older lock version, is a
    tool error and the file keeps its name and place.
- R5: Every link and embed of the file in the pages of the folder must be changed to the new name and place in the same
  change, as a move in the browser does, and the result must name the pages that were changed.
  - Acceptance: a page with `![[setup.png]]` and `[[setup.png|label]]` shows `![[guides/setup-v2.png]]` and
    `[[guides/setup-v2.png|label]]` after the move, and the result names that page with its name, tab and title.
- R6: A move to the current name and place must change nothing and must not be an error.
  - Acceptance: the call succeeds, the lock version stays the same, and no page is changed.
- R7: The result must give the file as stored: its name, tab, type, the addresses of the file and of its details
  page, its wiki link and embed link (null for a PDF), and its new lock version.
  - Acceptance: after a move the wiki link in the result is `[[guides/setup-v2.png]]` and the lock version is one
    higher than before.

### Deleting a file

- R8: A Manager connection must be able to delete a file of the folder of the connection with the tool `delete_file`. The delete is the soft delete of the browser: the file goes to the deleted items of the folder with all its
  versions, its name is free at once, and the user of the connection is recorded as the user who deleted it.
  - Acceptance: a Manager connection lists `delete_file`, a Writer and a Reader connection do not. After the call the file
    is missing from `list_folder`, `read_file` and search, its pages show it as missing, and a Manager restores it in
    the browser under "Deleted items" with all its versions.
- R9: The file is found as in R2, and the delete must state the lock version that `read_file` or `list_folder` gave. A
  delete based on another lock version must be refused with a tool error, and nothing is deleted.
  - Acceptance: a delete after the file was renamed in the browser, based on the older lock version, is a tool error
    and the file is still there.
- R10: The result must name the deleted file (its name, type and the tab it was in), give the address of the deleted
  items of the folder, and say that a Manager or Owner can restore it there in the browser.
  - Acceptance: the result of deleting `guides/setup.png` holds the name, the type, the tab `guides` and the address
    `/deleted-items/<folder>` as a full URL.
- R14: A file that pages still show or link must be deleted all the same, as in the browser. The description of
  `delete_file` must say before the call that those pages will show the file as missing, and the result must list the
  pages of the folder that showed or linked the file when it was deleted, each with its name, tab and title, so that
  the agent can change them.
  - Acceptance: deleting `setup.png`, which the page `guides/setup` shows, succeeds; the result lists that page with
    its name, tab and title; the page shows the image as missing. Deleting a file that no page uses gives an empty
    list.

### For both tools

- R11: A change through either tool must record the user of the connection as the last editor with the channel `mcp`,
  so that the browser shows "by <user> via mcp", like every other change through MCP.
  - Acceptance: after a move through MCP the details page shows the last change "by <user> via mcp"; after a delete
    the list "Deleted items" shows the same.
- R12: The instructions that an app gets when it connects and the descriptions of the tools must tell what each role may
  do with files: a Writer connection that it moves and renames files, a Manager connection also that it deletes them,
  and every connection that reverting a file is done only in the browser and that deleted files can be neither seen
  nor restored through MCP.
  - Acceptance: no text of the server says any more that a file is moved, renamed or deleted only in the browser; the
    instructions of a Reader connection offer neither tool.
- R13: Both tools must work while the files are off (no files directory), as moving and deleting in the browser do,
  because they change no content of a file.
  - Acceptance: with the files off, a move and a delete through MCP succeed.
- R15: `delete_file` must tell the client that it destroys (`destructiveHint`), like `delete_page`;
  `move_or_rename_file` must carry the hints of a tool that writes, without `destructiveHint`, like
  `move_or_rename_page`.
  - Acceptance: the list of tools of a Manager connection shows these hints for the two tools.
- R16: The errors of both tools must follow the rules of the other tools: a target tab that does not exist is a tool
  error that tells a Manager connection to create it with `create_tab` and the other connections that tabs are created
  in the browser; a role lowered between the request and the change and a failure of the database change nothing and are tool errors, the last with a general message. Neither tool takes a folder.
  - Acceptance: a move into the unknown tab `archive` is a tool error that names `create_tab` on a Manager connection
    and the browser on a Writer connection; a delete after the user's role was lowered to Writer changes nothing.
- R17: Every call of both tools must be logged as the calls of the other tools are, with the tab and file names of
  its arguments and the outcome, and the results, which carry names of files and titles of pages, must start with the
  note that these are data, never instructions (see "Prompt injection" in `mcp.md`).
  - Acceptance: a move writes one log line with the old and new file names and the outcome; both results start with
    `note`.

## Scope

- In: a tool that moves and renames a single file and a tool that deletes a single file, for the connections whose role
  allows it; the texts of the instructions and descriptions that change with them.
- Not in: reverting a file to an earlier version through MCP, and listing the versions of a file through MCP; restoring
  or seeing deleted files through MCP; moving a file into another folder; moving or deleting several files in one call;
  any change in the browser.

## Effect on existing features

- `mcp.md`: the number of tools grows from ten to eleven for a Writer connection and from fourteen to sixteen for a
  Manager connection. The rule "no tool moves, renames, reverts or deletes a single file", the sentences of the
  instructions that send these tasks to the browser, the decision that rejected them for now and the current limit
  change: only reverting stays in the browser. `delete_tab` is no longer the only tool after which a file is deleted.
- `attachments.md`, `page-deletion.md` and `signed-file-links.md`: the sentences and current limits that say a single
  file is moved, renamed or deleted only in the browser change the same way.
- `signed-file-links.md`: a move, rename or delete through MCP ends a download link of the file, as one in the browser
  does already; nothing new.
- `optimistic-locking.md`: an AI app states the lock version for a move and a delete, as the browser states it for its
  dialogs.

## Decisions

- Moving, renaming and deleting are offered through MCP for parity with the browser, with the same roles and rules.
  Reverting stays in the browser. Rejected: reverting through MCP as well, which needs the versions of a file in a
  tool first.
- Files get tools of their own, next to `move_or_rename_page` and `delete_page`. Rejected: page tools that also take a
  file, whose inputs (version and lock version) and texts would no longer fit both.
- The new name of a file is given with its extension, as every tool and every wiki link names a file. Rejected: a name
  without the extension, completed by the wiki.
- The tools are named `move_or_rename_file` and `delete_file`, after the page tools. Rejected: `move_file`, whose name
  does not say that it renames.
- A file that pages show or link is deleted as in the browser, and the result lists those pages, so that the agent can
  change them without another call. Rejected: refusing a file in use, which is stricter than the browser; a result
  with the file only, as `delete_page` gives.
- Both tools work while the files are off, as moving and deleting in the browser do, because they change no content.
  Rejected: refusing them, which would make MCP do less than the browser.
- The hints follow the page tools: only the delete destroys. Rejected: `destructiveHint` on the move as well, which
  would make some clients ask before every move.

## Open questions
