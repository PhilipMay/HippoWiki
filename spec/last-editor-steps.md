# Last Editor – Steps

## Goal

Every folder, tab and page records the user who last edited it; creating it counts as an edit. The lists and the
views show that user next to the time of the last change, so that a reader sees who changed something, and the
deleted pages show who deleted them.

## Scope

- In:
  - One required last editor per folder, tab and page: a foreign key to `User` with `onDelete: Restrict`, like the
    other keys of the content model.
  - The last editor changes on exactly the writes that change `updatedAt`, in the same write:
    - folder: created, renamed
    - tab: created, renamed
    - page: created, content edited, moved or renamed, deleted, restored
  - A migration that gives every existing folder, tab and page the admin (the user named `admin`) as its last editor
    and then makes the column required.
  - The user name of the last editor, next to the time that is already shown, in:
    - the folder list (`/folders`)
    - the contents of a folder (its pages and its tabs) and the pages of a tab
    - the list of all pages of a folder (`?view=all`)
    - the page view
    - the deleted pages of a folder (`/deleted-pages/<folder>`), as who deleted the page
    - the deleted page view (`/deleted-pages/<folder>/<id>`), as who deleted the page
  - The writes of the folders and pages services take the acting user (`Actor`), and the actions pass the user of
    the session.
  - The development seed and the test helpers give every folder, tab and page a last editor.
- Not in:
  - Who created an item: it is not stored (the roadmap keeps this part of "Pages with an author").
  - A history of editors or of changes.
  - A change inside a folder or tab counting as an edit of the folder or tab: creating, moving, deleting or restoring
    a page and creating a tab leave the folder's and the tab's `updatedAt` and last editor as they are.
  - Sorting or filtering by the editor, a page per user, links from the editor's name, and showing the editor in the
    user list or in a dialog.
  - Deleting or deactivating users, and an index on the new columns (nothing looks content up by its editor yet).

## Checklist

- [ ] Record the last editor
- [ ] Show the last editor
- [ ] Wrap-up

## Record the last editor

### Goal

Every write of a folder, tab or page stores the acting user as its last editor, and every existing item has the admin
as its last editor. Nothing shows the editor yet.

### Build

- `prisma/schema.prisma`: `Folder`, `Tab` and `Page` each get a required `lastEditedById` with a relation
  `lastEditedBy` to `User` (`onDelete: Restrict`), and `User` gets the back relations. A doc comment on the column
  says that it changes on the same writes as `updatedAt`.
- The migration is written by hand (see "Database" in `architecture.md`), because Prisma cannot fill a new required
  column. Its directory name sorts after all existing migrations. If content exists but no admin does, making the
  columns required fails and the migration is rolled back; a comment in the SQL says so. On an empty database, as in
  the tests and on the first start of the container image, setting the admin changes nothing. Its SQL, in this order:
  1. add the three columns as nullable
  2. set them on every existing row to the id of the user named `admin`
  3. make them `NOT NULL` and add the foreign keys
- `src/features/folders/service.ts` and `src/features/pages/service.ts`: every write takes the acting user as its first
  argument (`actor: Actor`, the type of `src/features/users/service.ts`, imported as a type) and writes `actor.id` as
  `lastEditedById` in the same `create` or `updateMany` that changes `updatedAt`: `createFolder`, `renameFolder`,
  `createTab`, `renameTab`, `createPage`, `updatePageContent`, `moveOrRenamePage`, `deletePage` and `restorePage`.
  - The actor's id is parsed like every other id: a malformed id never reaches the database. Add `parseUserId` to
    `src/features/users/schema.ts` if there is none.
  - A malformed actor id and an actor that does not exist give `failed` and are logged as an error, because only a
    broken caller can cause them (the adapters take the actor from a valid session, and users cannot be deleted). No
    new error code.
  - A foreign key violation of the editor key must not be read as a missing folder or tab. `createTab`, `createPage`,
    `moveOrRenamePage` and `restorePage` map every foreign key violation to a not-found code today; tell the editor
    key apart by the name of the violated constraint, with a constraint-aware variant of `isForeignKeyViolation` in
    `src/lib/db-errors.ts`, in the way `isUniqueViolation` reads the index name. Check what the `pg` driver adapter
    reports for a foreign key violation before relying on it.
- `src/features/folders/actions.ts` and `src/features/pages/actions.ts`: each action passes the user that
  `requireUser()` returns to the service write as the actor. Nothing else in the actions changes.
- `prisma/seed.ts`: create the known users first, then the sample folder and page with the admin of the known users as
  their last editor. The admin is looked up by name, because one that `npm run admin:setup` created has another id.
  The upsert of the folder and the page sets the editor in `create` and in `update`.
- `e2e/support/database.ts`: `createFolder()`, `createTab()` and `createPage()` accept the editor as a `User` and
  create a user with `createUser()` when none is given, so that the integration tests, which start from an empty
  database, keep working. Their doc comments say so.
- Update the unit tests that call the service writes (`service.test.ts` of both features) and the action unit tests to
  the new signatures.

### Test

- Unit tests (`src/features/folders/service.test.ts`, `src/features/pages/service.test.ts`):
  - every write stores the actor's id as `lastEditedById` together with its other data
  - a malformed actor id never reaches the database and gives `failed`
  - a foreign key violation of the editor key gives `failed` and is logged as an error, also in the writes that map
    other foreign key violations to a not-found code
- Unit tests (`src/features/folders/actions.test.ts`, `src/features/pages/actions.test.ts`): each action passes the
  user of `requireUser()` to its service write as the actor.
- Unit tests (`src/features/users/schema.test.ts`): `parseUserId` accepts a UUID and refuses anything else, if it is
  new.
- Integration tests (`integration/folder-service.test.ts`, `integration/page-service.test.ts`):
  - each write stores its actor as the last editor; a second write by another user replaces it
  - a write that fails (name taken, not found, invalid input) leaves the last editor as it was
  - renaming a folder leaves the last editor of its tabs, its pages and its deleted pages as it was; creating a tab or
    a page, and moving, deleting or restoring a page, leaves the last editor of its folder and its tab as it was
  - deleting and restoring a page set the actor as its last editor
  - an actor that does not exist gives `failed`, not a not-found code, and writes nothing
- Integration tests (`integration/db-errors.test.ts`): the constraint-aware foreign key check tells a violation of an
  editor key from one of a folder or tab key.
- End-to-end tests: the step changes `prisma/schema.prisma`, its migrations and `e2e/support/`, so the complete
  `npm run test:e2e` runs. No spec is added; the existing specs show that every write still works.
- Manual checks:
  - On a development database with content stored before the migration, `npm run db:migrate` gives every folder, tab
    and page the admin as its last editor (`npm run db:psql`).
  - `npm run db:reset` followed by `npm run db:seed` works, and running `npm run db:seed` again changes nothing.

## Show the last editor

### Goal

Every list and view that shows when an item was last changed also shows who changed it; the deleted pages show who
deleted them.

### Build

- The service reads select the user name of the last editor and return it in their result types, named by the service
  as for the other fields: `FolderSummary`, `TabSummary`, `PageSummary` (and so `PageWithTabSummary`),
  `PageWithPlace`, `DeletedPageSummary` and `DeletedPage`. The reads name the column with `select`, never `include`, so
  that no other field of the user reaches a caller.
- The components add "by <user name>" after the time that is already there:
  - `FolderList`: "Updated <time> by <user>"
  - `FolderContentsList` (pages and tabs), `PageListItem` and `AllPagesList`: "Updated <time> by <user>"
  - `PageView`: "Last updated <time> by <user>"
  - `DeletedPagesList`: a column "Deleted by" after the column "Deleted"
  - `DeletedPageView`: "Deleted <time> by <user>"
- The user name is shown as text, never as a link: there is no page for a user.

### Test

- Unit tests (`service.test.ts` of both features): nothing new, because the reads only add a column to their `select`
  (see "Unit tests" in `testing.md`).
- Integration tests (`integration/folder-service.test.ts`, `integration/page-service.test.ts`): every read listed in
  "Build" returns the user name of the last editor, and for a deleted page the user who deleted it.
- End-to-end tests, each checking the name of the user who made the change, and that a change by another user
  replaces it (an item set up with `createFolder()`, `createTab()` or `createPage()` with another editor, then changed
  through the GUI):
  - `e2e/folders.spec.ts`: the folder list after creating and after renaming a folder
  - `e2e/tabs.spec.ts`: the folder contents after creating and after renaming a tab
  - `e2e/create-page.spec.ts`, `e2e/edit-page.spec.ts` and `e2e/move-or-rename-page.spec.ts`: the page view and the
    page lists of the folder or tab after the write
  - `e2e/all-pages.spec.ts`: the list of all pages
  - `e2e/delete-page.spec.ts` and `e2e/deleted-pages.spec.ts`: the deleted pages list and the deleted page view show
    the user who deleted the page
  - `e2e/restore-page.spec.ts`: the restored page shows the user who restored it
- Manual check: the lists and views in the browser, in a narrow window as well, so that the longer line of a list item
  still wraps cleanly.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `workflow.md`), or extend an existing
   feature spec; update `architecture.md`, `testing.md` or `tech.md` where conventions changed. For this feature,
   extend the existing specs instead of adding a new one:
   - `content-structure.md`: a section on the last editor (which writes set it, for folders, tabs and pages, and that
     a change inside a folder or tab is no edit of it), the lists that show it in "Lists and order", and under
     "Decisions": the same writes as `updatedAt`, so that time and name describe the same change; the admin as last
     editor of the content stored before the feature, with the rejected alternatives (no editor, "unknown"); the
     required column; `onDelete: Restrict`.
   - `pages.md`: the page view shows the last editor; drop "no author" from "Current limits" and say instead that
     only the last editor is stored, not who created a page.
   - `page-deletion.md`: the deleted pages list and view show who deleted a page; under "Decisions": who deleted a
     page is its last editor, which holds only as long as nothing writes to a deleted page, so that a later write to
     deleted pages (deleting or restoring folders and tabs, restoring into another folder) has to keep it; that pages
     deleted before the feature show the admin; drop "Who deleted a page is not recorded" from "Current limits".
   - `users-and-login.md`: under "Current limits", replace "no pages with an author" by the creator not being stored,
     and add that a user who has edited content cannot be deleted for good (`onDelete: Restrict`).
   - `architecture.md`: that the content writes take the acting user as their first argument, in "Reads and writes",
     and the constraint-aware foreign key check in "Validation and errors".
   - `testing.md`: the editor parameter of the content helpers of `e2e/support/database.ts`, if the section on the
     helpers names their parameters.
2. Remove the feature from `roadmap.md`: reduce "Pages with an author" to recording who created a page.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
