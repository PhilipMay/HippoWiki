# End-to-End Stability – Steps

## Goal

Two causes make end-to-end tests fail now and then without a fault of the app. The MCP specs all send their requests
as the known user `alice`, whose rate-limit budget lives in the memory of each server and outlives
`resetTestDatabase()`, so a spec can meet the limit (429) in the complete suite. And the hot module replacement of
`next dev` can drive a page into an endless reload loop, which fails the test that waits for the page to hydrate.
After the plan every MCP test uses a user of its own, and a page under test never gets the messages with which the
development server tells it to reload.

## Scope

- In: a user of its own for every test of the MCP specs that `setUpProjects()` sets up, the tests "in the browser"
  among them; a user of its own for `e2e/oauth.spec.ts` only if the complete suite shows it meeting the limit; a filter
  in `e2e/support/` that keeps the reload messages of the hot module replacement from the pages under test, with its
  unit tests; the description of both in `testing.md`.
- Not in: any change of the app, of the default limits of MCP or of the limits of the end-to-end servers, which keep
  the defaults so that `e2e/mcp-limits.spec.ts` checks them; a report or a workaround of the race in Next.js itself; an
  upgrade of Next.js; other flaky tests; the production run, which has no hot module replacement.

## Checklist

- [x] A user of its own for every MCP test
- [ ] Keep the reload messages of the development server from the pages
- [ ] Wrap-up

## A user of its own for every MCP test

### Goal

No MCP spec shares the rate-limit budget of another test: every test that `setUpProjects()` sets up sends its MCP
requests as a user of its own, so that a spec no longer meets the limit of 60 at once and 300 a minute in the complete
suite, while the servers keep the default limits.

### Build

- `e2e/support/mcp.ts`: `setUpProjects()` resets the test database as now, creates a user of its own with
  `createUser()` (`mustChangePassword: false`), makes it the Owner and the last editor of the folder "projects", gives
  it the Reader grant of the connection of `send()` and `call()`, and returns it as `owner` next to the folder, the
  address and the secret. The comments of the module and of the function say why: the budget of the rate limit is kept
  per user in the memory of the server of a worker, so the known user would share one budget across all MCP specs of
  that worker.
- The specs set up by `setUpProjects()` (`e2e/mcp-access.spec.ts`, `e2e/mcp-read.spec.ts`, `e2e/mcp-write.spec.ts`,
  `e2e/mcp-edit.spec.ts`, `e2e/mcp-manager.spec.ts`, `e2e/mcp-search.spec.ts`): every grant of `KNOWN_USER` becomes a
  grant of `owner`, and every expectation that names `KNOWN_USER` as the user of an MCP connection, such as the last
  editor, the user of a revision or "by <user> via mcp", names `owner`. A second user of a test, such as `bob`, stays
  as it is; so does what a test checks about `alice` that is not about MCP.
- The tests "in the browser" of these specs show what the owner of the connection sees, so their browser is logged in
  as `owner` instead of with `USER_STORAGE_STATE`: with `logInElsewhere()` of `e2e/support/auth.ts`, or with `logIn()`
  on a page without a stored login. A test that checks how a change through MCP looks to another user keeps the user it
  names.
- `e2e/oauth.spec.ts` approves its grants on the consent page as `alice` and sends few MCP requests; it stays as it is
  unless the complete suite of this step shows it meeting the limit, and then it gets a user of its own as well
  (`createUser()` and the password argument of `connect()`). The change is named in the report of the step.
- `e2e/mcp-limits.spec.ts` uses users of its own already and stays as it is.

### Test

- No new test: the step changes how the existing tests are set up, not what they check. Each changed expectation
  checks the same rule with the user of `setUpProjects()`.
- A search of `e2e/mcp-*.spec.ts` for `owner: KNOWN_USER` finds no grant of the known user any more, and
  `USER_STORAGE_STATE` is left only in tests that do not act through MCP as the browser user.
- The step changes `e2e/support/`, so the complete `npm run test:e2e` runs in this step, and no spec in it gets a 429.

## Keep the reload messages of the development server from the pages

### Goal

A page under test is never reloaded by the hot module replacement of `next dev`. Now and then, when the compile pass
that a page render schedules lands just after the page has subscribed to its chunk lists, the server answers the
subscription of the shared entry chunk list with an update of type `restart`, or the version of the page no longer
matches and the server sends `reloadPage` ("HMR hash mismatch"). The page reloads, the next render schedules the next
pass, and the loop never ends (in one run 330 reloads in 29 seconds, until the test timed out). The two messages that
ask a page to reload no longer reach it; every other message passes, because a page of Next.js 16 does not hydrate
without the connection of the hot module replacement. The tests change no source file, so no real update is lost.

### Build

- A new module `e2e/support/hmr.ts`:
  - `withoutReloads(message)`, a pure function: a text message that is JSON with the type `reloadPage` is dropped
    (`null`); one of the type `turbopack-message` loses the updates of its `data` whose type is `restart`, and is
    dropped when none is left; every other message, a binary one or a text that is no JSON included, is returned
    unchanged.
  - `keepFromReloading(page)`: routes the websocket of `/_next/hmr` of the page with `page.routeWebSocket()`, connects
    it to the server, passes every message of the page to the server unchanged and every message of the server through
    `withoutReloads()`.
  - Its comment says why: the race of the compile pass with the subscription (Next.js names the subscription setup "not
    atomic" in `hot-reloader-turbopack.js` of the installed version), that the loop is endless, that the tests change no
    source file, that stubbing the websocket instead keeps the page from hydrating, and that the production run has no
    `/_next/hmr`, so the route never matches there.
- `e2e/support/test.ts`: `hydrating()` calls `keepFromReloading()` for the page, and its `goto()` and `reload()` wait
  for the route before they load the page, so that the first load is covered. The pages with JavaScript disabled,
  which `hydrating()` does not wrap, need nothing.
- The check of more than `MAX_RELOADS_WHILE_HYDRATING` reloads stays as a guard. Its message says that the page loaded
  itself again, which no page of the app does and the filter keeps the development server from doing, and points to
  "End-to-end tests" in `testing.md`, so that a new cause is told apart from a failure of the app.

### Test

- Unit, in `e2e/support/hmr.test.ts`: `reloadPage` is dropped; a `turbopack-message` with only a `restart` is
  dropped; one with a `restart` and a `partial` update keeps only the `partial` one and every other field unchanged;
  one without a `restart` is returned as the same text; `building`, `built`, `sync` and `turbopack-connected`, a binary
  message and a text that is no JSON are returned unchanged.
- The step changes `e2e/support/`, so the complete `npm run test:e2e` runs in this step.
- After it, the specs that showed the loop most often, every `e2e/mcp-*.spec.ts` and `e2e/oauth.spec.ts`, run three
  times in a row on their own (`npm run test:e2e -- <the specs>`), and no run fails; before the step about every second
  such run had a test that failed with the reload loop.
- Last, `npm run test:e2e:production -- e2e/smoke.spec.ts e2e/hydration.spec.ts`: the route changes nothing in a
  production build.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the changes as built in `testing.md`, "End-to-end tests":
   - "Helpers in `e2e/support/`": the entry of `test.ts` names the filter of `hmr.ts`; the paragraph on the reload
     loop says what the loop is (the race of the compile pass with the subscription of the entry chunk list), that it
     is endless, that the filter keeps the messages `reloadPage` and `restart` from the pages and why that loses
     nothing, and that the check of more than 5 reloads stays as a guard. A new entry describes `hmr.ts`.
   - The entry of `mcp.ts`: `setUpProjects()` creates a user of its own, the Owner of "projects" with the Reader
     grant, instead of a grant of `alice`.
   - The paragraph of the specs of MCP and the one of `e2e/mcp-limits.spec.ts`: every MCP test uses a user of its
     own, because the budget of the rate limit is kept per user in the memory of a server and outlives
     `resetTestDatabase()`; the tests "in the browser" log in as that user; the limits of the servers are not raised.
     If `e2e/oauth.spec.ts` got a user of its own, it is named there too.
2. `roadmap.md` has no item for either cause; nothing is removed.
3. `README.md`: the commands are unchanged; its section "End-to-end tests" is checked for a statement about the reload
   loop or the known user of the MCP specs that no longer holds.
4. Delete this step file. The plan has no requirements file.
5. `CLAUDE.md`: remove the entry of this step file from the spec catalog.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The step changes only documentation, so
  `npm run check` runs and no end-to-end spec; the complete suite ran in the step before.
- A search of `spec/`, `README.md` and `CLAUDE.md` for "reload loop", "hot module replacement", `setUpProjects` and
  "known user" leaves no statement that contradicts the filter or the users of the MCP tests.
