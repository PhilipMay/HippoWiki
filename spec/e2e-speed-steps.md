# Faster End-to-End Tests – Steps

## Goal

The end-to-end suite takes less time, locally and above all in CI, which runs it with one worker, while every
behaviour it checks stays checked at some level. Most of the time goes to pages that a test opens in the browser and
waits for until they have hydrated, and to logins through the login page, to check something that an HTTP request or a
unit or integration test checks as well. These checks move to the cheapest level that still shows the behaviour, and
the tests that check the same thing twice are merged.

Starting point, from the HTML report of a complete `npm run test:e2e` on 2026-11-22 with 4 workers: 1062 tests,
1163 s of summed test time, 5.3 min wall time. A test with `request` only, database reset included, takes 0.03–0.15 s;
a `page.goto()` with the wait for hydration 0.35–0.45 s; a login through the login page 0.5–1 s. The review behind
this plan estimates that about 420 s of the summed test time can go.

## Scope

- In:
  - A helper that checks the not-found page with an HTTP request, and its use for the not-found checks that only test
    how an address is read.
  - The unit and integration tests that are missing for a behaviour whose end-to-end test is removed, added before
    the removal.
  - Changes made by another user at the same time, set up in the database instead of in a second browser with a
    login of its own, where the second browser shows nothing the test needs.
  - Failed logins counted in the database instead of submitted five times, outside `e2e/login.spec.ts`.
  - The rule of `testing.md` that tests on accounts of their own log in through the login page: checked, and relaxed
    if `resetTestDatabase()` makes it unnecessary.
  - Rule loops in the browser (password rules, OAuth errors, name rules, the title from the heading, crafted ways
    back) cut to one browser case per form.
  - Redundant tests merged or removed, and loops over roles cut where the code has no branch for the role.
  - Limits with heavy setup checked with a cheaper limit or on a lower level.
  - The descriptions in `testing.md` and the times of the suite after the change.
- Not in:
  - The files written from the spec alone (`*-spec-tests.spec.ts`): they belong to the `spec-tester` agent. Their
    overlaps are listed in the wrap-up for its next run.
  - Lower limits for the test servers, such as a shorter time limit of the search: the servers keep the default
    limits (see `testing.md`).
  - The number of workers, in CI or locally, and changes of `playwright.config.ts`.
  - `e2e/hydration.spec.ts`, `e2e/pending-states.spec.ts`, `e2e/security-headers.spec.ts` and `e2e/smoke.spec.ts`,
    which check one case per pattern on purpose.
  - Any change of the app itself.

## Rules for this plan

- A test or a part of a test is removed only when another test checks the same behaviour. The step names that test;
  the implementer reads it before the removal. When it does not check the behaviour, the step adds a test that does,
  at the lowest level that shows it, and names the change in the report of the step.
- At least one case of each kind of page stays in the browser: the not-found page, the login page, each form with its
  errors, each dialog.
- The estimates in the steps are summed test time from the report above. The first test of a spec often pays for the
  compile of a route by `next dev`; removing it moves that cost to the next test instead of removing it.

## Checklist

- [x] Missing lower-level tests
- [x] Not-found checks through HTTP
- [x] Access without a login
- [ ] Changes of other users without a second login
- [ ] Logins of accounts of their own
- [ ] Rule loops in the browser
- [ ] Redundant tests and role loops
- [ ] Limits with heavy setup
- [ ] Editor, wiki link and file specs
- [ ] Wrap-up

## Sessions

- Stop point after "Logins of accounts of their own".

## Missing lower-level tests

### Goal

Every behaviour that a later step stops checking end to end has a unit or integration test first.

### Build

Add these tests, each next to the tests of its module:

- Integration, `integration/folder-role-service.test.ts`: a Manager's change of a role to the role the user already
  has is refused as not allowed.
- Integration, `integration/page-service.test.ts`: a page can be created under the name and in the place of a deleted
  page.
- Integration, `integration/page-service.test.ts` or `integration/wiki-links-service.test.ts`: a save with 5,000 wiki
  links is stored, and its links are in the index of links.
- Integration, `integration/file-service.test.ts`: a file stays readable when a page that shows it is deleted.
- Integration: once a tab is deleted, the read tools of a Writer connection of MCP list neither the tab nor its pages,
  and a page can no longer be created in it (the service calls behind `list_folder` and `create_page`).
- Unit, `src/features/folders/folder-query.test.ts`: `folderAddressOf` reads `view: "All"` and `view: ""` as not
  found.
- Unit: `linkAddressAt` of `src/features/pages/editor/preview-plugin.ts`, exported for the test, with a relative link,
  a reference link, entities and escapes, and an unsafe address.
- Unit: the tooltip text of the toolbar of `EditorToolbar.tsx`, with its name and, where it has one, its shortcut.

### Test

- The new tests pass, and each fails when the rule it checks is broken in the code (tried once by hand, then undone).
- No end-to-end spec runs: the step changes only tests and an export.

## Not-found checks through HTTP

### Goal

The not-found checks that test how an address is read send a request instead of opening the page in the browser.

### Build

- Add `expectNotFoundResponse(request, address)` to `e2e/support/browser.ts`: it sends a `GET` with the cookies of the
  page (`page.request`), expects the status 404 and the HTML of the not-found page in one of the two forms that
  Next.js sends, in the development and in the production build: for an address that a route answers with
  `notFound()`, the error shell (`<html id="__next_error__">`), which holds no heading, with the digest of
  `notFound()` (`NEXT_HTTP_ERROR_FALLBACK;404`) in its payload, from which the browser renders the page; for an
  address that matches no route, the page rendered on the server, with the heading "Page not found" in the HTML with
  its `script` elements removed. It names the address in each assertion, like `expectNotFound()`. The heading alone
  tells nothing apart, because the payload of every page, a found one included, holds the heading of the not-found
  page.
- Keep `expectNotFound()` for the cases that show the not-found page in the browser: one in `e2e/pages.spec.ts`,
  with the banner and "Back to folders", and the cases that check what the page shows besides the heading, such as
  the plain title.
- In these specs, replace the not-found checks that only test the reading of an address with
  `expectNotFoundResponse()`, and merge the tests that each check one address into one test per spec that loops over
  the addresses after a single setup. Keep the addresses that depend on data, such as a name in the wrong place or a
  revision past the newest:
  - `e2e/tabs.spec.ts`: the 23 tests "… shows the not-found page"; keep the wrong places (`meetings/in-guides.md`,
    `guides/in-folder.md`, `other/guides/…`). About 12 s.
  - `e2e/pages.spec.ts`: the 21 tests "… shows the not-found page". Keep one of the addresses below `/pages`, which is
    a route the app no longer has, instead of four. About 10 s.
  - `e2e/folders.spec.ts`: the 13 not-found tests. About 7 s.
  - `e2e/deleted-items.spec.ts`: the 18 tests "… shows the not-found page", and in "every view and action of the old
    address of a deleted page" only the plain address of each page. About 10 s.
  - `e2e/all-pages.spec.ts`: the 12 tests "?view=… shows the not-found page". About 5 s.
  - `e2e/page-history.spec.ts`: the loops of "an invalid before…", "a missing, invalid or unknown revision number…",
    "a missing or invalid from or to…", the addresses of the Manager test and the loops per role; keep `before=6`,
    which `HistoryAddress.tsx` checks against the newest revision, `before=99999999999`, `missing.md`,
    `revision=4`, `to=6` and one address per role in the browser. About 14 s.
  - `e2e/move-or-rename-page.spec.ts`: the 9 not-found tests. About 4.5 s.
  - `e2e/folder-roles.spec.ts`: the loops of "the user sees the folder neither in the list nor at any of its
    addresses", "a Reader reads the folder…", "a Writer creates…", "Folder roles in the header…" and "…under the
    plain title", cut to one address per kind of route; the plain title is read from `<title>` in the HTML. About
    9 s.
  - `e2e/search.spec.ts`: "shows the not-found page for words that do not belong to the address", cut to two
    addresses. About 5 s.
  - `e2e/revert-page.spec.ts`: "the newest revision and an older one with the content of the page offer no Revert…",
    cut to `revision=5`. About 2.4 s.
  - `e2e/create-page.spec.ts`: the 5 tests of a preset name that is not found, covered by `tabAddressOf` "reads the
    preset name…". About 2 s.
  - `e2e/edit-page.spec.ts`: "a notice without an action…" and "editing an unknown page…", one address each. About
    2.5 s.
  - `e2e/file-details.spec.ts`: "the details page shows the not-found page for a missing file, a deleted one and any
    action", cut to two addresses; remove "a revert to the current version or to one that does not exist is not
    found", covered by `src/features/files/file-query.test.ts`. About 3.5 s.
  - `e2e/account.spec.ts`, `e2e/users.spec.ts` and `e2e/own-password-change.spec.ts`: the not-found tests of one
    address each, merged into one test per role.

### Test

- Unit tests of `expectNotFoundResponse()` are not needed: it has no logic of its own beyond Playwright calls. Check
  once by hand that it fails for an address that exists and for one that answers a plain 404, such as a missing file.
- The complete `npm run test:e2e` runs, because the step changes `e2e/support/`.

## Access without a login

### Goal

`e2e/access.spec.ts` keeps checking every kind of address and renders the login page and the not-found page only once
each.

### Build

- "… leads to the login page": keep the request with `maxRedirects: 0` for every address (status 307, the way back in
  `next`, nothing of the content in the body), and follow the redirect in the browser for one address only. The
  login page with `next` is covered by `e2e/login.spec.ts`. About 18 s.
- The admin tests "… shows the not-found page": use `expectNotFoundResponse()` for all but three addresses, and check
  that the HTML has no "Secret", and none of the names of the folder, tab and pages or "Updated" and "via" once its
  `script` elements are removed. About 15 s.
- Move the tests that only read into a `describe` whose content is created once in `beforeAll`; the tests that end
  sessions or submit actions keep their `beforeEach`. About 12 s.
- Remove "after a logout, the content leads to the login page": add its last `goto()` to "log out leads to the login
  page…" in `e2e/login.spec.ts`.
- Rule of `testing.md` that every new route adds its address to `access.spec.ts`: it stays, and the address is checked
  with the request.

### Test

- `npm run test:e2e -- e2e/access.spec.ts e2e/login.spec.ts`.

## Changes of other users without a second login

### Goal

A test of a change made at the same time by another user sets up that change in the database when the test does not
need the other user's browser.

### Build

- Replace `logInElsewhere()` with an update of the page in `getTestDb()` (content or name, the next version, the
  other user as last editor, via web), as the MCP tests and `e2e/revert-page.spec.ts` already do, in:
  - `e2e/edit-page.spec.ts`: "refuses a save without a change in an editor opened before another change" and "refuses
    the save after a rename…". Keep "refuses the save of the second editor…" as the one test with two browsers.
  - `e2e/move-or-rename-page.spec.ts`: "refuses the move after a content save…" and "refuses the rename after a
    rename by another user…"; in "an unchanged save of the dialog keeps the editor of another user…" use a second
    tab of the same context.
  - `e2e/delete-page.spec.ts`: "refuses the delete after a content save…" and "refuses the delete after a rename…".
  - `e2e/search.spec.ts`: "shows the results to another user with a role" and "…to a user without a role", with
    `setOwnRole()` or a folder created with the role of the other user.
- `e2e/folder-roles.spec.ts`: in "an Owner makes another user Owner…", check the stored role instead of logging in as
  that user.
- `e2e/account.spec.ts`: create the grants with `createGrant()` instead of approving them on the consent page in "an
  app connected through OAuth is listed…", "a user sees only their own apps…", "two connections of the same app…"
  and "a connection to the Manager address…"; keep `connect()` in "revoking asks first…", which needs a refresh
  token.
- `e2e/log-out-other-browsers.spec.ts`: in "closing the dialog with Cancel or Escape ends nothing", count the sessions
  in the database instead of logging in a second browser.
- Failed logins: add a helper to `e2e/support/database.ts` that stores the attempts of a name and an address as five
  failed logins leave them, and use it instead of five submitted logins in "once the wait is over…" and the test per
  address of `e2e/login.spec.ts`, in "after 5 the change waits…" of `e2e/own-password-change.spec.ts`, in "count
  like failed logins" of `e2e/change-password.spec.ts` and in "after 5 wrong passwords the next approval waits…" of
  `e2e/oauth.spec.ts`. Keep the five real submits in "after five wrong passwords the right one is refused" of
  `e2e/login.spec.ts`. Covered by `integration/auth-service.test.ts`.

About 35 s together.

### Test

- The complete `npm run test:e2e` runs, because the step changes `e2e/support/`.

## Logins of accounts of their own

### Goal

Tests that need a logged-in user log in through the login page only when the login itself is part of what they check.

### Build

- Check first whether the rule of `testing.md` still holds, that a test which changes a password or ends sessions uses
  an account of its own "so that the saved sessions of the known users stay valid": `resetTestDatabase()` creates the
  known users again with their passwords and restores their saved sessions before every test, and the tests of a
  worker run one after another. Try it with one test of `e2e/change-password.spec.ts` that changes the password of
  the known user, followed by a spec that uses the saved state, with one worker and with four.
- If the rule is no longer needed: drop it from `testing.md` and let the tests that change the password of the known
  user or the admin, or end their sessions, use the saved states. Set `mustChangePassword` on the row of the known
  user where a test needs a pending password change.
- Either way, use `USER_STORAGE_STATE` or `ADMIN_STORAGE_STATE` instead of a login in the tests that change nothing of
  the account: in `e2e/own-password-change.spec.ts` "…sees no such choice" (both), "the address of the dialog opens it
  directly…" and its not-found test; in `e2e/login.spec.ts` the three tests "a logged-in user/admin who opens the
  login page…"; and the tests of `e2e/access.spec.ts` that log in through the page.
- `e2e/change-password.spec.ts`: merge the 8 tests "…leads to the password change while it is pending" into one test
  with one login and 8 addresses; `src/features/auth/session.test.ts` covers `requireUser()`.
- Keep the login through the page in `e2e/login.spec.ts`, in one test of each password change and in the MCP tests
  "in the browser", which need the user of `setUpProjects()` because of the rate limit per user.

About 20 s if the rule goes, about 8 s otherwise.

### Test

- The complete `npm run test:e2e` runs with four workers, because the step decides whether the saved sessions survive a
  change of the known users. It is the complete suite of this session (see "Sessions").

## Rule loops in the browser

### Goal

The rules of an input are checked in the unit tests of their schema, and each form keeps one browser case for how it
shows an error.

### Build

- `e2e/change-password.spec.ts`: of the 9 rule tests keep "a repetition that differs" and "a wrong current password";
  covered by `src/features/auth/schema.test.ts` and `src/features/users/schema.test.ts`. Remove "a new admin with a way
  back into the content…" (`src/features/auth/actions.test.ts`) and "a crafted way back to another site … after the
  password change" (the crafted addresses of `actions.test.ts`). About 11 s.
- `e2e/own-password-change.spec.ts`: of the 7 tests "…is refused with the message of the forced change" keep one, as
  the same schema and the same fields are used. Remove "a admin opens the dialog … logs in with the new one" and "for
  a admin: an unknown action…" (`parseAccountNotice` in `src/lib/addresses.test.ts`). About 14 s.
- `e2e/oauth.spec.ts`: of the 8 tests "…shows the reason and returns to the client … only on a click" keep one with
  `invalid_request` and one with `invalid_target`; of the 4 "…sends the browser nowhere" keep one; remove both admin
  variants; in "a missing folder, a folder without a role and a role too low…" keep two resources. Covered by
  `integration/oauth-service.test.ts` and `src/features/oauth/queries.test.ts`. About 8 s.
- `e2e/login.spec.ts`: of the 4 tests "a crafted way back to another site (…)" keep `/\evil.example/`
  (`src/features/auth/forms.test.ts`, `actions.test.ts`, `src/lib/addresses.test.ts`). Remove "a name with spaces
  around it logs in", "a name that cannot belong to a user and a password in another case…", "a new login after a
  logout works", "an unknown name shows the same messages … also for the wait", "the wait of one name does not hold
  back another user" (all in `integration/auth-service.test.ts`), "the right password logs in after a failed
  attempt" ("a failed login keeps the way back for the next attempt" does the same) and "a forged entry to the left of
  the address gives no new budget" (`src/lib/client-address.test.ts`). About 11 s.
- `e2e/users.spec.ts`: of the 5 tests "…shows its error and keeps the dialog open" keep "an empty name"; of the 2
  crafted-type tests keep one (`src/features/users/forms.test.ts`). About 4 s.
- `e2e/create-page.spec.ts`: of the 6 tests of the title from the heading keep one (`src/features/pages/derive.test.ts`);
  the 3 name errors in one test that loops in the open dialog, as `e2e/tabs.spec.ts` does; the 3 tests "choosing a
  tab or the folder…" in one. About 8 s.
- `e2e/folders.spec.ts`: the 4 name tests in one looping test (`src/lib/names.test.ts`). About 2 s.
- `e2e/upload-file.spec.ts`: "names that break the rule…" with one name (`src/features/files/service.test.ts`).
- `e2e/wiki-links.spec.ts`: "a page whose heading holds a wiki link gets its label, or its target, in the title" with
  one case (`derive.test.ts`); remove "a label shows as text, never as HTML", "a code span, a code block, \[[ and a
  link over a line break are text" and "a label keeps its asterisks and a link in a table cell takes \|"
  (`src/features/pages/markdown.test.ts`), and one of the two loops of "a target that breaks the name rule…". About
  4 s.

### Test

- `npm run test:e2e -- ` with the specs above.

## Redundant tests and role loops

### Goal

A behaviour is checked end to end once, and a loop over roles runs only where the code has a branch for the role.

### Build

- `e2e/search.spec.ts`: "shows on every address of the folder, its tab and its pages to a …" only for `reader`, as
  `SearchField` has no branch by role; "does not show while an action is open…" without `/folders`, `/users` and
  `/account`, which never render it, and with a request that checks the absence of `role="search"` in the HTML for
  the rest; "more than 100 pages" without the half with 30 pages (`integration/search-service.test.ts`). About 18 s.
- `e2e/edit-page.spec.ts`: remove "a folder and a page can be created, and the page edited and renamed" (the Writer
  test of `e2e/folder-roles.spec.ts` and "creating a folder…" of `e2e/folders.spec.ts`), "refuses the save in a second
  tab after a save in the first" and "stores the change of the second editor after the first saved without a change"
  (`integration/page-service.test.ts`); drop the part of bob in "a page created and saved in the browser has a
  revision per change…". About 11 s.
- `e2e/tabs.spec.ts`: remove "a page can be created in a tab, viewed, edited and renamed" and "a page created on the
  folder address is placed directly in the folder…" (`e2e/create-page.spec.ts`, `e2e/all-pages.spec.ts`,
  `e2e/move-or-rename-page.spec.ts`); "overview.md can exist…" without the views and the case directly in the folder
  (`integration/page-service.test.ts`). About 6 s.
- `e2e/move-or-rename-page.spec.ts`: the six moves and renames in two tests, a rename in the folder and a move from a
  tab to another with a new name (`integration/page-service.test.ts`). About 5 s.
- `e2e/folders.spec.ts`: remove "the app bar links to the folder list" ("creating a folder…" clicks it).
- `e2e/folder-roles.spec.ts`: "a crafted form of each write of a Reader…" with one editor form and one dialog form;
  "…of a Manager, submitted as a Writer…" with one form; "forms submitted with the login of the admin…" with one
  form; one test instead of "a Manager sees no controls…", "a crafted Remove of a Manager…" and "a crafted form of a
  Manager writes nothing"; remove "a crafted form to create a page…", "…to rename the folder…", "a crafted change of a
  manager/writer to the role a user has…" (the integration test of the first step), "a crafted form with the name of
  an admin…" and "a crafted change to a value that is no role…". Covered by `integration/folder-role-service.test.ts`,
  `src/features/folder-roles/schema.test.ts` and the not-allowed tests of `src/features/pages/actions.test.ts` and
  `src/features/folders/actions.test.ts`. About 10 s.
- `e2e/delete-page.spec.ts`: remove "the second of two deletes…" ("deleting a page that was deleted in the
  meantime"); merge "the deleted pages … show the logged-in user who deleted" into "deleting a page in a tab…"; remove
  "a page of the same name can be created…" (the integration test of the first step, and the test of
  `e2e/deleted-items.spec.ts`).
- `e2e/restore-page.spec.ts`: remove "the second of two Managers who restore the same page at once gets an error in
  the dialog" ("restoring a page that was restored in the meantime" and `integration/page-service.test.ts`); merge
  "the restored page shows the logged-in user…" into the first restore test; drop the lists after the restore in one
  of the two restore tests; merge Cancel and Escape. About 5.5 s.
- `e2e/all-pages.spec.ts`: create the page of alice with `createPage()` in "…shows who changed each page last and
  how"; merge "reached from the folder and left through the breadcrumb" into the first test.
- `e2e/users.spec.ts`: remove "the whole chain for a new admin…" (`e2e/change-password.spec.ts` and
  `integration/user-service.test.ts`); merge "after a reload the password is gone" with "the password is not shown
  again…". About 5 s.
- `e2e/oauth.spec.ts`: remove "the chosen lifetime is the lifetime of the grant", "a 50th app that is a grant of the
  same client…", "a second client gets a grant of its own", "the code is bound to the client" and "a owner approves …
  Manager address" (`integration/oauth-service.test.ts`); send the `scope` of "a scope that the client sends is
  ignored" in the test of the whole flow. About 7 s.
- `e2e/log-out-other-browsers.spec.ts`: remove the admin variant of "confirming logs out a second browser…"
  (`integration/auth-service.test.ts`) and check the link of the admin in the admin test of `e2e/account.spec.ts`.
- `e2e/mcp-manager.spec.ts`: remove "a tab deleted in the browser meanwhile…" (`e2e/delete-tab.spec.ts` and the tool
  error of "delete_tab deletes an empty tab…"); merge its two tests of the deleted items.
- `e2e/mcp-write.spec.ts`: move "replace_page_content with the stored content keeps the last change…" out of "in the
  browser"; fold the check of "no app" of "a page changed through MCP names the user and the channel mcp…" into the
  browser test of `e2e/mcp-edit.spec.ts`.
- `e2e/ai-apps.spec.ts`: drop the owner case of the role loop (`mcpRolesFor` in its unit test), and open `?view=mcp`
  directly in three of the four role cases.
- `e2e/delete-tab.spec.ts`: remove "a page of a deleted tab is restored from the deleted pages into another place…"
  (`e2e/restore-page.spec.ts`), "a Writer whose editor was open on a page of the deleted tab gets the message on
  saving" (`e2e/edit-page.spec.ts`), "after deleting the tab archive, a new tab archive is created", "the folder list
  shows the same last change…" and "an Owner deletes a tab in the same way" (`integration/folder-service.test.ts`),
  and "…a Writer connection of MCP lists neither the tab nor its pages…" (the integration test of the first step);
  merge "a tab renamed after the dialog was opened…" into "the pages in the tab when confirming…". About 11 s.

### Test

- `npm run test:e2e -- ` with the specs above.

## Limits with heavy setup

### Goal

A limit is checked end to end with the cheapest content that breaks it, and its size on a lower level.

### Build

- `e2e/revert-page.spec.ts` "reverting to a revision that breaks the table cell limit…": break the depth limit
  instead, with a revision of 21 nested quotes (`CONTENT_MAX_DEPTH`), and expect its message. The table case is in
  `integration/page-service.test.ts` "refuses a revision past the table cell limit and changes nothing". About 9 s.
- `e2e/wiki-links.spec.ts`: remove "a save with 5,000 wiki links is stored" (the integration test of the first step);
  keep the refusal of 5,001 at the editor. About 4.5 s.
- `e2e/mcp-limits.spec.ts`: "lets 70 requests without a token and 70 with an invalid token get 401…" with 5 requests
  of each kind, sent together; the 70 are in `src/features/mcp/http.test.ts`. Merge "shares one budget between the
  addresses of a user…" into the first test of the rate limit: after its 429, one request at the Writer address
  (429) and one as another user (200). About 9 s.
- `e2e/mcp-search.spec.ts`: remove "a search that takes longer than the time limit is a tool error…": the limit is in
  `integration/search-service.test.ts`, the message in `src/features/mcp/tools.test.ts`, and `e2e/search.spec.ts`
  keeps the test that waits for the limit in the browser. About 5 s.
- `e2e/editor-limit.spec.ts`: merge the tests of typed characters and of a paste (`content-limit.test.ts`).

### Test

- `npm run test:e2e -- e2e/revert-page.spec.ts e2e/wiki-links.spec.ts e2e/mcp-limits.spec.ts e2e/mcp-search.spec.ts
e2e/editor-limit.spec.ts`.

## Editor, wiki link and file specs

### Goal

The specs of the editor, of wiki links and of files open fewer pages for the same behaviour.

### Build

- `e2e/editor.spec.ts`: remove "a new page in a folder and in a tab and an edited page use the editor, not a
  textarea" and move its check of no `textarea` into "with JavaScript the editor replaces the read-only field…";
  "only the editor loads it…" with the page view and one list; remove "Enter at the end of a list item continues the
  list" (`src/features/pages/editor/extensions.test.ts`), "raw HTML shows as its characters in source mode…"
  (`live-preview.test.ts`) and "saving without a change stores nothing" (`e2e/editor-spec-tests.spec.ts`); merge
  "spell check is off" into "the editor is named Content…" and "every character of the content is visible in source
  mode" into "source mode colors…". About 8 s.
- `e2e/editor-preview.spec.ts`: one of the two "stored content does not depend on the mode…" (live preview); one test
  instead of "typing on a fence line…", "Arrow Down reaches the opening fence line…" and "Arrow Down and Arrow Up
  stop on the fence lines…"; merge "an image shows as its Markdown and is not requested" into the test of the inline
  elements; "starts in the mode last chosen" without the save. About 3.5 s.
- `e2e/editor-leave.spec.ts`: run "a link of the app bar asks", "closing the tab asks…" and "the back button…" for the
  edited page only; both forms keep "Cancel asks" and "after undoing…", because each form computes its own changes.
  About 3.5 s.
- `e2e/editor-toolbar.spec.ts`: bold, link and the line button in one test. `e2e/editor-wiki-links.spec.ts`: fold "the
  toolbar has no upload button" into the test of drop and paste, and "No page found" into the first test of the
  picker.
- `e2e/wiki-links.spec.ts`: remove "a Reader sees a missing link as marked text without a link" (the test of a
  deleted page shows it to a Reader) and "a Writer follows a missing link to the editor…", which runs as Owner (the
  same flow for Writer and Manager is in `e2e/wiki-links-spec-tests.spec.ts`).
- `e2e/wiki-link-updates.spec.ts`: remove "a revert to a revision that holds the old target stores it as it is…" and
  "an editor opened on a linking page before the rename has its save refused as changed"
  (`integration/wiki-links-service.test.ts`, and the refused save of `e2e/editor-leave.spec.ts`); drop the history
  and the page view of the second page in "renaming a page…" and "renaming a tab…". About 5.5 s.
- `e2e/file-details.spec.ts`: remove "a page that shows the file can be deleted, and the file stays" (the integration
  test of the first step).
- `e2e/move-or-rename-file.spec.ts`: drop the lists, the page view and the history in "renaming a file…" and "moving
  a file…" (`integration/file-service.test.ts`).
- `e2e/delete-file.spec.ts`: drop the restore of "deleting a tab with two files…" ("a deleted file is listed…"
  restores).
- `e2e/file-links.spec.ts`: remove the test of `[[…]]` and `![[…]]` of a PDF where the test of `![[…]]` of a PDF
  without a label in `e2e/attachments-spec-tests.spec.ts` covers it.
- `e2e/editor-spec-tests.spec.ts` is not changed (see "Scope").

### Test

- The complete `npm run test:e2e` runs: this is the last step of the plan that changes tests, and the last of the
  second session. Its time, as Playwright reports it, and the summed test time of its HTML report are noted in the
  report of the step for the wrap-up.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Update `testing.md`: `expectNotFoundResponse()` next to `expectNotFound()` and when each is used, the helper for
   failed logins, the rule of accounts of their own as the step "Logins of accounts of their own" decided it, the
   rule that a test of a change by another user sets it up in the database unless it needs the other browser, and
   the rule that a rule of an input is checked in the unit tests of its schema with one browser case per form. Update
   the times of the suite in "Workers" with a complete `npm run test:e2e` before and after: the starting point of the
   "Goal" above and the run of the last step that changed tests. List, in "Current limits", the overlaps of the files
   written from the spec alone that this plan left in place.
2. The roadmap has no entry for this plan: nothing to remove.
3. `README.md`: no command changes; check that it still holds.
4. Delete this step file.
5. Remove this step file from the spec catalog in `CLAUDE.md`.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The complete end-to-end suite runs in
  the step "Editor, wiki link and file specs", the last step of the second session that changes tests.
