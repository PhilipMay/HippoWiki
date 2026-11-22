# HMR Route Race – Steps

## Goal

The end-to-end tests that open a second page of a browser context hydrate it every time, in CI as well. Right now the
second page can be created while the route of the first page is still being set up. Playwright installs its websocket
binding for the whole context during the first `page.routeWebSocket()` of that context. A page created in the middle of
that install misses the binding, the websocket of the hot module replacement throws `binding is not a function`,
Next.js stops before it hydrates, and the test times out waiting for `data-hydrated="true"`. It failed this way in
`e2e/edit-page.spec.ts` ("refuses the save in a second tab after a save in the first"), and it passed on the retry.

## Scope

- In:
  - `hydrating()` settles only once the route of its page is in place, so a test cannot open another page of the
    context before that.
  - The `page` fixture waits for its route before the test gets it.
  - Every spec and helper that calls `hydrating()` waits for it.
  - Unit tests of the new order.
  - The section on the helpers in `e2e/support/` of `spec/testing.md`.
- Not in:
  - A change of the filter `withoutReloads()` or of the route itself in `e2e/support/hmr.ts`.
  - A context-wide route with `context.routeWebSocket()` in place of the routes per page.
  - Changes to `playwright.config.ts`, retries or `failOnFlakyTests`.
  - An end-to-end test that tries to reproduce the race: it depends on timing, so it would pass whether or not the race
    is fixed.
  - Any change to the app.

## Checklist

- [ ] Wait for the route before a page is used
- [ ] Wrap-up

## Wait for the route before a page is used

### Goal

No page of a context is created while the websocket route of another page of that context is still being set up.

### Build

- Move `hydrating()`, `waitForHydration()` and `MAX_RELOADS_WHILE_HYDRATING` from `e2e/support/test.ts` into a new
  module `e2e/support/hydration.ts`. It imports only types from `@playwright/test`, so its unit tests can load it.
  `test.ts` re-exports `hydrating`, so the imports of the specs stay the same.
- `hydrating(page)` becomes `async` and returns the page once `keepFromReloading(page)` has settled. A route that fails
  rejects `hydrating()`. `goto()` and `reload()` of the wrapped page no longer wait for the route themselves, because
  the page is handed out only once the route is in place. They still wait for hydration.
- The `page` fixture in `test.ts` awaits `hydrating(page)` before `provide`, still not with JavaScript disabled.
- Every call becomes `await hydrating(await context.newPage())`: the specs that call it and `e2e/support/auth.ts`. Use
  `grep -rn "hydrating(" e2e` to find them all. The type check catches one that is missed, because a `Promise<Page>`
  has no `goto()`.
- The comments of `hydrating()` and of the fixture say why the route has to be in place first: Playwright installs its
  websocket binding for the whole context during the first route of the context, and a page created during that
  install misses it. Do not cite the trace or the CI run.

### Test

- Unit tests in `e2e/support/hydration.test.ts`, with a fake page whose `routeWebSocket()` settles when the test says
  so:
  - `hydrating()` does not settle before the route has settled, and settles with the same page afterwards.
  - A route that fails rejects `hydrating()`.
  - `goto()` of the wrapped page calls the original `goto()` and then waits for `html[data-hydrated="true"]`.
- `e2e/support/` changes, so the complete `npm run test:e2e` runs, as "When a step is done" in
  `spec/step-plan-workflow.md` says.
- Manual check for the user: the next CI runs of `end_to_end_tests` on `main` report no flaky test in a spec that opens
  a second page. One clean run doesn't prove the race is gone, since it only showed up now and then.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. There is no feature spec for this fix, because it changes only the test helpers. In the section on the helpers in
   `e2e/support/` of `spec/testing.md`, say three things:
   - `hydrating()` lives in `hydration.ts` and is re-exported by `test.ts`.
   - It is awaited, as in `await hydrating(await context.newPage())`, and settles once the route of `hmr.ts` is in
     place. Its `goto()` and `reload()` wait for hydration.
   - Why the route comes first: the binding of `page.routeWebSocket()` is installed for the whole context, and a page
     created during that install never hydrates.
2. `roadmap.md` holds no item of this fix; leave it unchanged.
3. `README.md` needs no new command; check that this still holds.
4. Delete this step file. The fix has no requirements file and no requirement IDs.
5. Remove this step file from the spec catalog in `CLAUDE.md`. The entry of `spec/testing.md` keeps its question.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes only documentation,
  so `npm run check` runs.
- `grep -rn "hmr-route-race" spec CLAUDE.md README.md` finds nothing.
