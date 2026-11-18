# Unchanged Saves – Steps

## Goal

A content save whose content is the same as the stored content of the page leaves the page as it is: no new last
editor, channel or time of the last change, no new version and no revision. The browser and `replace_page_content`
answer as after every save, and the server log tells such a save from a stored one. The requirements are in
`spec/unchanged-saves-requirements.md` (R1 to R8).

## Scope

- In: content saves in the browser editor and with `replace_page_content` through MCP (`updatePageContent()` of the
  pages service); their checks in the order role, limits, version (R4, R7); the log line of a save without a change
  (R8); the description of `replace_page_content` where it promises a new version.
- Not in: moving or renaming a page to its own name and place, renaming a folder or tab to its own name, and reverts
  (`revertPage()`), which keep their behaviour; a notice in the browser or an extra field in the MCP result for a save
  without a change; any change of the database schema.

## Checklist

- [x] Leave the page unchanged on a save without a change
- [ ] Check saves without a change through MCP
- [ ] Wrap-up

## Leave the page unchanged on a save without a change

### Goal

A content save of the same content, in the browser and through MCP, passes the same checks as every content save and
then stores nothing: the page keeps its last editor, channel, time of the last change and version, and no revision is
recorded (R1, R2, R3, R4, R5, R7, R8).

### Build

- `src/features/pages/service.ts`, `storeContentChange()`: for a content save (`revertedTo === null`), compare the
  normalised content with the stored content of the page, not with the newest revision. In the same transaction as
  the version check, a save whose content differs from the stored one is stored and records the next revision as
  today; a save of the same content to a page that is not deleted and has the given version stores nothing and
  records no revision. The outcome tells the caller which of the two happened, or that nothing matched, for example
  `"stored" | "unchanged" | "refused"` instead of a `boolean`. One way that is safe against a write at the same time:
  update only where the id, `deletedAt: null`, the version and a different content match; when no row matched, look
  for the page with the id, `deletedAt: null`, the version and the same content, which is `unchanged`, and otherwise
  go on as for a refused write (`refusedWrite()`, `page-changed` or `page-not-found`).
- A revert keeps its behaviour: it always stores the page and records a revision that names the revision it went back
  to (`revertPage()` already refuses a revision with the content of the page now).
- `saveContentChange()`: return the page as stored also for `unchanged`, so that the caller gets the same last editor,
  time and version as before, and pass the outcome on, so that `updatePageContent()` logs a save without a change
  with the page and the channel (`channelOf(actor)`) in a line of its own, such as "page not changed: content is the
  same", and "page updated" only for a stored save (R8).
- A page stored with a title that differs from the title its content gives keeps that title on a save without a
  change: only the content is compared, so such a save stores nothing (R1). It gets the derived title with its next
  change of the content. The end-to-end test "a page stored with a different title gets the derived title on its next
  save" in `e2e/edit-page.spec.ts` is changed to check both (decided with the user while building this step).
- The order of the checks in `updatePageContent()` stays: role, then the content with the limits in force
  (`pageContentInputSchema`, which also makes the line endings uniform, R3, R7), then the version. Content that is
  over a limit is refused as `invalid-input` also when it is the same as the stored content.
- The browser action `updatePageContent()` in `src/features/pages/actions.ts` needs no change: it redirects to the
  address of the page as stored, without a notice (R5). Check that this holds.
- Update the comments that say a save without a change makes the actor the last editor and counts the version up:
  the head comment and the comments of `storeContentChange()`, `updatePageContent()` and `saveContentChange()` in
  `service.ts`, and the comments in the tests named below.

### Test

- Unit, `src/features/pages/service.test.ts` ("updatePageContent"):
  - Replace "records no revision when the content is that of the newest revision, but stores the page" by a test that
    a save of the stored content stores nothing, records no revision, returns the page as stored with its version
    and logs the line of a save without a change with the page and the channel, and no "page updated" (R1, R2, R8);
    once with the channel `web` and once with `mcp` and the grant of the connection.
  - A save of the stored content to a page with another version, or with no valid version, gives `page-changed` with
    the page as stored; to a deleted page `page-not-found` (R4).
  - A save of the stored content that breaks a limit gives `invalid-input` before the version is looked at, and
    nothing is written (R4, R7).
  - A revert still records a revision and is logged as "page reverted".
- Integration, `integration/page-service.test.ts`, on real data (R1, R2, R3, R4, R7):
  - Bob saves a page last changed by Anna via `mcp` with its stored content: last editor, channel, `updatedAt` and
    version stay as they were, and the revisions are the same before and after. Replace the case "R14: a save without
    a change records nothing, but makes the actor the last editor".
  - The stored content sent with `\r\n` line endings changes nothing; with one more space at the end of a line it is
    stored as a change, with a new version and a new revision.
  - The stored content based on an older version, or on none, is refused as `page-changed`; of a deleted page as
    `page-not-found`; nothing changes.
  - A page stored directly with content over `CONTENT_MAX_LENGTH`, saved with that content, gives `invalid-input`, and
    the page stays as stored.
  - A save of the same content right after a stored change, based on the version before it, is refused, and a save of
    a change after a save without a change, based on the same version, is stored (the scenario of Anna and Bob).
- End-to-end, `e2e/edit-page.spec.ts` (R1, R2, R3, R4, R5, R7):
  - Rework "a page created and saved in the browser has a revision per change, and a save without a change adds none":
    after Bob saves without a change, the page still says it was last changed by the first user, the revisions are
    the same, and the version in the database is unchanged.
  - A page last changed by Bob via `mcp`: the logged-in user opens the editor and clicks "Save" without a change; the
    page address is shown without a notice, the page says "by bob via mcp" with the previous time, and the lists of
    the folder (and of a tab, for a page in a tab) show bob with "Via" `mcp`.
  - Two editors opened on the same page: the first saves without a change, the second saves a change, which is
    stored.
  - An editor opened before another user's change, saved without a change, shows the notice that the page was
    changed, and the page keeps the other user's change.
  - A page stored directly with content over `CONTENT_MAX_LENGTH`, saved in the editor without a change, shows the
    length error at the content field, and the page in the database is unchanged.
- Specs to run: `e2e/edit-page.spec.ts`, `e2e/page-history.spec.ts`, `e2e/revert-page.spec.ts` and `e2e/mcp.spec.ts`,
  because the step changes the content save that they use.

## Check saves without a change through MCP

### Goal

An AI app that sends the stored content back with `replace_page_content` gets the usual result with the version it
stated and changes nothing, and the tool no longer promises a new version (R1, R4, R6, R7, R8).

### Build

- `src/features/mcp/tools.ts`: change the description of `replace_page_content` from "Returns the page with its new
  version" to wording that holds for both cases, for example that it returns the page with its version, which a
  change counts up and content without a change keeps. Check the description of the field `version` of the stored
  page and the instructions of a connection for the same promise.
- `replacePageContent()` needs no other change: it returns the stored result of `updatePageContent()`, which carries
  the stored version (R6). Check that this holds.

### Test

- Unit, `src/features/mcp/tools.test.ts`: `replace_page_content` with a result of the service for an unchanged page
  returns the usual result with the name, title, tab, address and the stated version (R6).
- End-to-end, `e2e/mcp.spec.ts` (R1, R4, R6, R7):
  - A page last changed in the browser: `read_page`, then `replace_page_content` with its content and version returns
    the same version; `read_page` and the page view show the previous last editor, `web` and time; a following
    `replace_page_content` with a change based on that version is stored.
  - `replace_page_content` with the stored content and an older version gets the tool error of a changed page.
  - A page stored directly with content over `CONTENT_MAX_LENGTH`: `replace_page_content` with that content gets the
    error of invalid content, and the page keeps its last editor, time and version.
- The log line of a save without a change through MCP (R8) is covered by the unit test of the service in the step
  before.
- Specs to run: `e2e/mcp.spec.ts`.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed. For this feature, extend the existing specs
   as "Effect on existing features" in the requirements file lists:
   - `page-history.md`, "Revisions": a content save without a change stores nothing and records no revision; the
     decision "A save without a change records no revision" gets the reason that such a save changes nothing at all.
   - `pages.md`: the rule on revisions of a save without a change says that the page itself stays unchanged too, and
     the rule that a page stored before titles were derived keeps its stored title until its next save says: until
     its next change of the content.
   - `optimistic-locking.md`, "The version of a page": a content save without a change does not count the version up;
     "Which changes are refused" holds for it unchanged.
   - `content-structure.md`, "Last editor": a content save without a change changes neither the last editor nor the
     time of the last change.
   - `mcp.md`: `replace_page_content` with the stored content changes nothing and returns the same version.
   - The rules of R3 (when content counts as the same), R4 and R7 (the checks), R8 (the log line) and the decisions of
     the requirements file go into the spec where they fit best, without repeating them in each.
2. Remove the feature from `roadmap.md`.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
