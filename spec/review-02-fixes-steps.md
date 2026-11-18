# Fixes of Review Report 02 – Steps

## Goal

Fix the findings of `spec/review-02-report.md`: the code, the tests and the documents say each rule in one place again,
every rule has a test that can fail, and the documents describe the code as built. The order is the one the report
suggests: correct the documents that are wrong, close the gaps of the tests, refactor the code in small steps, and
restructure the documents last.

## Scope

- In: 106 of the 107 findings of `spec/review-02-report.md`.
  - A finding with a High confidence is fixed as its Suggestion says.
  - A finding with a line `Decision` is fixed as that line says.
  - The five findings labelled `question:` are fixed as decided under "Decisions on the questions" below.
- In, as changes of behaviour that the decisions name. Every other change keeps the behaviour as it is.
  - The actor and every log line name the channel `web`, not `browser`.
  - The log lines of the writes of roles, of the OAuth service and of the grant service get the names and reasons
    their findings give.
  - A database error in the lookup before a write is logged and returned as `failed`.
  - `changeRole()` returns `invalid-input` with `fieldErrors` for the role.
  - `createPage()` of the pages service accepts a missing name and derives it, with a code of its own for a title that
    suggests no name; `create_page` then checks in the order of the service.
  - A file in a text field of a form counts as empty.
  - A malformed id bound to an action is answered as the action answers a missing row of its feature.
  - The texts of `createUser()` while the hashing is busy, of the hint under "New password", and of three
    descriptions of MCP tools.
  - Every name of an existing tab or page is a plain string in the input schema of an MCP tool.
  - The MCP server reports the version of `package.json`.
  - The "Save page" dialog focuses the name field after a refused name.
  - The browser title of a not-found page in the three routes of the content.
- Not in:
  - The finding "none of the 98 findings of `review-report.md` that need one has a confidence": by its Decision the
    confidences are assigned at the next recheck. It stays in the report, so the report is not deleted.
  - Fixing the findings of `spec/review-report.md`. Only the text of that report is corrected, as four findings ask.
  - The lint rule that allows only type imports of the forms modules of users and auth, which the finding on the
    comments "Client Components can use it" names as optional on top. Only the comments are corrected.
  - Upgrades of packages. `knip` is the only new package.
  - A security review of the page history, the delete of a tab and the tools of a Manager.

### Decisions on the questions

Decided by the user on 2026-11-18:

- "Is a malformed name of an existing tab or page refused by the input schema or answered by the tool?": answered by
  the tool. Every name of an existing tab or page is a plain string in the input schema. A name that no item has,
  malformed or with spaces around it, gets the not-found error of the tool with the hint to use `list_folder`. The
  reason: the MCP specification of 2025-11-25 asks for errors of input that a model can act on, and the installed SDK
  answers a schema refusal with a general text that does not say where the names are.
- "The OAuth service returns texts of messages, and one code has two shapes; is that a meant exception?": yes.
  `architecture.md` and `oauth.md` say that the OAuth service returns the descriptions of its errors, and the two
  codes with two shapes get names of their own.
- "Do Client Components ship Zod and markdown-it only to read the name of a field or a length limit?": measure first.
  Only if the two libraries are in the chunks of the client, the names of the fields and the limit move to modules
  without imports.
- "Are two entries of the roadmap still open as written?": "Bearer token sessions" is merged into "Access for clients
  without OAuth", and the condition of "Exact search-and-replace for MCP" is dropped.
- "Is a change outside a step plan committed?": no. It stays in the working tree, and `CLAUDE.md` says so under "Git
  Handling". The skills in `.claude/skills/` are added to the check of doc references.

### What holds for every step

- Each step names its findings by the section of the report and the start of their title. The detail of a fix (the
  places, the evidence, the properties to keep) is in the finding; read it before it is deleted.
- A fixed finding is deleted from `spec/review-02-report.md` in the commit of its step, and the report is brought in
  line as "Fixing a finding of the review report" in `step-plan-workflow.md` describes: the counts of "Summary" by
  severity, by label and by confidence, the list "To fix first", the sentence on the open questions, the "Reviewed"
  lists and "Suggested order of work" where they name the finding.
- A finding that two steps fix is deleted in the later one; the step says so.
- The report cites line numbers of 2026-11-18. Earlier steps move the lines, so a place is found by the name of its
  function.
- The feature spec that a fix touches, and `architecture.md`, `testing.md` or `tech.md` where a convention changes,
  are updated in the same step.
- A step that changes code a finding of `spec/review-report.md` describes notes it in its report; the step "The first
  review report" brings that report in line.
- A refactoring step keeps the behaviour. A test is changed only where it pins how the code is written and not what
  it does, and never to make a check pass. If a new test shows a defect of the code, stop and ask the user before
  anything is fixed: a fix of behaviour is a change of the scope.
- The complete end-to-end suite runs once per session, in the last step of the session that changes anything but
  documentation (see "Sessions"). A step that changes `e2e/support/` or another file every page depends on runs it
  right away, as the workflow says.

## Checklist

- [x] Rules of the checks and of a review
- [x] Statements of `architecture.md`
- [x] Statements of the feature specs
- [x] `testing.md`, `tech.md`, the README and the roadmap
- [x] Integration tests of access and of rules without a test
- [x] Integration tests of the rollback and the races of pages
- [x] Tests that assert less than their name says
- [x] Unit tests of the services cut down
- [x] Shared helpers of the unit and integration tests
- [x] Shared helpers of the end-to-end tests
- [x] End-to-end tests of access, roles and deleted pages
- [ ] End-to-end tests of locking, MCP and single states
- [ ] End-to-end tests of the pending state
- [ ] Split of `e2e/mcp.spec.ts`
- [ ] Actors, guards and one channel
- [ ] Guards and errors of the services
- [ ] Writes of pages
- [ ] The stored page and the derived name
- [ ] The reads of the history in a service of their own
- [ ] MCP tools
- [ ] OAuth and grants
- [ ] Actions, forms and schemas
- [ ] Leftovers and small duplicates
- [ ] Lint rules and checks
- [ ] The query of a page and what a route shows
- [ ] Views of the folder routes and pieces of the lists
- [ ] Dialogs
- [ ] The first review report
- [ ] One owner per rule in the feature specs
- [ ] Structure of `architecture.md` and the other documents
- [ ] Wrap-up

## Sessions

The plan has stop points, as "Step plans" in `step-plan-workflow.md` describes. It is implemented in seven sessions,
each started with the same prompt, `Implement spec/review-02-fixes-steps.md`. A session starts at the first step that
is not ticked off, ends after the step named here, and pushes there:

1. The documents that are wrong: ends after "`testing.md`, `tech.md`, the README and the roadmap". It changes only
   documentation, so no end-to-end test runs.
2. The tests below the browser: ends after "Shared helpers of the unit and integration tests".
3. The end-to-end tests: ends after "Split of `e2e/mcp.spec.ts`".
4. The services: ends after "The reads of the history in a service of their own".
5. MCP, OAuth, actions and lint: ends after "Lint rules and checks".
6. The routes and the dialogs: ends after "Dialogs".
7. The documents last: ends after "Wrap-up". It changes only documentation, so no end-to-end test runs.

The last step of the sessions 2 to 6 runs the complete `npm run test:e2e` in place of the specs it affects.

## Rules of the checks and of a review

### Goal

The rule for when the complete end-to-end suite runs stands in one place, and so do the rules of a review. The later
steps of this plan follow the new rule.

### Build

Findings of "Documentation: architecture, testing, catalog and workflows":

- "three documents disagree on when the complete end-to-end suite runs":
  - "When a step is done" in `step-plan-workflow.md` says: the complete suite runs once per plan, in the last step
    that changes anything but documentation, and in a plan with stop points once per session, in the last such step
    of the session; a change outside a step plan that changes code counts as a plan of one step; a step or a wrap-up
    that changes only documentation relies on that run and on CI.
  - The sentences of the same file that assume a run in the wrap-up are brought in line, among them "The complete
    suite of the wrap-up still covers all features" and the paragraph on a failure that only the complete suite shows.
  - `CLAUDE.md`, "Running the Checks", keeps the commands and points to "When a step is done" for the rest.
  - "Sharding the end-to-end tests" in `roadmap.md` is brought in line.
- "the same rules of the workflow stand in three to five places":
  - What `npm run check` and `npm run check:all` hold, and what never runs next to the end-to-end tests, stands only
    in "When a step is done"; `CLAUDE.md`, `README.md` and `testing.md` point there.
  - The list of the wrap-up stands once, in "Wrap-up step"; the template points to it.
  - `issue-report.md` holds the rules of a review: its title names code and documents, it gets the rule for
    documents (Location is the file and the heading, Evidence a short quote) and the one rule for the summary (the
    verdict and the counts per severity and per confidence). "Reporting Review Issues" in `CLAUDE.md` points there
    and keeps only what no other document says.

### Test

- `npm run check` passes; only documentation changes.
- A search of `spec/`, `README.md` and `CLAUDE.md` for "complete" finds the rule of the suite only in "When a step is
  done", and pointers elsewhere.
- The two skills in `.claude/skills/` still agree with the two workflow files.

## Statements of `architecture.md`

### Goal

`architecture.md` says nothing that the code contradicts, and holds the conventions the refactoring steps follow.

### Build

Findings of "Documentation: architecture, testing, catalog and workflows":

- "`architecture.md` says deleting pages and the writes of tabs take only the actor of the browser": the sentence of
  the Suggestion, and "the grant service" in place of "the token service".
- "single statements of `architecture.md` that the code contradicts": each of the eight sentences is corrected in its
  place; the count of the kinds of addresses with other parameters becomes the rule of the Suggestion.
- "the list of codes of a `Result` is incomplete": the rule stays, the list goes.
- "the rules for queries and actions are written for all features": the scope is stated, and one bullet names each
  exception with its reason. `users-and-login.md` is brought in line where it states the same rule.
- "rules that the code follows everywhere are not written down": four bullets: the write that changes nothing, the
  full order of the checks, a helper of two services lives in a pure module of the feature that owns the rule, and
  the adapter of a caller other than the browser is named `http.ts`.

Finding of "Code: services of the content features":

- "the writes of roles take an MCP actor by their type": no change of the code. `architecture.md` and `mcp.md` say
  that the writes of roles are not offered through MCP.

### Test

- `npm run check` passes; only documentation changes.
- Each corrected sentence is checked against the code it names.

## Statements of the feature specs

### Goal

The feature specs say nothing that the code contradicts, and state the limits a user meets.

### Build

Findings of "Documentation: the feature specs of the content":

- "`pages.md` says only the last editor of a page is stored": the sentence of the Suggestion.
- "`page-deletion.md` says every delete stores the channel `web`": the two sentences of the Suggestion.
- "`mcp.md` names `delete_page` and `delete_tab` as the tools with `destructiveHint`": `replace_page_content` is added
  with its reason.
- "`content-structure.md` sends `/` and the app bar to `/folders` for everyone": the sentence of the Suggestion.
- "the length limits that a user meets are not stated": the three numbers once each, with the constant, and the cut
  of the title.
- "specs describe states from before a feature": the sentences about states before the last editor, the version, the
  types of an account and derived titles go; the told decisions become rules. The sentences on the channel and on the
  first revision stay.
- "`pages.md` lists the health endpoint among its routes": the bullet goes.
- "three pointers lead one step past their target": each pointer is corrected.

Findings of "Documentation: the first review report and the other feature specs":

- "`container-image.md` says the probe of the client address is skipped only for `/login` and `/api/health`".
- "`users-and-login.md` says `/` uses `landingPath()`".
- "`container-image.md` says the admin setup "does not read the variable"": the wording of `users-and-login.md`.
- "`oauth.md` lists the checks of an authorization request "in this order"": one sentence before the list points to
  the limit in the schema of OAuth and does not restate the number.

### Test

- `npm run check` passes; only documentation changes.
- Each corrected sentence is checked against the code it names.

## `testing.md`, `tech.md`, the README and the roadmap

### Goal

The documents a developer starts from match the tests, the stack and the features as built.

### Build

Findings of "Documentation: architecture, testing, catalog and workflows":

- "`testing.md` does not match the integration tests it describes": a pointer to `src/lib/db-errors.ts` in place of
  the list, "one file per service in `integration/`", the helper `createRevisions()` and the direct writes of the
  tests, one bullet on races and rollbacks, and a section of their own for the bullets on the commands.
- "`tech.md` and `architecture.md` describe a search that does not exist": `architecture.md` says the search is not
  built, `tech.md` names markdown-it with its footnote plugin, "Later Aspects" becomes a pointer to `roadmap.md`, and
  the line on Podman is corrected.
- "the README names 8 of 11 feature specs and no page history": a pointer to the catalog in `CLAUDE.md`, one sentence
  on the history, `npm run db:deploy` in "Getting started", and the item of the wrap-up in `step-plan-workflow.md`
  extended to the summary of the features.
- "are two entries of the roadmap still open as written?": as decided under "Decisions on the questions".

Finding of "Tests: end-to-end":

- "`testing.md` says the production run covers `error.tsx` and `global-error.tsx`": `testing.md` says that the error
  pages are covered by no test, and why.

### Test

- `npm run check` passes; only documentation changes.
- Every script the README names exists in `package.json`.

## Integration tests of access and of rules without a test

### Goal

The access rules of the reads of the history, the order "role before version", and the rules that only an end-to-end
test covered are proven against the database, before any code is refactored.

### Build

Findings of "Tests: unit and integration":

- "the access rules of two reads of the history are asserted by no test": in `integration/page-service.test.ts` the
  test of the roles becomes a table over the three reads, the roles with a stranger and an admin, and a live and a
  deleted page; one case for the fields and the order of a comparison.
- ""the role is checked before the version and the content" is tested only with a current version": the case for no
  role and for a Reader, with invalid content and no version, for the four writes with a version in the unit test,
  and with an old version in the integration test.
- "rules that only an end-to-end test covers, or no test": one integration case each for the stored title kept by a
  save without a change, a page over a limit that is moved, renamed, deleted and restored, a Writer who reverts, the
  versions of the pages after a rename of their folder or tab, and `page-changed` through MCP for a page moved
  meanwhile; `revertPage()` joins the tables of the unit test.
- "a race test waits up to 10 and 20 seconds inside a test that times out after 5": a timeout above its inner ones.

### Test

- Integration: the cases above in `integration/page-service.test.ts` and `integration/folder-service.test.ts`.
- Unit: the cases of the role before the version and `revertPage()` in the tables of
  `src/features/pages/service.test.ts`.
- `npm run check:all` passes. No end-to-end spec is affected: the step changes only tests below the browser.

## Integration tests of the rollback and the races of pages

### Goal

That a content save and its revision are one unit, and that two writes with the same version never both win, is
proven with real concurrency.

### Build

Finding of "Tests: unit and integration":

- "that a content save and its revision are one unit, and most races of pages, are proven by no test against the real
  database", in `integration/page-service.test.ts`:
  - A save and a revert leave the page and its revisions as they were when a trigger refuses the insert of the
    revision, with the technique of the test of `deleteTab()` in `integration/folder-service.test.ts`.
  - A table of races over the pairs of save, move, delete and revert with the same version: exactly one write wins,
    the other is `page-changed`, and the stored page and its revisions fit the winner.
  - Two restores at once.
  - A move and a restore into a tab that is being deleted.
- `testing.md` names these tests in its bullet on races and rollbacks.

### Test

- Integration: the cases above.
- Each new test is shown to fail once, by a change of the service that is taken back before the commit, for example
  the update of the page moved out of the transaction.
- `npm run check:all` passes. No end-to-end spec is affected.

## Tests that assert less than their name says

### Goal

Every test of the services and of the MCP tools fails when the rule in its name is broken.

### Build

Findings of "Tests: unit and integration":

- "tests say that no MCP connection reads deleted pages, but try only a Writer connection": the list of tools holds
  the rule. The four tests are renamed, one case documents that a Manager connection may read deleted pages at the
  level of the service, and `page-deletion.md`, `folder-roles.md` and `mcp.md` say "no tool" in place of "no
  connection".
- "tests that assert less than their name says": the error of the answer is asserted in the four tests of the tools,
  with a name that no connection has; `getPage()` is called or the test renamed; a real outcome is expected for an
  allowed role; `revertPage()` joins the table of writes; the integration test of an admin covers the missing list,
  the move, the revert and the three reads of the history.
- "small gaps in the parity of the tests of the two adapters": one table over all nine tools for the failing database
  and for the result given twice, and the table of errors of `changeRole()` for both intents.

### Test

- Unit: the changed tests of `src/features/pages/service.test.ts`, `src/features/folders/service.test.ts`,
  `src/features/folder-roles/service.test.ts`, `src/features/mcp/tools.test.ts` and
  `src/features/folder-roles/actions.test.ts`.
- Integration: the test of an admin and the case of a Manager connection in `integration/page-service.test.ts`.
- `npm run check:all` passes. No end-to-end spec is affected.

## Unit tests of the services cut down

### Goal

The unit tests of the three content services survive a refactoring that keeps the behaviour: they assert what needs a
mock, and the integration tests prove the rest.

### Build

Finding of "Tests: unit and integration":

- "the unit tests of the services pin the calls of Prisma, not the behaviour", in
  `src/features/pages/service.test.ts`, `src/features/folders/service.test.ts` and
  `src/features/folder-roles/service.test.ts`:
  - Kept: a malformed id or name never reaches the database, every database error becomes its code, the log lines,
    and the data of a write.
  - Cut: the assertions on the exact arguments of a query, the inspections of the list of calls, and the assertions
    on the number and the order of calls, where an integration test proves the same rule.
  - Before a test is cut, the integration test that proves its rule is named; a rule without one gets its integration
    case first.
- `testing.md`, "Unit tests", says what a unit test of a service asserts and what it leaves to the integration tests.

### Test

- The report of the step lists, per file, the tests that were cut and the integration test that covers each rule.
- `npm run test:coverage`: the coverage of the three services stays at the level of the report (94 % to 100 %), or
  the report of the step names each branch that lost its cover and the integration test that has it.
- `npm run check:all` passes. No end-to-end spec is affected.

## Shared helpers of the unit and integration tests

### Goal

A new write or role is added to one table of the tests, and the tests of the pages service can be read by concern.

### Build

Finding of "Tests: unit and integration":

- "fixtures and builders of mocks are copied between the test files":
  - A module of test helpers for the unit tests, left out of the coverage in `vitest.config.ts`, with `RedirectError`,
    the builders of database errors, the ids and actors, and one table of all content writes.
  - Helpers for a stored page, the user "bob" and an MCP actor for the integration tests, and one `revisionsOf()`.
  - `src/features/pages/service.test.ts` is split into reads, history, writes and access.
- `testing.md` names the helpers and the split.

### Test

- The number of unit and integration tests is the same before and after the step, apart from tables that were merged;
  the report of the step gives both numbers.
- `npm run check:all` passes.
- The complete `npm run test:e2e` passes: the step is the last of its session.

## Shared helpers of the end-to-end tests

### Goal

The helpers of the end-to-end tests exist once, every page a test opens waits for hydration, and the comments and
assertions of the tests say what they prove.

### Build

Findings of "Tests: end-to-end":

- "helpers are copied between the specs": `expectNotFound()` and `by()` move to `e2e/support/browser.ts`, the login
  helpers to `e2e/support/auth.ts`, the tool call to a new module `mcp.ts` in `e2e/support/`, and the base address
  comes from the constant of `e2e/support/oauth.ts`.
- "only the `page` of the fixture waits for hydration": `e2e/support/test.ts` exports a helper that wraps `goto()`
  and `reload()` of any page; it is used where a second page or context is opened.
- "71 comments in the tests cite requirement IDs": each ID is replaced by the section of the feature spec that holds
  the rule, or dropped with the sentence kept, in `e2e/`, `integration/` and `src/`. The wrap-up in
  `step-plan-workflow.md` says that requirement IDs leave the comments when the requirements file is deleted.
- "a few assertions prove nothing": the two assertions go, the field errors of the user dialog are asserted at the
  field, the MCP assertion checks the JSON-RPC error, and `testing.md` names the exceptions of the selector rule.
- "an end-to-end test asserts a wall-clock time": the measurement goes, the assertion on the message stays.
- `testing.md`, "Helpers in `e2e/support/`", lists the new helpers and corrects the sentence on hydration.

### Test

- `npm run check:all` passes.
- The complete `npm run test:e2e` passes: the step changes `e2e/support/`.

## End-to-end tests of access, roles and deleted pages

### Goal

The browser tests cover every protected address, every view of a deleted page, the functions of a Manager against a
Writer, and the states of the roles view.

### Build

Findings of "Tests: end-to-end":

- "`/users` and `/change-password` are missing from the protected addresses": the user list, its dialog and
  `/change-password` join `PROTECTED_ADDRESSES` in `e2e/access.spec.ts`.
- "a deleted page is checked on two of the addresses that could show it": the test loops over the views and actions,
  for a page deleted in the folder and one deleted from a tab; new tests "a page can be renamed to the name of a
  deleted page" and "restoring into a tab that no longer exists shows an error".
- "the functions of a Manager are refused for a crafted form of a Writer only for "delete tab"": `submitAs(role, …)`,
  the four forms of a Manager as a Writer, the two addresses of a deleted page, and a crafted "Remove" as a Manager.
- "the "Give role" dialog and the roles view have states that no test reaches": the five cases of the Suggestion in
  `e2e/folder-roles.spec.ts`.

### Test

- End-to-end: the new cases in `e2e/access.spec.ts`, `e2e/deleted-pages.spec.ts`, `e2e/move-or-rename-page.spec.ts`,
  `e2e/restore-page.spec.ts` and `e2e/folder-roles.spec.ts`; these five specs run.
- `npm run check:all` passes.

## End-to-end tests of locking, MCP and single states

### Goal

The revert dialog has the locking cases of the other three actions, a real MCP call meets an open editor, and the
untested states of single components are rendered once.

### Build

Findings of "Tests: end-to-end":

- "the revert dialog has one locking case in the browser": a submission without a version, a rename meanwhile and a
  page deleted meanwhile in `e2e/revert-page.spec.ts`; a move to a taken name on an older state in
  `e2e/move-or-rename-page.spec.ts`.
- ""changed through MCP meanwhile" is simulated with a database row": one test in `e2e/mcp.spec.ts` with a real
  `replace_page_content` while an editor is open, then the save in the browser and the history view.
- "single states of other components have no test": one short test each in the spec of its feature: the limit
  reached between the consent page and "Approve", "Returning to the app…", a tab deleted while its rename dialog is
  open, and Escape in the "Save page" dialog and in the revoke dialog. The case of a failed copy is dropped if the
  browser of the tests cannot be made to refuse the clipboard; the report of the step says which.

Finding of "Code: components, routes, auth, users and lib":

- "the "Save page" dialog does not move the focus to the name field": the effect of `MoveOrRenamePageDialog` in
  `SavePageDialog` of `src/features/pages/components/NewPageForm.tsx`, and an assertion on the focus in "a taken name
  shows an error in the open dialog and keeps all values" of `e2e/create-page.spec.ts`.

### Test

- End-to-end: the new cases. Every spec the step changes runs, among them `revert-page`, `move-or-rename-page`, `mcp`
  and `create-page`, and `e2e/hydration.spec.ts` for the changed dialog.
- `npm run check:all` passes.

## End-to-end tests of the pending state

### Goal

The guard against a double submission has a test before the dialogs are refactored.

### Build

Finding of "Tests: end-to-end":

- "the pending state of the forms and dialogs is tested nowhere":
  - First try whether `page.route()` can hold the request of a Server Action with the installed Next.js.
  - If it can: a helper in `e2e/support/browser.ts` that holds and releases the request, and one test per pattern (a
    dialog with a name, a confirmation dialog, the editor of a page, the "Save page" dialog, "Give role" and the
    consent form): while the submission runs, the buttons are disabled, Escape does nothing and the label is the
    pending one.
  - If it cannot: `testing.md` says that pending states are left untested on purpose, and why; no test is added.
- `testing.md` names the helper, or the limit.

### Test

- End-to-end: the tests of the pending state, if they can be built. The complete `npm run test:e2e` passes when the
  step changes `e2e/support/`.
- `npm run check:all` passes; if only `testing.md` changed, `npm run check` alone.

## Split of `e2e/mcp.spec.ts`

### Goal

The specs of MCP can be picked by what a change affects, and a rule of the database is tested where the database is.

### Build

Finding of "Tests: end-to-end":

- "`mcp.spec.ts` has 1,465 lines": the spec is split by access, read, write and Manager. "the database refuses a page
  whose tab belongs to another folder" of `e2e/tabs.spec.ts` moves to `integration/db-errors.test.ts`, unless a test
  there covers the foreign key already; then it is deleted. The test of `e2e/smoke.spec.ts` that uses neither browser
  nor server is treated the same way.
- `testing.md` names the new specs.

### Test

- End-to-end: the number of the tests of the new specs of MCP, of `e2e/tabs.spec.ts` and of `e2e/smoke.spec.ts` is the
  same before and after, apart from the tests that moved.
- `npm run check:all` passes.
- The complete `npm run test:e2e` passes: the step is the last of its session.

## Actors, guards and one channel

### Goal

Who the actor is and how a content write opens is said in one pure module, and the channel has one set of values.

### Build

Findings of "Code: services of the content features":

- "the guards of a content write are copied into three services": a new pure module
  `src/features/folder-roles/actors.ts` holds `notAllowed()`, `refusedByRole()`, `editorIdOf()` and `unknownActor()`,
  and one function for the opening of a content write that returns the last editor and the channel, or the refusal.
  The services of folders, pages and folder roles use it.
- "the service of the folder roles holds three concerns", the first half: `ContentActor`, `BrowserActor`, `McpActor`,
  `inBrowser()`, `inMcp()` and the channel move to the same module; the adapters import them from there. The finding
  is deleted in the step "The reads of the history in a service of their own".

Finding of "Documentation: the feature specs of the content":

- ""the channel" has two sets of values": the actor and every log line name the channel `web`, so `web` and `mcp` are
  the only values of the stored channel, the actor and the log. `content-structure.md`, `folder-roles.md` and
  `architecture.md` say so.

`architecture.md` names the module, and `src/features/services.test.ts` loads it.

### Test

- Unit: the tests of the three services pass with the channel `web` in the log lines; a test of `actors.ts` covers the
  opening of a write for an admin, a malformed actor id, a browser actor and an MCP actor.
- Integration: the tests of the three services pass unchanged.
- End-to-end: the specs of the content run: `folders`, `tabs`, `pages`, `create-page`, `edit-page`,
  `move-or-rename-page`, `delete-page`, `delete-tab`, `restore-page`, `revert-page`, `folder-roles` and the specs of
  MCP.
- `npm run check:all` passes.

## Guards and errors of the services

### Goal

The content services check, fail and log in one way.

### Build

Findings of "Code: services of the content features":

- "two reads spread the condition for readable folders without checking it for `null`": `getFolderByName()` and
  `getTab()` read the condition into a constant and return `null` when it is `null`.
- "the check for the Owner exists twice inside the service of the folder roles": `writeRole()` starts with the shared
  check and keeps only the check inside the transaction; the folder id is parsed once per function; `ChangeOutcome`
  carries the role of the actor. The order "Owner before input" stays.
- "a database error in the lookup before a write is thrown": the lookup moves inside the `try` of every write of the
  three services, is logged with the ids and returns `failed`.
- "the error types and the helper for `invalid-input` are declared per service": the shared types and the generic
  `invalidInput()` move to `src/lib/result.ts`; `changeRole()` returns `invalid-input` with `fieldErrors` for the
  role, and its action shows them.
- "the log lines of the role writes name the actor and the outcome in another way": `actorId` in every line, "role
  unchanged: the role is the same" for a change to the same role, and the channel in "folder created".

`architecture.md` and `folder-roles.md` are brought in line where they name the lookup, the codes or the log line.

### Test

- Unit: a lookup that fails gives `failed` and its log line, for every write of the three services; the changed log
  lines; `invalid-input` of `changeRole()` with its `fieldErrors`, in the service and in the action.
- Integration: the tests of the three services pass; "reads no folder and no tab without a role of the actor" covers
  the two reads.
- End-to-end: the invalid role in `e2e/folder-roles.spec.ts`; the complete `npm run test:e2e` passes, because the step
  changes `src/lib/result.ts`, which every write uses.
- `npm run check:all` passes.

## Writes of pages

### Goal

A write that stores nothing has one shape, the condition on the version is built in one place, and the soft delete of
a page is written once.

### Build

Findings of "Code: services of the content features":

- ""a write that stored nothing" has five shapes": one internal shape with the discriminant `kind` in all four
  helpers, and a small store function for `moveOrRenamePage()`, so that its log line and result are built after the
  `try`. The public result stays `{ ok: true, value }`.
- "the write with the version in its condition is built by hand three times": the swallowed violation of the revision
  number is logged as a warning, the comment in `deletePage()` is corrected, and one helper builds the condition
  `{ id, deletedAt: null, version }` and the data `version: { increment: 1 }`. The six properties the finding lists
  are kept; the tests of the step "Integration tests of the rollback and the races of pages" prove them.
- "the soft delete of a page is written in two services": the pages service exports a function that builds the data
  of a soft delete, and `deleteTab()` uses it inside its own transaction. No transaction is passed between services.

### Test

- Unit: the warning of the swallowed violation.
- Integration: every test of `integration/page-service.test.ts` and `integration/folder-service.test.ts` passes
  unchanged, the races and the rollbacks included.
- End-to-end: `edit-page`, `move-or-rename-page`, `delete-page`, `delete-tab`, `revert-page`, `restore-page`,
  `page-history` and the specs of MCP that write.
- `npm run check:all` passes.

## The stored page and the derived name

### Goal

A write of a page returns all an adapter needs, and the name of a new page is derived in the service.

### Build

Findings of "Code: MCP, connected apps and OAuth":

- "the write tools read the page a second time for its title": `StoredPage` and its selection carry the title, and
  `storedResult()` builds the result from the stored page alone.
- "`create_page` without a name validates the content in the tool before the service does": `createPage()` of the
  pages service accepts a missing name and derives it after its own checks, with a code of its own for a title that
  suggests no name. The tool no longer parses the content, and the browser action handles the new code. `pages.md`
  and `mcp.md` are brought in line.

### Test

- Unit: the service derives the name and returns the new code; the action and the tool map the new code; the tool
  returns the title of the stored page without a second read.
- Integration: a page created without a name gets the derived name; a title that suggests no name stores nothing; a
  user without a role is refused before the content is looked at.
- End-to-end: `create-page` and the specs of MCP that write.
- `npm run check:all` passes.

## The reads of the history in a service of their own

### Goal

A feature can have more than one service module, and the reads of the history are the first to use it.

### Build

Finding of "Code: services of the content features":

- "the service of the folder roles holds three concerns", the second half:
  - A feature may have service modules next to `service.ts`, named `<part>-service.ts`. The lint rules of
    `eslint.config.mjs` that name `service.ts` (the database only in a service, a service as a type in routes and
    components, no `next`, `react`, revalidation or forms in a service) match both names.
  - `listPageRevisions()`, `getPageRevision()` and `getRevisionComparison()` move to
    `src/features/pages/history-service.ts`; the queries call it. `revertPage()` stays in the pages service, because
    it is a content save.
  - `src/features/services.test.ts` loads the new module.
  - `architecture.md`, "Layout", "Reads and writes" and "Linting", `page-history.md` and `testing.md` name the rule
    and the module.
- The finding is deleted in this step.

### Test

- Lint: an import of `@/lib/db` in a module that is neither `service.ts` nor `<part>-service.ts` is still an error;
  tried once and taken back.
- Unit and integration: the tests of the three reads pass, moved to files of their service; the table of the access
  rules of the step "Integration tests of access and of rules without a test" passes unchanged.
- End-to-end: the specs `page-history`, `revert-page` and `deleted-pages` cover the moved reads.
- `npm run check:all` passes.
- The complete `npm run test:e2e` passes: the step is the last of its session.

## MCP tools

### Goal

The MCP tools say each argument, message and rule once, follow `mayDo()`, and describe what they do.

### Build

Findings of "Code: MCP, connected apps and OAuth":

- "the tools decide by the name of a role which tools a connection gets": each tool is registered under `mayDo()`
  with the function that its write checks; the two texts for people stay hand-written.
- "the tools still support a server without a public URL": the option is a string, the adapter passes the value it
  checked, and the fallback, the four tests and the half sentence of `mcp.md` go.
- "is a malformed name of an existing tab or page refused by the input schema or answered by the tool?": as decided
  under "Decisions on the questions"; `mcp.md` says the rule once.
- "arguments, messages and hints are repeated": one constant for each argument, `pageNotFound()` in `readPage()`, the
  constants for the hints with one of its own for `replace_page_content`, and a local helper for `role_too_low`. The
  nine `switch` blocks stay as they are.
- "the descriptions of the tools name the write without a change for one tool of three": the three texts of the
  Decision.
- "`tools.ts` and the OAuth service each hold several parts", the half of MCP: the schemas of the tools and the
  registration with the descriptions move to modules of their own, which `src/features/services.test.ts` loads. The
  finding is deleted in the step "OAuth and grants".
- "two helpers with nearly the same name give two orders": a name that says what the helper does, a sort by tab and
  then by name, and a word about the other order in both comments.
- "leftovers in the features of OAuth, grants and MCP", the half of MCP: the server reports the version of
  `package.json`, and names that nothing imports lose their `export`. The finding is deleted in the step "OAuth and
  grants".

Finding of "Documentation: architecture, testing, catalog and workflows":

- "`.env.example` says that without the public URL "only API tokens work"": "without it there is no OAuth and no MCP
  server".

### Test

- Unit: `src/features/mcp/tools.test.ts` compares the tools of each role with `FUNCTION_ROLES`; a malformed name and a
  name with spaces around it give the not-found error of the tool for every tool that takes the name of an existing
  tab or page; the hints, the descriptions and the version are asserted.
- End-to-end: the specs of MCP, `e2e/oauth.spec.ts` and `e2e/ai-apps.spec.ts`.
- `npm run check:all` passes.

## OAuth and grants

### Goal

The features of OAuth and grants have one owner per rule, one answer per error and log lines that say why.

### Build

Findings of "Code: MCP, connected apps and OAuth":

- "the log lines of the OAuth and the grant service follow several conventions": a reason of its own for each
  refusal of an authorization request, `clientRowId` for the id of the row, and one of `actorId` and `userId` per
  function.
- "the OAuth service returns texts of messages, and one code has two shapes": as decided under "Decisions on the
  questions": `architecture.md` and `oauth.md` state the exception, and the two codes get names of their own.
- "the features of grants and OAuth import each other": `MAX_GRANTS_PER_USER` moves to a pure module of the grants,
  one `isOAuthOn()` is exported from the issuer module and used everywhere, the two files of MCP included, and the
  check in the action that revokes a grant goes.
- "the error answer of an authorization request is put together in three places": one function next to
  `authorizationResponseUrl()` in the schema of OAuth.
- "`tools.ts` and the OAuth service each hold several parts", the half of OAuth: the service is split along its
  parts (the clients and their registration, the authorization request with the code, the token endpoint, the
  clean-up) into service modules named `<part>-service.ts`; the error of an invalid grant is unwrapped once, and
  there is one `refuse()`. `src/features/services.test.ts` loads each module. The finding is deleted in this step.
- "leftovers in the features of OAuth, grants and MCP", the rest: `unauthorized_client` and `invalid_scope` leave
  `OAUTH_ERRORS` and the unit test of the schema is adjusted; `newTokens()` states its return type and its parameter
  hides no import; a stored role that is no role of MCP is logged the same way in all four places; `mediaTypeOf()`
  exists once; the comment on "a former API token" is corrected; names that nothing imports lose their `export`. The
  finding is deleted in this step.

`oauth.md`, `connected-apps.md` and `architecture.md` are brought in line where they name the modules or the log.

### Test

- Unit: the reasons of the refusals in the log; one `isOAuthOn()`; the error answer keeps its address in the tests
  of the actions and the queries.
- Integration: `integration/oauth-service.test.ts`, `integration/oauth-metadata.test.ts` and
  `integration/grant-service.test.ts` pass, with only their imports changed.
- End-to-end: `oauth`, `account`, `ai-apps` and the specs of MCP.
- `npm run check:all` passes.

## Actions, forms and schemas

### Goal

A message, a label, the name rule and the read of a text field exist once.

### Build

Findings of "Code: services of the content features" and "Code: components, routes, auth, users and lib":

- "the actions of pages and folders repeat messages, form states and the mapping of a failed parse": the two messages
  and the state are exported from one place, one helper maps the errors of the place, and `showChanged()` takes the
  address.
- "messages and labels of the same situation are defined more than once": `createUser()` answers "The server is busy,
  please try again in a moment", the hint under "New password" says "Not built from your user name or the name of the
  wiki, and not a common password", and `TYPE_LABELS` moves next to the types of an account.
- "the schema of a user name is a second copy of the name rule": `src/lib/names.ts` exports a builder of the schema
  with the limits, and a parser for an exact match.
- "a text field of a form is read in three ways": one helper for a text field and one generic type of a parse result
  and of a form state, in a module of `src/lib/` without server-only imports. A file counts as empty, so the schema
  reports the field as missing.
- "unused names, an unused colour, and small twins", one part: a malformed id bound to an action is answered as the
  action answers a missing row of its feature. The finding is deleted in the step "Lint rules and checks".

`users-and-login.md` is brought in line where it quotes a text.

### Test

- Unit: the messages of the schemas of a name and a user name stay, in the same order; a file in a text field is
  reported as missing for every form; the two new texts; a malformed id in the actions of roles, grants, folders and
  pages.
- End-to-end: the assertions on the two texts in `users` and `change-password`; the complete `npm run test:e2e`
  passes, because the step changes `src/lib/names.ts`, which every form uses.
- `npm run check:all` passes.

## Leftovers and small duplicates

### Goal

No name, comment or small rule misleads a reader, and the browser gets no library it does not use.

### Build

Findings of "Code: services of the content features" and "Code: components, routes, auth, users and lib":

- "unused names and comments that no longer match the code": `Channel` and `isRole()` with its test go, the comments
  are corrected, and `GRANT_ACCESS_TOKEN_HASH` and `OAUTH_CODE_HASH` go together with their cases in
  `integration/db-errors.test.ts`; the unique constraints stay in the schema.
- "small rules that are written more than once": `mayDo(role, "read")` in all four places, a `withView()`, one
  extraction of the constraint, `isRevisionNumber()` exported from the schema, and `null` from `listFolders()` for a
  malformed actor id as the other reads.
- "comments promise "Client Components can use it"": the three comments are corrected.
- "unused names, an unused colour, and small twins", one part: `LogoutFormAction`, `LoginInput`,
  `authorizationServerMetadataPath()` with its test and the secondary colour go. The finding is deleted in the step
  "Lint rules and checks".
- "do Client Components ship Zod and markdown-it only to read the name of a field or a length limit?": as decided
  under "Decisions on the questions". The chunks of the client of a production build are read for a page with
  `?action=delete`; the report of the step gives the result. Only if the libraries are in them, `VERSION_FIELD`,
  `PLACE_FIELD` and `NAME_MAX_LENGTH` move to modules without imports, and `architecture.md` says why.

### Test

- Unit and integration: the tests pass without the deleted names.
- Manual: the chunks of the client before and, if something moved, after the change.
- End-to-end: the specs of the content; `npm run test:e2e:production` for `delete-page`, `revert-page` and
  `move-or-rename-page` if the field names moved, because the bundles exist only in a production build.
- `npm run check:all` passes.

## Lint rules and checks

### Goal

Four conventions are held by a check and no longer by a habit, and unused exports are reported.

### Build

Findings of "Code: components, routes, auth, users and lib":

- "four rules of `architecture.md` are convention only":
  - `no-console` is on for `src/` and off for the two error pages.
  - The MCP tools and the pure modules of OAuth join the rule of the services: no `next`, no `react`.
  - A syntax rule refuses `include` in a service.
  - The roots that `src/lib/revalidate.ts` uses and the `/` of the header and of the auth actions come from helpers
    of `src/lib/addresses.ts`.
- "unused names, an unused colour, and small twins", the rest: `knip` in its latest stable version joins
  `npm run check` through `scripts/check.ts` and the `lint` workflow, with a script of its own in `package.json`; what
  it reports is deleted, loses its `export`, or is named in its configuration with a reason. The finding is deleted
  in this step.

Finding of "Documentation: architecture, testing, catalog and workflows":

- "is a change outside a step plan committed?": as decided under "Decisions on the questions": one line under "Git
  Handling" in `CLAUDE.md`, and `scripts/check-doc-references.ts` also reads the skills in `.claude/skills/`.

`architecture.md`, "Linting", `testing.md` and `README.md` name the new rules, the check and the script.

### Test

- Lint: each new rule is shown to report once, by a line that breaks it and is taken back: `console.log` in a
  component, `react` in the MCP tools, `include` in a service.
- `npm run docs:check` fails for a file that a skill names and that does not exist; tried once and taken back.
- `knip` passes and fails for an export that nothing imports; tried once and taken back.
- The complete `npm run test:e2e` passes: the step is the last of its session, and it changes `src/lib/addresses.ts`
  and `src/lib/revalidate.ts`.
- `npm run check:all` passes.

## The query of a page and what a route shows

### Goal

Each route of the content decides once what an address shows, for the title and for the page, and the rules of the
query have unit tests.

### Build

Findings of "Code: components, routes, auth, users and lib":

- "`PageView.tsx` holds the parser of the query, the table of roles and the titles": the pure part moves to a module
  of the pages feature without server-only imports, with a unit test; the unused exports go, and the sentence of
  `architecture.md` on `parsePageNotice()` is corrected.
- "the title and the page each decide what an address shows": one function per route turns the parameters and the
  query into "not found" or into what to show, the role included; `generateMetadata` and the page use it.
- "each route states the role of an action twice": the buttons are built from the table of the route.

### Test

- Unit: the parser of the query (the views, the actions, `before` from 2 up, which parameter belongs to which view),
  the role of each action, and the titles.
- End-to-end: a Reader who opens `?action=new`, and an address with an invalid query, see the not-found page under
  its own title, in `e2e/folder-roles.spec.ts` or the spec of the route; the specs `folders`, `tabs`, `pages`,
  `folder-roles`, `page-history`, `edit-page`, `access` and `deleted-pages` run.
- `npm run check:all` passes.

## Views of the folder routes and pieces of the lists

### Goal

The routes of a folder and a tab hand their views to components, as the routes of pages do, and the lists share their
small pieces.

### Build

Findings of "Code: components, routes, auth, users and lib":

- "the folder route is a switch of five views written inline": the route keeps `requireUser()`, the read, the parse,
  the gate and the switch; the views move into Server Components of the features, the view "New page" and the head
  with its buttons exist once, and `NewPageForm` takes the tab once.
- "the time, the empty state and the label of a page are typed again in every list": `Time` moves to
  `src/components/`, with a component for the empty state and a helper for the label of a page.

`architecture.md`, "Layout" and "UI", names the shared components.

### Test

- End-to-end: the specs of the routes and lists: `folders`, `tabs`, `pages`, `all-pages`, `create-page`, `ai-apps`,
  `folder-roles`, `deleted-pages`, `page-history`, `account`, `users` and `hydration`.
- `npm run check:all` passes.

## Dialogs

### Goal

The rules of a dialog and of a form that rests on a version are written once.

### Build

Findings of "Code: components, routes, auth, users and lib":

- "the handling of a changed page is put together by hand": one component for the hidden field with the version and
  the warning, and one helper for the key and the message. The address parameter of `showChanged()` comes from the
  step "Actions, forms and schemas".
- "nine dialogs repeat the same frame and its rules by hand": a frame component for a dialog that submits a form, a
  confirmation dialog on top of it for the three deletes and the revert, and two hooks: one for the submit in a
  transition, one for the focus on the first field with an error. The bodies of the forms, the second stage of
  `CreateUserDialog` and the texts stay where they are. If the step "End-to-end tests of the pending state" could
  build no test, the pending state of every dialog is checked by hand in this step.

`architecture.md`, "UI", names the frame, the confirmation dialog and the hooks.

### Test

- End-to-end: the complete `npm run test:e2e` passes: the step is the last of its session. `e2e/hydration.spec.ts` covers every dialog with JavaScript disabled, and the tests of the pending state the guard
  against a double submission.
- `npm run check:all` passes.

## The first review report

### Goal

`spec/review-report.md` describes the code as it is after the steps above.

### Build

Findings of "Documentation: the first review report and the other feature specs":

- "17 findings of `review-report.md` cite line ranges or a file that no longer hold the code": each Location of the
  table is replaced by the range that holds now. The table names the functions; the ranges it gives are older than
  the refactoring of this plan.
- "four open findings of `review-report.md` describe a state of the code that has moved on": the four passages are
  rewritten for the code as it is now, the changes of this plan included. The finding on prompt injection becomes
  Major, and the counts and the list "To fix first" of that report change with it.
- "the threat model and the "Reviewed" lists of `review-report.md` leave out the page history": the missing actions,
  views and the asset are added, the three statements are corrected, and the page history, the delete of a tab and
  the tools of a Manager are listed under "Not covered by this review" until a security recheck.
- "the first nit of `review-report.md` still names `changeRole()` for an invalid role": the nit says that for
  `changeRole()` only a submission without a user or an intent is answered before the rights.
- What the earlier steps noted about findings of that report is brought in line as well.

### Test

- `npm run check` passes; only documentation changes.
- The counts of the summary of `review-report.md` match its findings.

## One owner per rule in the feature specs

### Goal

Each rule of the content stands in full in one feature spec, and the specs point to the code for what the code says.

### Build

Findings of "Documentation: the feature specs of the content":

- "the rules of writes without a change are explained in full in five specs": `pages.md` owns the content save and
  `content-structure.md` the rename and the move, each in one section with one list for the order, the answer and
  the log; every other place keeps one clause and a pointer.
- "more rules are stated in full in two or more specs": the full text stays in the spec that owns the rule; the
  copies become a clause and a pointer.
- "the specs restate messages, constants and details of the UI": a spec says what a message names and points to its
  function; the sentences on hydration and Enter go; the list of protocols stays as a security rule with its
  constant; of the measured times only the bound that the cost test enforces stays.
- "several sections grew sentence by sentence": the pointers move to the top, "Last editor" is split into the last
  editor and the channel, "Decisions" is grouped by topic, the three bullets on a tab become one, and the order of
  the refusals of a connection is a numbered list.

### Test

- `npm run check` passes; only documentation changes.
- No rule is lost: the report of the step names, for each section that was shortened, the spec that owns its rule
  now.
- Every heading that another spec, `CLAUDE.md` or a skill cites still exists under that name.

## Structure of `architecture.md` and the other documents

### Goal

A rule of `architecture.md` is found under a heading of its own, the documents use one name per thing, and the
catalog says what each file is for.

### Build

Findings of "Documentation: architecture, testing, catalog and workflows":

- "`architecture.md` has bullets that grew into paragraphs": "Reads and writes" is split into the layers, the
  services, the actors with channels and roles, the queries, the actions and the callers other than the browser; the
  list of features becomes a table; each repeated rule is stated once.
- "documents restate code, constants and configuration": a number stays only where a user or an operator relies on
  it, once and with a pointer to its constant; everywhere else the document points to the file.
- "the same things carry different names across the documents": a list of terms at the top of `architecture.md`,
  "caller other than the browser" throughout, and the terms for connected apps chosen to fit the names the UI shows.
- "the entries of the catalog in `CLAUDE.md` have grown into second copies of the specs": a rule under
  "Specification" that an entry is one line, the file and the question it answers; the entries are rewritten by it,
  and the item of the wrap-up in `step-plan-workflow.md` says the same.

### Test

- `npm run check` passes; only documentation changes.
- Every heading of `architecture.md` that another document, a comment of the code or a lint message cites exists
  under the name cited; the citations are updated where a heading changed.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. This plan has no feature spec of its own: its steps updated the feature specs. Check that `architecture.md`,
   `testing.md` and `tech.md` hold every convention that changed: service modules next to `service.ts`, the pure
   module of the actors, the shared helpers of the tests, the new lint rules and `knip`.
2. `roadmap.md` holds no entry for this plan; check that no entry points to a finding that is gone.
3. Check that `README.md` has all the commands a developer needs, the script of `knip` included.
4. Bring `spec/review-02-report.md` in line with its one open finding: the summary, "Scope and method" and "Suggested
   order of work".
5. Delete this step file. There is no requirements file.
6. Update the spec catalog in `CLAUDE.md`: remove this step file; the entry of `spec/review-02-report.md` stays.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
