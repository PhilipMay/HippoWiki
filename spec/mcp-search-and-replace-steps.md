# MCP Search-and-Replace – Steps

## Goal

A Writer or Manager connection changes parts of a page with the new MCP tool `edit_page_content`: it names exact texts
to find and the texts that replace them, instead of sending the whole content again. One call carries several
replacements, is stored as one change and one revision, and is all or nothing, so that the parts of a page the agent
did not mean to touch stay exactly as they were. Written from `spec/mcp-search-and-replace-requirements.md`.

## Scope

- In: the tool `edit_page_content` for a Writer and a Manager connection, with a list of replacements, each an exact
  text to find, the text that replaces it and the option to replace every place where it appears (R1, R2, R8, R9, R12,
  R13, R14, R15); its refusals, all or nothing, with errors that name the replacement (R3, R16); the version check
  before the replacements and the rules of a content change through MCP (R4, R5, R6, R18); its hints and its result
  with the counts of the places changed (R10, R11); the descriptions of both content tools and the instructions of a
  connection saying which tool is for what (R7, R17).
- Not in: diffs or patches, line numbers or positions, edits targeted at a heading or section, appending or
  prepending without naming a text, changes of several pages in one call, and a search-and-replace in the browser. No
  change of the pages service: the tool builds the new content and saves it with `updatePageContent()`, as
  `replace_page_content` does.

## Checklist

- [x] The replacements of a content
- [x] The tool edit_page_content
- [ ] Which tool is for what
- [ ] Wrap-up

## The replacements of a content

### Goal

A pure module applies a list of replacements to the content of a page, or says which replacement cannot be applied
and why, so that the tool of the next step only has to call it. Nothing imports it yet but its tests.

### Build

- A new module `src/features/mcp/edits.ts`, with no database, no service and no import of Next.js or React. Its
  function takes the stored content and the list of replacements (`oldText`, `newText`, `replaceAll`, the last one
  optional) and returns either the new content with the number of places each replacement changed, in the order
  given, or the failure of the first replacement that cannot be applied, with its position in the list (counted from
  1. and the reason.
- The line breaks of `oldText` and `newText` are made plain first, CRLF and CR to LF, as `contentSchema` in
  `src/features/pages/schema.ts` does for content (R13). Matching is then exact: case, spaces and indentation count,
  and nothing looser is tried (R16).
- Before anything is applied, every replacement is checked: an empty `oldText`, and a `newText` that is the same as
  its `oldText` once the line breaks are plain, are failures of that replacement (R14). An empty list is a failure as
  well, because it is a mistake of the agent like the two above; it is not in the requirements and is named in the
  report of the step.
- The replacements are applied one after the other, each to the content as the ones before it left it (R2, R9).
- A replacement without `replaceAll` must find its `oldText` exactly once. Not found is the failure "not found"; found
  more than once is the failure "found several times" with the number of places (R8). The number counts every place
  where the text starts, also places that overlap, so that a text whose places overlap, such as `aa` in `aaa`, is
  never taken as unique and an agent never changes a place it did not mean.
- A replacement with `replaceAll` changes every place, from the start of the content, as `String.prototype.replaceAll`
  does, and counts the places it changed. Not found is the failure "not found" as well.
- The new text is inserted as it is: a `$` in it is no replacement pattern, so the module never passes `newText` as the
  replacement string of `replace()` or `replaceAll()`.
- There is no limit on the number of replacements (R15). The length of the content is the bound instead: a
  replacement whose result would be longer than `CONTENT_MAX_LENGTH` (`src/features/pages/limits.ts`) is the failure
  "too long", computed from the number of places before the new content is built, so that a call can never build a
  content far beyond the limit in memory. The other rules of content, such as the title heading, are left to
  `updatePageContent()` in the next step (R5). This bound is stricter than the requirements in one case, a call whose
  content goes over the limit and back under it with a later replacement; it is named in the report of the step.
- The function is pure and synchronous; its comments say why each failure exists.

### Test

- Unit tests `src/features/mcp/edits.test.ts`:
  - one replacement changes its one place and leaves the rest of the content character for character as it was
  - three replacements change three places and give the counts 1, 1, 1 (R2)
  - a second replacement finds and changes text that the first one inserted (R9)
  - a text that appears twice fails with the number 2 and the position of the replacement; with `replaceAll` both
    places change and the count is 2 (R8); overlapping places count as several
  - a text that differs only in case, in one space or in its indentation is not found, and the failure is the plain
    "not found" (R13, R16)
  - an `oldText` and a `newText` sent with CRLF or CR line breaks match and insert as LF (R13)
  - an empty `oldText`, a `newText` equal to its `oldText` (also equal only once the line breaks are plain) and an
    empty list fail before anything is applied, also when the other replacements would match (R14)
  - a failure names the position of the first replacement that fails, also when a later one would fail as well (R3)
  - a `newText` with `$&`, `$1` and `$$` is inserted as it is
  - 200 small replacements are applied (R15); a replacement whose result would pass `CONTENT_MAX_LENGTH` fails as "too
    long", also with `replaceAll`; a result of exactly the limit is applied
- Cost test `src/features/mcp/edits.cost.test.ts` (project `cost`), with a content at `CONTENT_MAX_LENGTH`: as many
  small replacements as fit into the body limit of an MCP request (the 4 MiB default of the SDK), each one found
  once, and a `replaceAll` of a one-character text that appears on every other character. Each must be applied, or
  fail, within 2 s. If the many replacements cannot be applied within the budget, a limit on their number is a change
  of the scope (R15): stop and ask the user, as "Step plans" in `spec/step-plan-workflow.md` says.
- No end-to-end spec: nothing that the app runs imports the module yet.

## The tool edit_page_content

### Goal

A Writer and a Manager connection get the tool `edit_page_content`, which finds a page like `replace_page_content`,
checks the version, applies the replacements and stores the result as a content change through MCP, or refuses the
whole call and changes nothing.

### Build

- `src/features/mcp/tool-schemas.ts`:
  - `editPageContentInput`: the page arguments of the other write tools (`tab`, `page`, `version`) and `edits`, a list
    of objects with `oldText`, `newText` and the optional `replaceAll`. The descriptions say that `oldText` must match
    the content as `read_page` gave it exactly, case, spaces and indentation included, and appear exactly once unless
    `replaceAll` is set; that the replacements are applied in the order given, each to the content the ones before it
    left; and that `replaceAll` changes every place. The schema sets no minimum and no maximum on the list and refuses
    no text, so that every mistake stays a tool error that says what to do (see "What holds for all of them" in
    `spec/mcp.md`).
  - `editedPageOutput`: the fields of `storedPageOutput` and the number of places each replacement changed, in the
    order given, with a description. No content (R11).
- `src/features/mcp/tools.ts`, the handler `editPageContent()`, in this order:
  1. The page by its tab and name with `pageService.getPage()`; a page that does not exist, a deleted one included, is
     `pageNotFound()`, as with `replace_page_content` (R12).
  2. The version: a missing version, or one that is not the version of the page as read, is `pageChanged()`, with the
     same message as `replace_page_content` and who changed the page last, before any replacement is looked at (R4,
     R18).
  3. The replacements with the module of the first step, on the content as read. A failure is a tool error that
     names the replacement by its position and the start of its `oldText`, says that nothing was changed and what to
     do next: read the page again with `read_page` for "not found" (R16); the number of places and the advice to add
     surrounding text or to set `replaceAll` for "found several times" (R8); to send a non-empty `oldText`, a `newText`
     that differs from it, or at least one replacement for the checks of R14; the length limit for "too long" (R5).
  4. The new content with `pageService.updatePageContent()` and the version of the call, as `replacePageContent()`
     does, with the same mapping of its errors: `not-allowed`, `page-not-found`, `page-changed` (a change between the
     read and the write), `invalid-input` with the error of a full replacement, such as a title heading that was
     removed (R5), and `failed`. The service records the user of the connection, the channel `mcp`, the new version
     and one revision, and stores nothing when the result equals the stored content (R6).
  5. The result: the page as stored, as `storedResult()` gives it, with the counts of the places (R11).
- The handler runs in `run()` with `WRITE_FAILED`, like the other write tools.
- `src/features/mcp/server.ts`: `edit_page_content` is registered with `mayDo(role, "editPage")`, next to
  `replace_page_content`, so that a Reader connection does not get it (R1). It carries the same hints as
  `replace_page_content` (`OVERWRITES`, R10); the comment of that constant says that both tools can destroy content.
  Its title and description say what the tool does, that a call is all or nothing, that the version that `read_page`
  gave is stated, and what it returns. Naming `replace_page_content` for rewrites is the next step.
- `replace_page_content` keeps its behaviour (R7).

### Test

- Unit tests in `src/features/mcp/tools.test.ts`, with the mocked services:
  - `edit_page_content` passes the content with the replacements applied and the version of the call to
    `updatePageContent()`, and returns the page as stored with the counts, and no content (R2, R11); with two
    replacements, one of them with `replaceAll` for a text that appears three times, the counts are 1 and 3
  - a version that is missing or older than the page as read is refused with the message of `replace_page_content`,
    also when an `oldText` is missing as well, and `updatePageContent()` is not called (R4, R18)
  - every failure of the replacements is a tool error that names the replacement and what to do, and
    `updatePageContent()` is not called (R3, R8, R14, R16)
  - an unknown page gets the error that points to `list_folder` (R12)
  - every error code of `updatePageContent()` gives the same tool error as with `replace_page_content` (R5)
  - a failure of the database is the general write error
  - `TOOL_FUNCTIONS` of "the tools of each role" gets `edit_page_content` with `editPage`, so the tools of each role
    are compared with `FUNCTION_ROLES` (R1); the tables of the tests that go over every tool or every write tool
    (such as "every tool" and "a name of an existing tab or page") get it as well
  - its hints are those of `replace_page_content` (R10)
- End-to-end tests in a new spec `e2e/mcp-edit.spec.ts`, through a Writer connection and against the real database:
  - one replacement of a date in a sentence changes only that date; the page has a new version, one new revision by
    the user via mcp, and the rest of the content is as it was (R6)
  - three replacements in one call change three places and add one revision (R2)
  - a call with one matching and one missing replacement leaves the page, its version and its history unchanged, and
    the error names the missing one (R3, R16)
  - a text that appears twice is refused with the number 2; with `replaceAll` both places change and the result has
    the count 2 (R8, R11)
  - a text sent with CRLF line breaks matches; a text that differs only in case is not found (R13)
  - a replacement that removes the title heading, and one that makes the page longer than the limit, are refused and
    change nothing; a replacement inside the title heading changes the title (R5)
  - a call based on an older version, or on none, is refused with the message of a full replacement and changes
    nothing; based on an older version with an `oldText` that a change in the browser removed, it gets the version
    error that names the user, via web (R4, R18)
  - two replacements that cancel each other out keep the version and add no revision (R6)
  - an unknown page and a deleted page are refused with the error that points to `list_folder` (R12)
  - a Reader connection does not list the tool, and its call changes nothing; a Writer connection whose user was
    lowered to Reader is refused and changes nothing (R1)
  - in the browser: the page shows "by <user> via mcp", and reverting the revision in its history restores the
    content before (R6)
- `e2e/mcp-write.spec.ts`: the list of the write tools of a Writer connection gets `edit_page_content`.
  `e2e/mcp-manager.spec.ts`: the tool list of a Manager connection has ten tools, with `edit_page_content` after
  `replace_page_content`, and the same destructive hint (R1, R10).
- `replace_page_content` behaves as before: its existing unit and end-to-end tests pass unchanged (R7).
- The end-to-end specs of the step: `e2e/mcp-edit.spec.ts`, `e2e/mcp-write.spec.ts`, `e2e/mcp-manager.spec.ts` and
  `e2e/mcp-read.spec.ts`.

## Which tool is for what

### Goal

The descriptions of both content tools and the instructions a client gets when it connects say which tool is for
what, so that an agent picks `edit_page_content` for small changes and `replace_page_content` for rewrites.

### Build

- `src/features/mcp/server.ts`:
  - the description of `replace_page_content` says that it is for rewriting a page and names `edit_page_content` for
    changing parts of it; its behaviour and its hints stay (R7, R17)
  - the description of `edit_page_content` names `replace_page_content` for rewriting a page (R17)
  - `ROLE_ABILITIES` of a Writer and a Manager connection names `edit_page_content` next to the other write tools and
    says which content tool is for what (R17)
- The tool error of a taken name in `tools.ts` names `replace_page_content` for changing that page; it stays as it is,
  because a taken name has nothing to do with small changes.

### Test

- Unit tests in `src/features/mcp/tools.test.ts`:
  - "the descriptions": the description of `replace_page_content` names `edit_page_content`, and that of
    `edit_page_content` names `replace_page_content` (R17)
  - "the instructions": the instructions of a Writer and a Manager connection name both tools; those of a Reader
    connection name neither (R17)
- End-to-end: the test of `initialize` at the Manager address in `e2e/mcp-manager.spec.ts`, and the one at the Writer
  address if a spec has one, check that the instructions name `edit_page_content` (R17).
- The end-to-end specs of the step: `e2e/mcp-edit.spec.ts`, `e2e/mcp-write.spec.ts`, `e2e/mcp-manager.spec.ts` and
  `e2e/mcp-read.spec.ts`. The complete suite runs in the wrap-up, which changes the comments of code and tests.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Extend `spec/mcp.md`, the feature spec of MCP:
   - "Tools": a Writer connection gets four write tools of pages, so the roles get two, six and ten tools;
     `edit_page_content` is described next to `replace_page_content` (the replacements, matching, the order, the
     option for every place, all or nothing, the version checked first, the result with the counts), records a
     revision like it and carries `destructiveHint` like it; the instructions name it and say which tool is for what.
   - The code and tests line names `src/features/mcp/edits.ts`, `src/features/mcp/edits.test.ts`,
     `src/features/mcp/edits.cost.test.ts` and `e2e/mcp-edit.spec.ts`.
   - "Decisions": the decisions of the requirements file that still hold, with their rejected alternatives, and the
     bound of the length for each replacement and the empty list, if the steps kept them.
   - "Current limits": the limit "no exact search-and-replace in a page" goes; what the plan put out of scope (diffs,
     positions, sections, several pages, the browser) is named where a reader would look for it.
   - Bring the other specs that list the content writes of MCP in line: `spec/page-history.md` (the writes that
     record a revision), `spec/optimistic-locking.md` (the tools that state a version), `spec/pages.md` (saves without
     a change), and `spec/testing.md` where it names the cost tests.
2. Remove "Exact search-and-replace for MCP" from `spec/roadmap.md`.
3. Check that `README.md` has the commands a developer needs, and extend its summary of the MCP server: a Writer
   connection also changes parts of a page.
4. Delete this step file and `spec/mcp-search-and-replace-requirements.md`. The requirement IDs (R1 to R18) leave the
   comments of the code and the tests: each is replaced by the section of `spec/mcp.md` that holds the rule now, or
   dropped with its sentence kept.
5. Update the spec catalog in `CLAUDE.md`: remove the entries of this step file and of the requirements file. The
   question of `spec/mcp.md` stays as it is.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes the comments of
  code and tests as well, so it is not documentation only: it is the last step that changes more than documentation
  and runs the complete `npm run test:e2e`, as "The complete end-to-end suite" in `spec/step-plan-workflow.md` says.
- No requirement ID of this plan (R1 to R18) is left in `src/` and `e2e/`, and no file in `spec/`, `README.md` or
  `CLAUDE.md` names the deleted files.
