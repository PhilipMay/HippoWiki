# HippoWiki – Review Report 02: Code Quality, Tests and Documentation

## Summary

- Verdict: no Blocker. The code is in better shape than "dirty" suggests: the layers hold and ESLint enforces
  them, every adapter handles every code of every write, the browser and MCP agree on the seven writes they share,
  and the newest rules (writes that store nothing) are proven against the real database and in the browser. The
  weak points are three:
  - Rules that are written several times: the guards of a content write in three services, the frame of a dialog
    in nine components, a write without a change in five shapes, and the same rule in up to five specs. Two copies
    have drifted already.
  - Tests that would not catch the refactoring this report suggests: the unit tests of the services pin the calls
    of Prisma, and three rules of access and of the transaction have no test that could fail.
  - Documents that the features outran: `architecture.md` has about a dozen statements the code contradicts, one
    of them about what MCP may delete, and three documents disagree on when the complete end-to-end suite runs.
- Findings: 107 in all, 0 Blocker, 6 Major, 80 Minor and 21 Nit (52 `issue:`, 31 `suggestion:`, 19 `nit:` and 5
  `question:`).
- Confidence of the suggestions: 33 High, 54 Medium and 15 Low; the 5 questions have none. A High suggestion can be
  fixed as written; the others wait for the user, as `issue-report.md` describes.
- To fix first, the six Major findings:
  1. `architecture.md` says deleting pages and the writes of tabs take only the actor of the browser, but MCP does
     them (Documentation: architecture; High).
  2. Tests say that no MCP connection reads deleted pages, but try only a Writer connection; by the code the
     service would answer a Manager connection (Tests: unit and integration; Low, a decision).
  3. The access rules of two reads of the history are asserted by no test (Tests: unit and integration; High).
  4. That a content save and its revision are one unit, and most races of pages, are proven by no test against the
     real database (Tests: unit and integration; Medium).
  5. The unit tests of the services pin the calls of Prisma, not the behaviour (Tests: unit and integration; Low,
     a decision before the refactoring).
  6. Three documents disagree on when the complete end-to-end suite runs before a commit or a push
     (Documentation: architecture; Low, a decision).
- Not covered by this review: security, which `review-report.md` covers and whose findings are not repeated here;
  the unit tests of auth, users, OAuth and grants, of which only the names and the copied helpers were looked at;
  the size of the bundles for the browser, because no build was read (one `question:` asks for it); and the
  behaviour in a browser, because the review ran no server.

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
  of the write, the order of the checks and the transaction of a content save. The finding on the three writes
  with a version lists the properties to keep.
- A lost check of access when helpers are shared: the role before the version, and the `null` of the condition
  for readable folders.
- A cleanup in one step: the findings are cut so that each can be fixed and checked on its own.

## Findings

### Code: services of the content features

#### issue: two reads spread the condition for readable folders without checking it for `null`

- Location: `src/features/folders/service.ts`, lines 214–225, `getFolderByName()`, and lines 248–261, `getTab()`;
  `src/features/folder-roles/service.ts`, lines 183–191, `readableFolderWhere()`
- Severity: Minor. The reads are right today; the restriction rests on two functions that return `null` for the same
  actors.
- Category: security
- Problem: `readableFolderWhere()` returns a condition or `null`. `getFolderByName()` and `getTab()` spread the
  result into the `where` without a check, and a spread of `null` adds nothing, so the condition on the role would
  be gone. It is safe only because `readerOf()` is checked just before and returns `null` in the same cases.
  `getFolderById()` and `getPage()` check both values, and `getFolderById()` joins the condition with `AND`, which
  MCP needs: its condition holds the id of the folder of the connection.
- Impact: a later change of when `readableFolderWhere()` returns `null`, or a new read that copies the spread, makes
  a folder readable without a role, with no error of the type checker.
- Evidence: line 220, `where: { name: folderName, ...readableFolderWhere(actor) },`; line 255,
  `where: { name, folder: { name: folder, ...readableFolderWhere(actor) } },`; against lines 198–202,
  `if (!reader || !readable || !folderId) return null;` and `where: { AND: [{ id: folderId }, readable] },`.
- Suggestion (required): read the condition into a constant in both functions and return `null` when it is `null`,
  as `getFolderById()` does.
- Confidence: High. One fix; the `where` that reaches Prisma stays the same, so the tests of both reads in
  `src/features/folders/service.test.ts` pass unchanged, and `integration/folder-service.test.ts`, "reads no folder
  and no tab without a role of the actor", covers the behaviour.

#### issue: the guards of a content write are copied into three services

- Location: `src/features/folders/service.ts`, lines 109–148, `notAllowed()`, `refusedByRole()`, `editorIdOf()` and
  `unknownActor()`; `src/features/pages/service.ts`, lines 500–539, the same four; `src/features/folder-roles/service.ts`,
  lines 100–105, `roleHolderId()`, and lines 305–312, `notAllowed()`
- Severity: Minor. Duplicated code with no wrong behaviour today.
- Category: readability
- Problem: `notAllowed()` is the same in all three services. `editorIdOf()` and `unknownActor()` are the same in
  folders and pages, and `refusedByRole()` differs only in the type of its target. `roleHolderId()` is a third copy
  of `editorIdOf()` behind a check for the admin. The opening of a write, "an admin gives `not-allowed`, a malformed
  actor id gives `failed`, then take the stored channel", is written as the same four lines in all 11 content
  writes, and the rule of the catch block, "the last editor before the other foreign keys", nine times.
- Impact: a change of the rule, for example the actor id in every log line, which the first review report asks
  for, has up to 14 places. One that is missed makes the services disagree without a failing test.
- Evidence: `src/features/folders/service.ts`, lines 138–141, and `src/features/pages/service.ts`, lines 529–532,
  both: `const id = parseUserId(actor.id);` and `if (!id) logger.error({ actorId: actor.id }, "malformed actor id");`.
- Suggestion (required): move the four helpers to one module that both services import, and add one function for
  the opening that returns the last editor and the channel, or the refusal, as `ownerOf()` does for the roles.
- Confidence: Medium. No behaviour changes and the unit tests of both services cover the refusals; where the module
  lives is a choice.
- Alternatives:
  - A new pure module in the feature of the folder roles. It needs no database, so the lint rule allows it.
  - Next to `roleHolderId()` in the service of the folder roles, which both import already; that file is mixed
    enough (see the finding on the three concerns below).

#### issue: the writes of roles take an MCP actor by their type, and `writeRole()` would ignore the role of the connection

- Location: `src/features/folder-roles/service.ts`, lines 344–348, `giveRole()`, lines 425–462, `writeRole()`,
  lines 510–536, `changeRole()` and `removeRole()`
- Severity: Minor. No caller passes an MCP actor today; the MCP tools import only the services of folders and
  pages.
- Category: correctness
- Problem: the three writes take `Actor`, and the actor of MCP is an `Actor`. `giveRole()` reads the role of the
  actor with `folderRoleOf()`, which applies the role of the connection and so refuses MCP. `writeRole()` reads the
  role with a raw query and never applies it. `renameFolder()` solves the same rule, "no AI app changes roles",
  with the type `BrowserActor`.
- Impact: a later tool that passes its actor to `changeRole()` or `removeRole()` acts with the full rights of the
  user as an Owner, on every folder, while `giveRole()` refuses. Two paths of one feature disagree.
- Evidence: lines 446–447: `const actorRole = roles.find((row) => row.userId === ownerId)?.role ?? null;` and
  `if (!mayDo(actorRole, "manageRoles")) return { kind: "not-allowed", actorRole };`.
- Suggestion (required): type the writes of roles with `BrowserActor` and pass `inBrowser(user)` from the actions,
  as the other features do.
- Confidence: Medium. Nothing changes at run time for the browser; the signatures, the actions and the fixtures of
  the tests change.
- Alternatives: keep `Actor` and refuse an MCP actor at the top of `writeRole()`: a smaller change, checked at run
  time, not by the compiler.

#### issue: "a write that stored nothing" has five shapes inside the services and none in their results

- Location: `src/features/folders/service.ts`, line 151, `Written<T>`; `src/features/pages/service.ts`, line 655,
  `ContentStoreOutcome`, lines 776–801, `saveContentChange()`, and lines 927–937, `moveOrRenamePage()`;
  `src/features/folder-roles/service.ts`, lines 411–416, `ChangeOutcome`
- Severity: Minor. Each variant works; the cost is in reading and in the next feature.
- Category: readability
- Problem: the same outcome is `{ kind: "unchanged"; item }` for folders and tabs, `{ kind: "unchanged"; role;
folderName }` for roles (next to `"done"`, where folders say `"stored"`), `{ outcome: "unchanged"; page }` for the
  content, `changed: false` inside a value in `saveContentChange()`, and an early `return` with a log line of its
  own, without a type, in `moveOrRenamePage()`. The public result of every write is `{ ok: true, value }` either way.
- Impact: a fourth feature copies whichever shape it finds first. The actions revalidate the content after a write
  that stored nothing, and the MCP tools cannot say that nothing changed.
- Evidence: line 151 of the folders service,
  `type Written<T> = { kind: "stored" } | { kind: "unchanged"; item: T } | { kind: "not-found" };`; line 655 of the
  pages service, `type ContentStoreOutcome = { outcome: "stored" } | { outcome: "unchanged"; page: StoredPage } |
{ outcome: "refused" };`; line 789, `return { ok: true, value: { page: stored.page, changed: false } };`.
- Suggestion (optional): one shape with the discriminant `kind` in all four helpers, and a small store function for
  `moveOrRenamePage()` that returns it, so that the log line and the result are built after the `try`, as in
  `renameFolder()`.
- Confidence: Low. Whether the public result should say "unchanged" as well is a design decision; the specs say a
  write without a change is "answered like a stored change".

#### suggestion: the write with the version in its condition is built by hand three times, each fragile in its own way

- Location: `src/features/pages/service.ts`, lines 563–575, `refusedWrite()`, lines 666–716, `storeContentChange()`,
  lines 909–937, `moveOrRenamePage()`, and lines 988–1008, `deletePage()`
- Severity: Minor. No wrong result was found; the risk is in the next change.
- Category: correctness
- Problem:
  - `moveOrRenamePage()` writes the condition "differs" (lines 919–922) and its opposite (line 931) apart, with the
    rules of SQL for `NULL` handled by hand. The update, the read of the unchanged page and `refusedWrite()` are
    three statements without a transaction, where `storeContentChange()` uses one.
  - `refusedWrite()` concludes "changed" from "the row exists" and compares no version, so every reason for no
    matching row is reported as `page-changed`.
  - `storeContentChange()` turns a violation of the revision number into `refused` without a log line (line 713).
  - The comment in `deletePage()` (line 991) credits the transaction for a consistent place. No isolation level is
    set anywhere, so it is the version in the condition that guarantees it; a tab renamed between the read and the
    update does not count the version of the page up.
- Impact: a refactoring that trusts the comments can break the lock.
- Evidence: line 713, `if (isUniqueViolation(err, PAGE_REVISION_NUMBER)) return { outcome: "refused" };`; line 991,
  "One transaction, so that the place read is the one the page had when it was deleted."
- Suggestion (optional): log the swallowed violation as a warning, correct the comment, and build the condition
  `{ id, deletedAt: null, version }` and the data `version: { increment: 1 }` in one helper; they appear four times
  each. A refactoring must keep these properties:
  - the comparison "is it the same" stays inside the condition of the write;
  - the version is in the condition and counted up in the same statement;
  - a write without a change keeps the time, the last editor and the version, and is `page-changed` when it rests
    on an older version;
  - an older version wins over a taken name;
  - in `storeContentChange()` the update comes first in the transaction, because its row lock puts the revision
    numbers in order;
  - the last editor is tested before the other foreign keys.
- Confidence: Low. The log line and the comment are safe; the helper is a judgement, and the race of the tab name
  was reasoned, not reproduced. `integration/page-service.test.ts` and `integration/folder-service.test.ts` pin
  the properties above.

#### issue: the soft delete of a page is written in two services

- Location: `src/features/folders/service.ts`, lines 532–536, `deleteTab()`; `src/features/pages/service.ts`,
  lines 1001–1004, `deletePage()`
- Severity: Minor. One rule in two features, held together by a comment.
- Category: readability
- Problem: the folders service writes the table of the pages itself, with a copy of the data of `deletePage()`.
- Impact: a new column of a soft delete has to be added in two features, or pages deleted with their tab differ
  from pages deleted alone.
- Evidence: both hold the same line:
  `data: { deletedAt: new Date(), tabId: null, lastEditedById, lastEditedVia, version: { increment: 1 } },`.
- Suggestion (optional): let the pages service export the data of a soft delete, or a function that deletes the
  pages of a tab inside a given transaction, and call it from `deleteTab()`.
- Confidence: Medium. No behaviour changes and the integration tests of both deletes cover it; a transaction
  passed between services is a new pattern for `architecture.md`.

#### issue: the check for the Owner exists twice inside the service of the folder roles, and its writes follow other conventions

- Location: `src/features/folder-roles/service.ts`, lines 318–336, `ownerOf()`; lines 431–436, 446–447, 469–473 and
  490, `writeRole()`; lines 251–259, `listFolderRoles()`; lines 268–276, `listRoleCandidates()`; lines 349–372,
  `giveRole()`
- Severity: Minor
- Category: readability
- Problem: the opening "an admin, a malformed id, not an Owner", with its three log messages, stands in `ownerOf()`
  and again inline in `writeRole()`. Three functions pass the unparsed folder id to Prisma, which is well-formed
  only because `folderRoleOf()` returned a role before. `writeRole()` returns the literal `"owner"` for the role of
  the actor, not the role it read, which repeats "only an Owner manages roles" outside `FUNCTION_ROLES`.
- Impact: a change of the refusal, or of the role that manages roles, has several places in one file.
- Evidence: lines 329, 436 and 470 all hold `the actor is not an Owner of the folder`; line 254,
  `where: { folderId },`; line 490, `actorRole: target === ownerId ? outcome.role : "owner"`.
- Suggestion (optional): let `writeRole()` start with the shared check and keep only the check inside the
  transaction; parse the folder id once per function; carry the role of the actor in `ChangeOutcome`.
- Confidence: Medium. The unit tests pin the log lines; the order "Owner before input" must stay.

#### issue: a database error in the lookup before a write is thrown, not returned as `failed`

- Location: `src/features/folders/service.ts`, lines 325, 389, 441 and 511; `src/features/pages/service.ts`, lines
  596, 742, 826, 899, 983 and 1041; `src/features/folder-roles/service.ts`, lines 326 and 360–362
- Severity: Minor. It needs a database error exactly at the lookup.
- Category: error handling
- Problem: `architecture.md` says that every other database error of a write is logged with the ids and returned
  as `failed`. The lookup of the role in every write, and of the user in `giveRole()`, stands outside every `try`.
  `revertPage()` catches its read before the write and returns `failed`, so the services do not agree with each
  other either. No unit test covers a lookup that fails.
- Impact: a short failure of the database at the lookup replaces the form with the error page, instead of the
  message "could not be saved" with the typed values kept, and the error is not logged with the ids.
- Evidence: line 742 of the pages service, `const role = await roleOnFolderOfPage(actor, pageId);`, without a
  `try`; against lines 834–842, `} catch (err) { logger.error({ err, pageId }, "failed to revert page");`.
- Suggestion (optional): decide one rule and write it down: either the lookup counts as a read and throws, or the
  writes catch it and return `failed`.
- Confidence: Low. It needs a decision, and the effect on the form was read, not tried.

#### issue: the error types and the helper for `invalid-input` are declared per service, and one `invalid-input` has no `fieldErrors`

- Location: `src/features/folders/service.ts`, lines 73–81 and 101–103; `src/features/pages/service.ts`, lines
  162–183 and 489–494; `src/features/folder-roles/service.ts`, lines 279–287, 355 and 399; `src/lib/result.ts`
- Severity: Minor
- Category: readability
- Problem: `NotAllowed`, `Failed`, `NameTaken`, `FolderNotFound` and `TabNotFound` are declared two or three times
  in the content features, `Failed` seven times in `src/`. `invalid-input` is `InvalidName` in folders, a generic
  `InvalidInput` in pages, another in roles, and `InvalidRole = { code: "invalid-input" }` without `fieldErrors`,
  though `architecture.md` defines the code "with `fieldErrors`".
- Impact: a caller that handles `invalid-input` in general cannot rely on `fieldErrors`.
- Evidence: line 399 of the folder roles service, `type InvalidRole = { code: "invalid-input" };`.
- Suggestion (optional): move the shared types and the generic `invalidInput()` to `src/lib/result.ts`, and give
  `changeRole()` a code of its own or `fieldErrors` for the role.
- Confidence: Medium. Moving types changes nothing at run time; the shape of `InvalidRole` touches the action.

#### suggestion: the service of the folder roles holds three concerns, and the pages service has one clear seam

- Location: `src/features/folder-roles/service.ts`, lines 31–94 (the actors and the channel), 96–232 (who may read
  and write content) and 234–572 (the roles); `src/features/pages/service.ts`, lines 361–487 (the reads of the
  history)
- Severity: Minor
- Category: readability
- Problem: the head of the service names only the roles, but the file also defines `ContentActor`, `inBrowser()`,
  `inMcp()`, `channelOf()` and `storedChannelOf()`, which every adapter imports and which need no database. The
  pages service mixes lists, the history, the helpers of writes and six writes in 1,081 lines.
- Impact: an adapter imports a module of the database for a pure constructor, and "who is the actor" is not where
  a reader looks for it.
- Evidence: `src/features/folders/actions.ts`, line 11: `import { inBrowser } from "@/features/folder-roles/service";`.
- Suggestion (optional): move the actors and the channel to a pure module of the feature. A split of the pages
  service needs a change of the lint rule that allows the database only in a `service.ts`, and of
  `architecture.md`; it is worth it only if the file keeps growing.
- Confidence: Low. A choice of structure; the import paths of many files change.

#### nit: the actions of pages and folders repeat messages, form states and the mapping of a failed parse

- Location: `src/features/folders/actions.ts`, lines 20–26; `src/features/pages/actions.ts`, lines 40–44, 59–62,
  81–87, 175–180, 263–269 and 326–330
- Severity: Nit
- Category: style
- Problem: `FOLDER_GONE_MESSAGE`, `TAB_GONE_MESSAGE` and `nameTakenState` are declared in both files. The block
  that turns a failed parse with an invalid place into a form state is written three times. `revertPage()` repeats
  the two lines of `showChanged()`. The same comment on `not-allowed` stands 11 times.
- Impact: a message that is reworded has to be changed twice.
- Evidence: both files hold `const TAB_GONE_MESSAGE = "This tab no longer exists.";`.
- Suggestion (optional): export the two messages and the state from one place, add one helper for the errors of
  the place, and let `showChanged()` take the address.
- Confidence: Medium. The tests of the actions assert the messages; the home of the shared messages is a choice.

#### nit: the log lines of the role writes name the actor and the outcome in another way than the content writes

- Location: `src/features/folder-roles/service.ts`, lines 310, 431, 436, 475 and 484–487;
  `src/features/folders/service.ts`, line 302
- Severity: Nit
- Category: style
- Problem: in one file the acting user is `actorId` in a refusal and `ownerId` everywhere else. "role not changed:"
  starts both a refusal, as a warning, and a change to the same role, as information; the content services use
  "not renamed:" for a refusal and "not changed:" for a write without a change. "folder created" is the only line
  of a successful content write without the channel.
- Impact: a search of the log by actor or by the start of the message misses lines or mixes two outcomes.
- Evidence: line 431, `const what = newRole === null ? "role not removed" : "role not changed";`; line 486,
  `"role not changed: the role is the same",`.
- Suggestion (optional): `actorId` in every line, another wording for the change to the same role, and the channel
  in "folder created".
- Confidence: Medium. The unit tests pin the lines; the wording is a choice.

#### nit: unused names and comments that no longer match the code

- Location: `src/features/folder-roles/service.ts`, line 36, `Channel`; `src/features/folder-roles/roles.ts`, line
  20, `isRole()`; `src/lib/db-errors.ts`, `GRANT_ACCESS_TOKEN_HASH` and `OAUTH_CODE_HASH`;
  `src/features/pages/service.ts`, line 86 and lines 208, 222 and 237; `src/features/pages/markdown.ts`, line 13;
  `src/lib/addresses.ts`, lines 1–3; `src/lib/db-errors.ts`, line 1; `src/lib/revalidate.ts`, line 4;
  `src/features/folders/forms.ts`, line 36; `prisma/schema.prisma`, line 251
- Severity: Nit
- Category: docs
- Problem: `Channel` is used nowhere; `isRole()` only by its test, while the code uses `parseRole()`; the two
  constants only by an integration test, and no service catches those violations. The comment on the version of a
  page says "counted up by every write", against the rule of writes without a change. The comment in `markdown.ts`
  says "as react-markdown allowed them before", which describes an earlier state. The heads of `addresses.ts`,
  `db-errors.ts` and `revalidate.ts` leave out what the modules hold or who calls them today.
  `TabDeleteFormAction` declares two parameters that `deleteTab()` says it does not take. The schema says a grant
  is "limited to its scopes", while `mcp.md` says there are no scopes. Three reads say "`null` for an admin" and
  leave out the user without a role.
- Impact: readers follow dead names and stale statements.
- Evidence: `/** The state of the page: 1 when it is created, counted up by every write. */`.
- Suggestion (optional): delete `Channel` and `isRole()` with its test, correct the comments, and decide whether
  the services of grants and OAuth should catch the two violations or the constants go.
- Confidence: Medium. High for `Channel` and the comments; the two constants need a decision.

#### nit: small rules that are written more than once

- Location: `src/features/folder-roles/service.ts`, lines 187, 224, 231 and 252; `src/lib/addresses.ts`, lines
  192–250; `src/lib/db-errors.ts`, lines 76–80 and 114–118; `src/features/pages/service.ts`, line 412,
  `src/features/pages/schema.ts`, line 48, and `src/features/pages/actions.ts`, line 313;
  `src/features/folders/service.ts`, line 179
- Severity: Nit
- Category: style
- Problem: "every role may read" is coded in four ways in one file. `?view=` is built by hand six times, while
  `withAction()` exists for actions. The constraint of a database error is extracted twice. A revision number is
  checked in three places. `listFolders()` returns an empty list for a malformed actor id, where every other read
  returns `null`.
- Impact: none today; each is a place where two copies can drift.
- Evidence: line 231, `return (await roleOnFolderOfTab(actor, tabId)) !== null;`, next to line 224,
  `return mayDo(await folderRoleOf(actor, folderId), fn);`.
- Suggestion (optional): `mayDo(role, "read")` in all four places, a `withView()`, one extraction of the
  constraint, and `isRevisionNumber()` exported from the schema.
- Confidence: Medium. Each is mechanical and covered by the unit tests of its file; none is needed.

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

#### suggestion: the write tools read the page a second time for its title, and return an empty title when that read finds nothing

- Location: `src/features/mcp/tools.ts`, lines 467–481, `storedResult()`; `src/features/pages/service.ts`, lines
  119–129, `StoredPage`
- Severity: Minor. The window is small and the write itself is right.
- Category: correctness
- Problem: `StoredPage` carries no title, but every write tool of pages returns one. The tool therefore reads the
  page by its name after the write. If that read returns `null`, because another caller moved, renamed or deleted
  the page meanwhile or the role was lowered, the tool reports success with `title: ""`. The adapter repairs a gap
  in the result of the service.
- Impact: an AI app gets an empty title for a page it just wrote, without an error, and every write of a page
  through MCP costs one more query.
- Evidence: lines 473–476: `const page = await pageService.getPage(options.actor, options.folder.name, tab,
stored.name);` and `title: page?.title ?? "",`.
- Suggestion (optional): add the title to `StoredPage` and its selection, and build the result from the stored
  page alone.
- Confidence: Medium. One fix, but it changes a type that the browser actions and many mocks of the tests use;
  nothing was run.

#### suggestion: the tools decide by the name of a role which tools a connection gets, not by `mayDo()`

- Location: `src/features/mcp/tools.ts`, lines 395–398, `isManager()`, line 405, `tabNotFound()`, lines 822–823 and
  872–873, `createWikiServer()`, and lines 41–55, `ROLE_ABILITIES`; `src/features/folder-roles/roles.ts`, lines
  91–99, `MCP_ROLE_ABILITIES`
- Severity: Minor. The services check again, so nothing is exposed; only the list of tools can drift.
- Category: readability
- Problem: `roles.ts` says that services and routes ask `mayDo()` for a function "instead of repeating roles, so
  that both always agree". The MCP adapter repeats roles. Which role gets which tool now lives in `FUNCTION_ROLES`,
  in two gates of `createWikiServer()`, in `isManager()` and in two texts for people.
- Impact: when a function moves to another role, the services follow at once; the list of tools, the hint "create
  the tab with create_tab" and the instructions stay wrong until someone finds each place.
- Evidence: line 823, `if (!includesRole(options.actor.connection.role, "writer")) return server;`.
- Suggestion (optional): register each tool under `mayDo()` with the function that its write checks, and keep the
  two texts by hand.
- Confidence: Medium. The list is the same today and the unit tests of the tools cover it.
- Alternatives: keep the two gates and add a unit test that compares the tools of each role with `FUNCTION_ROLES`.

#### suggestion: the tools still support a server without a public URL, which the adapter never lets through

- Location: `src/features/mcp/tools.ts`, lines 26–31, `WikiToolsOptions`, and lines 291–294, `addressOf()`;
  `src/features/mcp/http.ts`, lines 97 and 133–138; `spec/mcp.md`, section "Tools"
- Severity: Minor. A dead branch, and tests of a state that cannot occur.
- Category: readability
- Problem: `handleMcpRequest()` answers 404 before anything else while `HIPPOWIKI_PUBLIC_URL` is not set, so no
  tool runs without it. The option is still typed `string | undefined`, `addressOf()` still falls back to paths,
  the adapter reads the variable a second time, four unit tests set it to `undefined`, and `mcp.md` says: "An
  address is the path of the folder, tab or page; with `HIPPOWIKI_PUBLIC_URL` it is the full URL".
- Impact: the code and the spec describe a mode that does not exist.
- Evidence: `src/features/mcp/http.ts`, lines 133–134: `if (publicUrl === undefined) return refusal(404,
"not_found");`; `src/features/mcp/tools.ts`, line 293: ``return `${publicUrl ?? ""}${path}`;``.
- Suggestion (optional): type the option as a string, pass the value that was checked, drop the fallback, the four
  tests and the half sentence of the spec.
- Confidence: Medium. It removes tests and changes a sentence of a spec.

#### question: is a malformed name of an existing tab or page refused by the input schema or answered by the tool?

- Location: `src/features/mcp/tools.ts`, lines 77–84, `pageArguments`, lines 96–101 and 121–126, and lines 139–140,
  `existingTabArgument`
- Severity: Minor. One kind of argument, two behaviours.
- Category: error handling
- Problem: the tab and the page of `read_page`, `replace_page_content`, `move_or_rename_page` and `delete_page`
  use the name schema: the SDK refuses a malformed name before the tool runs, and spaces around a name are cut
  off. The tab of `create_page`, the new tab of a move and the tab of `rename_tab` and `delete_tab` use a plain
  string: a malformed name reaches the tool and gets the message "There is no tab named …", and a name with
  spaces around it is "not found".
- Impact: an AI app gets two kinds of error for the same mistake.
- Evidence: line 78, `tab: nameSchema.nullable().optional()`; line 140,
  `const existingTabArgument = z.string().describe("The name of the tab, as list_folder returns it");`.
- Suggestion (optional): one rule for the names of existing items; a plain string everywhere fits the comment at
  line 139 and the sentence of `mcp.md` that a tab that does not exist is a tool error.

#### suggestion: arguments, messages and hints are repeated next to the helper or constant that holds them

- Location: `src/features/mcp/tools.ts`, lines 76–84 against 148–163 (the arguments of a tab and a page), lines
  364–369 against 388–393 (the message of a page that is not found), lines 835, 852 and 867 against the constants
  at 776–780 (the hints), lines 183–253 (three descriptions of outputs twice); `src/features/mcp/http.ts`, lines
  161 and 171 (the answer `role_too_low`) and lines 85 and 102
- Severity: Minor. Several places, each small.
- Category: readability
- Problem: `pageArguments.tab` is letter for letter `tabArgument`, and the comment that explains why `describe()`
  comes last stands only at the second copy. `readPage()` writes out the text of `pageNotFound()`, defined 20 lines
  below. Three tools write the literal of a hint object that a named constant holds, and `replace_page_content`
  uses the one whose comment says "deletes from the wiki".
- Impact: a change of a wording needs every copy found, and the hints of three tools are not tied to the
  constants the other four use.
- Evidence: line 777, `const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false,
openWorldHint: false };`, and line 835, `annotations: { readOnlyHint: false, destructiveHint: false,
idempotentHint: false, openWorldHint: false },`.
- Suggestion (optional): one constant for each argument, `pageNotFound()` in `readPage()`, the constants for the
  hints with one of its own for `replace_page_content`, and a local helper for `role_too_low`. Keep the nine
  `switch` blocks as they are: they mirror the actions one to one, the type checker proves them complete, and a
  shared mapper would need a flag per tool.
- Confidence: High. Each replacement is the same value or text; the unit tests of the tools assert the schemas,
  the messages and the hints, and those of the adapter the answer 403.

#### suggestion: the descriptions of the tools name the write without a change for one tool of three

- Location: `src/features/mcp/tools.ts`, lines 216–228, `storedPageOutput`, lines 467–470, and the descriptions at
  lines 861–864 and 909–911
- Severity: Minor. The descriptions are what an AI app reads.
- Category: docs
- Problem: the description of `version` and the comment of `storedResult()` name only content that is the same as
  before. The same output serves `move_or_rename_page`, which also keeps the version for the own name and place,
  and neither its description nor that of `rename_tab` names the case. `mcp.md` describes all three.
- Impact: a model that reads the list of tools learns the rule for one tool.
- Evidence: line 225, "counted up by a change, kept by content that is the same as before".
- Suggestion (optional): "kept by content, or a name and place, that is the same as before", and one sentence in
  each of the two descriptions.
- Confidence: Medium. The text reaches clients, so the wording is for the user to read.

#### suggestion: the log lines of the OAuth and the grant service follow several conventions

- Location: `src/features/oauth/service.ts`, lines 345–399, `checkAuthorizationRequest()`, lines 473–479 and line
  630; `src/features/grants/service.ts`, lines 136–162, `revokeGrant()`; `src/features/mcp/http.ts`, line 178
- Severity: Minor. It makes the log harder to search.
- Category: readability
- Problem: `refuse()` in `checkAuthorizationRequest()` logs the OAuth error code as the reason, so five different
  causes are all logged as `invalid_request`, while the refusals around it name the cause ("unknown-client",
  "foreign-redirect-uri"). `clientId` means the id of the row in every log line and the `client_id` of the
  protocol in the type of a client; for a client from a metadata document the two differ. One user is `actorId`
  in two lines of `revokeGrant()` and `userId` in the next three.
- Impact: the log does not say why an authorization request was refused, and a search for one field misses lines.
- Evidence: line 359, `logger.warn({ reason: error, clientId: client.id }, "authorization request refused");`,
  with lines 363–364, `refuse("invalid_request", "state is too long")` and `refuse("invalid_request",
"response_type is missing")`.
- Suggestion (optional): a reason of its own for each refusal, `clientRowId` for the id of the row, and one of
  `actorId` and `userId` per function.
- Confidence: Medium. The unit tests of the service must be checked for the changed reasons.

#### question: the OAuth service returns texts of messages, and one code has two shapes; is that a meant exception?

- Location: `src/features/oauth/service.ts`, lines 103–104, 289–314 and 515–533; `src/features/oauth/http.ts`,
  lines 128–132
- Severity: Minor. It is written down nowhere.
- Category: readability
- Problem: `architecture.md` says a service returns no messages except the field errors of the schemas. The OAuth
  service returns the description of an error in three families of errors, while its adapter adds texts of its
  own, so the texts are split over two layers. `invalid-client` and `invalid-redirect-uri` each exist with and
  without a description.
- Impact: a new adapter cannot rely on one rule for where a text comes from.
- Evidence: line 289, `type UntrustedRequest = { code: "invalid-client" | "invalid-redirect-uri" };`, against line
  522, `type MissingClient = { code: "invalid-client"; description: string };`.
- Suggestion (optional): write the exception down in `architecture.md` and `oauth.md`, or move the texts to the
  adapter; in both cases give the two codes with two shapes names of their own.

#### suggestion: the features of grants and OAuth import each other, and "is OAuth on" is asked in three ways

- Location: `src/features/grants/service.ts`, lines 15–29 and 74–77; `src/features/oauth/service.ts`, line 46;
  `src/features/oauth/actions.ts`, lines 13–17; `src/features/grants/actions.ts`, lines 27–28;
  `src/features/mcp/http.ts`, lines 133–138; `src/features/mcp/queries.ts`, lines 18–19
- Severity: Minor. There is no cycle of modules, but the owner of a rule is unclear.
- Category: readability
- Problem: `MAX_GRANTS_PER_USER` is declared in the grant service, which never uses it; only the OAuth service
  enforces it. The grant service in turn imports the issuer, the hash and the shape of a token from OAuth. Whether
  OAuth is on is `issuer() === null` in eight places, a private `isOAuthOn()` in the grant service, and a read of
  the environment in the two files of MCP. The action that revokes a grant checks the issuer before a service
  that checks the same and leads to the same not-found page.
- Impact: the next rule about grants has no clear home, and a change of how OAuth is switched on has three
  spellings to find.
- Evidence: `src/features/grants/service.ts`, line 29, `export const MAX_GRANTS_PER_USER = 50;`, and
  `src/features/oauth/service.ts`, line 46, `import { MAX_GRANTS_PER_USER } from "@/features/grants/service";`.
- Suggestion (optional): move the constant to a pure module, export one `isOAuthOn()` from the issuer module, and
  drop the check in the action.
- Confidence: Low. Which feature owns the limit and the check of a token is a design choice.

#### suggestion: the error answer of an authorization request is put together in three places

- Location: `src/features/oauth/actions.ts`, lines 22–35, `refusal()`, and lines 92–100, `deny()`;
  `src/features/oauth/queries.ts`, lines 49–69, `refused()`
- Severity: Minor. One shape of the protocol, three copies.
- Category: readability
- Problem: the error, its description, the state and the issuer are passed to `authorizationResponseUrl()` in the
  same order in all three places. The rule that every answer carries `iss` is repeated by hand.
- Impact: a new parameter of the error answer has to be added three times in two files.
- Evidence: `src/features/oauth/queries.ts`, line 67: `authorizationResponseUrl(redirectUri, { error,
error_description: description, state, iss: base })`.
- Suggestion (optional): one function for the error answer next to `authorizationResponseUrl()` in the schema of
  OAuth.
- Confidence: High. One fix; the order of the parameters and so the address stay the same, and the unit tests of
  the actions and the queries assert the addresses.

#### suggestion: `create_page` without a name validates the content in the tool before the service does

- Location: `src/features/mcp/tools.ts`, lines 494–515, `createPage()`
- Severity: Minor. Meant, as the comment says, but a rule outside the service.
- Category: performance
- Problem: to derive the name, the tool runs the schema of the content itself, which parses the Markdown; the
  service then parses the same content again. The order of checks also differs from the order of the service:
  without a name, an error of the content is reported before the role and the tab are looked at.
- Impact: every `create_page` without a name pays the parse twice.
- Evidence: lines 499–501: `const checked = pageContentInputSchema.safeParse({ content: input.content });` and
  `name = deriveName(checked.data.title);`.
- Suggestion (optional): let the service accept a missing name and derive it after its own checks, with a code for
  a title that suggests no name.
- Confidence: Low. It adds a code to the service and to the browser action.
- Alternatives: keep the rule in the tool and record the second parse as accepted in `pages.md`.

#### suggestion: `tools.ts` and the OAuth service each hold several parts that could stand alone

- Location: `src/features/mcp/tools.ts` (937 lines); `src/features/oauth/service.ts` (837 lines)
- Severity: Minor. Size alone; the parts are kept apart inside the files.
- Category: readability
- Problem: `tools.ts` holds the schemas of inputs and outputs, the helpers for results and messages, the nine
  handlers, and the registration with the descriptions. The OAuth service holds the clients and their
  registration, the authorization request with the code, the token endpoint, and the clean-up. Inside the token
  part the error of an invalid grant is unwrapped ten times, and `refuse()` is declared twice.
- Impact: a change of one description or one rule of a token means scrolling a file of 900 lines.
- Evidence: `src/features/oauth/service.ts`, line 628: `return refuse("expired-code",
invalidGrant(INVALID_CODE).error);`.
- Suggestion (optional): move the schemas of the tools and the registration to modules of their own and add them
  to `src/features/services.test.ts`. A split of the OAuth service has to respect the lint rule that only a
  `service.ts` imports the database.
- Confidence: Low. Whether and how to split is a design decision.

#### nit: two helpers with nearly the same name give two orders, and the tool sorts again what the service sorted

- Location: `src/features/mcp/tools.ts`, lines 306–319, `placedDirectlyFirst()`; `src/features/pages/service.ts`,
  lines 239–265, `directPagesFirst()`
- Severity: Nit. Both orders are specified; only the names and the hidden dependency are unclear.
- Category: readability
- Problem: the difference is meant: `content-structure.md` orders the list of the browser by name and then by tab,
  `mcp.md` orders `list_folder` by the folder first and then tab by tab. The tool regroups the order of the
  service and relies on it and on a stable sort, and neither helper names the other.
- Impact: a reader takes one for a copy of the other, and a change of the order of the service changes
  `list_folder` without a failing unit test, because that test mocks the service.
- Evidence: `src/features/mcp/tools.ts`, lines 307–308: "Within each group the pages keep the order they came in,
  which is by name."
- Suggestion (optional): a name that says what the helper does, a sort by tab and then by name, and a word about
  the other order in both comments.
- Confidence: Medium. The explicit sort gives the same result today; the tests were not run.

#### nit: leftovers in the features of OAuth, grants and MCP

- Location: `src/features/oauth/schema.ts`, lines 12–28, `OAUTH_ERRORS`; `src/features/oauth/service.ts`, line 541,
  `newTokens()`; `src/features/grants/service.ts`, lines 95–98, 184–185 and 258; `src/features/oauth/http.ts`, lines
  87–89, and `src/features/oauth/metadata-fetch.ts`, lines 46–48; `src/features/mcp/tools.ts`, line 39
- Severity: Nit. None changes behaviour.
- Category: style
- Problem:
  - `OAUTH_ERRORS` lists `unauthorized_client` and `invalid_scope`; nothing sends them, and there are no scopes.
  - About 25 names of these three features are exported and imported by no other file, tests included, for
    example the three prefixes of secrets, `clientRowIdSchema`, `MAX_REDIRECT_URIS` and the lifetimes of a code and
    an access token.
  - `newTokens()` states no return type, and its parameter hides an imported function of the same name.
  - A stored role that is no role of MCP is treated in four ways: skipped with an error in the log, folded into
    another code without one, `failed`, and checked only when a `resource` is sent.
  - `mediaTypeOf()` exists twice.
  - A comment of the grant service speaks of "a former API token".
  - The MCP server reports the version `1.0.0`, the project is at `0.1.0`.
- Impact: readers take exported names for an interface and unused codes for behaviour.
- Evidence: `const SERVER_INFO = { name: "hippowiki", title: siteName, version: "1.0.0" };`.
- Suggestion (optional): drop `export` where nothing imports the name, state the return type, log a broken role
  the same way in all four places, share `mediaTypeOf()`, and decide where the version of the server comes from.
- Confidence: Medium. Dropping `export` is safe by the type checker; removing the two codes breaks a unit test of
  the schema that asserts them; the version needs a decision.

#### Reviewed

- Parity of the codes is complete for all seven writes that both adapters offer.
- The layer rules hold: `tools.ts` imports nothing from `next` or `react`; only the services of grants and OAuth
  call the database in this area; the four route files only hand the request over.
- The adapters are thin: the MCP adapter checks the path, the method, the origin, the token and the folder and
  hands over; the OAuth adapter reads bodies and maps codes to a status and an OAuth error.
- The bearer token is parsed in one place, `bearerTokenOf()` of the grant service.
- The texts shared by the tools (`NOT_ALLOWED`, `WRITE_FAILED`, `pageNotFound()`, `tabNotFound()`, `pageChanged()`,
  `invalidInput()`, `nameTaken()`) hold each message once.
- The log lines of writes without a change are uniform in both content services, always with the channel.
- `secret.ts`, `public-address.ts`, `metadata-fetch.ts` and `issuer.ts` are small, with one purpose each, and the
  shape and the hash of a token exist once.
- `replacedGrants()` is one condition for the count on the consent page and for the delete in the exchange.

### Code: components, routes, auth, users and lib

#### issue: the "Save page" dialog does not move the focus to the name field when the server refuses the name

- Location: `src/features/pages/components/NewPageForm.tsx`, lines 117–195, `SavePageDialog`
- Severity: Minor. A rule of the UI is broken in one dialog; nothing is lost.
- Category: correctness
- Problem: `architecture.md`, section "UI", says that after a refused save the first field with an error gets the
  focus. Eight forms do this with an effect on the form state. `SavePageDialog` reads the error of the name but has
  no such effect, and the file does not import `useEffect`.
- Impact: a user who saves a new page under a taken or invalid name keeps the focus on "Save"; users of the
  keyboard and of a screen reader are not led to the error. It is the first copy of a repeated rule that drifted,
  see the next finding.
- Evidence: line 12, `import { startTransition, useActionState, useId, useRef, useState, type SubmitEvent } from
"react";`; against `src/features/pages/components/MoveOrRenamePageDialog.tsx`, lines 76–78,
  `useEffect(() => { if (state.fieldErrors?.name) nameRef.current?.focus(); }, [state]);`. The test "a taken name
  shows an error in the open dialog and keeps all values" in `e2e/create-page.spec.ts` checks the message, not the
  focus; the test of the same case in `e2e/move-or-rename-page.spec.ts` checks the focus.
- Suggestion (required): add the effect of `MoveOrRenamePageDialog` to `SavePageDialog`, and an assertion on the
  focus to the test named above.
- Confidence: Medium. The same three lines as in the other dialogs, and no spec says otherwise; no existing test
  covers the focus of this dialog, and the fix was not tried.

#### suggestion: nine dialogs repeat the same frame and its rules by hand

- Location: `src/features/folders/components/NameDialog.tsx` and `DeleteTabDialog.tsx` in the same folder;
  `MoveOrRenamePageDialog.tsx`, `DeletePageDialog.tsx`, `RestorePageDialog.tsx` and `RevertPageDialog.tsx` in
  `src/features/pages/components/`; `src/features/folder-roles/components/GiveRoleDialog.tsx`;
  `src/features/grants/components/RevokeAppDialog.tsx`; `src/features/users/components/CreateUserDialog.tsx`
- Severity: Minor. Duplicated code, but it carries rules, and the finding above shows a copy that drifted.
- Category: readability
- Problem: these rules of `architecture.md` are written once per dialog: close only while nothing is pending
  (9 times), `disablePortal` with the same comment (9), the submit button outside the form, disabled while pending
  or not hydrated (9), "Cancel" as a link (9), the alert for the message of the form state (14), the submit in a
  transition for controlled fields (5), and the focus on the first field with an error (8 chains written by hand).
  `DeletePageDialog`, `RevertPageDialog` and `RevokeAppDialog` are the same component except for the title, the
  sentence, the label and the hidden version.
- Impact: a change of one rule, for example the lock until hydration, has nine files.
- Evidence: `src/features/grants/components/RevokeAppDialog.tsx`, lines 32–80, and
  `src/features/pages/components/DeletePageDialog.tsx`, lines 36–91, differ in about ten lines.
- Suggestion (optional): a frame component for a dialog that submits a form, a confirmation dialog on top of it for
  the three deletes and the revert, and two hooks: one for the submit in a transition, one for the focus on the
  first error. Keep the bodies of the forms, the second stage of `CreateUserDialog` and the texts where they are.
  Close the gaps of the tests first: the pending state has no test (see "Tests: end-to-end").
- Confidence: Medium. A refactoring with choices of design; `e2e/hydration.spec.ts` and the specs of the features
  cover every dialog.
- Alternatives: only the two hooks, which are small and would have prevented the finding above; or only the
  confirmation dialog, which removes about 250 lines.

#### issue: the title and the page each decide what an address shows, and they disagree in three routes

- Location: `src/app/folders/[folder]/page.tsx`, lines 70–82 against 91–95;
  `src/app/folders/[folder]/[item]/page.tsx`, lines 54–62 against 73–86;
  `src/app/folders/[folder]/[item]/[page]/page.tsx`, lines 24–28 against 37–38;
  `src/features/pages/components/PageView.tsx`, lines 194–199, `pageViewTitle()`
- Severity: Minor. Only the title in the browser of a not-found page, for a user who may read the item anyway.
- Category: correctness
- Problem: each route parses the query and decides "not found" twice, with different rules. The folder route
  repeats the check for an invalid query and a missing public URL, but not for an action beyond the role. The tab
  route repeats nothing. `pageViewTitle()` returns the title of the page for an invalid query, and "Edit …" without
  a look at the role.
- Impact: a Reader who opens `?action=new`, or anyone with a mistyped query, sees the not-found page under a title
  such as "New page", and the rule has to be kept in step by hand in two places per route.
- Evidence: the folder route, line 74, `if (query.action === "new") return { title: pageTitle("New page") };`,
  against line 95, `if (action !== null && !mayDo(folder.role, ACTION_FUNCTIONS[action])) notFound();`.
- Suggestion (optional): one function per route that turns the parameters and the query into "not found" or into
  what to show, the role included, used by the title and by the page.
- Confidence: Medium. The two rules are in the cited lines; that the title stays on the not-found page was not
  tried in a browser, and no test checks the title of a not-found page.

#### suggestion: `PageView.tsx` holds the parser of the query, the table of roles and the titles, without a unit test

- Location: `src/features/pages/components/PageView.tsx`, lines 32–199;
  `src/features/pages/components/DeletedPageView.tsx`, lines 19–27
- Severity: Minor. Logic with many branches sits where no unit test lives.
- Category: tests
- Problem: about 170 of the 307 lines are pure functions and tables, not the component: `mayDoPageAction()`,
  `parsePageNotice()`, `parsePageQuery()`, `parseHistoryView()`, `historyViewTitle()`, `changedMessage()` and
  `pageViewTitle()`. No directory of components has a test file, so they are covered only end to end, while their
  siblings in `src/lib/addresses.ts` have unit tests. The route of a deleted page imports two of them from
  `PageView` although it never renders it. Five names are exported and used only in their own file.
  `architecture.md` says the routes read the notice with `parsePageNotice()`; they call `parsePageQuery()`.
- Impact: a change of the rules of the query, such as `before` from 2 up or which parameter belongs to which view,
  has only the end-to-end suite as a net.
- Evidence: line 118, `return before === null || before < 2 ? "invalid" : { name: "history", before };`.
- Suggestion (optional): move the pure part to a module of the feature without server-only imports, add a unit
  test, drop the unused exports and correct the sentence in `architecture.md`.
- Confidence: Medium. The name of the module and the cut are a choice; nothing changes in behaviour.

#### suggestion: the handling of a changed page is put together by hand in four forms, two parents and twice in the actions

- Location: `PageForm.tsx`, `MoveOrRenamePageDialog.tsx`, `DeletePageDialog.tsx` and `RevertPageDialog.tsx` in
  `src/features/pages/components/`; `PageView.tsx`, lines 218–234 and 284–301, and `PageAddress.tsx`, lines 41–46,
  in the same folder; `src/features/pages/actions.ts`, lines 59–62 and 326–330
- Severity: Minor. The pieces work only together, and nothing ties them.
- Category: readability
- Problem: a form that rests on the version of a page needs the hidden field with the version, the warning with
  the message, and a key of the version and the notice that mounts it again. Each of the four forms writes the
  first two, each of the two parents the key and the message. `revertPage()` repeats `showChanged()` because its
  address differs.
- Impact: a new dialog without the hidden field has every save refused as changed; one without the key keeps the
  old input after a refused save. Both compile.
- Evidence: `PageView.tsx`, line 221, ``const formKey = `${page.version}-${notice ?? ""}`;``, and
  `PageAddress.tsx`, line 42, ``key={`${page.version}-${query.notice ?? ""}`}``.
- Suggestion (optional): one component for the hidden field and the warning, one helper for the key and the
  message, and an address parameter for `showChanged()`.
- Confidence: Medium. A choice of design; the tests of a changed page in four end-to-end specs cover the behaviour.

#### suggestion: each route states the role of an action twice, in its table and again at the button

- Location: `src/app/folders/[folder]/page.tsx`, lines 45–50 against 136, 145, 203, 224 and 229;
  `src/app/folders/[folder]/[item]/page.tsx`, lines 33–37 against 121, 126 and 131;
  `src/features/pages/components/PageView.tsx`, lines 41–47 against 255, 260 and 269
- Severity: Minor. Two statements of one rule in the same file.
- Category: readability
- Problem: the gate of a dialog uses the table of the route; the button that links to the dialog names the
  function again. `mayDoPageAction()` exists, but the buttons of `PageView` do not use it.
- Impact: when one is changed and not the other, a button leads to the not-found page, or a dialog can be opened
  without a button.
- Evidence: the folder route, line 48, `"new-tab": "editTab",`, and line 224, `{mayDo(role, "editTab") && (`.
- Suggestion (optional): build the buttons from the table.
- Confidence: Medium. Nothing changes in behaviour; `e2e/folder-roles.spec.ts` uses the buttons of each role.

#### suggestion: the folder route is a switch of five views written inline, while the routes of pages hand over to components

- Location: `src/app/folders/[folder]/page.tsx`, lines 84–257; `src/app/folders/[folder]/[item]/page.tsx`, lines
  88–157; `src/features/pages/components/NewPageForm.tsx`, lines 31–34
- Severity: Minor. Readability; the checks of the role and the reads are where `architecture.md` wants them.
- Category: readability
- Problem: the folder route renders five views itself, the view "AI apps" as 20 lines of JSX; the routes of pages
  hand everything to components. The view "New page" is written twice, the same except for two props, and so is
  the head with its row of buttons. `NewPageForm` takes the name and the id of the same tab, though its list of
  tabs holds the name for the id.
- Impact: each new view or action makes the route longer, and a reader learns two patterns.
- Evidence: lines 104–110 of the folder route and lines 94–100 of the tab route are the same call of
  `NewPageForm`.
- Suggestion (optional): keep in the route only `requireUser()`, the read, the parse, the gate and the switch, and
  move the views into Server Components of the features, as pages do with `PageView`.
- Confidence: Medium. A choice of structure without a change of behaviour.

#### issue: comments promise "Client Components can use it" for modules that pull in the list of common passwords or a module of Node

- Location: `src/features/users/forms.ts`, lines 1 and 5; `src/features/auth/schema.ts`, lines 1 and 6;
  `src/lib/client-address.ts`, lines 4–7
- Severity: Minor. Nothing is wrong in the bundle today; the comments invite the mistake they should prevent.
- Category: docs
- Problem: both modules of forms import values from `src/features/users/schema.ts`, which imports the 10,000
  common passwords. `architecture.md` says exactly that Client Components must not import that schema.
  `client-address.ts` says "no server-only imports" and imports `node:net`. It is safe today only because the one
  Client Component that touches these modules imports a type. No lint rule would notice an import of a value.
- Impact: a developer who follows the pattern of the pages, whose forms module exports the name of a field for
  Client Components, and adds such a constant to the forms of the users, ships the list of passwords to every
  browser that opens "New user".
- Evidence: `src/features/users/forms.ts`, line 1, "What only the forms of users need. No server-only imports, so
  Client Components can use it.", and line 5, `import { userInputSchema, type UserFieldErrors, type UserInput }
from "@/features/users/schema";`.
- Suggestion (required): correct the three comments: Client Components import only the types of the two modules,
  and limits come from `src/features/users/limits.ts`; `client-address.ts` is for the server. Optional on top: a
  lint rule for routes and components that allows only type imports of these modules.
- Confidence: High for the comments. One fix without a change of behaviour; the cited lines are the evidence, and
  `npm run check` covers the files. The lint rule was not run.

#### question: do Client Components ship Zod and markdown-it only to read the name of a field or a length limit?

- Location: `DeletePageDialog.tsx`, `RevertPageDialog.tsx`, `MoveOrRenamePageDialog.tsx`, `PageForm.tsx` and
  `PageNameAndPlaceFields.tsx` in `src/features/pages/components/`; `src/features/pages/forms.ts`, lines 4–17;
  `src/features/oauth/components/ConsentForm.tsx`, lines 15–22; `src/lib/names.ts`
- Severity: Minor, if it holds.
- Category: performance
- Problem: the dialogs import `VERSION_FIELD` and `PLACE_FIELD` from the forms module of the pages, which imports
  Zod and the schema of the pages, which imports the Markdown parser. `NAME_MAX_LENGTH` comes from a module that
  builds a schema when it loads. Whether the bundler drops the unused code was not measured, because no build was
  read. The same worry is the stated reason for the two `limits.ts` modules.
- Impact: if it is not dropped, every page with a delete, revert or move dialog loads Zod and markdown-it for the
  string `"version"`.
- Evidence: `src/features/pages/components/DeletePageDialog.tsx`, line 16: `import { VERSION_FIELD, type
PageDeleteFormAction } from "@/features/pages/forms";`.
- Suggestion (optional): look at the chunks of the client for a page with `?action=delete` in a production build;
  if the two libraries are in them, move the names of the fields and the limit to modules without imports.

#### suggestion: messages and labels of the same situation are defined more than once, and two no longer fit

- Location: `src/features/auth/actions.ts`, line 25, and `src/features/users/actions.ts`, line 16, `BUSY_MESSAGE`;
  `src/features/users/components/CreateUserDialog.tsx`, line 30, and `UserList.tsx` in the same folder, line 12,
  `TYPE_LABELS`; `src/features/auth/components/ChangePasswordForm.tsx`, line 79
- Severity: Minor. Copies drift, and two are already inexact.
- Category: readability
- Problem: an admin who creates a user while the hashing is busy reads "Too many logins at the moment, please try
  again", the message of the login, copied. The hint under "New password" says "not the same as your user name",
  while the rule of the schema is wider: not built only from the user name or the name of the wiki, and no common
  password. `TYPE_LABELS` exists twice, while the labels of the roles live once in `roles.ts`.
- Impact: users read a wording that does not fit what they did, and a change of one copy misses the other.
- Evidence: `src/features/users/actions.ts`, line 16:
  `const BUSY_MESSAGE = "Too many logins at the moment, please try again";`.
- Suggestion (optional): a text of its own for `createUser()`, the hint in line with the rule, and `TYPE_LABELS`
  next to the types of an account.
- Confidence: Medium. Moving the labels changes nothing; the two texts are seen by users and pinned by unit and
  end-to-end tests.

#### suggestion: the schema of a user name is a second copy of the name rule and of its parser

- Location: `src/features/users/schema.ts`, lines 36–52 and 85–98; `src/lib/names.ts`, lines 13–28;
  `src/features/auth/schema.ts`, lines 15–19
- Severity: Minor. Two copies of a rule that addresses depend on.
- Category: readability
- Problem: `userNameSchema` repeats `nameSchema` step by step, with only the limits of the length different, and
  `parseUserName()` is `parseName()` line for line. The rule "count the length of the string, not the code points"
  is written by hand in two schemas.
- Impact: a change of the name rule or of its message has two modules.
- Evidence: both hold `.regex(NAME_PATTERN, "Use lowercase letters, digits and single hyphens")`.
- Suggestion (optional): export from `names.ts` a builder of the schema with the limits, and a parser for an exact
  match.
- Confidence: Medium. The unit tests of both schemas pin the messages; whether a builder keeps the order of the
  errors was not tried.

#### suggestion: a text field of a form is read in three ways, with two outcomes for a file

- Location: `src/features/auth/forms.ts`, lines 26–29; `src/features/users/forms.ts`, lines 32–37;
  `src/features/folders/forms.ts`, lines 13 and 22; `src/features/pages/forms.ts`; `src/lib/names.ts`, lines 30–40
- Severity: Nit. Only a crafted request sends a file; the cost is the repetition.
- Category: readability
- Problem: a file in the field of the name counts as empty for a user and is refused by the type check of Zod for
  a folder, a tab or a page. The type of a parse result is declared five times. The types of the name form live in
  `src/lib/names.ts`, though only the folders feature uses them.
- Impact: a new form copies one of three patterns.
- Evidence: `src/features/users/forms.ts`, line 35, `name: typeof name === "string" ? name : "",`, against
  `src/features/folders/forms.ts`, line 13, `folderInputSchema.safeParse({ name: formData.get("name") ?? "" })`.
- Suggestion (optional): one helper for a text field and one generic type of a parse result and of a form state,
  in a module of `src/lib/` without server-only imports.
- Confidence: Medium. The helper changes nothing; one outcome for a file changes what unit tests pin.

#### suggestion: four rules of `architecture.md` are convention only, and a lint rule could hold them

- Location: `eslint.config.mjs`, lines 122–192; `spec/architecture.md`, section "Linting"
- Severity: Minor. The rules hold today; nothing keeps them true.
- Category: readability
- Problem: ESLint enforces the groups of imports, the environment, the database only in services, services as
  types in routes and components, and no `next` or `react` in a `service.ts`. Convention only are:
  - `no-console`, which is a list of globs that leaves out the session module, every forms and schema module,
    every page and layout and the shared components;
  - "the MCP tools import nothing from `next` or `react`", because the lint rule matches only a `service.ts`;
  - addresses only from `src/lib/addresses.ts`: `src/lib/revalidate.ts` repeats two roots, and the header and the
    auth actions write `"/"`;
  - `select`, never `include`, in a service.
- Impact: a new server module of a kind that no glob names, or a new address written by hand, passes the checks.
- Evidence: `eslint.config.mjs`, line 175, `files: ["src/features/**/service.ts"],`; `src/lib/revalidate.ts`, line
  9, `revalidatePath("/folders", "layout");`.
- Suggestion (optional): turn `no-console` round, on for `src/` and off for the two error pages; add the MCP tools
  and the pure modules of OAuth to the rule of the services; a syntax rule against `include`; helpers for the
  roots that the revalidation uses.
- Confidence: Medium. The gaps are as cited; none of the rules was run against the code.

#### nit: unused names, an unused colour, and small twins

- Location: `src/features/auth/forms.ts`, lines 19–20, `LogoutFormAction`; `src/features/auth/schema.ts`, lines
  22–23, `LoginInput`; `src/lib/addresses.ts`, lines 155–158, `authorizationServerMetadataPath()`;
  `src/lib/theme.ts`, line 11; `src/features/mcp/queries.ts`, lines 17–24; `src/features/users/records.ts`;
  `src/app/error.tsx` and `src/app/global-error.tsx`
- Severity: Nit. Nothing breaks.
- Category: readability
- Problem:
  - `LogoutFormAction` and `LoginInput` are used nowhere; `authorizationServerMetadataPath()` only by its test;
    the secondary colour of the theme by no component.
  - A search for exports that no other file imports gives about 150 names in `src/`. Most are types of results and
    constants that only the tests of their file import; no check of the project reports an unused export.
  - `listMcpAddresses()` builds the full MCP address a second time, as `mcpResourceOf()` does, and reads the
    environment itself.
  - Copying to the clipboard has two shapes of state and two ways to show a failure.
  - `records.ts` of the users holds two things without a link: the rows of Better Auth, and the wording of the
    last editor, which nine components import from the users feature.
  - A malformed id bound to an action is "not found" in the actions of roles and grants and a message "no longer
    exists" in those of folders and pages.
  - The field `user` carries a user name in "Give role" and a user id in the list of roles.
- Impact: none at run time; a reader takes dead names for an interface.
- Evidence: `export type LogoutFormAction = () => Promise<void>;`; the header passes `logOut` to the form
  directly.
- Suggestion (optional): delete the two types and the unused function or use it, drop the colour, decide on one
  answer for a malformed id, and add a check for unused exports to `npm run check`.
- Confidence: Medium. High for the two types, which nothing references; the rest are small decisions.

#### nit: the time, the empty state and the label of a page are typed again in every list

- Location: the `<time>` element in ten components, for example `src/features/pages/components/PageListItem.tsx`
  and `src/features/folders/components/FolderList.tsx`, with a local `Time` in
  `src/features/grants/components/ConnectedAppList.tsx`; the empty state in six; the `.md` of a page label in five
- Severity: Nit
- Category: readability
- Problem: the markup of a time, with the ISO value and the text of `formatDateTime()`, is written ten times,
  though one component wraps it already. The suffix of a page is typed by hand five times, while its constant is
  private in `src/lib/addresses.ts`. Two breadcrumb components build the same trail.
- Impact: a change of the time format or of the suffix needs a search over the components.
- Evidence: `function Time({ date }: { date: Date }) { return <time dateTime={date.toISOString()}>
{formatDateTime(date)}</time>; }`.
- Suggestion (optional): move `Time` to `src/components/`, add a component for the empty state and a helper for
  the label of a page.
- Confidence: Medium. No behaviour should change; whether a test reads the `dateTime` attribute was not checked.

#### Reviewed

- The boundary of client and server holds today: none of the 22 Client Components imports a service, a queries
  module, the database, the logger, the environment or the schema of the users as a value.
- Apart from the finding of the first review report on the rows of tabs, each Client Component gets only what it
  shows or submits.
- Every page calls `requireUser()`, or the documented exception, before it reads the query.
- Links, redirects and the addresses that close a dialog are built with `src/lib/addresses.ts`, with the three
  exceptions named above.
- The two error pages use the `retry` prop, which is the API of the installed Next.js.
- Shared pieces that work: `PageNameAndPlaceFields` for three dialogs, the place of the history for live and
  deleted pages, `PageListItem`, `useHydrated()`, and `mayDo()` for routes and services alike.
- The services of auth and users: a type of errors per write, `Result` everywhere, no password in a log line, and
  pure modules for the wait, the limits and the type of an account.
- Every form state is the field errors and a message, with at most one documented extra.
- There is no `TODO` or `FIXME` in `src/`, `scripts/` or `prisma/`.

### Tests: unit and integration

Unit coverage on 2026-11-18 is 78.95 % of the lines and 69.71 % of the branches. The gap is almost only the
components and the route pages, which have no unit tests on purpose (67 of 138 files, 690 lines); the services are
between 94 % and 100 %. The findings below are therefore about what is asserted, not about lines.

#### issue: that a content save and its revision are one unit, and most races of pages, are proven by no test against the real database

- Location: `src/features/pages/service.test.ts`, lines 43–60 and 94–100 (the mock of the database and of the
  transaction) and lines 932–959; `integration/page-service.test.ts`, lines 1457–1469, the only race of pages;
  `spec/page-history.md`, section "Revisions"; `spec/optimistic-locking.md`, section "Decisions"
- Severity: Major. The central promise of the history and of optimistic locking is proven for one of four writes
  of a page, and a mock cannot prove the rest.
- Category: tests
- Problem: proven with real concurrency are two content saves with the same version, two Owners who lower each
  other, a page created in a tab while the tab is deleted, and the rollback of `deleteTab()`. Proven only with
  mocks are the rename that was renamed meanwhile, a delete changed between its read and its update, and the lock
  of the roles. Proven nowhere:
  - the rollback of the page when the revision cannot be stored: the mock gives the database and the transaction
    the same functions, so the unit tests pass when the update moves out of the transaction;
  - the races with the same version for two moves, a save and a move, a save and a delete, two deletes, and a
    revert and a save;
  - a move or a restore into a tab while it is deleted, though `content-structure.md` names "created, moved or
    restored";
  - two restores at once; the end-to-end test waits for the first before it submits the second.
- Impact: a refactoring of `storeContentChange()`, which the findings under "Code: services of the content
  features" suggest, can take the update of the page out of the transaction. A failed insert of the revision then
  leaves a changed page with a new version and no revision, and every unit and integration test stays green.
- Evidence: `src/features/pages/service.test.ts`, line 938, `expect(mocks.transaction).toHaveBeenCalledOnce();`, is
  the only assertion about the transaction. `Promise.all` appears once in `integration/page-service.test.ts`.
- Suggestion (required): add to `integration/page-service.test.ts`: a save and a revert that leave the page and
  its revisions as they were when a trigger refuses the insert of the revision, as the test of `deleteTab()` in
  `integration/folder-service.test.ts` does; a table of races over pairs of save, move, delete and revert with the
  same version; and two restores at once. Add a move and a restore into a tab that is being deleted.
- Confidence: Medium. The rollback test is one clear addition with a technique the repository has; a new race test
  could show a real defect.
- Alternatives: give the transaction of the mock functions of its own, so that "inside the transaction" can be
  asserted; cheaper, and still no proof of a rollback.

#### issue: tests say that no MCP connection reads deleted pages, but try only a Writer connection

- Location: `src/features/pages/service.test.ts`, lines 2042–2047 and 2056–2073;
  `src/features/folder-roles/service.test.ts`, lines 271–287; `integration/page-service.test.ts`, lines 1195–1202;
  `src/features/pages/service.ts`, lines 322 and 340, `listDeletedPages()` and `getDeletedPage()`;
  `spec/page-deletion.md`, section "Deleting"; `spec/folder-roles.md`, section "MCP"
- Severity: Major. A rule about what the token of an AI app may read is asserted on a premise that stopped being
  true with the Manager connections.
- Category: tests
- Problem: all four tests use a connection with the role Writer, where the answer `null` comes from the role, not
  from the channel. Both reads take `ContentActor`, and for a Manager connection the condition for the function
  `deletedPages` holds, so by the code the service would return deleted pages to an MCP actor. This was derived
  from the code and not run. The rule holds today only because no tool calls the reads, which the tests of the
  tools and `e2e/mcp.spec.ts` prove. Restoring and the reads of the history are closed to MCP by the type
  `BrowserActor`.
- Impact: a later tool, or a refactoring that reuses the read for a Manager connection, shows deleted pages
  through MCP while the tests named after the rule stay green.
- Evidence: the test name "listDeletedPages through MCP reads nothing, because the role of a connection is at most
  Writer"; `integration/page-service.test.ts`, line 1198, `const mcp = inMcp(user, { grantId: crypto.randomUUID(),
folderId: folder.id, role: "writer" });`; `folder-roles.md`: "The deleted pages list, reading a deleted page and
  restoring one stay in the browser as well, also for a Manager connection."
- Suggestion (required): decide where the rule lives, then make the tests say it, in one of the two ways under
  Alternatives.
- Confidence: Low. The problem is in the cited lines; the fix is a decision of design.
- Alternatives:
  - The service holds the rule: both reads take `BrowserActor`, as restoring does, and the four tests get a case
    with a Manager connection. One changed type, and it fits the wording of three specs.
  - The list of tools holds the rule: the tests are renamed, a case documents that a Manager connection may read
    at the level of the service, and the specs say "no tool" instead of "no connection".

#### issue: the access rules of two reads of the history are asserted by no test

- Location: `src/features/pages/service.test.ts`, lines 403–560; `integration/page-service.test.ts`, lines
  1472–1562; `src/features/pages/service.ts`, lines 447–487, `getRevisionComparison()` and `getPageRevision()`;
  `spec/testing.md`, section "Integration tests"
- Severity: Major. These reads take the id of a page, and the service is the only layer that checks the role for
  it.
- Category: tests
- Problem: only `listPageRevisions()` has its condition on the role tested, in the unit test and for every role in
  the integration test. For `getPageRevision()` the unit test asserts only that the id is in the condition, and
  the integration test reads as an Owner. `getRevisionComparison()` has no integration test at all, and its unit
  tests never assert the read of the page. The end-to-end tests reach both reads through routes that find the page
  with a read that checks the role first.
- Impact: when the reads of the history are split out of the pages service, one of them can lose the condition on
  the role or on a deleted page, and no test fails. A user without a role could then read the content of a
  revision by the id of the page.
- Evidence: lines 429–431 of the unit test: `expect(mocks.findFirst).toHaveBeenCalledWith(
expect.objectContaining({ where: expect.objectContaining({ id: PAGE_ID }) }),`. `testing.md` says: "a new read
  with a condition the database must get right and every new write get a case in the integration test of their
  service".
- Suggestion (required): in `integration/page-service.test.ts`, turn the test of the roles into a table over the
  three reads, the roles with a stranger and an admin, and a live and a deleted page; add a case for the fields
  and the order of a comparison.
- Confidence: High. One addition; the paths in the service and the callers were read, and the new cases prove
  themselves.

#### issue: the unit tests of the services pin the calls of Prisma, not the behaviour

- Location: `src/features/pages/service.test.ts`, `src/features/folders/service.test.ts` and
  `src/features/folder-roles/service.test.ts`
- Severity: Major. The planned refactoring is what breaks these tests, and they are the only tests of the branches
  for database errors.
- Category: tests
- Problem: the three files hold 72 assertions on the exact arguments of a database mock, 19 inspections of the
  list of calls and 23 assertions on the number or the order of calls. Beyond that, nearly every test of a write
  scripts its case through the method the code happens to call. `testing.md` says: "Assertions that only repeat
  the `select` and `orderBy` of a query are left out." Not coupled are the tests of the actions, the queries and
  the tools, which mock at the border of the service, and no test asserts the inner types of a result.

  | File                                        | Tests | Exact arguments | Lists of calls | Number or order of calls |
  | ------------------------------------------- | ----- | --------------- | -------------- | ------------------------ |
  | `src/features/pages/service.test.ts`        | 135   | 39              | 10             | 8                        |
  | `src/features/folders/service.test.ts`      | 72    | 25              | 8              | 11                       |
  | `src/features/folder-roles/service.test.ts` | 57    | 8               | 1              | 4                        |

- Impact: one shape for writes without a change, a switch from `updateMany` to `update`, or a read moved into the
  transaction turns these tests red, though the integration tests of the same rules stay green. They then have to
  be rewritten together with the code, which removes the cover of the branches only they have: the mapping of
  database errors, `failed`, and the log lines.
- Evidence: lines 915–916 of the pages test: `expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: PAGE_ID,
deletedAt: null, version: VERSION, content: { not: CONTENT } },`.
- Suggestion (required before the refactoring): first add the missing integration cases of this section, so that
  every rule has a test of its behaviour. Then cut the unit tests down to what needs a mock: a malformed id never
  reaches the database, an error becomes a code, the log lines, and the data of a write.
- Confidence: Low. The problem is evident; how far to cut is a decision.
- Alternatives:
  - Keep the tests and accept that they are rewritten with the code.
  - One scripted fake of the client with helpers that say what happens, not which method is called.
  - Move the mapping of errors to integration tests with triggers, which run slower.

#### issue: "the role is checked before the version and the content" is tested only with a current version and valid content

- Location: `src/features/pages/service.test.ts`, lines 1990–2004 and 2082–2209;
  `integration/page-service.test.ts`, lines 1145–1163 and 1206–1224; `spec/optimistic-locking.md`, section "Which
  changes are refused"
- Severity: Minor. The order is right today and guarded in part; the missing case is the one that would leak.
- Category: tests
- Problem: every test of a refusal for no role and for too low a role passes `version: 1` and valid content. With
  no version or an old one the code takes another path, which reads the page and answers `page-changed` with its
  name, folder and tab. Only the admin is tested with no version and invalid input. The folders test has "is
  refused before the input is checked" for a user without a role; the pages test has no such case.
- Impact: a shared helper that parses the version or the content first, a likely result of the refactoring, would
  answer a user without a role with the stored page, and the action would redirect to the real address of the
  page. No test fails.
- Evidence: `optimistic-locking.md`: "The role is checked before the version, so a refusal tells nothing to a user
  without the role for the change."
- Suggestion (required): add the case for no role and for a Reader, with invalid content and no version, for the
  four writes with a version, in the unit test and with an old version in the integration test.
- Confidence: High. The cases are additions, and the order was checked in the four writes of the service.

#### issue: rules that only an end-to-end test covers, or no test

- Location: `integration/page-service.test.ts` and `integration/folder-service.test.ts`, where the tests belong;
  `spec/pages.md`, sections "Saves without a change" and "Content and title"; `spec/optimistic-locking.md`, section
  "The version of a page"; `spec/folder-roles.md`, section "Roles"
- Severity: Minor. Each rule is small, and most hold by construction today.
- Category: tests
- Problem:
  - The stored title is kept by a save without a change: only `e2e/edit-page.spec.ts`.
  - A page over a limit can be moved, renamed, deleted and restored: the move only in
    `e2e/move-or-rename-page.spec.ts`, the delete and the restore in no test. The unit tests pass invalid content
    as an extra field of the input; a mock has no stored content, so they cannot fail for the reason their comment
    gives.
  - A Writer may revert: only `e2e/revert-page.spec.ts`; `revertPage()` is missing from the table of functions of
    the unit test.
  - The rename of a folder or tab leaves the versions of its pages as they are: no test.
  - `page-changed` through MCP for a page that was moved meanwhile, and the empty title of `storedResult()`: no
    test.
- Impact: a refactoring that sends every write of a page through one helper that validates would block the move,
  the delete or the restore of a page stored before a limit, and only the end-to-end test of the move would notice.
- Evidence: lines 1432–1433 of the unit test: "Content and other fields are ignored: no content rule can block a
  move.", followed by `const input = { ...VALID, content: "No heading", title: "Given title", folderId:
crypto.randomUUID() };`.
- Suggestion (required for the limits and the versions, optional for the rest): one integration case each, and
  `revertPage()` in the tables of the unit test.
- Confidence: High. All are additions that name their test, and the helpers of the tests create such pages already.

#### issue: tests that assert less than their name says

- Location: `src/features/pages/service.test.ts`, lines 1895–1917, 2186–2200 and 2223–2229;
  `src/features/mcp/tools.test.ts`, lines 174–179, 400–406, 486–488 and 883–884;
  `src/features/folders/service.test.ts`, lines 1091–1102; `integration/page-service.test.ts`, lines 1098–1124
- Severity: Minor. None hides a known defect; each stays green after the change it is named for.
- Category: tests
- Problem: a test named for four reads never calls `getPage()`. Four tests of the tools assert only that the answer
  holds the name of the tool, and "an unknown tool is not found" uses `delete_page`, which is a real tool now and
  unknown only because the default actor is a Reader. One test of a refusal asserts only that a mock was called
  once. For an allowed role one test expects only "not `not-allowed`", so `failed` passes. `revertPage()` is
  missing from the table of writes, so a malformed actor id is untested for it. The integration test of an admin
  leaves out one list, the move, the revert and the three reads of the history.
- Impact: the SDK could start to answer an unregistered tool with a normal result that repeats its name, and the
  four tests would pass.
- Evidence: `src/features/mcp/tools.test.ts`, lines 404–405: `expect(JSON.stringify(answer)).toContain(
"delete_page");` and `expect(mocks.getPage).not.toHaveBeenCalled();`.
- Suggestion (required): assert the error of the answer in the four tests, with a name that no connection has;
  call `getPage()` or rename the test; expect a real outcome for an allowed role; add `revertPage()` to the table;
  extend the test of the admin.
- Confidence: High. Each is a local change of a test, checked against the cited lines.

#### suggestion: small gaps in the parity of the tests of the two adapters

- Location: `src/features/mcp/tools.test.ts`, describes "create_page" and "replace_page_content";
  `src/features/folder-roles/actions.test.ts`, lines 160–185
- Severity: Minor. The mapping of the codes itself is complete in both adapters.
- Category: tests
- Problem: "answers a failing database with a tool error that does not pass on the error, and logs it" exists for
  seven of the nine tools, not for the two write tools used most. That a result is given twice, as text and as
  structured content, is asserted for four tools. The codes `last-owner`, `role-not-found` and `failed` of
  `changeRole()` are tested for a change, not for a removal.
- Impact: a write tool that passes the wrong message for a failure, or the error of the database, goes unnoticed
  for `create_page` and `replace_page_content`.
- Evidence: a search of the test for `mcp tool failed` gives seven hits, none in the two describes.
- Suggestion (optional): one table over all nine tools for the failing database and for the result given twice,
  and the table of errors of `changeRole()` for both intents.
- Confidence: High. Additions that follow the pattern of the file.

#### issue: fixtures and builders of mocks are copied between the test files, and the tests of the services mix every concern

- Location: the three `service.test.ts` files and the `actions.test.ts` and `queries.test.ts` files of the content
  features; `integration/page-service.test.ts`; `integration/folder-service.test.ts`
- Severity: Minor. A cost of maintenance, not a risk of behaviour.
- Category: tests
- Problem: the unit tests have no shared module of helpers. `RedirectError` is defined in 12 test files, the
  builders of database errors in up to five, and the ids and actors are the same in three. The tables of writes,
  of messages and of functions are copied between the tests of pages and folders. In the integration tests the
  read of a stored page appears 40 times, the creation of the user "bob" 52 times, and `revisionsOf()` is defined
  twice with different fields. The pages test has 2,230 lines, with the roles spread over four describes.
- Impact: a new write or role has four tables in two files, and `revertPage()` was forgotten in three already. The
  premise "at most Writer" of the finding above lives in three copies.
- Evidence: the counts come from searches over the named files.
- Suggestion (optional): a module of test helpers for the unit tests, left out of the coverage, with the builders,
  the actors and one table of all content writes; helpers for a stored page and an MCP actor for the integration
  tests; a split of the pages test into reads, history, writes and access.
- Confidence: Medium. The duplication is counted; where the helpers live and how the file is split is a trade-off.

#### nit: a race test waits up to 10 and 20 seconds inside a test that times out after 5

- Location: `integration/folder-service.test.ts`, lines 985–1021, "never leaves a page created at the same time in
  a missing tab"; `vitest.config.ts`
- Severity: Nit. Only the message of a failure on a slow runner.
- Category: tests
- Problem: the test polls with a timeout of 10 seconds and opens a transaction with one of 20, has no timeout of
  its own, and the project sets only the timeout of hooks. The default for a test of the installed Vitest is 5
  seconds.
- Impact: on a slow runner the test ends with a general timeout while its transaction is still open, not with the
  message of the poll.
- Evidence: line 1006: `await expect.poll(waitingForLocks, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);`.
- Suggestion (optional): give the test a timeout above its inner ones.
- Confidence: High. A fix of one line; the default was read in the installed package.

#### Reviewed

- The rules of writes that store nothing are proven against the real database, with the whole row compared before
  and after: the content save with line breaks, an older version, a deleted page and the limits; the move to the
  own name and place; the rename of a folder or tab to its own name, with the name stored at the moment of the
  save and with MCP; the change to the same role. The unit tests assert every log line of these cases.
- The refusals of optimistic locking for save, move, delete and revert, with a strict comparison of the result and
  of the untouched row, including "changed, not taken" and the restore without a version.
- The last Owner with a real race, and the trigger of the database against roles of admins.
- The delete of a tab: the rollback with a trigger, a race with a held lock, 300 pages, and MCP.
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

#### issue: `testing.md` says the production run covers `error.tsx` and `global-error.tsx`, but no test renders them

- Location: `spec/testing.md`, section "End-to-end tests"; `src/app/error.tsx`; `src/app/global-error.tsx`
- Severity: Minor. The error pages are the fallback of every failure, but they hold no logic of the wiki.
- Category: tests
- Problem: no spec makes a route fail, so neither error page is rendered in a run, with or without
  `HIPPOWIKI_E2E_SERVER=production`. Neither has a unit test. The sentence in `testing.md` promises a cover that does
  not exist.
- Impact: a broken error page, for example after an upgrade of Next.js, shows only in production during an outage,
  and the spec gives a false assurance to whoever plans the refactoring.
- Evidence: `testing.md` says: "This run covers what only exists in a production build: prerendering and the route
  cache, the minified client bundles, `error.tsx` and `global-error.tsx` (hidden by the development error overlay)".
  A search of `e2e/` for `went wrong`, `global-error` and `Try again` gives no hit.
- Suggestion (required): bring the spec and the tests in line, in one of the two ways under Alternatives.
- Confidence: Low. It needs a decision on whether a test may break a read of the shared test database.
- Alternatives:
  - Correct `testing.md`: the error pages are covered by no test, and why.
  - Add a test for the production run that makes one read fail and checks the page and "Try again". It must restore
    the database even when it fails, or every later spec fails with it.

#### issue: `/users` and `/change-password` are missing from the protected addresses of `access.spec.ts`

- Location: `e2e/access.spec.ts`, lines 29–68, `PROTECTED_ADDRESSES`; `spec/testing.md`, section "End-to-end tests"
- Severity: Minor. Both addresses are tested in their own specs, but more weakly.
- Category: tests
- Problem: `testing.md` says that `access.spec.ts` checks "every kind of address" and that "a new route adds its
  address there". The list holds neither `/users`, nor its dialog, nor `/change-password`. Their own specs only
  follow the redirect in the browser; they do not check that the answer is a redirect that sends nothing of the page.
- Impact: a change of the proxy that lets `/users` render before it redirects, with every user name in the HTML,
  would pass.
- Evidence: the only hit for `/users` in `e2e/access.spec.ts` is line 323, in the test of the way back of an admin.
  `e2e/users.spec.ts`, lines 478–483, has `await page.goto("/users"); await expect(page).toHaveURL("/login?next=%2Fusers");`.
- Suggestion (required): add the user list, the dialog `/users?action=create` and `/change-password` to
  `PROTECTED_ADDRESSES`. `CONTENT_ADDRESSES` filters on `/folders` and `/deleted-pages`, so the tests of the admin
  stay as they are.
- Confidence: High. One fix, no behaviour change; the redirects are already asserted in `e2e/users.spec.ts` and
  `e2e/change-password.spec.ts`, and the new cases prove themselves.

#### issue: a deleted page is checked on two of the addresses that could show it

- Location: `e2e/deleted-pages.spec.ts`, lines 52–57, "the old address of a deleted page shows the not-found page";
  `e2e/move-or-rename-page.spec.ts`; `e2e/restore-page.spec.ts`; `spec/page-deletion.md`
- Severity: Minor. One lookup serves every view today, so the gap opens only when that changes.
- Category: tests
- Problem: the old address is checked plain and with `?action=edit`. Not checked: `?view=history`,
  `?view=revision&revision=1` (also raw), `?view=compare`, `?action=move-or-rename`, `?action=delete`,
  `?action=revert&revision=1`, and the old address of a page deleted from a tab. Two more rules have no end-to-end
  test: moving or renaming a page onto the name of a deleted page (only creating is tested), and restoring into a tab
  that was deleted while the dialog was open.
- Impact: the history views read revisions through reads of their own in the service. If a refactoring gives them a
  page lookup of their own, a Reader could read the content of a deleted page as a raw revision, and no browser test
  would notice. The integration tests of the page service cover the reads, not the routes.
- Evidence: lines 55–56 hold the only two addresses:
  `await expectNotFound(page, "/folders/handbook/removed.md");` and the same with `?action=edit`.
- Suggestion (required for the views, optional for the rest): let the test loop over the views and actions, for a
  page deleted in the folder and one deleted from a tab. Add "a page can be renamed to the name of a deleted page"
  and "restoring into a tab that no longer exists shows an error".
- Confidence: High. The loops over `expectNotFound` are the pattern of the file.

#### issue: the functions of a Manager are refused for a crafted form of a Writer only for "delete tab"

- Location: `e2e/folder-roles.spec.ts`, describe "what each role may do", lines 229–310 and 343–369;
  `spec/folder-roles.md`, section "Roles"
- Severity: Minor. `mayDo()` decides centrally and is tested below the browser.
- Category: tests
- Problem: delete page, restore page, create tab and rename tab are submitted only as a Reader, two roles below the
  one that may. "Remove" of a role is not submitted as a Manager. As a Writer, only `/deleted-pages/handbook` is
  opened, not a deleted page or its restore dialog.
- Impact: a mistake that lowers one function of a Manager to Writer in an action or a route, not through `mayDo()`,
  passes the browser tests.
- Evidence: line 362, `await setOwnRole(folder, "writer");`, is the only submission as a Writer. Below the browser:
  `integration/page-service.test.ts`, "lets a Writer write pages but neither delete nor restore them, nor see the
  deleted pages".
- Suggestion (optional): turn `submitAsReader` into `submitAs(role, …)`, run the four forms of a Manager as a Writer,
  add the two addresses of a deleted page, and a crafted "Remove" as a Manager.
- Confidence: High. The helper exists, and the same forms already pass as a Reader.

#### issue: the "Give role" dialog and the roles view have states that no test reaches

- Location: `src/features/folder-roles/components/GiveRoleDialog.tsx`;
  `src/features/folder-roles/components/FolderRoleList.tsx`; `e2e/folder-roles.spec.ts`
- Severity: Minor. The service and the actions cover the codes; only the wiring of the components is unproven.
- Category: tests
- Problem: no test saves without a user ("Choose a user" at the field, with the focus on it), gives a role to a
  user who got one meanwhile, changes or removes a role that another Owner removed meanwhile, cancels the
  confirmation of "Change your role", or checks the focus after the dialog opens. The components have no unit tests.
- Impact: a refactoring of the dialog can break the simplest error of a user without a failing test.
- Evidence: a search of `e2e/` for `already has a role on the folder`, `no longer has a role` and `Choose a role`
  gives no hit; "Choose a user" appears only as the text of an option (line 537). Below the browser:
  `src/features/folder-roles/actions.test.ts` and `integration/folder-role-service.test.ts`.
- Suggestion (required): add the five cases to `e2e/folder-roles.spec.ts`; `createFolderRole()` and a delete of the
  row after the view opened set up the two races.
- Confidence: Medium. The states were read in the code; the accessible description of the select was not tried.

#### issue: the revert dialog has one locking case in the browser, and two locking rules have none

- Location: `e2e/revert-page.spec.ts`, lines 140–169; `spec/optimistic-locking.md`, sections "Which changes are
  refused" and "What the browser shows"
- Severity: Minor. The tests of the actions and of the service cover the codes.
- Category: tests
- Problem: unlike edit, move and delete, a revert has no test for a submission without a version, for a rename
  meanwhile (the dialog again at the new address), for a page deleted meanwhile, or for a page in a tab. Two rules
  have no test in the browser at all: the role is checked before the version, and a move to a taken name that rests
  on an older state is refused as changed, not as taken.
- Impact: the redirect of a revert carries the parameter `revision`, which the other three do not. A refactoring of
  the shared handling of the notice can break only the revert.
- Evidence: a search of `e2e/revert-page.spec.ts` for `VERSION_FIELD`, `no longer exists` and `Escape` gives no
  hit. Below the browser: `src/features/pages/actions.test.ts` and `integration/page-service.test.ts`, "gives
  page-changed, not name-taken, for an older version and a taken name".
- Suggestion (optional): add the three cases to `e2e/revert-page.spec.ts` and the taken name on an older version to
  `e2e/move-or-rename-page.spec.ts`.
- Confidence: High. The same cases exist for the three other actions, for example in `e2e/delete-page.spec.ts`.

#### issue: the pending state of the forms and dialogs is tested nowhere

- Location: every dialog and form with a pending state, for example
  `src/features/folders/components/NameDialog.tsx`, `src/features/pages/components/PageForm.tsx`,
  `src/features/pages/components/MoveOrRenamePageDialog.tsx`, `src/features/pages/components/NewPageForm.tsx`,
  `src/features/folder-roles/components/GiveRoleDialog.tsx`, `src/features/oauth/components/ConsentForm.tsx`
- Severity: Minor. It is the guard against a double submission; no spec names it, and no test at any level sees it.
- Category: tests
- Problem: while a submission runs, each component disables its buttons, ignores Escape and changes the label
  ("Saving…", "Deleting…", "Reverting…", "Revoking…", "Creating…"). No test holds a submission open.
- Impact: a refactoring that drops `disabled={pending}` or the guard of Escape passes every test. This matters for
  the finding on the copied dialogs under "Code: components, routes, auth, users and lib": a shared dialog would
  move exactly this code.
- Evidence: a search of `e2e/` for the five labels gives no hit.
- Suggestion (optional): one test per pattern that holds the request of the Server Action with `page.route()`, with
  a helper in `e2e/support/browser.ts`.
- Confidence: Medium. Holding a Server Action with `page.route()` was not tried with this version of Next.js.
- Alternatives: say in `testing.md` that pending states are left untested on purpose.

#### issue: an end-to-end test asserts a wall-clock time

- Location: `e2e/page-history.spec.ts`, lines 364–374, "two completely different revisions at the length limit
  answer within a few seconds"
- Severity: Minor. It can fail a run without a defect.
- Category: tests
- Problem: the test measures `page.goto()` and the wait for hydration and expects less than five seconds. The time
  includes the compile of the route by `next dev` when the test runs alone, and the load of the runner. `testing.md`
  itself says that a budget measured next to other work says nothing about the code.
- Impact: CI retries twice and fails on a flaky test, so one slow first attempt fails the run.
- Evidence: `const start = Date.now();` … `expect(Date.now() - start).toBeLessThan(5_000);`. The cap of the diff
  already has a budget test, `src/features/pages/diff.cost.test.ts`.
- Suggestion (required): drop the measurement and keep the assertion on "These revisions are too different to
  compare."; the timeout of `expect` still bounds the wait.
- Confidence: Medium. The flakiness is reasoned, not observed.
- Alternatives: keep a budget far above the noise, with a comment.

#### issue: helpers are copied between the specs, and the copies have drifted

- Location: `expectNotFound()` in 14 specs, `by()` in 8, the MCP `callTool()` in `e2e/mcp.spec.ts` and
  `e2e/delete-tab.spec.ts`, `setOwnRole()` in `e2e/folder-roles.spec.ts` and `e2e/revert-page.spec.ts`, the login
  helpers in three specs, and the base address `http://localhost:3100` in 12 places outside one constant
- Severity: Minor. Duplicated code with the first signs of drift.
- Category: tests
- Problem: `e2e/support/` has no helper for the not-found page, for the line "by … via …", for a tool call or for a
  login, so each spec defines its own. The copies of `expectNotFound()` exist in four variants.
- Impact: a change of the not-found page or of the line of the last editor means editing up to 14 files, and in the
  copies without a message a failing loop does not name the address.
- Evidence: `e2e/folder-roles.spec.ts`, line 19, `expect(response?.status(), address).toBe(404);`, against
  `e2e/folders.spec.ts`, line 21, `expect(response?.status()).toBe(404);`.
- Suggestion (optional): move `expectNotFound()` and `by()` to `e2e/support/browser.ts`, the login helpers to
  `e2e/support/auth.ts`, the tool call to a new module `mcp.ts` in `e2e/support/`, use the constant of
  `e2e/support/oauth.ts` for the base address, and list the helpers in `testing.md`.
- Confidence: High. A pure move; the two extras of single specs stay as local assertions.

#### issue: only the `page` of the fixture waits for hydration, second pages and contexts do not

- Location: `e2e/support/test.ts`, lines 16–34; `e2e/support/auth.ts`, `logInElsewhere()`; `e2e/login.spec.ts`,
  `openLoginFrom()`; about 25 places that open a second page or context; `spec/testing.md`, "Helpers in
  `e2e/support/`"
- Severity: Minor. Today the locked fields and buttons of the components make Playwright wait anyway.
- Category: tests
- Problem: the wait wraps `goto()` and `reload()` of the fixture page only. Other pages act right after `goto()`.
  One helper repeats the wait by hand with a CSS selector, because `waitForHydration()` is not exported.
  `testing.md` says "So no test acts on the locked, server-rendered page", which holds only for the fixture page.
- Impact: an action that no lock guards, on a second page, can run before hydration: green locally, red in CI.
- Evidence: `e2e/login.spec.ts`, lines 305–306: "Only the page of the fixture waits for hydration by itself",
  followed by `page.locator('html[data-hydrated="true"]').waitFor(…)`.
- Suggestion (optional): export a helper from `e2e/support/test.ts` that wraps `goto()` and `reload()` of any page,
  use it where second pages are opened, and correct the sentence in `testing.md`.
- Confidence: Medium. No current action was shown to run unhydrated; the fix is mechanical.

#### suggestion: "changed through MCP meanwhile" is simulated with a database row that MCP could not write

- Location: the tests "names the channel mcp…" in `e2e/edit-page.spec.ts`, lines 488–507,
  `e2e/move-or-rename-page.spec.ts`, lines 595–617, `e2e/delete-page.spec.ts`, lines 237–259, and
  `e2e/revert-page.spec.ts`, lines 149–154; the other direction in `e2e/mcp.spec.ts`, lines 889–910
- Severity: Minor. Each half is proven; only the join is simulated.
- Category: tests
- Problem: the tests set the content, the version and the channel by hand, and three of the four write no revision,
  a state the app never stores. No test runs a real `replace_page_content` while an editor is open in the browser,
  and none shows a revision of a real MCP call in the history of the browser.
- Impact: if a write of MCP stopped counting the version up, the tests of the notice "via mcp" would still pass.
- Evidence: `e2e/edit-page.spec.ts`, lines 493–501: `await getTestDb().page.update({ … version: { increment: 1 },
lastEditedById: bob.id, lastEditedVia: "mcp" } });`.
- Suggestion (optional): one test in `e2e/mcp.spec.ts` with a real tool call, then a save in the browser and the
  history view.
- Confidence: Medium. The building blocks exist in `e2e/mcp.spec.ts`; the test was not written.

#### issue: single states of other components have no test

- Location: `src/features/users/components/CreateUserDialog.tsx` and `src/features/mcp/components/McpAddress.tsx`
  (the copy failed); `src/features/oauth/components/ConsentForm.tsx` (the limit reached between the page and
  "Approve", and "Returning to the app…"); `src/features/folders/components/NameDialog.tsx` (a tab deleted while its
  rename dialog is open); Escape in the "Save page" dialog and in the revoke dialog
- Severity: Minor. Each is small; together they are the untested rest of the dialogs.
- Category: tests
- Problem: none of these states is rendered in an end-to-end test, and the components have no unit tests.
- Impact: the fallback of the copy button and the lock of the consent form can break unnoticed.
- Evidence: a search of `e2e/` for `could not be copied`, `Copy failed`, `Returning to the app` and `most allowed`
  gives no hit. "Renaming a tab deleted meanwhile shows the not-found page" is a decision in `folder-roles.md` that
  only `src/features/folders/service.test.ts` proves.
- Suggestion (optional): one short test each in the spec of the feature.
- Confidence: Medium. Whether the browser of the tests refuses the clipboard without a permission was not tried.

#### nit: 71 comments in the tests cite requirement IDs of files that no longer exist

- Location: 36 comments in `e2e/` (`edit-page.spec.ts` 11, `move-or-rename-page.spec.ts` 12, `delete-page.spec.ts`
  6, `mcp.spec.ts` 4, `folder-roles.spec.ts` 2, `restore-page.spec.ts` 1) and 35 in the unit and integration tests
  (`integration/page-service.test.ts` 19, `src/features/pages/service.test.ts` 6, six more files)
- Severity: Nit. Comments only.
- Category: tests
- Problem: the IDs `R1` to `R14` point into requirements files, which the wrap-up of a feature deletes; `spec/`
  holds none now. The same ID means a different rule from feature to feature.
- Impact: a reader cannot resolve the IDs. They look like traceability and are none.
- Evidence: `e2e/edit-page.spec.ts`, line 459, "R1: both open the editor; bob saves first.", against
  `e2e/mcp.spec.ts`, line 777, "R1, R2, R6, R7, R11: a move to the current name and tab …".
- Suggestion (optional): replace each ID with the section of the feature spec that holds the rule now, or drop the
  ID and keep the sentence. Add to the wrap-up in `step-plan-workflow.md` that requirement IDs leave the comments
  when the requirements file is deleted.
- Confidence: High. Text only; the sentences after the IDs already state the rule.

#### nit: `mcp.spec.ts` has 1,465 lines, and two specs hold tests that use neither browser nor server

- Location: `e2e/mcp.spec.ts`; `e2e/tabs.spec.ts`, lines 586–604, "the database refuses a page whose tab belongs
  to another folder"; `e2e/smoke.spec.ts`, lines 28–35
- Severity: Nit. A matter of structure.
- Category: tests
- Problem: `mcp.spec.ts` mixes the checks of the token, the binding to the address, the read tools, the write
  tools, the tools of a Manager and the parity with the browser. The two tests named run in the slowest suite and
  test a rule of the database.
- Impact: "the specs the change affects" is hard to pick for MCP.
- Evidence: the test in `e2e/tabs.spec.ts` takes no `page` and no `request`.
- Suggestion (optional): split `mcp.spec.ts` by access, read, write and Manager, and move the database test to
  `integration/db-errors.test.ts`.
- Confidence: Low. The split is a preference, and whether an integration test already covers that foreign key was
  not checked.

#### nit: a few assertions prove nothing, and the selector rule of `testing.md` names no exceptions

- Location: `e2e/folder-roles.spec.ts`, lines 309 and 1002; `e2e/users.spec.ts`, lines 324 and 338;
  `e2e/mcp.spec.ts`, line 633; `spec/testing.md`, section "End-to-end tests"
- Severity: Nit
- Category: tests
- Problem: two assertions compare local values that nothing can change. Field errors of the user dialog are found
  by text anywhere in the dialog, not at the field as in `e2e/folders.spec.ts`. One MCP assertion accepts any answer
  that holds the name of the tool. `testing.md` says elements are located "not by CSS selectors", while about 35
  calls of `locator()` exist, most for elements without a role.
- Impact: an error shown at the wrong place of a dialog passes, and the rule cannot be followed to the letter.
- Evidence: `expect([tab.name, intro.name]).toEqual(["guides", "intro"]);` and `expect(dave.type).toBe("user");`.
- Suggestion (optional): delete the two assertions, assert the field errors at the field, assert the JSON-RPC error,
  and name the exceptions in `testing.md` (`time`, the form for `requestSubmit()`, `data-change`).
- Confidence: Medium. The accessible description of the field joins several helper texts and must be read first.

#### Reviewed

- The newest rules are proven in the browser and at the server: "Save" of the rename dialogs disabled for the own
  name, with Enter without effect and nothing stored (`e2e/folders.spec.ts`, `e2e/tabs.spec.ts`); "Save" of "Move or
  rename page" disabled for the own name and place, also after a refused save
  (`e2e/move-or-rename-page.spec.ts`); a save without a change, with strict comparisons of the row and the
  revisions (`e2e/edit-page.spec.ts`); a change to the same role (`e2e/folder-roles.spec.ts`).
- Optimistic locking: two real browser contexts for save, move or rename and delete, a second tab of the same user,
  a rename meanwhile and a missing version, each with the address, the exact message, the stored content and a
  second confirm that succeeds. MCP has a first and a second writer and a refusal after an edit in the browser.
- Roles: each function is allowed for its lowest role and not found for the next lower one at its address; a change
  of a role holds from the next request on; the last Owner is kept.
- Admins never see content: `e2e/access.spec.ts` checks every content route with its views and actions.
- Parity of browser and MCP: the last editor and the channel after real MCP writes, the revisions MCP writes, the
  lower of the two roles, and a tab deleted in the browser as MCP sees it.
- Conventions: all 27 specs reset the database in `beforeEach` and import `test` and `expect` from the support
  module; there is no fixed wait and no `networkidle`; `e2e/hydration.spec.ts` has a case for every component that
  uses `useHydrated`.
- `testing.md` matches the configuration of Playwright, the global setup and the helpers in every statement
  checked, except the three named in the findings above.
- Every route under `src/app` has an end-to-end test except the two error pages.

### Documentation: the feature specs of the content

The seven specs of the content (`pages.md`, `content-structure.md`, `page-history.md`, `page-deletion.md`,
`optimistic-locking.md`, `folder-roles.md`, `mcp.md`) were read sentence by sentence against the code. The rules
that several of them state were compared with each other and with the code:

| Rule                                                 | Stated in                                                                                  | The specs agree                              | The code agrees       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- | --------------------- |
| A content save without a change stores nothing       | `pages.md`, `page-history.md`, `optimistic-locking.md`, `content-structure.md`, `mcp.md`   | Yes; two copies leave out the channel        | Yes                   |
| A rename of a folder or tab to its own name          | `content-structure.md`, `pages.md`, `mcp.md`                                               | Yes                                          | Yes                   |
| A move or rename of a page to its own name and place | `content-structure.md`, `pages.md`, `optimistic-locking.md`, `mcp.md`                      | Yes                                          | Yes                   |
| A change to the same role                            | `folder-roles.md`                                                                          | One place                                    | Yes                   |
| Who may delete a tab                                 | `folder-roles.md`, `content-structure.md`, `mcp.md`                                        | Yes                                          | Yes                   |
| What the roles of MCP may do                         | `mcp.md`, `folder-roles.md`, `content-structure.md`, `page-deletion.md`, `architecture.md` | No: `architecture.md` differs                | The seven specs yes   |
| The last editor and the channel                      | all seven                                                                                  | In part: see the two findings on the channel | The stored values yes |
| Who is stored for a page                             | `pages.md`, `content-structure.md`, `page-history.md`                                      | No: `pages.md` differs                       | The other two yes     |
| Deleting a tab counts the versions up, unchecked     | `content-structure.md`, `optimistic-locking.md`, `page-deletion.md`                        | Yes                                          | Yes                   |
| Restoring is unchecked and stores the channel `web`  | `page-deletion.md`, `optimistic-locking.md`                                                | Yes                                          | Yes                   |

#### issue: `pages.md` says only the last editor of a page is stored, but revision 1 stores who created it

- Location: `spec/pages.md`, section "Current limits"; `spec/page-history.md`, section "Revisions";
  `src/features/pages/service.ts`, lines 616–624
- Severity: Minor. False about which data of users is kept, but in a list of limits, and the spec that owns the
  rule is right.
- Category: docs
- Problem: the limit says no creator is recorded. Every new page gets revision 1 with the user who created it,
  kept for as long as the page exists.
- Impact: someone who answers from `pages.md` what the wiki stores about users answers wrongly.
- Evidence: "only the last editor of a page is stored, not who created it; recording who created it is not
  planned"; against `revisions: { create: { number: 1, …, userId: lastEditedById, via: lastEditedVia } }`.
- Suggestion (required): "the page itself stores only its last editor; its history keeps the user of every content
  change, so revision 1 names who created it (see `page-history.md`)".
- Confidence: High. The code and both other specs were read; one change of wording, covered by `npm run check`.

#### issue: `page-deletion.md` says every delete stores the channel `web`, but a delete through MCP stores `mcp`

- Location: `spec/page-deletion.md`, section "Restoring", last bullet; `spec/content-structure.md`, section "Last
  editor"; `src/features/pages/service.ts`, lines 969–977
- Severity: Minor. Wrong about a stored value; the same spec states it right two sections above.
- Category: docs
- Problem: the sentence covers deleting and restoring together. Only restoring is for the browser alone;
  `deletePage()` takes either actor and stores its channel.
- Impact: a reader concludes that a deleted page never shows "via mcp".
- Evidence: "Deleting and restoring a page each make the logged-in user its last editor, with the channel `web`";
  against `const lastEditedVia = storedChannelOf(actor);` in `deletePage()`.
- Suggestion (required): "Restoring makes the logged-in user the last editor of the page, with the channel `web`",
  and in `content-structure.md`: "The user is the one who is logged in, through MCP the user of the connection."
- Confidence: High. Both paths of the code were read; one fix.

#### issue: `mcp.md` names `delete_page` and `delete_tab` as the tools with `destructiveHint`, but `replace_page_content` carries it too

- Location: `spec/mcp.md`, section "Tools"; `src/features/mcp/tools.ts`, line 852
- Severity: Minor. Clients use the hint to decide whether to ask the user before a call.
- Category: docs
- Problem: the spec gives the three write tools of pages "the hints of a tool that writes" and keeps the hint of a
  tool that destroys for the two deletes. The code marks `replace_page_content` as destructive, and a unit test
  asserts it.
- Impact: someone who brings the code in line with the spec removes a warning that is meant.
- Evidence: "`delete_page` and `delete_tab` carry the hint of a tool that destroys (`destructiveHint`)"; against
  `annotations: { readOnlyHint: false, destructiveHint: true, … }`.
- Suggestion (required): add that `replace_page_content` carries the hint as well, because it overwrites the whole
  content.
- Confidence: High. The code and its test agree; one fix.

#### issue: `content-structure.md` sends `/` and the app bar to `/folders` for everyone, but an admin goes to `/users`

- Location: `spec/content-structure.md`, section "Routes", first bullet; `src/app/page.tsx`, line 12;
  `src/components/AppHeader.tsx`, lines 38–42
- Severity: Minor. A wrong statement about a route; `users-and-login.md` has it right.
- Category: docs
- Problem: the bullet has no condition. The home page branches on the type of the account, and the header hides
  "Folders" from an admin.
- Impact: the bullet contradicts "Only users see content" of the same spec.
- Evidence: "`/` redirects to `/folders`; the app bar links to `/folders`."; against
  `redirect(isAdmin(user) ? usersPath() : foldersPath());`.
- Suggestion (required): "`/` redirects a user to `/folders` and an admin to `/users`; the app bar links a user to
  `/folders` (see `users-and-login.md`)."
- Confidence: High. Both files were read; one fix.

#### issue: the length limits that a user meets are not stated: 100,000 characters of content, 80 of a name, 200 of a title

- Location: `spec/pages.md`, sections "Content and title" and "The cost of the Markdown parse";
  `spec/content-structure.md`, section "Names"; `src/features/pages/limits.ts`; `src/lib/names.ts`
- Severity: Minor. `step-plan-workflow.md` asks for the numbers a user meets in the spec, next to a pointer; the
  limits of nesting and of table cells follow this, the lengths do not.
- Category: docs
- Problem: the specs state 20 levels and 10,000 cells, but "the content limit" appears six times without its
  number. No spec says that a title is cut to 200 characters, or that a heading without a letter or digit counts
  as no title.
- Impact: a user or the author of an AI app learns the limits only from an error message.
- Evidence: "Its length limit counts the content with plain line breaks"; against
  `export const CONTENT_MAX_LENGTH = 100_000;`.
- Suggestion (required): state the three numbers once each, with the constant, and the cut of the title.
- Confidence: High. The constants were read, and the additions follow the rule of the workflow.

#### issue: specs describe states from before a feature, and tell how features came about

- Location: `spec/content-structure.md`, sections "Last editor" and "Decisions"; `spec/optimistic-locking.md`,
  sections "The version of a page", "Editors and dialogs open over a deployment" and "Decisions";
  `spec/pages.md`, section "Current limits"; `spec/mcp.md`, section "Decisions"; `spec/page-deletion.md`, section
  "Decisions"; `spec/connected-apps.md`, section "Decisions"; `spec/architecture.md`, section "Database"
- Severity: Minor. A claim that matters to an operator, a migration that fails without an admin, has no code
  behind it.
- Category: docs
- Problem: the first migration creates the last editor, the version, the title and the types of an account
  together with the tables and moves no data. The states these sentences describe cannot arise from the migrations
  of the repository. Other sentences tell a history: "The plain `/mcp` was removed…", "The write tools were built
  before page history…", "It replaced the migrations that led there…". The sentences on the channel and on the
  first revision are different: their migrations exist, and they are true.
- Impact: an operator expects a migration to assign the admin or to fail, and a reader cannot tell a lasting rule
  from a note about a transition.
- Evidence: `content-structure.md`: "Migrating content without an admin fails and is rolled back."; the migration
  `init` in `prisma/migrations/` holds `"lastEditedById" UUID NOT NULL,` inside the `CREATE TABLE` of the pages and
  no statement that moves data.
- Suggestion (required): delete the sentences about states before the last editor, the version, the types of an
  account and derived titles, and write the told decisions as rules, for example "There is no plain `/mcp`
  address, so that there is one kind of MCP address."
- Confidence: Medium. The migrations were read; whether an installation older than the first migration exists and
  needs the notes was not checked.
- Alternatives: keep the notes about transitions in one place for upgrades.

#### issue: "the channel" has two sets of values, and the specs call one of them "the only two values"

- Location: `spec/content-structure.md`, section "Last editor"; `spec/folder-roles.md`, section "MCP";
  `spec/architecture.md`, section "Reads and writes"; `src/features/folder-roles/service.ts`, lines 36 and 51–61
- Severity: Minor. A matter of names, but an operator searches the log by it.
- Category: docs
- Problem: the stored and shown channel is `web` or `mcp`. The channel of the actor and of every log line is
  `browser` or `mcp`. The specs use one word for both and never say that the value in the log differs.
- Impact: an operator who filters the log for the channel `web` finds nothing.
- Evidence: "its channel: `web` for a change in the browser, `mcp` … These are the only two values."; against
  `export type Channel = "browser" | "mcp";`.
- Suggestion (required): one sentence in "Last editor": the log lines and the actor name the channel of the call,
  `browser` or `mcp`; only the stored channel says `web`.
- Confidence: Medium. The fix is clear; the same word in the log is a reasonable alternative.
- Alternatives: let the log lines say `web` as well, which changes output that an operator may filter on.

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
  is the text of `changedMessage()` in `src/features/pages/components/PageView.tsx`.
- Suggestion (optional): say what a message names and point to its function; drop the sentences on hydration and
  Enter; keep the list of protocols as a security rule and name its constant; keep only the bound that the cost
  test enforces.
- Confidence: Medium. Which statements are guarantees to keep is a judgement.

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

#### nit: `pages.md` lists the health endpoint among its routes

- Location: `spec/pages.md`, section "Routes", last bullet; `spec/container-image.md`
- Severity: Nit. Misplaced and a copy, not wrong.
- Category: docs
- Problem: `/api/health` is no route of the pages, and `container-image.md` describes it.
- Impact: a third copy to keep in step.
- Evidence: "`GET /api/health`: `{ "status": "ok" }` while the database is reachable, status 503 and a logged
  error otherwise."
- Suggestion (optional): delete the bullet.
- Confidence: High. One fix.

#### nit: three pointers lead one step past their target

- Location: `spec/mcp.md`, the introduction; `spec/optimistic-locking.md`, the paragraph on the code;
  `spec/content-structure.md`, section "Addresses"
- Severity: Nit
- Category: docs
- Problem: `mcp.md` points to `content-structure.md` for the view "AI apps", which `folder-roles.md` describes.
  `optimistic-locking.md` names three functions for the check and leaves out `revertPage()` and
  `storeContentChange()`, where the check of a content save lives. `content-structure.md` says "The rest of the
  root belongs to the app (`/api` today)", while the app has seven more roots.
- Impact: a reader follows two hops or reads an example that is out of date.
- Evidence: "its view "AI apps" (see `content-structure.md`)".
- Suggestion (optional): point `mcp.md` to `folder-roles.md`, name the two functions, and drop the example or
  point to `src/app/`.
- Confidence: High. Each target was opened.

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
- `content-structure.md`: "Overview", "Names" apart from the missing length, "Actions and views", both sections on
  changes that change nothing, "Deleting a tab" and "Lists and order" match the code.
- `page-deletion.md` and `pages.md` match the code apart from the findings above.
- Every heading of a section that one of the seven specs cites in another spec exists under that name.

### Documentation: architecture, testing, catalog and workflows

#### issue: `architecture.md` says deleting pages and the writes of tabs take only the actor of the browser, but MCP does them

- Location: `spec/architecture.md`, section "Reads and writes"; `src/features/pages/service.ts`, lines 969–970,
  `deletePage()`; `src/features/folders/service.ts`, lines 376–377, 427–428 and 497–498, `createTab()`,
  `renameTab()` and `deleteTab()`; `src/features/mcp/tools.ts`, lines 631, 679, 711 and 750
- Severity: Major. A false statement about what a caller other than the browser may delete, in the document that
  reviews and coding agents check the code against. `mcp.md` and `folder-roles.md` state it right.
- Category: docs
- Problem: the sentence has been out of date since the tools of a Manager exist. The four writes take
  `ContentActor`, and the MCP tools call them. Only for the browser are creating and renaming a folder, reverting
  and restoring a page and the reads of the history. The writes of roles take a plain `Actor`. The same section
  speaks of "the token service", which does not exist; it means the grant service.
- Impact: an agent that adds or reviews a tool gets a wrong picture of which writes MCP reaches, and a review
  that follows the spec misses four paths of writes or reports them as a hole.
- Evidence: "Creating a page, saving its content and moving or renaming it take either; deleting and restoring
  pages and the writes of folders, tabs and roles take only the actor of the browser."; against
  `export async function deletePage(actor: ContentActor,`.
- Suggestion (required): "The type of the first argument says which channel a function accepts: `ContentActor`
  for what MCP may do as well, `BrowserActor` for what only the browser does (creating and renaming folders,
  reverting, restoring, the reads of the history). Which tools exist is in `mcp.md`." State the writes of roles
  after the finding on their actor under "Code: services of the content features" is decided, and write "the
  grant service".
- Confidence: High. The signatures and the four calls of the tools were read; one fix without a change of
  behaviour, covered by `npm run check`.

#### issue: three documents disagree on when the complete end-to-end suite runs before a commit or a push

- Location: `CLAUDE.md`, section "Running the Checks"; `spec/step-plan-workflow.md`, sections "When a step is
  done" and "Changes to documentation only"; `spec/roadmap.md`, "Sharding the end-to-end tests"
- Severity: Major. These are the instructions that decide what an agent runs before it commits and pushes to
  `main`.
- Category: docs
- Problem: `CLAUDE.md` asks for the complete suite before every commit. `step-plan-workflow.md` commits every step
  except the wrap-up after only the affected specs, and frees a wrap-up that changes only documentation. All five
  items of the wrap-up template are documentation, so in a normal plan the complete suite never runs locally. The
  same file and the roadmap still assume that it runs once per plan.
- Impact: an agent either runs the suite of five minutes at every step, or pushes a plan whose complete suite ran
  only in CI, and the author cannot tell which is meant.
- Evidence: `CLAUDE.md`: "Before the work is finished, committed or pushed, run the complete `npm run test:e2e`
  once."; `step-plan-workflow.md`: "In every step except the wrap-up, only the specs the step affects", "When the
  wrap-up step changes only documentation, the complete end-to-end suite does not run locally before the push" and
  "The complete suite of the wrap-up still covers all features."; `roadmap.md`: "the complete suite runs about once
  per plan".
- Suggestion (required): decide the rule once, state it only in "When a step is done", and reduce `CLAUDE.md` to
  a pointer.
- Confidence: Low. It needs the decision of the author.
- Alternatives:
  - The complete suite runs once per plan, in the last step that changes anything but documentation.
  - The complete suite always runs in the wrap-up, which costs five minutes per plan.
  - CI is relied on, and every document says so.

#### issue: single statements of `architecture.md` that the code contradicts

- Location: `spec/architecture.md`, sections "Layout", "Reads and writes", "Addresses and actions", "Database" and
  "UI"
- Severity: Minor. Each is small; together they make the document unreliable.
- Category: docs
- Problem:
  - "The name dialog … is shared by folders, tabs and pages": only the routes of folders and tabs use
    `NameDialog`; pages use `MoveOrRenamePageDialog`.
  - "`limits.ts` holds the field length limits: for pages, so that `schema.ts` can import `derive.ts` without a
    cycle": the schema does not import `derive.ts`; the head of the file gives the real reason, and it also holds
    the number of revisions per page, which is no length.
  - "Every model has a UUID id generated by PostgreSQL": `AuthSecret`, `LoginAttempt`, `LoginWindow` and
    `OAuthRegistrationWindow` have other keys.
  - "only `service.ts` calls `getDb()` … The health route … is the one exception": `src/lib/auth.ts` calls it as
    well, for Better Auth; the section "Linting" allows `src/lib/` correctly.
  - "A read that the actor may not do returns `null`, a list included, without asking the database": true for an
    admin; for a user without a role the role is looked up first.
  - "The messages live in `actions.ts`, and each action has its own message for `failed`": three actions of pages
    share one message, and the message of a taken name lives in `src/lib/names.ts`.
  - "Three kinds of addresses carry other search parameters": the history, a revision, a comparison, the revert
    dialog and the app to revoke carry parameters of their own as well.
  - The routes read the notice "with `parsePageNotice()`": they call `parsePageQuery()`.
- Impact: an agent reuses the wrong dialog, expects a UUID on a table without one, or takes the list of
  parameters for closed.
- Evidence: `prisma/schema.prisma`, line 370, `id Int @id @default(1)`, and line 393,
  `@@id([username, clientAddress])`; `src/lib/addresses.ts`, line 239, `?view=history&before=${before}`.
- Suggestion (required): correct each sentence in its place; for the parameters, replace the count with the rule
  that each is built by a helper of `src/lib/addresses.ts` and read with a parser, and that an unknown value is
  not found.
- Confidence: High. Each statement was checked against the code; the fixes are wording only.

#### issue: the list of codes of a `Result` is incomplete and names the wrong services

- Location: `spec/architecture.md`, section "Reads and writes"; the union types of the services
- Severity: Minor. Wrong reference material, no wrong behaviour.
- Category: docs
- Problem: "the codes of the content" leave out `not-allowed`, which every content write returns. `limit-reached`
  is given to "the users, auth and grant services" but exists only in the OAuth service. The codes of the roles
  (`user-not-found`, `role-taken`, `role-not-found`, `last-owner`), of OAuth and of the check of a token are
  missing. The list restates union types and goes stale with every feature.
- Impact: an agent that writes a `switch` of an action copies an incomplete list.
- Evidence: "the users, auth and grant services add codes such as `not-allowed`, `busy`, `invalid-credentials`,
  `wait`, `limit-reached` and `grant-not-found`"; against `src/features/oauth/service.ts`, line 443,
  `type LimitReached = { code: "limit-reached" }`.
- Suggestion (required): keep the rule and drop the list: each write declares its codes in a union type next to
  it, and the lint rule for exhaustive switches makes every adapter handle each one.
- Confidence: High. The codes of the seven services were compared, and the lint rule is active.

#### issue: the rules for queries and actions are written for all features, but only the content features follow them

- Location: `spec/architecture.md`, sections "Layout", "Reads and writes" and "Login and sessions";
  `spec/users-and-login.md`, section "Authenticated access only"; `src/features/mcp/queries.ts`;
  `src/features/oauth/queries.ts`; `src/features/auth/actions.ts`; `src/app/oauth/authorize/page.tsx`
- Severity: Minor
- Category: docs
- Problem: "Every query first awaits `connection()` … then `requireUser()` … and then calls the service read of
  the same name": `listMcpAddresses()` is synchronous and calls no service, and `loadConsent()` has no read of its
  name. "Every Server Action first" calls `requireUser()`: `logIn()` and `logOut()` call neither. "On success it
  calls `revalidateContent()`": the actions of users, grants and auth revalidate their own paths. "Every page
  calls `requireUser()` first, before it reads the query string": the consent page and the login page read the
  query first. A service "knows nothing about … addresses": the services of grants and OAuth build the public
  address of a folder.
- Impact: an agent that adds a query to another feature forces the pattern where it does not fit, or copies an
  exception without knowing that it is one, and a reviewer who goes by the sentence reports `logOut()` as a hole.
- Evidence: `src/features/auth/actions.ts`, lines 127–128: `export async function logOut(): Promise<void> { const
result = await authService.logOut(await headers());`.
- Suggestion (required): state the scope, "for the queries and actions of a page behind the login", and add one
  bullet of exceptions that names each case with its reason.
- Confidence: Medium. The deviations were checked; whether to write them down or to change the code is a choice.

#### issue: `testing.md` does not match the integration tests it describes

- Location: `spec/testing.md`, sections "Unit tests" and "Integration tests"; `integration/db-errors.test.ts`;
  `integration/folder-role-service.test.ts`
- Severity: Minor. The document is the convention that a new test is written from.
- Category: docs
- Problem: the list of unique constraints "recognised by its constant" leaves out `PAGE_REVISION_NUMBER` and
  `FOLDER_ROLE_USER`, and the tested trigger against roles of admins. "One file per service" names two files and
  not the integration test of the folder roles. The helper `createRevisions()` and the direct writes of the tests
  are not named. How races and rollbacks are tested, with a trigger that raises, a held row lock and rounds of
  `Promise.all`, is described for auth and OAuth and not for the content. The bullets on `npm run check`, on
  `npm run check:all` and on the coverage stand under "Unit tests".
- Impact: a new unique constraint or service gets no integration test, because the list looks complete.
- Evidence: "(`FOLDER_NAME`, `TAB_NAME`, `PAGE_NAME`, `GRANT_ACCESS_TOKEN_HASH`, `OAUTH_CLIENT_METADATA_URL`,
  `OAUTH_CODE_HASH`)"; `integration/db-errors.test.ts` tests nine constants.
- Suggestion (required): point to `src/lib/db-errors.ts` in place of the list, write "one file per service in
  `integration/`", add the helper and one bullet on races and rollbacks, and move the bullets on the commands to a
  section of their own.
- Confidence: High. Both sides were read, and a pointer removes the copy that went stale.

#### issue: `tech.md` and `architecture.md` describe a search that does not exist, and `tech.md` leaves out the Markdown parser

- Location: `spec/tech.md`, sections "Core", "Data & Backend", "Tooling" and "Later Aspects";
  `spec/architecture.md`, section "Database"; `package.json`
- Severity: Minor
- Category: docs
- Problem: `architecture.md` says "search uses PostgreSQL full-text search directly", and `tech.md` "for search
  use Postgres full-text search". No search exists in `src/` or `prisma/`; it is an entry of the roadmap.
  `tech.md` lists `diff` but not `markdown-it` and its footnote plugin, "the only Markdown parser of the wiki"
  according to `pages.md`. "Later Aspects" repeats five entries of the roadmap, one of them decided since.
  "Podman: instead of Docker for development" is too narrow: Podman also builds the image and runs in CI.
- Impact: an agent asked about the search looks for code that is not there, and one that chooses a Markdown
  library does not see that one is set.
- Evidence: `package.json` holds `"markdown-it": "^15.0.3"`; `tech.md` does not name it.
- Suggestion (required for the search and the parser, optional for the rest): say in `architecture.md` that the
  search is not built, add the parser to `tech.md`, and reduce "Later Aspects" to a pointer to the roadmap.
- Confidence: Medium. The facts were checked; removing "Later Aspects" drops text the author may want to keep.

#### issue: the README names 8 of 11 feature specs and no page history

- Location: `README.md`, sections "What the prototype can do" and "Getting started";
  `spec/step-plan-workflow.md`, section "Wrap-up step"
- Severity: Minor
- Category: docs
- Problem: the list of specs leaves out `spec/page-history.md`, `spec/folder-roles.md` and
  `spec/optimistic-locking.md`, and the text names neither the history nor that a save on an outdated page is
  refused. The wrap-up asks only to check "that `README.md` has all the commands a developer needs", so nothing
  keeps these paragraphs up to date. "Getting started" uses `npm run db:migrate`, which can create a migration,
  where the other two places use `npm run db:deploy`.
- Impact: a reader of the README does not learn about a main feature, and the list gets older with every feature.
- Evidence: "What is built is described in `spec/`: `spec/content-structure.md`, `spec/pages.md`,
  `spec/page-deletion.md`, `spec/users-and-login.md`, `spec/connected-apps.md`, `spec/mcp.md`, `spec/oauth.md` and
  `spec/container-image.md`."
- Suggestion (required): replace the list with a pointer to the catalog in `CLAUDE.md`, add one sentence on the
  history, use `npm run db:deploy`, and extend the item of the wrap-up to the summary of the features.
- Confidence: High. The three specs exist and are in the catalog.

#### issue: `.env.example` says that without the public URL "only API tokens work", but there are no API tokens

- Location: `.env.example`, lines 27–29, which the README and `container-image.md` point to;
  `src/features/mcp/http.ts`, lines 133–134
- Severity: Minor. It is the file an operator copies, and it promises a way in that does not exist.
- Category: docs
- Problem: without `HIPPOWIKI_PUBLIC_URL` every address below `/mcp` answers 404, as the README and
  `container-image.md` say. The comment contradicts them.
- Impact: an operator leaves the variable unset and expects access with a token.
- Evidence: "without it only API tokens work."; against `if (publicUrl === undefined) return refusal(404,
"not_found");`.
- Suggestion (required): "without it there is no OAuth and no MCP server".
- Confidence: High. No code accepts an API token, and `e2e/mcp.spec.ts` covers the behaviour. The file is no
  documentation by the rule for changes to documentation only, so the fix runs the full checks.

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

#### issue: the same rules of the workflow stand in three to five places, with small differences

- Location: `CLAUDE.md`, sections "Running the Checks" and "Reporting Review Issues";
  `spec/step-plan-workflow.md`, sections "When a step is done", "Wrap-up step" and "Step plan template";
  `spec/testing.md`; `README.md`; `spec/issue-report.md`
- Severity: Minor
- Category: docs
- Problem: what `npm run check` and `npm run check:all` hold, and "never next to `test:e2e`", stand in `CLAUDE.md`,
  `step-plan-workflow.md`, `testing.md`, the README and the head of `scripts/check.ts`. The list of the wrap-up is
  in `step-plan-workflow.md` twice. The summary of a review differs: `CLAUDE.md` asks for the counts per severity,
  `issue-report.md` also for the counts per confidence. The rule for documents, with the heading as Location and
  a quote as Evidence, exists only in `CLAUDE.md`, while `issue-report.md` is titled "How to Report Issues in a
  Code Review".
- Impact: the finding on the end-to-end suite above is the result of such copies, and a reviewer who follows only
  `issue-report.md` reports issues of documents with the wrong Location.
- Evidence: `CLAUDE.md`: "the overall verdict and how many issues there are at each severity level";
  `issue-report.md`: "the overall verdict, number of blockers vs. minor issues, and how many suggestions are High,
  Medium and Low".
- Suggestion (required for the two differences, optional for the rest): move the rules for documents and the one
  rule for the summary into `issue-report.md`, keep the rules of the checks only in "When a step is done", and let
  the template point to the list of the wrap-up.
- Confidence: Medium. Which document becomes the one source is the choice of the author.

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
- Impact: a rule inside a bullet of 17 lines is not found; the wrong sentence on the actors of MCP sits in exactly
  such a bullet.
- Evidence: the sentence on the actors quoted in the first finding of this section is line 10 of a bullet of 17
  lines.
- Suggestion (optional): split "Reads and writes" into the layers, the services, the actors with channels and
  roles, the queries, the actions and the callers other than the browser; turn the list of features into a table;
  state each repeated rule once.
- Confidence: Medium. A new structure with judgement calls; no statement changes.

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
- Impact: each is a second copy; the stale lists of codes and of constraints in the findings above are the same
  pattern one feature later.
- Evidence: `testing.md`: "`lock_timeout` of 2 seconds"; the constants `TRUNCATE_LOCK_TIMEOUT` and
  `TRUNCATE_ATTEMPTS` in `e2e/support/database.ts`.
- Suggestion (optional): keep a number where a user or an operator relies on it, once and with a pointer;
  elsewhere point to the file.
- Confidence: Low. Which numbers count as rules is a decision per item.

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

#### suggestion: rules that the code follows everywhere are not written down in `architecture.md`

- Location: `spec/architecture.md`, section "Reads and writes"
- Severity: Minor. Worth writing down before a refactoring.
- Category: docs
- Problem: a write that would store what is stored already stores nothing, keeps the last editor, the time and
  the version, answers like a stored change and is logged in a line of its own. This is built four times and told
  in three feature specs, but not once as a convention. The order of the checks is given as "actor first, then
  its ids, then its input, then writes"; the code has the admin, the actor id, the ids, the role, the input, the
  version and the write. There is no rule for where a helper lives that two services need. That the adapter of a
  caller other than the browser is always called `http.ts` is not said either.
- Impact: the next write without a change, or the next shared helper, is built a fifth time in a slightly
  different way.
- Evidence: the comment of `updatePageContent()` in `src/features/pages/service.ts`: "The checks come in the order
  role, content with the limits in force, version".
- Suggestion (optional): four bullets: the write that changes nothing, the full order of the checks, the home of a
  helper of two services, and the name of an adapter.
- Confidence: Low. Whether these become rules is a decision of design.

#### question: are two entries of the roadmap still open as written?

- Location: `spec/roadmap.md`, section "API and Integrations"
- Severity: Minor
- Category: docs
- Problem: "Bearer token sessions" names `users-and-login.md`, which speaks of a bearer token only for the MCP
  addresses, and OAuth access tokens already give clients other than a browser such access; the entry "Access for
  clients without OAuth" stands right below it. "Exact search-and-replace for MCP" is planned "after MCP per
  folder and role", which is built. No other entry of the roadmap describes something that is built.
- Impact: a requirements conversation started from the first entry would design something that exists in part.
- Evidence: "Bearer token sessions: sessions for clients other than a browser, sent in the `Authorization`
  header".
- Suggestion (optional): merge the first entry into the one below it and drop the condition of the second.

#### question: is a change outside a step plan committed?

- Location: `CLAUDE.md`, section "Git Handling"; `spec/step-plan-workflow.md`, section "Fixing a finding of the
  review report"; `scripts/check-doc-references.ts`
- Severity: Nit
- Category: docs
- Problem: `CLAUDE.md` names commits only for step plans, their steps and requirements, and forbids asking. For a
  finding with a High confidence, fixed on its own "without asking the user", nothing says whether it is committed
  or left in the working tree. The check of doc references does not cover the skills in `.claude/skills/`, which
  name two workflow files; a rename of one would break two skills unnoticed.
- Impact: an agent that fixes a finding on its own has no rule for the end of its work.
- Evidence: "Do not ask whether something should be committed or pushed, and do not offer to do so."
- Suggestion (optional): one line under "Git Handling" for a change outside a step plan, and the skills in the
  list of documents of the check.

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
- Problem: the ranges do not match the files as they are. Everything in `src/features/oauth/service.ts` from
  `checkAuthorizationRequest()` on is off by one line; `src/features/mcp/tools.ts`,
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

#### nit: `container-image.md` says the probe of the client address is skipped only for `/login` and `/api/health`

- Location: `spec/container-image.md`, section "Configuration", `HIPPOWIKI_LOG_CLIENT_ADDRESS`; `src/proxy.ts`,
  lines 61–63
- Severity: Nit. The probe does its job for the login; the list of exceptions is incomplete.
- Category: docs
- Problem: the probe runs only in the proxy and in the login action. The matcher of the proxy also lets the MCP
  addresses, the two public endpoints of OAuth, both addresses below `/.well-known/` and the static files pass
  without it.
- Impact: an operator who checks the reverse proxy for the limit of registrations waits for lines of the probe
  that never come.
- Evidence: "(with `"source":"proxy"`, the method and the path; not for `/login` and `/api/health`)".
- Suggestion (required): "not for the public addresses that pass by the proxy (the `matcher` in `src/proxy.ts`)".
- Confidence: High. The only two callers of the probe were read.

#### nit: `users-and-login.md` says `/` uses `landingPath()`

- Location: `spec/users-and-login.md`, section "The way back after a login"; `src/app/page.tsx`, line 12
- Severity: Nit. A wrong pointer, the same behaviour.
- Category: docs
- Problem: the spec says the rule is "used by the login, the password change, both of their pages and `/`". The
  home page redirects by the type of the account without it.
- Impact: someone who changes `landingPath()` expects `/` to follow.
- Evidence: `redirect(isAdmin(user) ? usersPath() : foldersPath());`; `landingPath()` is called only by the login
  page, the page of the password change and the auth actions.
- Suggestion (required): drop "and `/`".
- Confidence: High. All callers were listed.

#### nit: `container-image.md` says the admin setup "does not read the variable" when the admin exists

- Location: `spec/container-image.md`, sections "Admin setup" and "Configuration"; `scripts/admin.ts`, line 16
- Severity: Nit. The effect is as described; the wording about the code is wrong, and it differs from
  `users-and-login.md`, which says "does not look at the password".
- Category: docs
- Problem: the script reads the variable on every run and passes it on; the service returns before it looks at
  it.
- Impact: none at run time; two specs describe one thing in two ways.
- Evidence: `const result = await userService.ensureAdmin(process.env[VARIABLE]);`.
- Suggestion (optional): the wording of `users-and-login.md` in both places.
- Confidence: High. One wording, no change of behaviour.

#### nit: `oauth.md` lists the checks of an authorization request "in this order" without the checks of the length that come first

- Location: `spec/oauth.md`, section "The authorization request and the consent page";
  `src/features/oauth/service.ts`, lines 334–336 and 357–363
- Severity: Nit. Only a value that is too long is affected.
- Category: docs
- Problem: the list of the spec starts with `response_type`. Before it, a `state` of more than 2048 characters is
  refused and not sent back, and a `client_id` of more than 2048 counts as an unknown client.
- Impact: the developer of a client cannot explain an `invalid_request` without `state` from the spec.
- Evidence: `if (params.state !== undefined && state === null) return refuse("invalid_request", "state is too
long");`.
- Suggestion (optional): one sentence before the list that points to the limit in the schema of OAuth.
- Confidence: Medium. The nit of the first report on `oauth.md` argues against more constants in the spec.

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

1. Decide the open questions that other work depends on: where the rule "no deleted pages through MCP" lives, when
   the complete end-to-end suite runs, whether the writes of roles take only the actor of the browser, and how far
   the unit tests of the services are cut.
2. Fix the findings with a High confidence that change no code: the wrong statements of `architecture.md` and of
   the feature specs, `testing.md`, the README and the Locations of the first report.
3. Close the gaps of the tests before any refactoring: the access rules of the reads of the history, the rollback
   of a content save, the role before the version, the rules that only an end-to-end test covers, and the states
   of the dialogs that a shared frame would move.
4. Refactor the code in small steps, each with its checks: the `null` check of the two reads, the shared guards of
   a content write, one shape for a write without a change, the hooks and the frame of the dialogs, then the
   splits of the large files.
5. Restructure the documents last: one owner per rule in the feature specs, the sections of `architecture.md`,
   and the form of the catalog in `CLAUDE.md`.
