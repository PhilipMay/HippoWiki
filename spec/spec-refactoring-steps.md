# Spec Refactoring – Steps

## Goal

Every fact about HippoWiki has one home. The feature specs say what a user or operator can rely on and why; the code,
its comments and the tests say how, and the specs point to them instead of restating them. `README.md` holds the
commands and links to the spec instead of repeating it. A check keeps the references in `spec/`, `README.md` and
`CLAUDE.md` from pointing to files that do not exist.

Where each kind of information lives after this plan:

| Kind of information                                                | Its one home                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| Model fields, constants, patterns, limits                          | the code (`prisma/schema.prisma`, `limits.ts`, …)    |
| How a read or write works (queries, transactions, retries)         | comments next to the code                            |
| Exact messages, focus and hydration details, every not-found case  | the end-to-end and integration tests                 |
| What a user or operator can rely on, including security invariants | the feature spec                                     |
| Why (decisions and the alternatives that were rejected)            | the feature spec, "Decisions"                        |
| What is deliberately missing                                       | the feature spec, "Current limits", and `roadmap.md` |
| Rules for new code                                                 | `architecture.md`, `testing.md`                      |
| Environment variables and what the environment has to provide      | `container-image.md`                                 |
| Commands, prerequisites, first steps                               | `README.md`                                          |

## Scope

- In:
  - a section "Feature specs" in `workflow.md` that defines what a feature spec holds, used by the wrap-up step
    instead of "in the style of `pages.md`"
  - a check of the file references in `spec/`, `README.md` and `CLAUDE.md`, run by `npm run check` and in CI
  - fixing the reference to `reports/Login lockout and client IP handling.md`, which does not exist
  - moving explanations that only the spec has into comments in the code, before they leave the spec
  - rewriting `pages.md`, `content-structure.md`, `page-deletion.md`, `users-and-login.md` and `container-image.md`
    by the new rules
  - removing the file inventory from `architecture.md` and the copies of spec content from `README.md`
  - one line in the checklist of `issue-report.md`
- Not in:
  - any change to how the app, the scripts or the image behave; changes to code files are comments only, apart from
    the new reference check
  - changes to tests, the schema or migrations
  - new feature spec files, or merging or splitting the existing ones
  - changes to `roadmap.md`, `tech.md` and `testing.md` beyond what this plan names
  - changes to the process rules of `workflow.md` other than the wrap-up step and its template
  - references to line numbers

## Checklist

- [x] Feature spec rules and reference check
- [x] Explanations into the code
- [x] Content specs
- [ ] Users and login spec
- [ ] Container image spec
- [ ] README and architecture
- [ ] Wrap-up

## Feature spec rules and reference check

### Goal

The rules for feature specs are written down before any spec is rewritten, and broken references are caught by
`npm run check`.

### Build

- Add a section "Feature specs" to `workflow.md`, after "Wrap-up step":
  - A feature spec says what a user or operator can rely on and why, and points to the code for how.
  - Its parts, in this order: a short purpose; pointers to the code and the tests; the rules, under headings of their
    own as the feature needs them (such as "Addresses" or "Failed logins"); "Decisions"; "Current limits".
  - A rule is something a user, an operator or other code relies on. A guarantee that must hold, above all one about
    security, stays in the spec as a rule even where the code shows the mechanism, because the spec is what a review
    checks the code against.
  - A feature spec does not contain: the field lists of the models, constants and patterns that the code names, exact
    messages, focus, hydration and layout details, and how a read or write works (which query, condition or
    transaction it uses). These live in the code, its comments and the tests.
  - Pointers name files, directories and test files, and a function only where a reader needs that one function.
    They never name line numbers.
- In "Wrap-up step" and in the step plan template, replace "(in the style of `pages.md`)" with a reference to
  "Feature specs".
- Add `scripts/check-doc-references.ts` and the script `docs:check` (`tsx scripts/check-doc-references.ts`) to
  `package.json`; add it to `check` right after `format:check`.
  - It reads `spec/*.md`, `README.md` and `CLAUDE.md` and takes every code span that starts with a top-level directory
    or file of the repository (`src/`, `prisma/`, `scripts/`, `e2e/`, `integration/`, `spec/`, `.github/`,
    `Containerfile`, `package.json`, …) or that is the name of a file in `spec/` (such as `pages.md`).
  - It skips spans with a placeholder or a glob (`<`, `*`), and paths that Git ignores (`coverage/`, `build/`,
    `src/generated/`), found with `git check-ignore`.
  - A span is fine when the path exists, or, for a command such as `scripts/image.sh smoke`, when its first word is an
    existing file.
  - Every broken reference is printed with its file and line; the script exits with 1 if there is any.
  - Bare file names inside a sentence that already names their directory, such as `wait.ts`, are not checked.
  - A span that ends in `.md` is checked as a whole path, from the repository root and, for a bare name, also in
    `spec/`, so that a reference into a directory that does not exist at all (such as `reports/`) is caught. A rule
    "every span with a slash" would flag package names and other non-paths such as `next/server` or `linux/arm64`.
  - Step plans (`spec/*-steps.md`) are skipped: they name files that do not exist yet, and this plan quotes the
    broken `reports/` reference itself. `testing.md` says so.
- Add a step `npm run docs:check` to the `lint` workflow, after `npm run lint`.
- Remove the reference to `reports/Login lockout and client IP handling.md` from `users-and-login.md` ("Decisions")
  and `roadmap.md` ("Login and Sessions"); the text around it stays.
- Add to the checklist of `issue-report.md`: "A spec restates code, a constant or a message instead of pointing to
  it".
- Name `docs:check` in `testing.md` (CI, `lint` workflow), in `README.md` ("Commands") and in the comment of
  `npm run check` in `CLAUDE.md`.

### Test

- Manual: `npm run docs:check` passes on the tree after this step.
- Manual: with the `reports/` reference put back for a moment, `npm run docs:check` fails and names its file and
  line; with `scripts/image.sh smoke` it passes. Undo the change afterwards.
- No end-to-end spec runs: the step changes nothing that the app runs.

## Explanations into the code

### Goal

Before the rewrites remove the "how" from the specs, every explanation that only the spec has is in a comment next to
the code it explains, so no reasoning is lost.

### Build

- For each passage the rewrite steps will remove, check whether the code or its comments already explain it. If not,
  add a comment where the code does it. The candidates:
  - the counting of failed logins in `src/features/auth/`: the conditional writes and the rows they name, the retry
    limit and why a round is lost at most twice per other login, `releaseAttempt()` and the deleting of old rows
  - the client address group in `src/lib/client-address.ts`: which `X-Forwarded-For` entry is used and why, the IPv6
    /64 grouping
  - the title heading rule in `src/features/pages/derive.ts`: what counts as a title heading and what does not
  - delete and restore in `src/features/pages/service.ts`: why the tab is set to `null`, which conflicts give which
    code
  - the start of the image in `scripts/image-start.sh` and the admin setup: order, exit codes, the second of two
    containers that start together
  - the checks of `scripts/image.sh smoke`: a short list at the top of the smoke test, so that `container-image.md`
    can point to it
- Comments explain why and what must hold; they do not repeat what the code says line by line. Follow the existing
  comment style.

### Test

- Manual: `git diff` of the step shows changes to comments only.
- No end-to-end spec runs: comments change nothing that the app runs.

## Content specs

### Goal

`page-deletion.md`, `pages.md` and `content-structure.md` follow "Feature specs" in `workflow.md`.

### Build

- Rewrite `page-deletion.md` first (now 86 lines, about 35 expected), as the example for the others:
  - keep: the purpose, the pointers, the rules a user sees (deleted pages are invisible everywhere, their names are
    free at once, a deleted page has an address by id, a page is restored only into its own folder, no place is
    preselected when restoring), the limits
  - remove: the `updateMany` conditions, the error strings, which button is disabled until hydration
- Rewrite `pages.md` (now 108 lines, about 55 expected):
  - keep: the title heading rule as behaviour, the suggested name, that the name never changes automatically, the
    routes and what each shows, the image rule of the Content Security Policy, the limits
  - remove: the model field list (point to `prisma/schema.prisma`), the length limits (point to `limits.ts`), the
    detailed title derivation now in `derive.ts`, the messages and focus details
- Rewrite `content-structure.md` (now 190 lines, about 110 expected):
  - keep: the overview of the three levels, the composite foreign key as a guarantee, the scopes where names are
    unique, the addresses, the table of actions, the routes, the order of lists, the limits
  - remove: the name pattern and its messages (point to `src/lib/names.ts`), the write mechanics, the component names
    except where a reader needs them

### Test

- Manual: for every removed passage, the rule is in the code, a comment or a test, or it was only a detail of how.
  The report of the step lists anything that fits none of these and was kept for that reason.
- `npm run docs:check` passes (part of `npm run check`).
- No end-to-end spec runs: the step changes nothing that the app runs.

## Users and login spec

### Goal

`users-and-login.md` follows "Feature specs" in `workflow.md` (now 352 lines, about 170 expected).

### Build

- Keep: the purpose, the pointers, the admin account and forced password change as rules, the two login limits with
  their numbers as rules a user meets, the guarantee that logins at the same time get no more guesses than logins one
  after another, that an unknown name waits like a known one, the client address groups as rules, authenticated
  access only, "Decisions" in full, the limits.
- Remove: the model field list (point to `prisma/schema.prisma`), the mechanics of counting (conditional writes, the
  retry limit, the release of a count, the deleting of old rows), the exact messages, the details of the forms.
- The numbers of the login limits stay in the spec, because users and operators rely on them; the spec names
  `wait.ts` as the place where they are defined.

### Test

- Manual: as in "Content specs", every removed passage is covered by the code, a comment or a test.
- `npm run docs:check` passes.
- No end-to-end spec runs: the step changes nothing that the app runs.

## Container image spec

### Goal

`container-image.md` follows "Feature specs" in `workflow.md` (now 367 lines, about 220 expected) and is the one
place for the configuration of a container.

### Build

- Keep: the image and its stages in short, the start with the migration and the admin setup as rules, "Configuration"
  and "What the environment has to provide" in full (they are for operators), publishing, "Decisions", the limits.
- Remove: the messages and exit details of the admin setup (point to `scripts/admin.ts` and the image scripts), the
  list of checks of the smoke test (point to `scripts/image.sh`).

### Test

- Manual: as in "Content specs", every removed passage is covered by the code, a comment or a test.
- `npm run docs:check` passes.
- No end-to-end spec runs: the step changes nothing that the app runs.

## README and architecture

### Goal

`README.md` holds the commands and first steps and links to the spec for behaviour; `architecture.md` holds the rules
for new code without a file inventory.

### Build

- `README.md` (now 306 lines, about 200 expected):
  - keep: what the prototype can do in short, prerequisites, getting started, the seed users, every command, the
    commands of the container image
  - replace with a link to the spec: the details of the login wait and the password change ("Users"), the environment
    variables and the start of the container, and the list of smoke test checks ("Container image")
- `architecture.md` (now 287 lines): in "Layout", keep the directories and what belongs in each, and remove the list of
  every module in `src/lib/` with its functions. The rules of the other sections stay.

### Test

- Manual: every command that `README.md` had is still in it.
- `npm run docs:check` passes.
- No end-to-end spec runs: the step changes nothing that the app runs.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `workflow.md`), or extend an existing
   feature spec; update `architecture.md`, `testing.md` or `tech.md` where conventions changed. Here: check that
   "Feature specs" in `workflow.md` and the reference check in `testing.md` describe what was built.
2. Remove the feature from `roadmap.md`. Here: there is no entry.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file. Here also: update the
   descriptions of the rewritten specs, which name sections that no longer exist (such as "model" and "input rules"
   of `pages.md`).

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
- Manual: a review of the rewritten specs under `spec/issue-report.md`, with the new checklist line.
