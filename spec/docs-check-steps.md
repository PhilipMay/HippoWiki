# Docs Check – Steps

## Goal

A change to documentation only runs a check of its own, `npm run check:docs`, instead of the whole `npm run check`. It
runs only what reads the documentation: Prettier on the Markdown files, the doc references and the unit tests that read
a documentation file, so it takes seconds instead of the type check, lint, knip, the unit tests and the cost tests. The
rules of the workflows and the testing spec name the new command wherever a change is documentation only.

## Scope

- In:
  - a mode `--docs` of `scripts/check.ts` and the command `npm run check:docs` that starts it;
  - the suffix `.docs.test.ts` for a unit test that reads a documentation file, and the rename of
    `src/features/users/example-passwords.test.ts`, which reads `README.md`, to it;
  - the comment at the top of `scripts/check.ts`, which leaves out knip and the cost tests of `npm run check`;
  - the rules that name `npm run check` for a change to documentation only: "Step plans" and "When a step is done" in
    `spec/step-plan-workflow.md`, the approval in `spec/requirements-workflow.md`, and the wrap-up of the step plans in
    `spec/` that still exist;
  - the paragraph "These rules hold for every change …" of "When a step is done", which stands between the sentence
    "A step is done only when both of the following hold:" and its two conditions;
  - the command lists of `README.md`, `CLAUDE.md` and `spec/testing.md`.
- Not in:
  - the workflows of CI, which keep running every check on every push and pull request;
  - a faster `npm run check` or `npm run check:all` for a change to code;
  - telling a change to documentation only apart by itself, for example in a Git hook: the rules decide, as before;
  - a check of the wording of the documentation, such as a Markdown linter, or of the references of the step plans;
  - `AGENTS.md`, which stays out of Prettier because `next dev` rewrites it;
  - the mentions of `npm run check` in `spec/review-report-v2.md`, which say how a review was done and stay true.

## Checklist

- [ ] Docs check command
- [ ] Docs-only rules use the docs check
- [ ] Wrap-up

## Docs check command

### Goal

`npm run check:docs` runs the checks that read the documentation, side by side, and fails when one of them fails, in
the same way as `npm run check`.

### Build

- `scripts/check.ts` gets a mode `--docs`. It runs, side by side and without `next typegen`, which only the code needs:
  - Prettier on the Markdown files of the repository: `prettier --check "**/*.md"`. Prettier also reads the Markdown
    files in directories that start with a dot, such as `.claude/`, and leaves out what `.prettierignore` and Git
    ignore, so `AGENTS.md` stays out;
  - `npm run docs:check`;
  - the unit tests that read a documentation file: `vitest run --project unit .docs.test.ts`.
- As in the other modes, every check runs also when another one fails, each prints its output as one block when it is
  done, and the last line and the exit code say whether all passed. `--docs` together with `--all` is refused with a
  message and the exit code 1.
- The comment at the top of `scripts/check.ts` names what each mode runs: `npm run check` with knip and the cost tests,
  `npm run check:all` and `npm run check:docs`.
- `package.json` gets the script `"check:docs": "tsx scripts/check.ts --docs"`.
- `src/features/users/example-passwords.test.ts` is renamed to `example-passwords.docs.test.ts`. The project `unit` of
  `vitest.config.ts` still includes it, so `npm run check` and `npm run test:unit` still run it; the comment of that
  project says that `npm run check:docs` runs the unit tests ending in `.docs.test.ts`.
- `README.md` lists `npm run check:docs` in "Commands", next to `npm run check`, and `CLAUDE.md` in "Running the
  Checks", each with what it runs.

### Test

- `npm run check:docs` passes. The report of the step gives its time next to the time of `npm run check`.
- Manual checks, each made and reverted before the commit, so that none of them is committed:
  - a Markdown file in `spec/` and one in `.claude/skills/` with a formatting error each make the Prettier check of
    `npm run check:docs` fail, and its output names both files;
  - a code span in `spec/testing.md` that names a file that does not exist makes `docs:check` fail;
  - a value of `HIPPOWIKI_ADMIN_PASSWORD` in `README.md` that the admin setup accepts makes the unit test fail;
  - with all three at once, all three checks fail in one run, and the exit code is 1.
- `npm run check` still runs `example-passwords.docs.test.ts`: it appears in the output of `test:unit`.
- `npm run check:docs` writes nothing (`git status` shows no change after it) and needs no Podman.
- `npx tsx scripts/check.ts --docs --all` is refused with the exit code 1.
- The step changes nothing that the app runs, so no end-to-end spec is affected; it is the last step of the plan that
  changes more than documentation, so the complete `npm run test:e2e` runs once (see "The complete end-to-end suite"
  in `spec/step-plan-workflow.md`).

## Docs-only rules use the docs check

### Goal

Every rule that names a check for a change to documentation only names `npm run check:docs`, and `spec/testing.md`
describes the new command and the suffix `.docs.test.ts`.

### Build

- `spec/step-plan-workflow.md`:
  - "Step plans": a new step plan, which is documentation only, is followed by `npm run check:docs` instead of
    `npm run check`.
  - "When a step is done": the paragraph "These rules hold for every change …" moves above "A step is done only when
    both of the following hold:", so that the sentence leads straight to its two conditions. The first condition says
    that a step that changes only documentation runs `npm run check:docs` instead of both commands.
  - "Changes to documentation only": the step is done when `npm run check:docs` passes and its "Test" items have been
    verified. Say what it runs and why the rest of `npm run check` does not run: the type check, lint, knip, the other
    unit tests and the cost tests read no documentation, and the integration tests, the end-to-end tests and the
    build do not either. A file in `.claude/skills/` or `.claude/agents/` that is not Markdown, such as a script, is not
    documentation. The report of the step says that only `npm run check:docs` ran and why.
- `spec/requirements-workflow.md`: the approval in step 6 runs `npm run check:docs` instead of `npm run check`.
- `spec/testing.md`:
  - "Checks and coverage": what `npm run check:docs` runs, that it writes nothing and needs no Podman, and that the
    rules of "Changes to documentation only" in `step-plan-workflow.md` say when it runs in place of `npm run check`.
  - "Unit tests": a unit test that reads a documentation file (the files that "Changes to documentation only" names)
    ends in `.docs.test.ts`, so that `npm run check:docs` runs it; it stays in the project `unit`.
  - "Doc references": `npm run docs:check` is part of `npm run check`, of `npm run check:docs` and of the `lint`
    workflow.
- Every step plan in `spec/` that still exists and names `npm run check` for a step or a wrap-up that changes only
  documentation, such as the wrap-up of `spec/file-copy-links-steps.md`, names `npm run check:docs` instead.
- Search `spec/`, `README.md`, `CLAUDE.md`, `.claude/skills/` and `.claude/agents/` for `npm run check`: each mention
  that remains is meant for a change to code, or is one of `spec/review-report-v2.md` (see "Scope").

### Test

- The step changes only documentation, so `npm run check:docs` passes, and no end-to-end spec runs.
- `grep -rn "npm run check" spec README.md CLAUDE.md .claude` shows no mention that names `npm run check` for a change
  to documentation only.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. The feature has no spec of its own: the command and its rules are described in `spec/testing.md` and
   `spec/step-plan-workflow.md` since the step "Docs-only rules use the docs check". Check that they describe it as
   built, and add to "Checks and coverage" of `spec/testing.md` why the docs check is a command of its own rather than
   a change of `npm run check`: `npm run check` has to run every check for a change to code, and the documentation
   needs only three of them.
2. `spec/roadmap.md` holds no item for this feature; nothing is removed.
3. Check that "Commands" in `README.md` lists `npm run check:docs`; the summary of what the prototype can do does not
   change, because the feature is a tool of the development.
4. Delete this step file. The feature has no requirements file and no requirement IDs.
5. Update the spec catalog in `CLAUDE.md`: remove the entry of this step file. No spec file is added, and the
   questions of the entries of `spec/testing.md`, `spec/step-plan-workflow.md` and `spec/requirements-workflow.md` do
   not change.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes only documentation,
  so it runs `npm run check:docs`.
- `grep` finds no `docs-check-steps` in `spec/`, `README.md` and `CLAUDE.md`.
