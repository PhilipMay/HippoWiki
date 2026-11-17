# MCP Manager Role – Requirements

Status: approved

## Goal

An AI app connected to a folder through MCP gets full management of the folder's content, with all the rights it
needs to read, write and manage the folder: besides reading and writing pages, it deletes pages and creates, renames
and deletes tabs. Today an agent can only fill a folder, not tidy it up; a user who is Manager or Owner of a folder
has to do every deletion and every change of tabs in the browser.

## Users and roles

- A user whose current role on a folder is Manager or Owner may connect an AI app to the new Manager address of the
  folder. Readers and Writers may not; admins never connect apps, as today.
- A Manager connection may do everything a Writer connection may, and in addition delete a page, create a tab, rename
  a tab and delete a tab.
- A Manager connection may not see the deleted pages of the folder, read one or restore one, see any roles, list the
  Owners, rename the folder or give, change or remove roles. These stay in the browser.
- A Reader or Writer connection keeps exactly the tools it has today.

## Scenarios

- An Owner of the folder "project-x" opens the view "AI apps", copies the Manager address and adds it to an AI
  assistant. On the consent page the user sees the folder, the role Manager and what it allows, and approves. The
  user asks the assistant to sort the folder: the assistant lists the folder, creates the tabs "meetings" and
  "guides", moves the pages into them, renames the tab "misc" to "archive" and deletes two outdated pages.
- A Manager asks the assistant to remove the tab "drafts". The assistant lists the folder and sees five pages in it;
  the tool tells it that all pages of the tab are deleted with it, and the assistant asks the user before the call. The
  call deletes the tab and its five pages and returns their names; the assistant tells the user that a Manager or
  Owner can restore them one by one in the browser under "Deleted pages", at the address it was given.
- A Manager is lowered to Writer by an Owner. The next request of the Manager connection is refused until the user is
  Manager or Owner again; the connection itself stays on `/account`.

## Requirements

### Address and connecting

- R1: Every folder must have a third MCP address, `/mcp/<folder-uuid>/manager`, which a user whose current role on
  the folder is Manager or Owner can connect an AI app to.
  - Acceptance: a Manager and an Owner approve a connection to the Manager address on the consent page and the app
    can call its tools.
  - Acceptance: a Reader and a Writer who start a connection to the Manager address are refused like any role that
    is too low, with the same message that no app can be connected to this address.
  - Acceptance: `/mcp/<folder-uuid>/owner` still answers 404, and an authorization request for it is still refused.
- R2: The view "AI apps" of a folder must show the Manager address to a Manager and an Owner, with one sentence on what
  it allows and a copy button, next to the Reader and Writer addresses.
  - Acceptance: a Manager and an Owner see three addresses; a Writer sees the Reader and Writer addresses only; a
    Reader sees the Reader address only.
- R3: The consent page and the list of connected apps on `/account` must name the role Manager for a Manager
  connection, and the consent page must say what that role allows through MCP, deleting pages and tabs included.
  - Acceptance: approving a Manager connection shows the folder, "Manager" and a sentence that names deleting pages
    and tabs; `/account` then lists the app with the folder and "Manager".
- R4: A Manager connection must work only while the user's current role on the folder is Manager or Owner, checked on
  every request, as for the other roles.
  - Acceptance: after the user is lowered to Writer or Reader, or loses the role, every request of the Manager
    connection is refused with the message that the user's role does not allow the address; once the user is Manager
    or Owner again, it works again without connecting anew.

### Tools of a Manager connection

- R5: A Manager connection must get every tool of a Writer connection and the four tools `delete_page`, `create_tab`,
  `rename_tab` and `delete_tab`; a Reader or a Writer connection must neither get nor reach them.
  - Acceptance: the tool list of a Manager connection has nine tools, that of a Writer connection five and that of a
    Reader connection two.
  - Acceptance: a call of one of the four tools through a Writer or Reader connection changes nothing.
- R6: `delete_page` must delete a page of the folder, named by its tab, if it is in one, and its name, based on the
  version that `read_page` gave, exactly as deleting it in the browser does.
  - Acceptance: the page is missing from `list_folder`, `read_page` answers that it does not exist, and in the
    browser it is listed under "Deleted pages" of the folder with the user of the connection as the user who deleted
    it.
  - Acceptance: a delete based on an older version, or on none, is refused with the message that names who changed
    the page last and when and tells the agent to read the page again; nothing is changed.
  - Acceptance: the result names the deleted page (name, title, the tab it was in) and says that a Manager or Owner
    can restore it in the browser under "Deleted pages", with the full address `/deleted-pages/<folder>`.
- R7: `create_tab` must create a tab in the folder with the given name, under the same name rule as in the browser.
  - Acceptance: the new tab is listed by `list_folder`, and `create_page` and `move_or_rename_page` can use it at once.
  - Acceptance: a name that breaks the name rule, or the name of an existing tab of the folder, is a tool error that
    says what to do next; nothing is created.
  - Acceptance: the result names the tab and its address.
- R8: `rename_tab` must give a tab of the folder, named by its current name, a new name, under the same rules as in the
  browser; like in the browser, a rename is not checked against changes meanwhile.
  - Acceptance: after the rename, `list_folder` lists the tab and its pages under the new name and the pages under
    their new addresses.
  - Acceptance: an unknown tab, a name that breaks the name rule, and the name of another tab of the folder are tool
    errors that say what to do next; nothing is changed.
  - Acceptance: the result names the tab and its new address.
- R9: `delete_tab` must delete a tab of the folder, named by its name, together with all its pages, exactly as
  deleting it in the browser does, and its description must make clear before the call that all pages of the tab are
  deleted with it.
  - Acceptance: the description of the tool says that every page in the tab is deleted with it, that the tab is
    deleted for good and cannot be restored, and that its pages can only be restored one by one by a Manager or Owner
    in the browser.
  - Acceptance: one call deletes the tab and all its pages at once, without a further confirmation, all or nothing;
    the tab is missing from `list_folder`, its name is free at once, and every page of it is listed under "Deleted
    pages" of the folder with the user of the connection as the user who deleted it.
  - Acceptance: the result names the tab, the number of pages deleted with it and the name and title of each, and
    says that a Manager or Owner can restore the pages one by one in the browser under "Deleted pages", with the full
    address `/deleted-pages/<folder>`.
  - Acceptance: a tab that does not exist, also one deleted meanwhile, is a tool error that says what to do next;
    nothing is changed.
  - Acceptance: an empty tab is deleted as well; the result names the tab, the number 0 and no pages.
  - Acceptance: the list of pages in the result has no limit: a tab with many pages lists every one of them.
- R10: The tools that delete (`delete_page`, `delete_tab`) must tell the client that they are destructive; `create_tab`
  and `rename_tab` must tell it that they write.
  - Acceptance: the tool list shows the destructive hint on `delete_page` and `delete_tab` and the write hints on all
    four.
- R14: The four tools must answer errors like the existing write tools: a change whose role is too low, because the
  role was lowered meanwhile, is refused as not allowed, and a failure of the database is a tool error with a general
  message that is logged and not passed on.
  - Acceptance: a call after the user's role was lowered below Manager between the check of the request and the write
    changes nothing and says that the role does not allow the change.
  - Acceptance: a failure of the database changes nothing and gives the agent a general message; the log holds the
    error.

### What a Manager connection cannot do

- R11: A Manager connection must not see, read or restore deleted pages, see any roles of the folder, list its Owners,
  rename the folder, or give, change or remove roles.
  - Acceptance: no tool of a Manager connection does any of this; a deleted page is answered like a page that does not
    exist, as for the other roles.
  - Acceptance: the Owner role stays no role of MCP: no address, tool or connection gives an AI app a function of an
    Owner.

### Instructions and records

- R12: The instructions that a Manager connection gets when it connects must name the folder and the role Manager,
  say what the role allows, say that deleting a tab deletes all its pages with it, and say that deleted pages can be
  neither seen nor restored through MCP, only by a Manager or Owner in the browser.
  - Acceptance: the instructions of a Manager connection contain these points; those of Reader and Writer connections
    are unchanged.
- R13: Every change through a Manager connection must record the user of the connection as the last editor, as a
  change in the browser does, and its log line must name the channel `mcp` and the grant.
  - Acceptance: a page deleted through MCP, alone or with its tab, shows the user as the user who deleted it; a tab
    created or renamed through MCP shows the user as its last editor; the log of a tab deletion through MCP names the
    channel, the grant and the number of pages.

## Scope

- In: the Manager address per folder, connecting to it, the four tools `delete_page`, `create_tab`, `rename_tab` and
  `delete_tab`, the instructions of a Manager connection, and the texts of the view "AI apps", the consent page and
  `/account` for the role Manager.
- Not in: seeing, reading or restoring deleted pages through MCP; seeing roles or Owners through MCP; renaming the
  folder and changing roles through MCP; an Owner address, as a lasting rule; a confirmation of `delete_tab` beyond the
  warning in its description; turning an existing Reader or Writer connection into a Manager connection (the user
  connects the app again to the Manager address); no new limits: the limit of 50 connected apps per user and every limit
  of names and pages stay as they are.

## Effect on existing features

- MCP (`mcp.md`): a third folder address and role of MCP, Manager; the roles `owner` alone still answer 404; four new
  tools; the instructions of a Manager connection; "Manager role for MCP" leaves the current limits.
- Folder roles (`folder-roles.md`): MCP no longer stops at Writer: through MCP a user has the lower of the own role
  and the role of the connection, now Reader, Writer or Manager; the view "AI apps" shows the Manager address to a
  Manager and an Owner. The rule that the Owner role is never a role of MCP stays.
- OAuth (`oauth.md`): an authorization request for the Manager address of a folder is valid; only `owner` and
  everything else stay `invalid_target`.
- Connected apps (`connected-apps.md`): a connected app has the role Reader, Writer or Manager.
- Content structure (`content-structure.md`): tabs are created, renamed and deleted through MCP as well, no longer
  only in the browser.
- Page deletion (`page-deletion.md`): pages are deleted through MCP as well; deleted pages and restoring stay in the
  browser.
- Roadmap (`roadmap.md`): the entry "Manager role for MCP" is done.

## Decisions

- `delete_tab` deletes at once; its description warns that all pages of the tab go with it, and the client and the
  user decide whether to confirm. Rejected: sending the expected number of pages, which is refused when the tab holds
  a different number; and two calls, the first only reporting what would be deleted.
- The result of `delete_tab` lists the name and title of every page deleted with it, so that the agent can tell the
  user exactly what went. Rejected: the number of pages only.
- The results of `delete_page` and `delete_tab` name the full address of the deleted pages of the folder, so that the
  user can restore them in the browser. Rejected: a hint without the address, and no hint.
- Deleted pages, restoring, the roles and the Owners stay out of MCP, also with the goal of full content management:
  undoing a deletion stays a deliberate step of a person in the browser. Rejected: tools that list, read and restore
  deleted pages, and a tool that restores only the pages the agent itself just deleted.
- The list of pages in the result of `delete_tab` has no limit, like `list_folder` and like the number of pages of a
  tab. Rejected: at most 100 names and the number of the rest.
- Accepted: a leaked access token of a Manager connection can delete pages and tabs. Every deleted page can still be
  restored in the browser; only the tabs themselves are gone for good and are created again by name.

## Open questions
