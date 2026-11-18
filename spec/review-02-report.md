# HippoWiki – Review Report 02: Code Quality, Tests and Documentation

## Summary

- Verdict: no Blocker. The code is in better shape than "dirty" suggests: the layers hold and ESLint enforces
  them, every adapter handles every code of every write, the browser and MCP agree on the seven writes they share,
  and the newest rules (writes that store nothing) are proven against the real database and in the browser. The
  weak points are three:
  - Rules that are written several times: the frame of a dialog in nine components, which is shared now, and the
    same rule in up to five specs. Two copies had drifted already; the one in the "Save page" dialog is fixed.
  - Tests that would not catch the refactoring this report suggests: the unit tests of the services pinned the calls
    of Prisma, and three rules of access and of the transaction had no test that could fail. Both are fixed; the
    findings of the tests that are still open are minor.
  - Documents that the features outran: rules stated in full in several documents, and copies of code and
    constants in the specs.
- Findings: 13 open of 107, 0 Blocker, 0 Major, 12 Minor and 1 Nit (5 `issue:`, 7 `suggestion:` and 1 `nit:`); no
  `question:` is open.
- Confidence of the suggestions: 1 High, 10 Medium and 2 Low. A High suggestion can be
  fixed as written; the others wait for the user, as `issue-report.md` describes.
- Decisions: on 2026-11-18 the user decided all Medium and Low suggestions. Each of these findings ends with a line
  `Decision`, and is fixed as that line says, without asking again. The questions were decided by the user on the
  same day, in "Decisions on the questions" of `spec/review-02-fixes-steps.md`.
- To fix first: no Major finding is open; the four Major findings of the tests are fixed.
- Not covered by this review: security, which `review-report.md` covers and whose findings are not repeated here;
  the unit tests of auth, users, OAuth and grants, of which only the names and the copied helpers were looked at;
  and the behaviour in a browser, because the review ran no server. The bundles for the browser were measured in the
  fixes: a production build showed Zod and markdown-it in the chunks of a page route until the names of the form
  fields moved; Zod stays there through `src/lib/addresses.ts`, which imports the schema of a name.

## Scope and method

- Reviewed: all of `src/` without `src/generated/` and without the list of common passwords, `e2e/`,
  `integration/`, `prisma/`, `scripts/`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`,
  `.env.example`, every file of `spec/`, `README.md`, `CLAUDE.md`, `AGENTS.md` and the skills in `.claude/skills/`.
- Date: 2026-11-18. The code is the state of the branch `main` on that day.
- The question of the review: after many features in a short time, where did the code, the tests and the
  documents get "dirty", and what has to be in place before a cleanup? It is no security review.
- Evidence comes from:
  - reading the code, the tests and the documents; each of eight areas was read by a read-only subagent with a
    fresh context, and the main claims of each area, among them every Major finding, were checked again against
    the cited lines before they went into this report; a claim that was reasoned and not shown says so in its
    Confidence;
  - `npm run test:coverage` for the numbers of the unit coverage;
  - searches over the repository for the layer rules, for copied helpers and for exports that no file imports.
- Not run: `npm run check:all`, the integration tests and the end-to-end tests. The review changes no code and no
  other document; this report and its entry in `CLAUDE.md` are the only changes.
- Each finding follows `issue-report.md`, with its severities and confidence levels. A finding of the first report
  is not repeated; where this review touches one, it says so.
- The section "Findings" holds only open findings. A fixed finding is deleted from this report, and the other documents are
  brought in line in the same change, as "Fixing a finding of the review report" in `step-plan-workflow.md`
  describes for the first report.

## Criteria

The review asked the same questions of the code, the tests and the documents:

- One rule in one place: is a rule or a decision written in two places, so that a change has to remember both?
  Text that only looks alike is no finding.
- Consistency: is the same idea modelled, named and logged the same way everywhere?
- One responsibility: does a function, a file or a section of a spec hold several things that could stand alone?
- Layers: do the rules of `architecture.md` hold, and does a check enforce them or only a convention?
- Parity: do the browser and MCP handle every code of every write, and the same rule in the same way?
- Leftovers: unused names, dead branches, comments and sentences that describe a state that is gone.
- Tests as a safety net: does every rule of a spec have a test that can fail, at a level that can prove it (a race
  needs the database, a state of a dialog needs the browser), and would a test survive a refactoring that keeps
  the behaviour?
- Documents as built: is every statement of a spec true today, do the specs agree with each other, and does a
  spec point to code instead of restating it?

What can go wrong in a cleanup, and what several findings warn about:

- The wrong abstraction: two things that only look alike are merged, and the shared function grows a flag per
  caller. The findings say where a copy should stay, for example the nine `switch` blocks of the MCP tools.
- A change of behaviour by accident, above all in the writes with a version: the comparison inside the condition
  of the write, the order of the checks and the transaction of a content save. The integration tests of
  `integration/page-service.test.ts` pin the properties to keep, the races and the rollbacks included.
- A lost check of access when helpers are shared: the role before the version, and the `null` of the condition
  for readable folders.
- A cleanup in one step: the findings are cut so that each can be fixed and checked on its own.

## Findings

### Code: services of the content features

#### Reviewed

- The layer rules hold: no service imports `next`, `react`, the revalidation or a `forms.ts`; `getDb()` is called
  only in services and in `src/lib/`; the pure modules have no server-only import. ESLint enforces these rules
  (`eslint.config.mjs`), so they are no convention that can decay.
- The adapters are thin: every query is the connection, `requireUser()` and one call of a service; every action
  calls `requireUser()` first and outside a `try`, redirects last and builds the address from the stored item.
- The order of checks: all 14 writes follow actor, ids, role, input, write; the two deviations are meant and
  commented.
- Every `switch` over the codes of a write handles every code; ESLint's `switch-exhaustiveness-check` and the type
  checker enforce it, and equal codes lead to the same behaviour in all 14 actions.
- `roles.ts`: `FUNCTION_ROLES` with `mayDo()` is the one place that says what a role may do.
- Concurrency as built is correct as far as it was traced: the row lock before the revision number, `FOR UPDATE`
  in `deleteTab()`, the locked roles in `writeRole()`, and the comparison of `writeRename()` inside the condition.
  Each has an integration test that runs the race.
- `db-errors.ts` matches constraints by name, not by the text of an error, with one integration test for each.
- `markdown.ts`, `diff.ts`, `derive.ts` and `limits.ts` are small, pure and documented.

### Code: MCP, connected apps and OAuth

The browser actions and the MCP tools were compared code by code for the seven writes that both offer (create a
page, save its content, move or rename it, delete it, and create, rename and delete a tab). Every code of every
service is handled on both sides, no `switch` has a `default`, and the two sides differ only where a spec says so:
for `not-allowed` the browser shows the not-found page and MCP says that the role does not allow the change.

#### Reviewed

- Parity of the codes is complete for all seven writes that both adapters offer.
- The layer rules hold: `tools.ts` imports nothing from `next` or `react`; only the services of grants and OAuth
  call the database in this area; the four route files only hand the request over.
- The adapters are thin: the MCP adapter checks the path, the method, the origin, the token and the folder and
  hands over; the OAuth adapter reads bodies and maps codes to a status and an OAuth error.
- The bearer token is parsed in one place, `bearerTokenOf()` of the grant service.
- The texts shared by the tools (`NOT_ALLOWED`, `WRITE_FAILED`, `pageNotFound()`, `tabNotFound()`, `pageChanged()`,
  `invalidInput()`, `nameTaken()`) hold each message once, and each argument, description of an output and hint is
  one constant in `tool-schemas.ts` or `server.ts`.
- The OAuth service is split into `clients-service.ts`, `authorization-service.ts`, `token-service.ts` and
  `cleanup-service.ts`, with `rows.ts` for what they share; each refusal of an authorization request is logged with a
  reason of its own and `clientRowId`; the error answer to a client is built once, by `authorizationErrorUrl()`; the
  limit of grants is `src/features/grants/limits.ts`, and whether OAuth is on is `isOAuthOn()` of the issuer module.
- The tools of a connection follow `mayDo()`, and a unit test compares the tools of each role with `FUNCTION_ROLES`;
  the tools take the public URL that the adapter checked, and every name of an existing tab or page is a plain
  string that the tool answers with its not-found error.
- The log lines of writes without a change are uniform in both content services, always with the channel.
- `secret.ts`, `public-address.ts`, `metadata-fetch.ts` and `issuer.ts` are small, with one purpose each, and the
  shape and the hash of a token exist once.
- `replacedGrants()` is one condition for the count on the consent page and for the delete in the exchange.

### Code: components, routes, auth, users and lib

#### Reviewed

- The boundary of client and server holds today: none of the 22 Client Components imports a service, a queries
  module, the database, the logger, the environment or the schema of the users as a value.
- Apart from the finding of the first review report on the rows of tabs, each Client Component gets only what it
  shows or submits.
- Every page calls `requireUser()`, or the documented exception, before it reads the query.
- Each route of the content decides once what its address shows: `folderAddressOf()`, `tabAddressOf()`,
  `pageAddressOf()` and `deletedPageAddressOf()` of the pure modules `folder-query.ts` and `page-query.ts` turn the
  item and the query string into the view or action with its title, the role included, for `generateMetadata` and
  the page alike; their unit tests cover the views, the actions, `before` from 2 up, the parameters of each view, the
  role of each action and the titles, and `e2e/folders.spec.ts` and `e2e/folder-roles.spec.ts` check that a
  not-found page keeps the plain title. The buttons ask the same tables of the lowest roles.
- The routes of a folder and a tab hold only the login, `resolve()`, the gate and a switch, as the routes of pages
  do; the views are Server Components of their features (`FolderView`, `TabView`, `FolderRolesView`, `AllPagesView`,
  `NewPageView`, `AiAppsView`), the head with its buttons is `HeadingWithActions`, and `NewPageForm` takes the tab
  once. The lists share `Time`, `EmptyState` and `pageLabel()`.
- Links, redirects and the addresses that close a dialog are built with `src/lib/addresses.ts`, with the three
  exceptions named above.
- The two error pages use the `retry` prop, which is the API of the installed Next.js.
- Shared pieces that work: `PageNameAndPlaceFields` for three dialogs, the place of the history for live and
  deleted pages, `PageListItem`, `useHydrated()`, and `mayDo()` for routes and services alike.
- The services of auth and users: a type of errors per write, `Result` everywhere, no password in a log line, and
  pure modules for the wait, the limits and the type of an account.
- Every form state is the field errors and a message, with at most one documented extra.
- Every dialog with a form moves the focus to the first field with an error after a refused save, the "Save page"
  dialog included (`e2e/create-page.spec.ts`), with one hook, `useFocusOnFirstError()`.
- The frame of the dialogs of an action is written once in `src/components/ActionDialog.tsx`: `ActionDialog`,
  `DialogForm`, `DialogFormActions` and `ConfirmDialog` for the deletes, the revoke and the revert, with
  `useSubmitInTransition()` for the forms with controlled choices; `e2e/hydration.spec.ts` and
  `e2e/pending-states.spec.ts` cover the lock until hydration and while pending. A form that rests on the version of
  a page holds `PageVersionField`, and its parent takes the key and the message from `changedPageForm()`.
- There is no `TODO` or `FIXME` in `src/`, `scripts/` or `prisma/`.
- The conventions that were habits are checks now: `no-console` holds for all of `src/` but the two error pages, the
  MCP server and the pure modules of OAuth hold the rules of a service, a service reads with `select` only, the
  roots and `/` come from `src/lib/addresses.ts`, and `npm run knip` reports unused files and exports in
  `npm run check`; the check of doc references reads the skills too.

### Tests: unit and integration

Unit coverage on 2026-11-18 is 78.95 % of the lines and 69.71 % of the branches. The gap is almost only the
components and the route pages, which have no unit tests on purpose (67 of 138 files, 690 lines); the services are
between 94 % and 100 %. The findings of this section were therefore about what is asserted, not about lines; all of
them are fixed.

#### Reviewed

- The rules of writes that store nothing are proven against the real database, with the whole row compared before
  and after: the content save with line breaks, an older version, a deleted page and the limits; the move to the
  own name and place; the rename of a folder or tab to its own name, with the name stored at the moment of the
  save and with MCP; the change to the same role. The unit tests assert every log line of these cases.
- The refusals of optimistic locking for save, move, delete and revert, with a strict comparison of the result and
  of the untouched row, including "changed, not taken" and the restore without a version.
- The last Owner with a real race, and the trigger of the database against roles of admins.
- The delete of a tab: the rollback with a trigger, a race with a held lock, 300 pages, and MCP.
- The unit tests of the services assert what needs a mock, and the integration tests prove the queries; the helpers
  of both exist once (`src/test/`, `integration/helpers.ts`), and the unit tests of the pages service are split by
  concern.
- A content save and a revert with their revision as one unit, by a trigger; the races of every pair of save,
  revert, move and delete with the same version, of two restores, and of a create, move and restore into a tab while
  it is deleted.
- The limits on a revert in unit, integration and end-to-end tests.
- The mapping of the codes: every code of every action of pages, folders and roles has its form state, and every
  code of all nine tools its tool error. The tests of the tools run the real SDK and check the lists of tools per
  role.
- The tests of the queries prove the order of the connection, `requireUser()` and the service.
- `src/features/services.test.ts` lists every service and the MCP tools.
- No test is skipped or marked `only` or `todo`.
- Not reviewed for weak or coupled tests: the unit tests of auth, users, OAuth and grants; only their names and
  their copied helpers were looked at.

### Tests: end-to-end

#### Reviewed

- The newest rules are proven in the browser and at the server: "Save" of the rename dialogs disabled for the own
  name, with Enter without effect and nothing stored (`e2e/folders.spec.ts`, `e2e/tabs.spec.ts`); "Save" of "Move or
  rename page" disabled for the own name and place, also after a refused save
  (`e2e/move-or-rename-page.spec.ts`); a save without a change, with strict comparisons of the row and the
  revisions (`e2e/edit-page.spec.ts`); a change to the same role (`e2e/folder-roles.spec.ts`).
- Optimistic locking: two real browser contexts for save, move or rename and delete, a second tab of the same user,
  a rename meanwhile and a missing version, each with the address, the exact message, the stored content and a
  second confirm that succeeds; the revert has a missing version, a rename and a delete meanwhile, and a move to a
  name taken meanwhile on an older state is refused as changed. MCP has a first and a second writer and a refusal
  after an edit in the browser, and a real `replace_page_content` while an editor is open is refused in the browser
  and shows in the history.
- The pending state: `e2e/pending-states.spec.ts` holds the request of a Server Action and checks, for a dialog with
  a name, a confirmation dialog, the editor, the "Save page" dialog, "Give role" and the consent form, that the
  buttons are disabled with the pending label and that Escape does nothing; the test of the name dialog was shown to
  fail without the guard of Escape.
- Single states: the grant limit reached between the consent page and "Approve", "Returning to the app…", a tab
  deleted while its rename dialog is open, Escape in the "Save page" and the revoke dialog, and a copy that the
  browser refuses, for the first password and for an MCP address.
- Roles: each function is allowed for its lowest role and not found for the next lower one at its address, and a
  crafted form of each function of a Manager is refused for a Writer, as "Remove" of a role is for a Manager; a
  change of a role holds from the next request on; the last Owner is kept. The "Give role" dialog and the roles view
  show their errors at the field or in the view: no user chosen, a role given or removed meanwhile, and a cancelled
  change of the own role.
- Deleted pages: every view and action of the old address of a deleted page is not found, also for a page deleted
  from a tab; a page can be renamed to the name of a deleted page, and a restore into a tab deleted meanwhile is
  refused.
- Access without a login: `e2e/access.spec.ts` checks every kind of address, the user list and the password change
  included.
- Admins never see content: `e2e/access.spec.ts` checks every content route with its views and actions.
- Parity of browser and MCP: the last editor and the channel after real MCP writes, the revisions MCP writes, the
  lower of the two roles, and a tab deleted in the browser as MCP sees it.
- Conventions: all 27 specs reset the database in `beforeEach` and import `test` and `expect` from the support
  module; there is no fixed wait, no `networkidle` and no measured time; `e2e/hydration.spec.ts` has a case for every
  component that uses `useHydrated`.
- Shared helpers: the not-found page, the line of the last editor, the login, the MCP tool call and the own role
  exist once in `e2e/support/`, and the base address is one constant; every page a test opens waits for hydration,
  the second pages through `hydrating()`. No comment cites a requirement ID. Field errors are asserted at the field,
  and `testing.md` names the exceptions of the selector rule.
- `testing.md` matches the configuration of Playwright, the global setup and the helpers in every statement
  checked.
- Every route under `src/app` has an end-to-end test except the two error pages.
- The specs of MCP are split by access, read, write and Manager, and every end-to-end test uses the browser or the
  server; the foreign key of a page and its tab is proven in `integration/db-errors.test.ts`.

### Documentation: the feature specs of the content

The seven specs of the content (`pages.md`, `content-structure.md`, `page-history.md`, `page-deletion.md`,
`optimistic-locking.md`, `folder-roles.md`, `mcp.md`) were read sentence by sentence against the code. The rules
that several of them state were compared with each other and with the code:

| Rule                                                 | Stated in                                                                                  | The specs agree                       | The code agrees       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- | --------------------- |
| A content save without a change stores nothing       | `pages.md`, `page-history.md`, `optimistic-locking.md`, `content-structure.md`, `mcp.md`   | Yes; two copies leave out the channel | Yes                   |
| A rename of a folder or tab to its own name          | `content-structure.md`, `pages.md`, `mcp.md`                                               | Yes                                   | Yes                   |
| A move or rename of a page to its own name and place | `content-structure.md`, `pages.md`, `optimistic-locking.md`, `mcp.md`                      | Yes                                   | Yes                   |
| A change to the same role                            | `folder-roles.md`                                                                          | One place                             | Yes                   |
| Who may delete a tab                                 | `folder-roles.md`, `content-structure.md`, `mcp.md`                                        | Yes                                   | Yes                   |
| What the roles of MCP may do                         | `mcp.md`, `folder-roles.md`, `content-structure.md`, `page-deletion.md`, `architecture.md` | Yes                                   | The seven specs yes   |
| The last editor and the channel                      | all seven                                                                                  | Yes                                   | The stored values yes |
| Who is stored for a page                             | `pages.md`, `content-structure.md`, `page-history.md`                                      | Yes                                   | Yes                   |
| Deleting a tab counts the versions up, unchecked     | `content-structure.md`, `optimistic-locking.md`, `page-deletion.md`                        | Yes                                   | Yes                   |
| Restoring is unchecked and stores the channel `web`  | `page-deletion.md`, `optimistic-locking.md`                                                | Yes                                   | Yes                   |

#### suggestion: the rules of writes without a change are explained in full in five specs

- Location: `spec/pages.md`, sections "Content and title", "Saves without a change", "Decisions" and "Current
  limits"; `spec/content-structure.md`, sections "Renaming to the same name", "Moving or renaming a page to its own
  name and place", "Last editor" and "Decisions"; `spec/page-history.md`, sections "Revisions" and "Decisions";
  `spec/optimistic-locking.md`, section "The version of a page"; `spec/mcp.md`, section "Tools"
- Severity: Minor. The copies agree today, but each change touches five files.
- Category: docs
- Problem: "the page keeps its last editor, channel, time and version" is written out about nine times, and the
  decisions of the three variants repeat each other.
- Impact: the next change of the rule leaves a copy behind; the table above shows the first drift, the channel
  missing in two copies.
- Evidence: `mcp.md`: "the page keeps its last editor, channel, time and version, and the tool returns the same
  version that the call stated"; `page-history.md`: "stores nothing and records no revision: the page keeps its
  last editor, time and version".
- Suggestion (optional): `pages.md` owns the content save and `content-structure.md` the rename and the move, in
  one section with one list for the order, the answer and the log; every other place keeps one clause and a
  pointer.
- Confidence: Medium. Which spec owns a rule is a judgement; no behaviour changes.
- Decision (2026-11-18): as suggested.

#### suggestion: more rules are stated in full in two or more specs

- Location: the rule of the version for MCP in `spec/optimistic-locking.md`, "Callers other than the browser", and
  `spec/mcp.md`, "What holds for all of them"; deleting a tab in `spec/content-structure.md`,
  `spec/page-deletion.md`, `spec/optimistic-locking.md`, `spec/mcp.md` and `spec/folder-roles.md`; the lower of two
  roles in `spec/mcp.md` and `spec/folder-roles.md`; "no deleted pages through MCP" four times in `spec/mcp.md`,
  twice in `spec/page-deletion.md` and twice in `spec/folder-roles.md`; the folder views twice inside
  `spec/content-structure.md` and again in `spec/folder-roles.md`
- Severity: Minor. The same risk as the finding above.
- Category: docs
- Problem: each rule has several full copies with slightly different detail.
- Impact: a reader cannot tell which spec decides, and a reviewer has to compare all copies.
- Evidence: `optimistic-locking.md` and `mcp.md` both hold: "with a tool error that names who changed the page
  last, how (`web` or `mcp`) and when, and tells the agent to read the page again; nothing is changed".
- Suggestion (optional): keep the full text in the spec that owns the rule and replace the copies with a clause
  and a pointer.
- Confidence: Medium. Who owns a rule is a judgement.
- Decision (2026-11-18): as suggested.

#### suggestion: the specs restate messages, constants and details of the UI that the workflow gives to the code

- Location: exact messages in `spec/optimistic-locking.md`, "What the browser shows", `spec/page-history.md`,
  "Seeing the history", `spec/pages.md`, "Routes", and `spec/page-deletion.md`, "Deleted pages of a folder";
  hydration and the Enter key in `spec/folder-roles.md` and `spec/content-structure.md`; the list of safe
  protocols and the prefix of ids in `spec/pages.md`, "Rendering"; measured times in `spec/pages.md`, "The cost
  of the Markdown parse"; how the transport of the SDK works in `spec/mcp.md`, "Decisions"
- Severity: Minor. All match the code today; each goes stale with a change of a wording or a tuning.
- Category: docs
- Problem: `step-plan-workflow.md` leaves "exact messages, focus, hydration and layout details, and how a read or
  write works" out of a feature spec.
- Impact: a changed message makes a spec stale, and the check of doc references sees only file names.
- Evidence: `optimistic-locking.md`: "This page was changed by mike via mcp at <time> after you opened it.", which
  is the text of `changedMessage()` in `src/features/pages/changed-page.ts`.
- Suggestion (optional): say what a message names and point to its function; drop the sentences on hydration and
  Enter; keep the list of protocols as a security rule and name its constant; keep only the bound that the cost
  test enforces.
- Confidence: Medium. Which statements are guarantees to keep is a judgement.
- Decision (2026-11-18): as suggested.

#### suggestion: several sections grew sentence by sentence and no longer read as one set of rules

- Location: `spec/content-structure.md`, the introduction, "Last editor" (13 bullets that mix rule, display and
  transition) and "Decisions" (about 45 bullets); `spec/mcp.md`, the introduction, "Tools" and "What holds for all
  of them" (17 bullets); `spec/pages.md`, "Saves without a change", "Decisions" and "Current limits";
  `spec/optimistic-locking.md`, "The version of a page"
- Severity: Minor. Readability; no numbered heading and no wrong numbered list was found in the seven specs.
- Category: docs
- Problem: sentences were added per feature at the nearest place. `mcp.md` says three times that a tab that does
  not exist is a tool error. `content-structure.md` has paragraphs "Code: … Tests: …" inside three sections, though
  the workflow puts the pointers at the top. `pages.md` lists wiki links twice under "Current limits", and its
  last bullet of "Saves without a change" is about moves and renames. `mcp.md` counts "nine tools, five and two"
  against the order of its sentence.
- Impact: a rule is hard to find and is repeated inside one section.
- Evidence: `mcp.md`: "A page or tab that does not exist is a tool error with a message that says what to do
  next" and "A tab that does not exist is a tool error that tells a Manager connection to create it with
  `create_tab`".
- Suggestion (optional): move the pointers to the top, split "Last editor" into the last editor and the channel,
  group "Decisions" by topic, merge the three bullets on a tab, and write the order of the refusals of a
  connection as a numbered list, because there the order matters.
- Confidence: Medium. Beyond the single items, a new structure is a matter of taste.
- Decision (2026-11-18): as suggested.

#### Reviewed

- `page-history.md`: every rule matches the service and the components of the history: 100 revisions at a time,
  the cap of the diff, the order, the roles for live and deleted pages, and the rules of a revert.
- `optimistic-locking.md`: "The version of a page", "Which changes are refused", "What the browser shows",
  "Callers other than the browser" and "Restoring" match the code.
- `folder-roles.md`: the table of roles is `FUNCTION_ROLES`; the change to the same role, the last Owner under a
  lock, the refusals of an admin in the service and in the trigger, the roles view, the overview of the admin and
  the view "AI apps" match the code.
- `mcp.md`: the addresses, the endpoint, the order of the answers 404, 405, 403, 401, 403 and 500, the actor, the
  list of tools per role and the instructions match the code.
- `content-structure.md`: "Overview", "Names", "Actions and views", both sections on
  changes that change nothing, "Deleting a tab" and "Lists and order" match the code.
- `page-deletion.md` and `pages.md` match the code.
- Every heading of a section that one of the seven specs cites in another spec exists under that name.

### Documentation: architecture, testing, catalog and workflows

#### suggestion: the entries of the catalog in `CLAUDE.md` have grown into second copies of the specs

- Location: `CLAUDE.md`, section "Specification"
- Severity: Minor. The list of files is right; the form is the problem.
- Category: docs
- Problem: the 19 entries match the files of `spec/`, without a leftover step plan or requirements file. The
  entries of the feature specs list behaviour instead of saying what the file is for; the longest have about 700
  characters, and every feature adds a clause. Two entries disagree with the sections of their file already: the
  one of `architecture.md` leaves out "Linting", the one of `testing.md` "Continuous integration". The entry of
  `pages.md` carries the renames of folders and tabs, which `content-structure.md` owns. `CLAUDE.md` is loaded
  into every session.
- Impact: a third place to update per feature, next to the spec and its headings, and tokens in every session.
- Evidence: the entry of `content-structure.md`: "…renaming a folder or tab to its own name, which stores nothing
  and keeps "Save" of the rename dialogs disabled, moving or renaming a page to its own name and place, which
  stores nothing and keeps "Save" of the "Move or rename page" dialog disabled, deleting a tab for good with its
  pages soft deleted…".
- Suggestion (optional): a rule under "Specification": an entry is one line, the file and the question it answers,
  without behaviour, numbers or lists of sections; the same rule in the item of the wrap-up.
- Confidence: Medium. A change of form that the author should approve.
- Decision (2026-11-18): as suggested.

#### suggestion: `architecture.md` has bullets that grew into paragraphs, and states rules twice

- Location: `spec/architecture.md`, sections "Layout", "Reads and writes", "Login and sessions" and "Database"
- Severity: Minor
- Category: docs
- Problem: the bullet on a feature folder ends in one sentence that describes eight features with nested
  brackets; the bullet on the MCP adapter is one chain of 13 lines; the bullet on the actor covers the channel,
  the connection, admins, roles, MCP, the last editor and the parsing of ids in 17 lines. Stated twice are the
  order of `requireUser()`, `redirect()` outside a `try`, ids that count as missing rows, the second validation of
  a service, "a caller other than the GUI can use the same service", and the layers. How the check of the version
  works, the reasons of the revalidation and the development database repeat the code or the README.
- Impact: a rule inside a bullet of 17 lines is not found; the wrong sentence on the actors of MCP sat in exactly
  such a bullet.
- Evidence: the sentence on the actors of MCP, which the code contradicted, was line 10 of a bullet of 17
  lines.
- Suggestion (optional): split "Reads and writes" into the layers, the services, the actors with channels and
  roles, the queries, the actions and the callers other than the browser; turn the list of features into a table;
  state each repeated rule once.
- Confidence: Medium. A new structure with judgement calls; no statement changes.
- Decision (2026-11-18): as suggested.

#### issue: documents restate code, constants and configuration instead of pointing to them

- Location: `spec/architecture.md`, sections "Security headers", "Linting" and "Login and sessions";
  `spec/testing.md`, the helpers of `e2e/support/` and the section "Continuous integration"; `spec/roadmap.md`;
  `README.md`; `spec/users-and-login.md`; `spec/connected-apps.md`; `spec/oauth.md`; `spec/container-image.md`
- Severity: Minor. All copies are right today. The first review report lists such nits for `oauth.md`,
  `container-image.md` and the security headers of `architecture.md`; the places below are new.
- Category: docs
- Problem:
  - `architecture.md` retells `tsconfig.json` and `eslint.config.mjs`, with the list of globs of `no-console`, and
    the comment on the matcher of `src/proxy.ts`.
  - `testing.md` restates the retry of the reset ("`lock_timeout` of 2 seconds … up to five times"), the defaults
    of every helper and the steps of each workflow, though `step-plan-workflow.md` says "Internal limits … such as
    a retry count, stay in the code".
  - `roadmap.md` names "the 50 rounds of `reserveAttempt()`" and dated timings.
  - `users-and-login.md` states the lifetime of a session and the length of a generated password without a
    pointer to the constant, and the limits of a name and a password several times.
  - `connected-apps.md` and `oauth.md` state "at most once a minute", the lifetimes of a grant, the limit of 50 in
    five places, the times of the cache, and the prefixes of the secrets.
- Impact: each is a second copy; the stale lists of the codes of a `Result` and of the unique constraints are the same
  pattern one feature later.
- Evidence: `testing.md`: "`lock_timeout` of 2 seconds"; the constants `TRUNCATE_LOCK_TIMEOUT` and
  `TRUNCATE_ATTEMPTS` in `e2e/support/database.ts`.
- Suggestion (optional): keep a number where a user or an operator relies on it, once and with a pointer;
  elsewhere point to the file.
- Confidence: Low. Which numbers count as rules is a decision per item.
- Decision (2026-11-18): as suggested: a number stays only where a user or an operator relies on it, once and with a
  pointer to its constant; everywhere else the document points to the file.

#### issue: the same things carry different names across the documents

- Location: `spec/architecture.md`, `spec/folder-roles.md`, `spec/content-structure.md`, `spec/mcp.md`,
  `spec/optimistic-locking.md`, `spec/testing.md`, `spec/step-plan-workflow.md`, `CLAUDE.md` and `README.md`
- Severity: Minor
- Category: docs
- Problem: one idea has three wordings: "a caller other than the GUI", "a caller other than the browser" and "a
  caller other than a form". "Connected app", "grant", "AI app", "AI assistant", "MCP client", "OAuth client" and
  "connector" stand for one or two concepts; the README alone uses five. "Item" means any folder, tab or page in
  `content-structure.md`, while the segment `[item]` of the route means a tab or a page placed in the folder. The
  file `step-plan-workflow.md` is titled "Development Workflow". "Version" and "revision" are used consistently.
- Impact: an agent takes "AI app" and "connected app" for two features.
- Evidence: `architecture.md` uses "a caller other than the GUI" in "Reads and writes" and "a caller other than
  the browser" in "Login and sessions".
- Suggestion (optional): a short list of terms at the top of `architecture.md`, and "caller other than the
  browser" throughout.
- Confidence: Medium. The differences were checked; the terms are the choice of the author.
- Decision (2026-11-18): as suggested: a list of terms at the top of `architecture.md` and "caller other than the
  browser" throughout; the terms for connected apps are chosen to fit the names the UI shows, the view "AI apps" and the
  page of the connected apps.

#### Reviewed

- The catalog: its 19 entries match the files of `spec/`; there is no leftover step plan or requirements file.
- The style rules: no numbered heading in `spec/`, the README, `CLAUDE.md` or the skills; every numbered list is a
  procedure or an order of priority.
- The layer rules of `architecture.md` and its section "Linting" match `eslint.config.mjs` and the imports.
- The security headers and the matcher of the proxy match `architecture.md` sentence by sentence.
- The conventions of the database (the times, the keys with `Restrict` and `Cascade`, the reads with `FOR UPDATE`)
  are as described.
- `testing.md` matches the three projects of Vitest, `scripts/check.ts`, the check of doc references, the
  configuration of Playwright and the setup of the integration tests; its section on CI matches the seven
  workflows exactly.
- The README documents every script of `package.json`.
- The two skills only hand over to the two workflow files and agree with them and with `CLAUDE.md`.
- `requirements-workflow.md`, `step-plan-workflow.md` and `issue-report.md` agree on commits, pushes, the rule of
  the confidence for fixing a finding and the deletion of fixed findings.

### Documentation: the first review report and the other feature specs

`spec/review-report.md` is the report of the security and code review, last rechecked on 2026-11-17. Every one of
its 103 findings was checked against the code of today: none is fixed, and its counts by label and by severity are
right. `users-and-login.md`, `connected-apps.md`, `oauth.md` and `container-image.md` were checked against their
code with less depth than the specs of the content; they match it closely.

#### issue: 17 findings of `review-report.md` cite line ranges or a file that no longer hold the code they describe

- Location: `spec/review-report.md`, section "Findings", the Location of the findings in the table below, and
  section "Scope and method"
- Severity: Minor. Each finding can still be found by the name of its function, but the cited lines show other
  code.
- Category: docs
- Problem: the ranges do not match the files as they are. Everything in the OAuth service from
  `checkAuthorizationRequest()` on was off by one line, and the service is now split into the modules
  `clients-service.ts`, `authorization-service.ts` and `token-service.ts`, to which the Locations point by file only; `src/features/mcp/tools.ts`,
  `src/features/pages/service.ts` and `src/features/folders/service.ts` are off by tens to hundreds of lines.
- Impact: whoever fixes a finding by its Location opens the wrong lines. For the nit on the second statement the
  cited function no longer holds the statement at all.
- Evidence:

  | Finding of the first report                                    | Cited                                                                                                       | Now                                                                                                   |
  | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
  | nit: `createUser()` and the write actions check the form first | `createPage()` 68–82, `createTab()` 100–110, `giveRole()` 36–50                                             | 70–87, 98–109, 35–47                                                                                  |
  | issue: Client Components get whole `TabSummary` rows           | `PageView.tsx` 111 and 149–159; `TabSummary` line 58                                                        | 242 and 282–287; line 64                                                                              |
  | suggestion: the seed resets the admin                          | `prisma/seed.ts` 81–126, upsert 87–94                                                                       | from 82, upsert 88–95                                                                                 |
  | issue: a repeated parameter counts as missing                  | `oauth/service.ts` 328–401                                                                                  | 329–402                                                                                               |
  | issue: using a code a second time                              | `exchangeCode()` 570–698                                                                                    | 571–699                                                                                               |
  | issue: a forged refresh token revokes the grant                | `refreshGrant()` 712–803                                                                                    | 713–804                                                                                               |
  | nit: `resource` is case-sensitive                              | lines 374, 649 and 776–781                                                                                  | 375, 650 and 777–782                                                                                  |
  | nit: the grant stays after two refreshes                       | 706–707, 757 and 794–799                                                                                    | 707–708, 758 and 794–800                                                                              |
  | issue: wiki text reaches the model unmarked                    | `tools.ts` 41–61, 184–186, 279–304 and 543–556                                                              | 41–69, 258–260, 357–383 and 806–820                                                                   |
  | suggestion: tool calls are not audited by grant                | `channelOf()` in the pages service                                                                          | defined in the service of the folder roles, line 51                                                   |
  | suggestion: `list_folder` has no paging                        | `tools.ts` 248–273                                                                                          | 322–351                                                                                               |
  | nit: `tools.listChanged: true`                                 | `tools.ts` 525–528                                                                                          | 786–789                                                                                               |
  | nit: writes read the page back in a second statement           | `updatePageContent()` 489–494, `moveOrRenamePage()` 547–552, `restorePage()` 667–671, `renameTab()` 384–386 | `saveContentChange()` 787–790, 923–938, 1055–1059, `renameTab()` 453–462 with `writeRename()` 159–169 |
  | issue: several security events lack the actor                  | `folders/service.ts` 259, 306, 356 and 401; `pages/service.ts` 628; `tools.ts` 212; `oauth/service.ts` 752  | 302, 366, 418 and 480; 644; 286; 753                                                                  |
  | issue: rejected input at the OAuth endpoints is never logged   | `oauth/service.ts` 580 and 721                                                                              | 581 and 722                                                                                           |
  | nit: the longest functions mix several steps                   | the OAuth service with 836 lines                                                                            | 837 lines                                                                                             |
  | suggestion: no lint rule keeps comparisons strict              | `roles.ts` 57 and 84                                                                                        | 59 and 87                                                                                             |

- Suggestion (required): replace the ranges as in the table, and decide at the next recheck whether a Location
  names only the file and the function, which do not drift.
- Confidence: High. Every new range was read; the change is to the report only.

#### issue: four open findings of `review-report.md` describe a state of the code that has moved on

- Location: `spec/review-report.md`, section "MCP server", "issue: wiki text reaches the model…" and "issue: one
  token can make the server do unbounded work…"; section "Content", "nit: writes read the page back in a second
  statement"; section "Logging, errors and failure handling", "issue: several security events are logged without
  the actor…"
- Severity: Minor. The findings stay open; the reasoning of one severity rests on an incomplete list.
- Category: docs
- Problem:
  - Prompt injection: the Severity argues that "a Writer connection cannot delete pages or touch tabs", and the
    Impact lists the three tools of a Writer. A Manager connection also has `delete_page`, `create_tab`,
    `rename_tab` and `delete_tab`, so planted text can steer deletes now.
  - Unbounded work: the batch of 100 writes leaves out 100 deletes of pages or tabs at a Manager address.
  - The second statement: "`updateMany` and the following read are two statements" no longer describes a content
    save, which is a transaction of the page and its revision, followed by a read; `revertPage()` takes the same
    path and is not named.
  - Logging: the writes of folders and tabs are said to be logged "with neither" the channel nor the actor. Only
    "folder created" has neither; the renames and "tab created" carry the channel, and "tab deleted" carries both.
- Impact: the finding on prompt injection is rated Minor on a description that leaves out the tools that destroy,
  so its severity may be too low; someone who fixes the finding on logging adds a channel that is there.
- Evidence: `src/features/mcp/tools.ts`, line 873, `if (!isManager(options)) return server;`, followed by the four
  registrations; `src/features/folders/service.ts`, line 366,
  `logger.info({ folderId, ...channelOf(actor) }, "folder renamed");`.
- Suggestion (required): rewrite the four passages, and judge the severity of the finding on prompt injection
  again.
- Confidence: Low. The new wording is clear; the new severity is a judgement for the user.
- Decision (2026-11-18): as suggested; the finding on prompt injection becomes Major, not a Blocker, because deleted
  pages can be restored. The counts of the first report change with it.

#### issue: the threat model and the "Reviewed" lists of `review-report.md` leave out the page history, the delete of a tab and the tools of a Manager

- Location: `spec/review-report.md`, section "Threat model" ("Assets" and "Entry points"), the "Reviewed" lists of
  "Access control", "MCP server" and "Content", and section "Scope and method"
- Severity: Minor. The "Reviewed" lists are the proof of the cover of the report; code they do not name was not
  visibly reviewed.
- Category: docs
- Problem:
  - The Server Actions of the entry points lack `deleteTab()` and `revertPage()`; the pages behind the login lack
    the views of the history, of a revision and of a comparison, and the actions revert and delete of a tab.
  - The assets do not list the revisions of a page, which keep the user of every change.
  - "Content", "Reviewed", says: "MCP has no tool that deletes, lists deleted pages or restores"; `delete_page`
    and `delete_tab` exist, and the list of "MCP server" in the same report names them.
  - "MCP server", "Reviewed", says the tools are those "of a Reader or a Writer only".
  - "Content", "Reviewed", says "every page has a version that every write counts up"; a save or a move without a
    change keeps it.
  - No list has an entry on the revisions, the revert, the comparison or the history of deleted pages, and the
    files read do not name `page-history.md` or the components of the history.
- Impact: a reader takes the page history and the delete tools as reviewed against the threat model, when no
  entry shows it.
- Evidence: line 1612 of the report: "MCP has no tool that deletes, lists deleted pages or restores".
- Suggestion (required): add the missing actions, views and the asset, correct the three statements, and then
  either review the page history and the delete of a tab for security and add their entries, or list them under
  "Not covered by this review".
- Confidence: Medium. The corrections are clear; the missing entries need a real review of that code.
- Alternatives: narrow "Scope and method" to the code the lists name, which is cheaper and leaves a gap.
- Decision (2026-11-18): as suggested, with the first of the two ways: the page history, the delete of a tab and the
  tools of a Manager are listed under "Not covered by this review" until a security recheck.

#### suggestion: none of the 98 findings of `review-report.md` that need one has a confidence

- Location: `spec/review-report.md`, sections "Summary" and "Scope and method"; `spec/issue-report.md`, section
  "Confidence levels"; `spec/step-plan-workflow.md`, section "Fixing a finding of the review report"
- Severity: Minor. Without a confidence the workflow lets no finding be fixed without asking the user.
- Category: docs
- Problem: the report holds 103 findings and no line "Confidence", and says so itself: the findings "get one at
  the next recheck". `issue-report.md` also asks the summary for the counts per confidence.
- Impact: every fix, however plain, waits for the user: "a finding with Medium, Low or no confidence is fixed only
  as agreed with the user".
- Evidence: a search of the report for lines that start with `- Confidence` gives none.
- Suggestion (required): assign the confidences at the recheck that corrects the Locations, and add the three
  counts to "Summary".
- Confidence: Medium. Each level is a judgement per finding.
- Decision (2026-11-18): the confidences are assigned at the next recheck, as the report says, and not in this cleanup.

#### nit: the first nit of `review-report.md` still names `changeRole()` for an invalid role

- Location: `spec/review-report.md`, section "Access control and the entry points of requests", "nit:
  `createUser()` and the write actions of folders check the form before the rights…";
  `src/features/folder-roles/service.ts`, lines 516–521
- Severity: Nit. The finding holds for the other four actions.
- Category: docs
- Problem: the report says `changeRole()` returns "the message for an invalid role" before the role of the actor
  is checked. The action answers so only for a submission without a user or an intent; a role that is no role
  goes to the service, which refuses a caller who is no Owner first.
- Impact: the finding reads as if `changeRole()` needed the same fix as the others.
- Evidence: the comment in the service: "Checked after the Owner, so that the answer to anyone else does not
  depend on the input."
- Suggestion (optional): say that for `changeRole()` only a submission without a user or an intent is answered
  before the rights.
- Confidence: Medium. Read on both sides, not sent to a running server.
- Decision (2026-11-18): as suggested.

#### Reviewed

- The counts of `review-report.md`: 53 `issue:`, 18 `suggestion:`, 27 `nit:` and 5 `question:` make 103; 1 Major,
  64 Minor and 38 Nit; 20 accepted deviations. All match its summary.
- No finding of the first report is fixed. Every quoted line of evidence that was looked for is still in the code
  or the spec.
- No spec now documents as a decision something that the first report lists as "no reason given".
- The Locations of the first report that name the auth service, `src/lib/`, the users, the grants, the schema and
  the adapter of OAuth, the MCP adapter, the configuration of Next.js, the container files and the workflows
  match exactly.
- `users-and-login.md`: the rules of names and passwords, the list of common passwords, the admin setup, the two
  limits of the login with the numbers derived in "Decisions", the settings of a session and the routes match
  the code.
- `connected-apps.md`: the limit and how it is counted, the lifetimes, the four codes of the check of a token and
  the account page match the code.
- `oauth.md`: both metadata documents, the rules of a client id, the guards of the fetch, the limit of
  registrations, the matching of redirect addresses, the order of the listed checks, the codes and the rules of
  a refresh match the code.
- `container-image.md`: the stages, the start, the exit codes of the admin setup, all five variables, the health
  answer and the workflow match the code.
- Not checked again: the evidence the first report took from a local server, and its "Reviewed" lists of browser
  security, login, OAuth, logging, configuration and supply chain.

## What is good

The "Reviewed" list of each area names what was checked and found right. Across the areas, these are the things to
keep doing:

- The layers are enforced by ESLint, not by convention, and the review found no breach.
- `FUNCTION_ROLES` with `mayDo()` is the one place that says what a role may do, for routes and services alike.
- Every `switch` over the codes of a write is complete, and the lint rule keeps it so.
- Rules that depend on the database are tested against the database, with the whole row compared before and after,
  and the races that are tested use real concurrency or a held lock.
- The newest rules were built into the service, the browser, MCP, the tests and the specs in one go; the copies of
  those rules agree with each other today.
- Constraints of the database are matched by name, with one test for each.
- The catalog of specs matches the files, no step plan or requirements file is left over, and the style rules of
  the documents hold everywhere.

## Suggested order of work

The order matters: the tests are the safety net of the refactoring, and the refactoring changes files that the
documents name.

1. Decide the open questions that other work depends on. Done on 2026-11-18: no tool offers the deleted pages or
   the writes of roles, and nothing in the code enforces it; the unit tests of the services are cut after the
   missing integration cases exist. The Decision of each finding holds the rest.
2. Fix the findings with a High confidence that change no code: the Locations of the first report.
3. Close the gaps of the tests before any refactoring: the states of the dialogs that a shared frame would move.
4. Refactor the code in small steps, each with its checks: the hooks and the frame of the dialogs, then the
   splits of the large files. Done: the code findings are fixed.
5. Restructure the documents last: one owner per rule in the feature specs, the sections of `architecture.md`,
   and the form of the catalog in `CLAUDE.md`.
