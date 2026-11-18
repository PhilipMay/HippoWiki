# Unchanged Saves – Requirements

Status: approved

## Goal

Saving a page whose content is the same as the stored content leaves the page as it is: it gets no new last editor,
channel or time of the last change, and its version is not counted up. So the last editor and the time of a page name
only the person or AI app that really changed it, as its history does, and an empty save no longer makes the editor or
dialog of another user fail with "page changed".

## Users and roles

- Writers, Managers and Owners of a folder save page content in the browser; AI apps save it with
  `replace_page_content` through an MCP connection with a role of Writer or Manager. They all get the new behaviour.
- Who may save what does not change: Readers save no content, admins see no content, and the role is checked before
  anything else, as today.
- Operators read the server log, which tells a save without a change from a stored save.

## Scenarios

- Anna opens a page in the editor, reads it, and clicks "Save" without changing anything. She is back on the page, as
  after every save. The page still says it was last changed by Mike via mcp at the time of Mike's change.
- Anna and Bob open the same page in the editor. Anna saves without a change. Bob changes a line and saves: his save is
  stored, because Anna's empty save did not change the page.
- An AI app reads a page and sends its content back unchanged with `replace_page_content`. It gets the usual result
  with the same version it sent, and can go on with its next change based on that version.
- Bob opened the editor before Mike's change and saves without a change. His save is refused with the notice that the
  page was changed, as today, even though his content is the same as Mike's.

## Requirements

### Content saves without a change

- R1: A content save whose content is the same as the stored content of the page must leave the page unchanged: the
  last editor, the channel, the time of the last change and the version stay as they were.
  - Acceptance: after another user saves the page in the browser editor without a change, the page, the lists of the
    folder and tab and `read_page` show the previous last editor, channel and time, and the version is the same as
    before.
  - Acceptance: the same holds for `replace_page_content` through MCP with the stored content.
- R2: A content save without a change must record no revision, as today.
  - Acceptance: the history of the page has the same revisions before and after such a save.
- R3: Content counts as the same when it is equal after the line endings are made uniform, as the content is stored;
  any other difference, such as a space or an empty line at the end, is a change.
  - Acceptance: a save in the browser that sends the stored content with Windows line endings changes nothing; a save
    with one more space at the end of a line is stored as a change.
- R4: A content save without a change must be checked like every other content save: the role first, then the limits
  of the content (R7), then the version of the page it is based on. If the page has another version, the save is
  refused as changed, also when its content is the same as the stored one; a save that states no valid version is
  refused; a save of a deleted page is refused as gone.
  - Acceptance: a browser editor opened before another change, saved without a change, shows the notice that the page
    was changed; `replace_page_content` with an older version and the stored content gets the tool error of a changed
    page.
- R7: A content save without a change must be checked against the limits of a page in force, like every other content
  save. Content that is over a limit lowered after the page was stored is refused with the error of that limit, also
  when it is the same as the stored content; the stored page stays as it is.
  - Acceptance: for a stored page whose content is longer than the length limit in force, saving it in the editor
    without a change shows the length error at the content field, and `replace_page_content` with its stored content
    gets the error of invalid content; the last editor, time and version of the page stay as they were.

### What the user and the AI app see

- R5: After a save without a change in the browser editor, the user must see the page as after every save, without a
  notice.
  - Acceptance: the save leads to the page address, and no message about the unchanged content is shown.
- R6: `replace_page_content` with the stored content must return the usual result of a stored page, with the version
  unchanged.
  - Acceptance: the result has the name, title, tab, address and the version that the call stated.

### Server log

- R8: The server log must record a content save without a change in a line of its own, apart from a stored save, with
  the page and the channel, so that an operator can tell the two apart.
  - Acceptance: a save without a change, in the browser and through MCP, writes a log line that says that the page was
    not changed because its content is the same, and no line that the page was updated.

## Scope

- In: content saves in the browser editor and with `replace_page_content` through MCP.
- Not in: moving or renaming a page to its own name and place, and renaming a folder or tab to its own name; they keep
  making the user the last editor (and, for a page, count the version up). Reverts, which always change the content.

## Effect on existing features

- `page-history.md`, "Revisions": a content save without a change no longer makes the user the last editor and no
  longer counts the version up. Its decision "A save without a change records no revision" stays and gets the reason
  that such a save changes nothing at all.
- `pages.md`: the rule on revisions of a save without a change says that the page itself stays unchanged too.
- `optimistic-locking.md`, "The version of a page": a content save without a change is no stored change and does not
  count the version up; "Which changes are refused" holds for it unchanged (R4).
- `content-structure.md`, "Last editor": a content save without a change changes neither the last editor nor the time
  of the last change. The rule that the last editor changes on exactly the writes that change the time still holds.
- `mcp.md`: `replace_page_content` with the stored content changes nothing and returns the same version.

## Decisions

- A save without a change is refused like every other save when it is based on an older version, so that one rule
  holds for every save and every caller. Rejected: accepting it because it would overwrite nothing.
- Only content saves are covered, because they are the saves that the history compares with. Rejected for now:
  covering unchanged moves, renames of pages and renames of folders and tabs as well.
- The browser and MCP answer as after every save. Rejected: a notice in the browser and an extra field in the MCP
  result, which a user or an AI app does not need to go on.
- A save without a change is checked against the limits like every other save, so that the editor never accepts
  content it could not store. Rejected: letting it pass unchecked because it stores nothing.
- The log tells a save without a change from a stored one, so that an operator reading it sees which saves changed a
  page. Rejected: logging both as "page updated"; logging nothing.

## Open questions
