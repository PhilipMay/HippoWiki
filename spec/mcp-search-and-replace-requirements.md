# MCP Search-and-Replace – Requirements

Status: approved

## Goal

An AI app connected to a folder changes a part of a page, such as a sentence or a list item, by naming the exact text
to replace and the text that replaces it, instead of sending the whole content again. This saves text on long pages and
keeps everything the agent did not mean to touch exactly as it was, so that a change cannot drop or garble other parts
of the page by accident.

## Users and roles

- A Writer and a Manager connection get the new tool, like the tool that replaces the whole content of a page.
- A Reader connection does not get it and cannot change a page.
- A connection whose user's role was lowered in the meantime is refused and changes nothing, like every other change
  through MCP.
- The user behind a connection sees the change in the browser like every other change through MCP: in the page, its
  last editor "by <user> via mcp" and its history.

## Scenarios

- An agent reads a page, finds a wrong date in one sentence and replaces only that date. The rest of the page stays as
  it was, and the history shows one new revision by the user via mcp.
- An agent fixes three typos in one call. All three are saved together as one change.
- An agent sends a replacement whose text no longer appears on the page, because a person changed it in the meantime.
  The call is refused, nothing is changed, and the agent is told to read the page again.

## Requirements

### Who gets the tool

- R1: A Writer and a Manager connection must get the search-and-replace tool; a Reader connection must not.
  - Acceptance: the tool is listed for a Writer and a Manager connection and not for a Reader connection; a Reader
    connection that calls it changes nothing.
- R12: The tool must be called `edit_page_content` and find the page by its tab, if it is in one, and its name, like
  the full replacement. A page that does not exist, a deleted one included, must get the same error as with the full
  replacement.
  - Acceptance: a call for an unknown page is refused with the error that points to the list of the folder.

### Edits

- R2: One call must be able to carry several replacements, each an exact text to find and the text that replaces it,
  applied in the order given.
  - Acceptance: a call with three replacements changes the three places and is stored as one change of the page.
- R8: The text to find must appear exactly once in the page, unless the replacement asks to replace every place where
  it appears. A text that appears more than once without that option must be refused with the number of places and the
  advice to add surrounding text or to ask for every place.
  - Acceptance: a text that appears twice is refused with the number 2 and changes nothing; with the option to replace
    every place, both places change.
- R9: Each replacement must work on the content as the replacements before it left it.
  - Acceptance: a second replacement can find and change text that the first replacement inserted.
- R13: The text to find must match exactly: case, spaces and indentation count. Line breaks in the texts of a
  replacement must be made plain first (CRLF and CR become LF), as when content is saved.
  - Acceptance: a text that differs only in case or in one space is not found; a text sent with CRLF line breaks
    matches the same text on the page.
- R14: An empty text to find, and a replacement whose new text is the same as its text to find, must be refused with
  an error that names the replacement.
  - Acceptance: a call with such a replacement changes nothing, also when its other replacements would match.
- R15: The number of replacements in one call must not have a limit of its own; the length limit of a page holds for
  the result.
  - Acceptance: a call with 200 small replacements is applied when its result fits the length limit.

### Refusals

- R3: When any replacement of a call cannot be applied, the whole call must be refused and the page must stay
  unchanged; the error must name the replacement that failed and say what to do next.
  - Acceptance: a call with one matching and one missing replacement leaves the page, its version and its history
    unchanged, and the error names the missing one.
- R16: A text to find that is not on the page must be refused with an error that says so and tells the agent to read
  the page again; the error must not guess at similar text, such as the same text with other spaces.
  - Acceptance: a text that is on the page only with other indentation gets the plain not-found error, which names
    the replacement and points to reading the page.

### Rules of a change

- R4: A call must state the version of the page it is based on, and must be refused like every other change through
  MCP when the page changed since.
  - Acceptance: a call based on an older version, or on none, is refused with the same message as a full replacement
    and changes nothing.
- R18: The version must be checked before the replacements, so that a call based on an older version gets the version
  error even when one of its texts to find is missing as well.
  - Acceptance: a call with an older version and a text that is no longer on the page gets the version error, which
    names who changed the page last.
- R5: The content after the replacements must follow the same rules as content saved in full: it starts with a title
  heading, the title follows that heading, and the length limit holds. Content that breaks a rule must be refused with
  the same error as a full replacement.
  - Acceptance: a replacement that removes the title heading, or that makes the page longer than the limit, is refused
    and changes nothing; a replacement inside the title heading changes the title.
- R6: A stored change must be recorded like a full replacement through MCP: the user of the connection as the last
  editor, the channel `mcp`, a new version, and one revision in the history of the page that a user can revert in the
  browser. A call whose result equals the stored content must store nothing.
  - Acceptance: after a call, the page shows "by <user> via mcp", its history has one new revision, and reverting it
    in the browser restores the content before; a call that changes nothing keeps the version and adds no revision.

### What the client sees

- R10: The tool must tell the client that it can destroy content, like the full replacement, so that a client treats
  it with the same care.
  - Acceptance: the tool carries the same hints as the full replacement tool.
- R11: After a stored change, or a call that changes nothing, the result must give the page as stored, as the full
  replacement does (name, title, tab, address and version), and how many places each replacement changed. It must not
  give the content.
  - Acceptance: after a call with two replacements, one of them for every place of a text that appears three times,
    the result has the new version and the counts 1 and 3, and no content.
- R17: The descriptions of both tools and the instructions a client gets when it connects must say which tool is for
  what: `edit_page_content` for changing parts of a page, `replace_page_content` for rewriting a page.
  - Acceptance: the description of `replace_page_content` names `edit_page_content` for small changes, the description
    of `edit_page_content` names `replace_page_content` for rewrites, and the instructions of a Writer and a Manager
    connection name both tools.

### Full replacement

- R7: The tool that replaces the whole content of a page must stay, for rewrites of a page, and behave as before; only
  its description changes (R17).
  - Acceptance: a Writer and a Manager connection still get the full replacement tool, which behaves as before.

## Scope

- In: a new MCP tool that replaces exact pieces of text in one page of the folder of the connection.
- Not in: diffs or patches, line numbers or positions, edits targeted at a heading or section, appending or prepending
  without naming a text, and changes of several pages in one call. A search-and-replace in the browser.

## Effect on existing features

- MCP: a Writer and a Manager connection get one more tool, so that the three roles get two, six and ten tools. The
  instructions a client gets when it connects name it, and the description of `replace_page_content` points to it for
  small changes.
- MCP, current limits: the limit "no exact search-and-replace in a page" goes away.
- Roadmap: the entry "Exact search-and-replace for MCP" is done.
- Page history: a change through the new tool records a revision like a full replacement through MCP.

## Decisions

- The main purpose is small edits with less text and no accidental losses in the parts of a page that are not touched.
- The tool goes to the same connections as the full replacement, because it is a content change of a page.
- One call carries a list of replacements, so that several small fixes need one version and make one revision.
  Rejected: exactly one replacement per call, which needs a call, a version and a revision for every fix.
- A call is all or nothing, like every refused write of the wiki. Rejected: saving the replacements that match and
  warning about the others, which can leave a page half changed.
- No diffs, line numbers or section targets: guides and benchmarks of edit tools for AI models favour exact
  search-and-replace, and positions shift with every change.
- A text to find must appear exactly once, unless the replacement asks for every place, so that an agent never changes
  a place it did not mean. Rejected: always exactly once, which makes renaming a term tedious; only the first place,
  which can change the wrong place unnoticed.
- Each replacement works on the result of the ones before it, as in other edit tools for AI models. Rejected: finding
  every text in the content as read, which needs a rule for replacements that overlap.
- The tool carries the hint of a tool that destroys content, like the full replacement, because a replacement can
  remove any text. Rejected: the hint of a tool that only writes, which some clients would confirm less often.
- The result gives the counts of the places changed, so that an agent sees what a replacement of every place did, but
  no content, so that the answer stays short. Rejected: only the page as stored; the whole new content.
- The tool is called `edit_page_content`, next to `replace_page_content`. Rejected: `replace_in_page`; `edit_page`,
  which could be read as moving or renaming as well.
- Matching is exact, but line breaks of the agent's texts are made plain as the content is, so that a text copied with
  other line breaks still matches. Rejected: character for character, which never matches a text with CRLF.
- An empty text to find and a replacement that would change nothing are errors, because both are mistakes of the
  agent. Rejected: allowing the replacement that changes nothing.
- No limit of its own on the number of replacements: the length limit of a page already bounds the result. Rejected:
  at most 100 per call.
- A text that is not found gets a plain error, so that the error is predictable and the agent reads the real text.
  Rejected: a hint that the text appears with other spaces or indentation, which needs a looser second search.
- Both tool descriptions and the connection instructions say which tool is for what, so that an agent picks the
  targeted tool for small changes. Rejected: explaining it only in the new tool.
- The version is checked before the replacements, because a text is most often missing since someone changed the page,
  and the version error tells the agent who did and to read the page again. Rejected: checking the replacements first.

## Open questions

None.
