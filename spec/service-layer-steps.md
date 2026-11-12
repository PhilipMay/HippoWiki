# Service Layer – Steps

## Goal

HippoWiki gets a service layer: one module per feature that holds every read and write of the feature and knows
nothing about Next.js, forms or addresses. The GUI works exactly as before, but its Server Actions and queries only
translate between the web and the services. A later MCP server can then call the same services.

## Scope

- In:
  - `src/features/folders/service.ts` and `src/features/pages/service.ts` with all reads and writes of the features
  - a shared result type for writes that can fail (`src/lib/result.ts`)
  - `queries.ts` and `actions.ts` of both features as thin adapters on top of the services
  - `forms.ts` per feature for what only a form needs, moved out of `schema.ts`
  - lint rules that keep the layers apart
  - unit and integration tests of the services, and a test that the services load without Next.js and React
- Not in:
  - the MCP server or any other new caller of the services (route handlers, command line)
  - users, rights or a caller that is passed to the services
  - repositories or another layer between the services and Prisma: the services call Prisma directly, on purpose
  - any change a user can see: addresses, redirects, messages and form behaviour stay as they are, and so do the
    logged events; no test in `e2e/` is changed. Only the import of `PLACE_FIELD` in `e2e/create-page.spec.ts` and
    `e2e/move-or-rename-page.spec.ts` follows its move to `forms.ts`.
  - changes to the database schema, new packages
  - the health route (`src/app/api/health/route.ts`), which keeps reading the database directly

## Design

These rules apply to every step.

- The layers: a route or component calls `queries.ts` or `actions.ts`, these call `service.ts`, and only `service.ts`
  calls `getDb()`. Routes and components import a service only for its types.
- `service.ts` of a feature:
  - imports nothing from `next`, `react`, `@/lib/revalidate` or a `forms.ts`, has no `"use server"` and works outside
    a request
  - takes plain typed arguments (ids, names, objects of strings), never `FormData`
  - trusts no caller: it parses ids and names (`parseFolderId`, `parseTabId`, `parsePageId`, `parseName`) and
    validates input with the Zod schemas of `schema.ts`, which also derive the title of a page
  - reads return rows, a list or `null`; a malformed id or name counts as a missing row; database errors are thrown
  - writes return a `Result` from `src/lib/result.ts`: `{ ok: true, value }` with the item as stored, or
    `{ ok: false, error }` with a code. The codes are `invalid-input` (with `fieldErrors`), `name-taken`,
    `folder-not-found`, `tab-not-found`, `page-not-found` and `failed`; each write declares the ones it can return.
  - an unexpected database error in a write is logged with `{ err }` and the ids and returned as `failed`
  - logs the events with the messages and fields the actions use today
  - returns no addresses and no messages, except the field errors of the schemas in `invalid-input`; the stored item
    carries what an address is built from (its name and the names of its folder and tab)
  - declares the types of its results itself instead of deriving them from a Prisma query, states the return type of
    every function, and names the columns of every query with `select`, never `include`, so that a new column does
    not reach a caller by accident
  - is the place for checks of who may read or change something, once users and rights exist. Such checks never go
    into the adapters, which an MCP server does not pass through. This plan adds none.
- `forms.ts` of a feature holds what only a form needs, moved from `schema.ts` unchanged: the `parse*FormData`
  functions, the form states, the types of the form actions and the names of form fields. It has no server-only
  imports, so Client Components can use it. `schema.ts` keeps the ids, the Zod schemas and the types of validated
  input.
- `actions.ts` of a feature:
  - checks the id, parses the form with the `parse*FormData` function it uses today, calls the service and maps the
    result
  - maps every error code to the form state and message of today in a `switch` (`switch-exhaustiveness-check` reports
    a missing code)
  - on success calls `revalidateContent()` and redirects to the address built from the stored item with the helpers
    of `addresses.ts`
- The form parsers move to `forms.ts` but do not change. They report all errors of a form together, including the
  ones only a form has (no place chosen, a file instead of text). The service validates the same input again with the
  same schemas; this is deliberate.
- `queries.ts` of a feature: every query awaits `connection()` and then calls the service read of the same name;
  the queries that use React `cache()` today keep it.
- Service functions keep the names of the queries and actions, so adapters import the service as a namespace:
  `import * as folderService from "@/features/folders/service"`.
- The types of results (`FolderSummary`, `PageWithPlace` and the like) are declared in `service.ts`; components import
  them from there with `import type`, which lint enforces (see "Layer rules").

## Checklist

- [x] Folder and tab service
- [x] Page reads
- [x] Page writes
- [ ] Layer rules
- [ ] Wrap-up

## Folder and tab service

### Goal

Folders and tabs are read and written through `src/features/folders/service.ts`. The result type and the lint rules
for services exist.

### Build

- `src/lib/result.ts`: the type `Result<Value, Error>`, without server-only imports.
- `src/features/folders/service.ts`:
  - the reads `listFolders()`, `getFolderByName()`, `listTabs()` and `getTab()`, moved from `queries.ts` without
    `connection()` and `cache()`; `listTabs()` returns an empty list for a malformed folder id
  - the types `FolderSummary` and `TabSummary` and named types for what `getFolderByName()` and `getTab()` return,
    all declared explicitly; `getFolderByName()` and `getTab()` get a `select` with the columns the GUI uses
  - `createFolder({ name })`: `invalid-input`, `name-taken`, `failed`
  - `renameFolder(id, { name })`: `folder-not-found`, `invalid-input`, `name-taken`, `failed`
  - `createTab(folderId, { name })`: `folder-not-found`, `invalid-input`, `name-taken`, `failed`
  - `renameTab(id, { name })`: `tab-not-found`, `invalid-input`, `name-taken`, `failed`
  - a folder is returned as `{ id, name }`, a tab as `{ id, name, folder: { name } }`, both as stored
- `src/features/folders/forms.ts`: `parseFolderFormData()`, `parseTabFormData()` and their result types, moved from
  `schema.ts`.
- `src/features/folders/queries.ts` and `actions.ts` become adapters as described in "Design".
- Components import `FolderSummary` and `TabSummary` from the service.
- `eslint.config.mjs`:
  - `no-console` also covers `src/features/**/service.ts`
  - `@typescript-eslint/no-restricted-imports` for `src/features/**/service.ts`: `next`, `next/*`, `react`,
    `@/lib/revalidate` and `@/features/*/forms`. It is a rule of its own, so the Material UI paths in
    `no-restricted-imports` stay as they are.

### Test

- Unit, `src/features/folders/service.test.ts` (mocks `@/lib/db` and `@/lib/logger`): the cases of today's
  `actions.test.ts` and `queries.test.ts` that are about the database, now against the service:
  - malformed ids and names never reach the database
  - invalid input returns `invalid-input` with the field errors and writes nothing
  - a unique violation returns `name-taken`, a foreign key violation `folder-not-found`, a count of 0 the not-found
    code, any other error `failed`
  - what is logged for each outcome
- Unit, `src/features/folders/actions.test.ts` (mocks the service, `next/cache` and `next/navigation`):
  - every error code gives the form state of today
  - success revalidates and redirects to the stored address; a failure does neither
  - a malformed id or an invalid form never reaches the service
- Unit, `src/features/folders/queries.test.ts` (mocks the service and `next/server`): every query waits for
  `connection()` before it calls the service.
- Unit, `src/features/folders/forms.test.ts`: the `parse*FormData` cases of `schema.test.ts`, moved unchanged.
- Integration, `integration/folder-service.test.ts`:
  - the folder and tab cases of `integration/queries.test.ts`, moved here and run against the service
  - `getFolderByName()` and `getTab()` return exactly the declared fields
  - the writes on real data: a folder and a tab are stored and returned, a taken name returns `name-taken`, the same
    tab name in another folder is allowed, a missing folder or tab returns its not-found code
- End-to-end: no new tests, because nothing a user sees changes. The existing ones pass without a change to `e2e/`.

## Page reads

### Goal

Pages are read through `src/features/pages/service.ts`.

### Build

- `src/features/pages/service.ts`: the reads `listFolderPages()`, `listTabPages()`, `listAllFolderPages()`,
  `getPage()`, `listDeletedPages()` and `getDeletedPage()` with `directPagesFirst()` and the types `PageSummary`,
  `PageWithTabSummary`, `PageWithPlace`, `DeletedPageSummary` and `DeletedPage`, moved from `queries.ts` without
  `connection()` and `cache()`. The lists return an empty list for a malformed id.
- The types are declared explicitly. `getPage()` and `getDeletedPage()` get a `select` with the columns the GUI uses
  instead of `include`.
- `src/features/pages/queries.ts` becomes an adapter as described in "Design".
- Components import the page types from the service.

### Test

- Unit, `src/features/pages/service.test.ts` (mocks `@/lib/db`): the cases of today's `queries.test.ts` except the
  ones about `connection()`: malformed names and ids never reach the database, deleted pages are left out, the
  conditions that pick the place of a page, `directPagesFirst()`.
- Unit, `src/features/pages/queries.test.ts` (mocks the service and `next/server`): every query waits for
  `connection()` before it calls the service.
- Integration, `integration/page-service.test.ts`:
  - the page cases of `integration/queries.test.ts`, moved here and run against the service;
    `integration/queries.test.ts` is deleted
  - `getPage()` and `getDeletedPage()` return exactly the declared fields
- End-to-end: no new tests; the existing ones pass without a change to `e2e/`.

## Page writes

### Goal

Pages are written through `src/features/pages/service.ts`. No Server Action reads or writes the database any more.

### Build

- `src/features/pages/service.ts`, moved from `actions.ts`:
  - `createPage(folderId, { name, content, tabId })`: `folder-not-found`, `tab-not-found`, `invalid-input`,
    `name-taken`, `failed`
  - `updatePageContent(id, { content })`: `page-not-found`, `invalid-input`, `failed`
  - `moveOrRenamePage(id, { name, tabId })`: `page-not-found`, `tab-not-found`, `invalid-input`, `name-taken`,
    `failed`
  - `deletePage(id)`: `page-not-found`, `failed`
  - `restorePage(id, { name, tabId })`: `page-not-found`, `tab-not-found`, `invalid-input`, `name-taken`, `failed`
  - `tabId` is the id of a tab or `null` for the folder itself; a malformed one returns `tab-not-found`
  - a page is returned as `{ id, name, folder: { name }, tab: { name } | null }`, as stored; `deletePage()` returns
    the place the page was in, `{ folder: { name }, tab: { name } | null }`
  - the transaction of `deletePage()` and the rule that a foreign key violation means the tab if one was given, else
    the folder, stay as they are
- `src/features/pages/forms.ts`: the `parse*FormData` functions, the form states, the types of the form actions,
  `PLACE_FIELD` and `CHOOSE_PLACE_MESSAGE`, moved from `schema.ts`; components import them from there, and so do the
  two end-to-end specs that use `PLACE_FIELD`.
- `src/features/pages/actions.ts` becomes an adapter as described in "Design". Each action keeps its own message for
  `failed` (save, delete, restore).

### Test

- Unit, `src/features/pages/service.test.ts`: the cases of today's `actions.test.ts` that are about the database,
  now against the service, for every write:
  - malformed ids never reach the database
  - invalid input returns `invalid-input` with the field errors and writes nothing
  - the stored data (derived title, name and tab only for a move, time of deletion and no tab for a delete)
  - every unique violation of `PAGE_NAME` returns `name-taken`, a foreign key violation the folder or tab code, a
    count of 0 `page-not-found`, any other error `failed`
  - a page that disappears between the update and reading its address
  - what is logged for each outcome
- Unit, `src/features/pages/actions.test.ts` (mocks the service, `next/cache` and `next/navigation`):
  - every error code of every action gives the form state of today
  - success revalidates and redirects to the address of the stored page, or to the folder or tab of a deleted page
  - a malformed id or an invalid form never reaches the service
- Unit, `src/features/pages/forms.test.ts`: the `parse*FormData` cases of `schema.test.ts`, moved unchanged.
- Integration, `integration/page-service.test.ts`, the writes on real data:
  - a page is created directly in a folder and in a tab; a tab of another folder returns `tab-not-found`
  - a taken name in the same place returns `name-taken`; the same name directly in the folder and in a tab is
    allowed
  - content is updated with its derived title; a deleted page returns `page-not-found`
  - a move into a tab and back, with and without a new name
  - a delete forgets the tab, returns the place and frees the name
  - a restore into the folder and into a tab; a taken name returns `name-taken`; a page that is not deleted returns
    `page-not-found`
- End-to-end: no new tests; the existing ones pass with no change to `e2e/` but the import of `PLACE_FIELD` in the
  two specs.

## Layer rules

### Goal

Lint keeps the layers apart, and a test shows that the services load without Next.js and React.

### Build

- `eslint.config.mjs`, with `@typescript-eslint/no-restricted-imports`:
  - `@/lib/db` may only be imported in `src/features/**/service.ts`, `src/lib/**` and `src/app/api/health/**`;
    everywhere else in `src/` the rule points to the service of the feature
  - in `src/app/**` and `src/features/**/components/**`, `@/features/*/service` may only be imported as a type
    (`allowTypeImports`); the rule points to `queries.ts` and `actions.ts`
  - a later config object replaces the options of a rule, so every file gets all its restrictions from the last
    object that matches it
- `integration/setup.ts`: remove the mock of `next/server`. No integration test loads `queries.ts` any more, so
  nothing uses it.

### Test

- Unit, `src/features/services.test.ts`: mocks `next/cache`, `next/headers`, `next/navigation`, `next/server` and
  `react` with factories that throw, then imports both services. An import of one of them, also an indirect one
  through `schema.ts` or `src/lib/`, fails the test.
- `npm run lint` passes.
- Manual check, reverted afterwards: `npm run lint` reports an import of `@/lib/db` in an `actions.ts`, an import of
  `next/server` in a `service.ts` and a value import of a service in a route.
- `npm run test:integration` passes without the mock.
- End-to-end: no new tests; the existing ones pass without a change to `e2e/`.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the service layer as built in `architecture.md` ("Layout", "Reads and writes", "Validation and errors",
   "Linting"), taking over the rules of "Design", and the tests of services, actions and queries in `testing.md`
   (unit tests, integration tests and their setup). There is no feature spec to write; correct `pages.md`,
   `content-structure.md` and `page-deletion.md` where they name `queries.ts` or `actions.ts` as the place of a rule
   that now lives in a service.
2. `roadmap.md` does not list the service layer, so nothing is removed; "MCP Server" stays.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: remove this step file.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
