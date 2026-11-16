# Squash Migrations – Steps

## Goal

The 20 migrations under `prisma/migrations/` are replaced by a single migration `init` that creates the current
schema on an empty database. No database exists yet whose state has to be kept, so the code that moved older states
forward (slugs from titles, the folder `test-folder`, the admin as last editor, the account types, the Owner roles,
the deletion of the API tokens) and the documents that describe those updates go away.

## Scope

- In:
  - one new migration `prisma/migrations/<timestamp>_init/` with the SQL that Prisma generates from
    `prisma/schema.prisma`, plus the hand-written parts that Prisma cannot express: the check constraint that keeps
    `AuthSecret` to a single row, the trigger that keeps the type of a `User`, and the trigger that refuses a role of
    an admin
  - a check that the new migration creates the same database as the old ones, before the old ones are deleted
  - deleting the 20 old migration directories
  - every pointer to an old migration directory, in `spec/`, `README.md`, `CLAUDE.md` and the comments of the code
  - removing the passages that only describe the update of an existing installation: "Existing installations" in
    `users-and-login.md` and `folder-roles.md`, the update to the account types in `container-image.md`, "The update
    that removed the API tokens" in `connected-apps.md`, the paragraph on the removed API tokens in `README.md`, and
    the sentences of `review-report.md` that rely on the migration that removed them
  - the rule in `architecture.md` that the history of migrations starts with this `init`, and why
  - the check of `/mcp` in the smoke test of the container image (`scripts/image.sh`), which still expected `405`
    without `HIPPOWIKI_PUBLIC_URL` instead of the `404` that `mcp.md` describes; added with the approval of the user,
    because the smoke test of this plan failed on it
- Not in:
  - any change to `prisma/schema.prisma` or to the database it describes: tables, columns, indexes, constraints and
    triggers stay as they are
  - a way to bring a database with the old migration history to the new one: such a database is recreated
  - resetting the development database of the user (`hippowiki-db`); the report of the step tells the user how
  - a rule to keep folding later changes into `init`: schema changes after this plan get a migration of their own, as
    `architecture.md` describes
  - the finding "CI does not check that the migrations produce the schema" of `review-report.md`; it stays open

## Checklist

- [x] Replace the migrations with one init
- [ ] Wrap-up

## Replace the migrations with one init

### Goal

A single migration `init` creates the database that the 20 old migrations created, and nothing in the code or the
documents points to the old migrations or to an update of an existing installation any more.

### Build

- Create `prisma/migrations/<timestamp>_init/migration.sql`, with the time of the build as timestamp, from
  `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`. Check that it contains the partial
  unique index `Page_folderId_name_key` (with `WHERE "tabId" IS NULL AND "deletedAt" IS NULL`).
- Add the hand-written parts at the end, each under a comment that says why it is written by hand, taken over from
  the old migrations with their comments where these still fit:
  - the check constraint `AuthSecret_single_row` (from `20261112170116_add_auth_secret`)
  - the function and trigger `User_keep_type` (from `20261115120000_add_user_types`)
  - the function and trigger `FolderRole_no_admin` (from `20261115210306_add_folder_roles`), with the message that
    `ADMIN_ROLE_MESSAGE` in `src/lib/db-errors.ts` expects
  - Not the check constraint `ApiToken_token_or_grant`, which a later migration dropped, and none of the data moves.
- Start the file with a short comment: it creates the whole schema of an empty database, and the hand-written parts
  are at the end.
- Check that the new migration creates the same database as the old ones, with two throwaway PostgreSQL containers of
  the image pinned in `scripts/Containerfile`: apply the old migrations to one and only the new one to the other
  (`prisma migrate deploy` with `DATABASE_URL` set to each), and compare `pg_dump --schema-only` of both. Differences
  are allowed only in the order of columns and in the names of not-null constraints that the old migrations kept from
  renamed columns and tables; every other difference is fixed in the new migration. Also check that
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` reports no difference
  against the database of the new migration. Remove both containers afterwards.
- Delete the 20 old migration directories; keep `prisma/migrations/migration_lock.toml`.
- Update the comment of `ADMIN_ROLE_MESSAGE` in `src/lib/db-errors.ts`, which points to `*_add_folder_roles`.
- In `scripts/image.sh`, the smoke test expects `404` at `/mcp` without `HIPPOWIKI_PUBLIC_URL`, and its comments say
  why.
- Update the documents (the pointers are checked by `npm run docs:check`, so they change in this step):
  - `architecture.md`, "Database": the examples of hand-written SQL point to the `init` migration.
  - `content-structure.md`, `optimistic-locking.md` and `folder-roles.md`: the pointers in "Code" point to
    `prisma/schema.prisma` and the `init` migration.
  - `folder-roles.md`: delete "Existing installations"; "a trigger of the migration" names the `init` migration.
  - `users-and-login.md`: delete "Existing installations"; "a trigger of the migration" names the `init` migration.
  - `container-image.md`: delete the paragraph on the update to the version with account types.
  - `connected-apps.md`: delete "The update that removed the API tokens".
  - `README.md`: delete the paragraph that says the API tokens are gone.
  - `review-report.md`: in the bullet on the removed API tokens, drop the sentence on their migration and the check on
    the development database, and keep the check that a value of the shape `hw_…` gets `401` at `/mcp`; search the
    report for other pointers to the old migrations. What the review read at its time ("all 16 migrations") stays.
  - `CLAUDE.md`: in the catalog, remove "existing installations" from `users-and-login.md` and `folder-roles.md`, and
    "the update that removed the API tokens" from `connected-apps.md`.
- Search `spec/`, `README.md`, `CLAUDE.md`, `src/`, `e2e/`, `integration/` and `scripts/` for the names of the old
  migrations, `test-folder` as the folder of an update, "existing installation", "earlier versions" and "the update",
  so that no reference is left.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass, with the complete `npm run test:e2e`,
  because the migrations change. The integration and end-to-end tests apply the new migration to a fresh database, and
  `integration/db-errors.test.ts` checks the names of the constraints and the trigger of an admin role.
- The comparison of the two databases above shows no difference other than the allowed ones; the report of the step
  names the differences it found.
- `prisma/migrations/` holds only the `init` directory and `migration_lock.toml`.
- The smoke test of the container image passes (`npm run image:build`, then `npm run image:smoke`; see "Smoke test"
  in `container-image.md`): an empty database gets its tables from the new migration on the first start.
- Manual check for the user: the development database still has the old migration history, so `npm run db:migrate`
  would want to reset it. The user runs `npm run db:reset`, `npm run db:deploy` and `npm run db:seed`, which delete all
  data in it.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed. Here there is no feature spec: add to
   "Database" in `architecture.md` that the history of migrations starts with the one `init`, which holds the
   hand-written parts of the schema at its end, and why: there was no installation whose database had to be kept, so
   the steps between older states were dropped; a database with the older history is recreated. Later schema changes
   get migrations of their own.
2. Remove the feature from `roadmap.md`. It is not there; check that nothing in it refers to the old migrations.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes only documentation,
  so only `npm run check` runs.
