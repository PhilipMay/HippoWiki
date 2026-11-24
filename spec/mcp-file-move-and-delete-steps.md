# MCP File Move and Delete – Steps

## Goal

AI apps connected to a folder through MCP move, rename and delete a single image or PDF, as a user of the same role
does in the browser: a Writer and a Manager connection with `move_or_rename_file`, a Manager connection also with
`delete_file`. Only reverting a file stays in the browser. The plan is written from
`spec/mcp-file-move-and-delete-requirements.md`, whose IDs (R1 to R17) the steps name.

## Scope

- In: the services `moveOrRenameFile()` and `deleteFile()` of `src/features/files/service.ts` for the actor of MCP; the
  list of the pages that showed or linked a file when it was deleted; the tools `move_or_rename_file` and
  `delete_file` with their input and output schemas, errors, hints and log lines; the instructions of the server and
  the descriptions of the tools that change with them; the spec files that say a single file is moved, renamed or
  deleted only in the browser.
- Not in: reverting a file and listing the versions of a file through MCP; seeing or restoring deleted files through
  MCP; moving a file into another folder; moving or deleting several files in one call; any change in the browser,
  its dialogs and its texts included.

## Checklist

- [ ] File services for MCP actors
- [ ] Tool `move_or_rename_file`
- [ ] Tool `delete_file`
- [ ] Instructions and descriptions
- [ ] Spec tests
- [ ] Wrap-up

## File services for MCP actors

### Goal

The services that move, rename and delete a file take the actor of MCP as they take the actor of the browser, and a
delete returns the pages that showed or linked the file when it was deleted (R8, R11, R13, R14 in the service).

### Build

- `moveOrRenameFile()` and `deleteFile()` in `src/features/files/service.ts` take a `ContentActor` instead of a
  `BrowserActor`, as `moveOrRenamePage()` and `deletePage()` of the pages service do. The role check stays
  `roleOnFolderOfFile()` with `refusedByRole()` and the functions `editFile` and `deleteFile`, which for an actor of
  MCP already is the lower of the user's current role and the role of the connection, on the folder of the connection
  only. The last editor gets the channel of the actor through `openContentWrite()`, and the log lines name it through
  `channelOf()`, as they do already. Neither service reads the store, so both work while the files are off (R13).
- `deleteFile()` returns, besides the place of the file, the pages of the folder that are not deleted and show or link
  the file, with their id, name, tab and title (`LinkingPage`), sorted as `listPagesLinkingToFile()` sorts them. They
  are read in the transaction of the delete, before the update and after it takes the exclusive lock of the links of
  the folder (`lockFolderLinks()`, with `LINKS_TRANSACTION`), as a move does, so that the list holds every link stored
  before the delete and no save adds one in between. The query of the links of a file is shared with
  `listPagesLinkingToFile()` rather than written twice. The type of the result gets a name of its own (for example
  `DeletedFilePlace`) instead of `FilePlaceNames`.
- The action `deleteFile()` of `src/features/files/actions.ts` keeps using only the place; the browser does not change.
- The comments of both services lose "Only the browser moves files" and "Only the browser deletes a single file", and
  say that the browser and MCP call them.

### Test

- Integration tests in `integration/file-service.test.ts`, with the actor of MCP built by `inMcp()`:
  - A Writer connection moves and renames a file; the file has the new name, place and lock version, its last editor is
    the user via `mcp`, and the links and embeds of the pages are updated as in the browser.
  - A Reader connection is refused with `not-allowed`, and so is a Writer connection of a user whose role is now
    Reader; the file is unchanged.
  - A Manager connection deletes a file; it is deleted with its versions, its last editor is the user via `mcp`, and
    its name is free at once.
  - A Writer connection, and a Manager connection of a user whose role is now Writer, are refused with `not-allowed`;
    nothing is deleted.
  - A delete returns the pages that show the file with `![[…]]` and that link it with `[[…]]`, each once, without
    deleted pages and without the pages of other folders; a delete of a file that no page uses returns an empty list.
  - With the files off (the state of the store set as in `integration/file-upload-link-service.test.ts`), a move and
    a delete through MCP succeed.
- The existing tests of the browser actor still pass unchanged, apart from the new field of the result of a delete.
- End-to-end specs: `e2e/move-or-rename-file.spec.ts`, `e2e/delete-file.spec.ts` and `e2e/deleted-items.spec.ts`,
  because the services they call change.

## Tool `move_or_rename_file`

### Goal

A Writer and a Manager connection move a file of the folder of the connection into another existing tab of the
folder, or directly into the folder, and rename it, in one call (R1 to R7, R11, R13, R15 to R17 for the move).

### Build

- `src/features/mcp/tool-schemas.ts`:
  - `moveOrRenameFileInput`: `tab` and `file` as in `readFileInput`; `newTab`, the name of an existing tab or null, as
    in `moveOrRenamePageInput`; `newName`, the new name with the extension of the file's type (R3), whose description
    states the name rule of files and says to pass the old name to keep it; `lockVersion`, the lock version that
    `read_file` or `list_folder` gave (R4), a plain optional number as in `fileUploadLinkInput`, so that a call
    without it is the tool error of a changed file and not an error of the schema. No argument names a folder (R16).
  - `movedFileOutput`: the note first (R17), then `name`, `tab`, `type`, `address`, `detailsAddress`, `wikiLink`,
    `embedLink` (null for a PDF) and `lockVersion` of the file as stored, with the descriptions of `fileOutput` (R7),
    and `updatedPages`, as `updatedPagesOutput` (R5).
- `src/features/mcp/tools.ts`, `moveOrRenameFile()`, built like `moveOrRenamePage()` and run through `run()`, which
  logs the call with the names of its arguments and the outcome (R17; `file`, `newTab` and `newName` are already in
  `NAME_KEYS`):
  - The file is found with `fileService.getFile()` by its tab and name, as `read_file` finds it; none, a deleted one
    and the name of a page included, is `fileNotFound()`, which points to `list_folder` (R2).
  - The target tab is found with `tabIdOf()`; an unknown tab is `tabNotFound()`, which names `create_tab` for a
    Manager connection and the browser for the others (R16).
  - The errors of the service, each saying that nothing was changed: `not-allowed` is `NOT_ALLOWED` (R16);
    `file-not-found` is `fileNotFound()`; `file-changed` is a new tool error `fileChanged()`, which names who changed the
    file last, how and when, from the file of the error, and says to read it again with `read_file` and base the move
    on its current `lockVersion` (R4); `tab-not-found` is `tabNotFound()`; `invalid-input` says what to do: for a name
    with another extension or none it names the extension of the file's type, such as `.png`, as the field error of
    the service does, and for a name that breaks the name rule it states `FILE_NAME_RULE` (R3); `name-taken` is a new
    tool error that names the file and the target place and says to choose another name (R3); `failed` is
    `WRITE_FAILED` (R16).
  - A stored move and a move to the current name and place both return `movedFileOutput`; the second returns the lock
    version unchanged and no updated page (R6). The addresses come from `addressOf()`, the wiki and embed links from
    the tab and name as stored, as `fileData()` builds them.
- `src/features/mcp/server.ts`: `move_or_rename_file` is registered when `mayDo(role, "editFile")`, after
  `get_file_upload_link`, with the hints `WRITES` (R15) and a description that says what it moves, that it states the
  `lockVersion`, that the name keeps its extension, that a move to the current name and place changes nothing, that
  the links and embeds of the file in every page of the folder follow in the same change, and what it returns,
  followed by `USER_TEXT_NOTE`.

### Test

- Unit tests in `src/features/mcp/tools.test.ts`: the tool is listed for a Writer and a Manager connection and not for
  a Reader connection, with the hints of a tool that writes and without `destructiveHint`; it is in
  `USER_TEXT_TOOLS`; each error of the service gives its tool error, with `list_folder`, `.png`, the name rule,
  `create_tab` for a Manager and the browser for a Writer where R2, R3 and R16 ask for them; the result of a move and
  of a move to the current name and place; the log line names the old and new file names and the outcome.
- End-to-end tests in a new spec `e2e/mcp-files.spec.ts`, against the MCP endpoint as `e2e/mcp-write.spec.ts` calls it:
  - A Writer connection moves `setup.png` from the folder into the tab `guides` as `setup-v2.png`; `list_folder` and
    `read_file` show it there, the old name and place are not found, the wiki link of the result is
    `[[guides/setup-v2.png]]` and the lock version is one higher (R1, R7).
  - A page with `![[setup.png]]` and `[[setup.png|label]]` has `![[guides/setup-v2.png]]` and
    `[[guides/setup-v2.png|label]]` afterwards, and the result names that page with its name, tab and title (R5).
  - An unknown name, the name of a page and the name of a deleted file are tool errors that name `list_folder` (R2);
    `setup.jpg` and `setup` name `.png`, `Setup.png` states the name rule, a name taken at the target is refused (R3);
    a move based on the lock version before a new version in the browser is refused (R4); a move into the unknown tab
    `archive` names `create_tab` on a Manager connection and the browser on a Writer connection (R16). In each case
    the file keeps its name, place and lock version.
  - A move to the current name and place succeeds with the same lock version and no updated page (R6).
  - A call of `move_or_rename_file` at the Reader address changes nothing (R1).
  - After a move through MCP the details page of the file shows the last change "by <user> via mcp" (R11).
- The tests that count or list the tools of a connection, in `src/features/mcp/tools.test.ts`,
  `e2e/mcp-write.spec.ts` and `e2e/mcp-manager.spec.ts`, have eleven tools for a Writer and fifteen for a Manager
  connection after this step.
- End-to-end specs: `e2e/mcp-files.spec.ts`, `e2e/mcp-write.spec.ts`, `e2e/mcp-manager.spec.ts`,
  `e2e/mcp-read.spec.ts`, `e2e/mcp-access.spec.ts` and `e2e/mcp-attachments-spec-tests.spec.ts`.

## Tool `delete_file`

### Goal

A Manager connection deletes a file of the folder of the connection as the browser does, and learns which pages showed
or linked it (R8 to R10, R11, R13 to R17 for the delete).

### Build

- `src/features/mcp/tool-schemas.ts`:
  - `deleteFileInput`: `tab` and `file` as in `readFileInput`, and `lockVersion` as in `moveOrRenameFileInput` (R9).
  - `deletedFileOutput`: the note first (R17), then `name`, `type`, `tab` (the tab the file was in, or null),
    `deletedItemsAddress` (the full URL of `/deleted-items/<folder>`), `restore`, and `shownOrLinkedFrom`, the pages
    of the folder that showed or linked the file when it was deleted, with name, tab and title, as `read_file` names
    the field (R10, R14).
- `src/features/mcp/tools.ts`, `deleteFile()`, built like `deletePage()` and run through `run()` (R17):
  - The file is found as in `move_or_rename_file` (R2, R9).
  - A new text `RESTORE_FILE`, like `RESTORE_PAGE`: a Manager or Owner restores the file with all its versions in the
    browser under Deleted items at `deletedItemsAddress`; deleted items can be neither seen nor restored through this
    connection (R10).
  - The errors of the service: `not-allowed` is `NOT_ALLOWED` (R16), `file-not-found` is `fileNotFound()`,
    `file-changed` is `fileChanged()` of the move step with "nothing was deleted" (R9), `failed` is `WRITE_FAILED`.
- `src/features/mcp/server.ts`: `delete_file` is registered when `mayDo(role, "deleteFile")`, after `delete_page`, with
  the hints `WRITES_AND_DELETES` (R15) and a description that says that the file goes with all its versions to the
  deleted items of the folder, where a Manager or Owner restores it in the browser, that it states the `lockVersion`,
  that a file that pages still show or link is deleted all the same and those pages then show it as missing, and that
  the result lists those pages so that they can be changed (R14), followed by `USER_TEXT_NOTE`.

### Test

- Unit tests in `src/features/mcp/tools.test.ts`: the tool is listed only for a Manager connection, with
  `destructiveHint`; it is in `USER_TEXT_TOOLS`; each error of the service gives its tool error; the result holds the
  name, type, tab, the full address of the deleted items, `restore` and the pages of the service, and an empty list
  for a file that no page uses; the log line names the file and the outcome.
- End-to-end tests in `e2e/mcp-files.spec.ts`:
  - A Manager connection deletes `guides/setup.png`, which the page `guides/setup` shows; the result holds the name,
    the type, the tab `guides`, the full URL of `/deleted-items/<folder>` and that page with its name, tab and title
    (R10, R14). Afterwards the file is missing from `list_folder`, `read_file` and `search_pages`, and the page shows
    the image as missing (R8).
  - Deleting a file that no page uses gives an empty list (R14).
  - A delete based on the lock version before a rename in the browser is refused and the file is still there (R9); an
    unknown or deleted file is a tool error that names `list_folder` (R2).
  - A delete after the user's role was lowered to Writer changes nothing (R16); a call at the Writer and the Reader
    address changes nothing (R8).
  - The deleted file is listed under "Deleted items" with the user who deleted it, via mcp (R11), and a Manager
    restores it there in the browser with all its versions (R8).
- The tests that count or list the tools of a Manager connection have sixteen tools after this step, and the test of
  the hints of a Manager connection has `destructiveHint` on `delete_file` and not on `move_or_rename_file` (R15).
- End-to-end specs: as in the move step.

## Instructions and descriptions

### Goal

The texts of the server tell each connection what it may do with files, and no text says any more that a file is
moved, renamed or deleted only in the browser (R12).

### Build

- `src/features/mcp/server.ts`:
  - `ROLE_ABILITIES`: a Writer connection moves and renames files with `move_or_rename_file`; a Manager connection also
    deletes them with `delete_file`; both state the `lockVersion` that `read_file` or `list_folder` gave, and a change
    based on an older one is refused. The sentence of a Manager about deleting a tab no longer suggests it is the only
    way a file is deleted.
  - `FILES_IN_BROWSER` says for every connection that a file is reverted to an earlier version only in the browser,
    and that deleted files can be neither seen nor restored through this connection. The Reader connection is offered
    neither tool.
- `src/features/mcp/tool-schemas.ts`: the description of `lockVersion` in `fileOutput` names `move_or_rename_file` and
  `delete_file` next to `get_file_upload_link`.
- The descriptions of `read_file`, `list_folder` and `delete_tab` are checked for sentences that send moving, renaming
  or deleting a file to the browser, and changed where they do.

### Test

- Unit tests in `src/features/mcp/tools.test.ts`: the instructions of each role name the tools it gets and not the
  others; no instruction and no description of any role contains "moved", "renamed" or "deleted" together with "only
  in the browser" for a file; every role is told that a file is reverted only in the browser and that deleted files
  are neither seen nor restored through MCP.
- End-to-end: the tests of `initialize` in `e2e/mcp-read.spec.ts`, `e2e/mcp-write.spec.ts` and
  `e2e/mcp-manager.spec.ts` that compare the instructions are updated and pass; specs as in the move step.

## Spec tests

### Goal

Tests written from the requirements alone check that the two tools keep what they promise.

### Build

- Start the `spec-tester` agent with `spec/mcp-file-move-and-delete-requirements.md` and wait for it, as "Step plans"
  in `spec/step-plan-workflow.md` describes. The tests it keeps belong to this step.
- A finding with High confidence within the scope of this plan is fixed in this step, and the failing test of its
  Evidence is added back with the fix; any other finding stops the plan.

### Test

- The tests of the agent pass, with the fixes of this step.
- End-to-end specs: those the agent adds or changes, and those of the code a fix changes.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in the existing feature specs, and move the rules and decisions of the requirements
   file that still hold into them:
   - `spec/mcp.md`: in "Tools", five, eleven and sixteen tools; `move_or_rename_file` with the write tools of a Writer
     connection and `delete_file` with the tools of a Manager connection, with their inputs, results, errors and hints;
     the rule that no tool moves, renames, reverts or deletes a single file becomes that only reverting is done in
     the browser, and `delete_tab` is no longer the one tool after which a file is deleted; the list of tools whose
     results start with the note in "Prompt injection"; the instructions of each role; the decisions of the
     requirements (parity with the browser, tools of their own, the name with its extension, the tool names, deleting a
     file in use with the list of its pages, working while the files are off, the hints) replace the decision that
     rejected these tools for now, and "Current limits" keeps only reverting and the versions of a file.
   - `spec/attachments.md`: "Moving, renaming, deleting and restoring", "MCP" and the decision that rejected moving,
     renaming and deleting a single file through MCP for now.
   - `spec/page-deletion.md`: "Deleting a file" names `delete_file` of a Manager connection and the pages it lists.
   - `spec/signed-file-links.md`: the sentences that send moving, renaming and deleting a file to the browser; a move,
     rename or delete through MCP ends a download link of the file as one in the browser does.
   - `spec/optimistic-locking.md`: "Files" and "Callers other than the browser" say that an AI app states the lock
     version for a move and a delete.
   - `spec/architecture.md`, `spec/testing.md` and `spec/tech.md` only where a convention changed, such as the new
     end-to-end spec `e2e/mcp-files.spec.ts` if `testing.md` lists the specs.
2. The feature has no item of its own in `roadmap.md`; check that no item there still says a single file is moved,
   renamed or deleted only in the browser, and change it if one does.
3. Check that `README.md` has all the commands a developer needs, and that its summary of what the prototype can do
   says that AI apps move, rename and delete files.
4. Delete this step file and `spec/mcp-file-move-and-delete-requirements.md`. Every requirement ID (R1 to R17) in the
   comments of the code and the tests, the tests of the spec tests step included, is replaced by the section of the
   feature spec that holds the rule now, or dropped with its sentence kept.
5. Update the spec catalog in `CLAUDE.md`: remove this step file and the requirements file; change the entries of
   `mcp.md` and the other specs only where their question changes.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes the comments of code
  and tests, so it runs all of them and is the last step that changes more than documentation: the complete
  end-to-end suite runs here.
- A search of `spec/`, `README.md`, `CLAUDE.md` and `src/` for "only in the browser" finds no sentence that sends
  moving, renaming or deleting a single file to the browser, and a search for `R1` to `R17` and
  `mcp-file-move-and-delete` finds none of them.
