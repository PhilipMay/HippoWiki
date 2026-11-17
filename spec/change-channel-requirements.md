# Change Channel – Requirements

Status: approved

## Goal

Every folder, tab and page already shows when it was last changed and by whom. It now also shows how that change was
made: in the browser (`web`) or by an AI app through MCP (`mcp`). Readers can then see at a glance which content an AI
app changed last, and so know what to check.

## Users and roles

- Every user who may see a folder, tab or page sees how it was last changed, wherever the last editor is shown today.
  No role sees more or less than today: the channel is shown exactly where the last editor is.
- An AI app connected through MCP is told how a page was last changed, where it is told the last editor today, and
  `list_folder` tells it the last editor and the channel of every tab and page of the folder.
- Admins see no content and no last editor (see "Only users see content" in `content-structure.md`); nothing changes
  for them. The admin overview `/folder-roles` keeps showing no last editor.

## Scenarios

- Mike asks an AI app to rewrite the page "setup". Anna opens the page and reads "Last updated Nov 17, 2026, 1:27 PM by
  mike via mcp". She knows that an AI app made the change and reads the page with that in mind.
- Anna edits the page in the browser. The page then shows "by anna via web".
- A Manager connection of an AI app deletes the tab "drafts" with its pages. The deleted pages list of the folder shows
  for each of these pages that mike deleted it through MCP.
- An AI app reads a page through MCP and learns that it was last changed by anna in the browser. A change it then sends
  with an older version is refused with a message that names anna, the channel and the time.

## Requirements

### Storing the channel

- R1: Every folder, tab and page must store how it was last changed: `web` for a change in the browser, `mcp` for a
  change through MCP. These are the only two values.
  - Acceptance: after each write that records the last editor (see "Last editor" in `content-structure.md`), the item
    has the channel of that write: creating, renaming, editing, moving, deleting and restoring in the browser give
    `web`; creating, editing, moving, renaming and deleting a page and creating, renaming and deleting a tab through
    MCP give `mcp`.
- R2: The channel must change on exactly the writes that change the last editor, in the same write, so that time, name
  and channel always describe the same change. A write that fails changes none of them.
  - Acceptance: a change inside a folder or tab (for example creating a page in it) leaves the channel of the folder or
    tab as it is; a refused or failed write leaves the channel of the item as it was.
- R3: All content stored before this feature must get `web` as its channel.
  - Acceptance: after the update of an existing installation, every folder, tab and page, deleted pages included,
    shows "via web".

### Showing the channel in the browser

- R4: Everywhere the browser shows the last editor of a folder, tab or page in a sentence, the channel must follow
  the user name after the word "via", in lowercase and as plain text: `mike via web` or `mike via mcp`.
  - Acceptance: the page header reads "Last updated <time> by <user> via <channel>", for example "Last updated Nov 17,
    2026, 1:27 PM by mike via mcp"; the folder list, the contents of a folder and the pages of a tab show "via
    <channel>" after each last editor.
- R10: The list of all pages of a folder must show how each page was last changed in a column of its own, headed
  "Via", next to "Updated by".
  - Acceptance: for a page that mike last changed through MCP, the list shows `mike` under "Updated by" and `mcp` under
    "Via"; for one changed in the browser, `web`.
- R5: The deleted pages of a folder must show how each page was deleted. The deleted pages list must show it in a
  column of its own, headed "Via", next to "Deleted by"; the view of one deleted page must show it after the user, as
  in R4.
  - Acceptance: for a page that a connection of mike deleted through MCP, also when it was deleted with its tab, the
    deleted pages list shows `mike` under "Deleted by" and `mcp` under "Via", and the view of the page reads "Deleted
    <time> by mike via mcp"; a page deleted in the browser shows `web` and "via web".
- R6: The notice that a change was refused because the page was changed meanwhile must name the channel after the
  user.
  - Acceptance: after a refused save, move, rename or delete in the browser, the notice reads "This page was changed
    by <user> via <channel> at <time> after you opened it."

### Telling AI apps through MCP

- R7: `read_page` must return how the page was last changed, next to its last editor, as `web` or `mcp`.
  - Acceptance: the structured result and its text both hold the channel.
- R8: The error for a change or delete based on an older version must name the channel after the user who changed the
  page last.
  - Acceptance: the tool error reads "The page was changed by <user> via <channel> at <time>, …".
- R9: `list_folder` must return, for each tab and each page, its last editor and how it was last changed, next to the
  time of its last change.
  - Acceptance: the structured result and its text hold the user name and `web` or `mcp` for every tab and page of the
    folder.

## Scope

- In: storing `web` or `mcp` with every change of a folder, tab or page; showing it wherever the last editor is shown in
  the browser and in MCP; the last editor and the channel in `list_folder`; `web` for all content stored before.
- Not in: which AI app made a change (its name or its connection); a history of changes or editors; other channels than
  `web` and `mcp`; filtering or sorting lists by channel; an explanation of the channel on hover; telling apart the
  content that AI apps changed before this feature.

## Effect on existing features

- Last editor (`content-structure.md`): the channel is stored and shown with the last editor, on the same writes. The
  list of all pages of a folder gets a column "Via".
- MCP (`mcp.md`): the decision "A change through MCP shows only the user as the last editor, like a change in the
  browser; the log keeps the channel until page history can show it" changes: a change through MCP now shows "via mcp"
  after the user. Showing which AI app made it ("via <app>") stays rejected: "via" names only the channel.
  `read_page` and the error for an outdated version name the channel, and `list_folder` now returns the last editor
  and the channel of each tab and page.
- Deleted pages (`page-deletion.md`): who deleted a page is shown with how it was deleted; the deleted pages list
  gets a column "Via".
- Optimistic locking (`optimistic-locking.md`): the notice and the MCP error name the channel.
- Pages (`pages.md`): the page header shows the channel.

## Decisions

- The channel is shown so that readers can tell changes by AI apps from changes in the browser. Rejected: showing which
  AI app made a change, because the name of an app is chosen by the app itself and may be long or misleading, and two
  values are enough to tell AI changes apart.
- The channel is shown everywhere the last editor is, so that the two never tell different stories. Rejected: only the
  page header and the lists, and only the page header.
- The channel follows the user name as "via <channel>" ("by mike via mcp"), as the user asked. Rejected: the channel
  in brackets ("by mike (mcp)").
- Content stored before this feature gets `web`, also where an AI app made the last change, because the past cannot
  be told apart and the channel is right from the next change on. Rejected: a third value such as "unknown" for old
  content.
- The two tables, the deleted pages list and the list of all pages, show the channel in a column of its own headed
  "Via", so that both look alike; the other places show it in the sentence "by mike via mcp". Rejected: the channel
  in the cell of the user, and the heading "Channel", a word the interface uses nowhere else.
- The channel is plain text, so that it reads the same on touch screens. Rejected: an explanation on hover.
- `list_folder` returns the last editor and the channel, so that an agent sees which pages an AI app changed last
  without reading each one. Rejected: leaving `list_folder` as it is.
- AI apps are told the channel too, so that an agent sees whether a person or another agent changed a page. Rejected:
  the browser only.

## Open questions
