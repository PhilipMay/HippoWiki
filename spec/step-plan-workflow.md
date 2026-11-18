# HippoWiki – Development Workflow

How new features are planned, built and finished. The rules for implementing a step are addressed to you, the AI that
implements it.

## Step plans

- Each feature from `roadmap.md` is planned in its own file `spec/<feature>-steps.md` before work starts. The new file
  gets an entry in the spec catalog in `CLAUDE.md`.
- When the feature has a requirements file `spec/<feature>-requirements.md` (see `requirements-workflow.md`), the step
  plan is written only once that file has the status `approved`, and it is written from it: its scope matches the
  scope of the requirements, every requirement ID is covered by a step, and the "Test" sections check the acceptance
  criteria. The requirements file is already committed when the conversation that gathered it ends.
- Once a new step plan is written and added to the spec catalog, run `npm run check`; fix formatting with
  `npm run format`. Then commit the step file and its catalog entry in `CLAUDE.md` as one Git commit on the current
  branch, without asking first. Stage only these two files. The message is a short lowercase summary, for example
  `plan search`. Do not push.
- Then stop, so that the user can review the plan before any step is built. Report the steps of the plan and the
  commit message. Do not say how to start implementing the plan, and do not offer to.
- A step plan has a goal, a scope (what is in, what is explicitly not in), an ordered checklist of steps, and for every
  step a "Goal", "Build" and "Test" section. "Test" lists the unit, integration and end-to-end tests the step adds (see
  `testing.md`), plus any manual checks that cannot be automated.
- A whole step plan is implemented in one session, step by step, started with a prompt such as:

  ```text
  Implement spec/search-steps.md
  ```

- In that session, work through the steps one after the other, in checklist order, starting with the first step that
  is not ticked off, until the plan is finished, wrap-up included. Do not ask the user between steps whether to go on.
  The same prompt resumes a plan that was interrupted: the steps that are already ticked off are skipped.
- A large plan can name stop points: its section "Sessions" lists the steps after which a session ends. A session then
  works through the steps up to the next stop point and ends there, also when later steps are still open. The same
  prompt starts the next session at the first step that is not ticked off. At a stop point:
  - The last step of the session that changes anything but documentation runs the complete `npm run test:e2e` in
    place of the specs it affects, so that the whole suite has passed before the push (see "When a step is done"). A
    session that changes only documentation runs none.
  - Once the last step of the session is committed, push the current branch with `git push`, without asking first,
    as after the wrap-up step.
  - The final reply names the stop point and the step the next session starts with.
  - A session that stops early does not push (see "When a step cannot be finished").
- The steps build on each other. Finish each step completely (done, ticked off, committed) before you start the next
  one; never work on two steps at once. Before you start a step, check that every earlier step is ticked off and that
  the working tree is clean; otherwise stop and ask the user. Tick a step off in the checklist once it is done (see
  "When a step is done").
- Once a step is done and ticked off, commit all of its changes, including the updated step file, as one Git commit on
  the current branch, without asking first, then go on with the next step. The message is a short lowercase summary of
  what the step does, for example `add search index`. A step that is not done is not committed (see "When a step cannot
  be finished").
- Once the wrap-up step is committed and the plan is finished, push the current branch with `git push`, without asking
  first. Push only then and at a stop point of the plan: not after each step, and not when the plan stops early (see
  "When a step cannot be finished").
- Never force-push. If the push fails (for example because the remote has new commits or the branch has no upstream),
  stop and report the error with the relevant part of its output; do not pull, rebase or merge to fix it. The commits
  stay local.
- After each commit, give a short report of the step: what it built, the commit message, any change to the plan, and
  the manual checks left for the user. Then continue with the next step. Your final reply, once the plan is finished or
  stopped, sums up all steps of the session and says whether the push succeeded.
- If a step shows that the scope needs to change (something the plan puts out of scope is needed, or something in scope
  should be dropped): stop before writing any code for the change, ask the user, and commit nothing. Once the user has
  approved the change, update the scope in the step file, and in the requirements file if there is one, and continue
  with the step and the rest of the plan. If the user declines it, continue within the existing scope, or follow "When
  a step cannot be finished" if the step cannot be done without the change.
- If a step shows that the plan needs another change (a missing step, a wrong order, a wrong assumption): update the
  step file first, then continue. Name the change in the report of the step, and commit it together with the step.

## Wrap-up step

The last step of every plan moves its lasting content into the other spec files and removes the plan. It has the same
Goal/Build/Test sections as the other steps, and its Build section covers, in this order (the template below has the
same items, ready to copy):

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs"), or extend an existing feature spec, and
   move the rules and decisions of the requirements file that still hold into it; update `architecture.md`,
   `testing.md` or `tech.md` where conventions changed.
2. Remove the feature from `roadmap.md`.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

The wrap-up step is not ticked off, because its step file is deleted; its commit includes the deletion of the step
file and the requirements file. The push of the finished plan follows this commit (see "Step plans"). Otherwise it
follows the same rules as every other step.

## Feature specs

A feature spec (`spec/<feature>.md`) describes a feature as built. The wrap-up step of its plan writes or extends it.

- A feature spec says what a user or operator can rely on and why, and points to the code for how.
- Its parts, in this order: a short purpose; pointers to the code and the tests; the rules, under headings of their own
  as the feature needs them (such as "Addresses" or "Failed logins"); "Decisions"; "Current limits".
- A rule is something a user, an operator or other code relies on. A guarantee that must hold, above all one about
  security, stays in the spec as a rule even where the code shows the mechanism, because the spec is what a review
  checks the code against.
- A feature spec does not contain: the field lists of the models, constants and patterns that the code names, exact
  messages, focus, hydration and layout details, and how a read or write works (which query, condition or transaction
  it uses). These live in the code, its comments and the tests.
- A number that a user or an operator relies on, such as the lengths of a password or the waits after failed logins,
  is a rule and stays in the spec, next to a pointer to the file that defines it. Internal limits that nobody outside
  the code meets, such as a retry count, stay in the code.
- Pointers name files, directories and test files, and a function only where a reader needs that one function. They
  never name line numbers. `npm run docs:check` checks that the files they name exist (see `testing.md`).
- "Decisions" gives the reasons and the alternatives that were rejected; "Current limits" says what is deliberately
  missing, and `roadmap.md` holds what may come later.

## Rules for every step

- Follow the conventions in `architecture.md` and `testing.md`.
- Follow the documentation of the installed version of each package, notably Next.js (`node_modules/next/dist/docs/`),
  Prisma, Material UI and Zod, instead of older conventions. When a step adds a package, use its latest stable version.
  Upgrading existing packages is a task of its own, not part of a feature step.
- Keep `README.md` up to date with the commands a developer needs.
- Do not add anything that the plan puts out of scope.

## When a step is done

A step is done only when both of the following hold:

- These commands pass, in this order. A step that changes only documentation runs `npm run check` instead of both
  (see "Changes to documentation only" below).
  1. `npm run check:all`: `npm run check`, `npm run test:integration` and `npm run build`, run side by side by
     `scripts/check.ts`, then the cost tests alone. Every check runs also when another one fails, so one run shows all
     failures.
  2. The end-to-end tests, only after `npm run check:all` is done and never at the same time: the integration and
     end-to-end tests use the same test database container and port (see `testing.md`). In every step except the
     wrap-up, only the specs the step affects (see below), for example `npm run test:e2e -- e2e/<name>.spec.ts`; in a
     wrap-up step that changes more than documentation, the complete `npm run test:e2e`, so that the whole suite has
     passed before the push. In a plan with stop points, the complete suite also runs in the last step of each
     session that changes anything but documentation (see "Step plans"). The complete suite takes about five minutes:
     run it with a timeout long enough or in the background, so that it is not cut off and run again.
- Its "Test" items have been verified. Do the manual checks you can yourself, for example in the browser. A manual
  check you cannot do does not hold the step back: list it in the report of the step so that the user can do it. Never report
  a check as done that you did not do.

The end-to-end specs a step affects:

- The specs the step adds or changes, and the specs that test the routes, actions and features whose code the step
  changes.
- The complete suite instead, when the step changes something every page depends on: `src/proxy.ts`, the root layout,
  `src/features/auth/session.ts`, a module of `src/lib/` that every request uses, `next.config.ts`,
  `playwright.config.ts`, `e2e/support/`, or `prisma/schema.prisma` and its migrations in a way that changes what is
  there: a table, column, constraint or index that is changed, renamed or removed, a new unique constraint, a new
  column without a default that may not be empty, or a migration that changes data.
- A change of `prisma/schema.prisma` and its migrations that only adds (new tables, new columns that may be empty or
  have a default, new indexes that are not unique) runs the specs of the features whose models it changes, and
  `e2e/smoke.spec.ts`, which loads a page and resets the test database on the migrated schema. The complete suite of
  the wrap-up still covers all features.
- No spec, when the step changes nothing that the app runs yet, such as a pure module that nothing imports.
- When it is unclear whether a spec is affected, run it.

Changes to documentation only:

- A step that changes only documentation (the files in `spec/`, `README.md`, `CLAUDE.md`, `AGENTS.md` and the skills in
  `.claude/skills/`) is done when `npm run check` passes and its "Test" items have been verified. The integration
  tests, the end-to-end tests and the build do not run, because none of them reads these files.
- This also holds for the wrap-up step. When the wrap-up step changes only documentation, the complete end-to-end
  suite does not run locally before the push; CI runs it on the push (see `testing.md`).
- A step that also changes any other file, such as code, configuration, `.env.example` or a fixture, is not
  documentation only and runs all the commands above.
- The report of the step says that only `npm run check` ran and why.
- The report of the step names the specs that ran, or says that none ran and why.

A failure that only the complete suite of the wrap-up step shows is fixed in the wrap-up step, also when an earlier step
caused it, and the fix is named in its report. The same holds for the complete suite at a stop point: the step that
runs it fixes the failure. If it cannot be fixed, follow "When a step cannot be finished": nothing is pushed.

`npm run test:e2e:production` is left out of this list on purpose: CI runs it on every push to `main` and on every pull
request (`end_to_end_tests_production`, see `testing.md`). Run it as well when the step changes something that only
exists in a production build, such as prerendering, the route cache or `error.tsx`, for the specs the step affects
(`npm run test:e2e:production -- e2e/<name>.spec.ts`). When you run it, it runs last, after the end-to-end tests and
never in parallel with the other commands (it uses the same test database container), and it must pass like them.

After a fix, the step runs from the point of failure:

- An end-to-end test failed: run only the failed tests first, with `npm run test:e2e -- --last-failed`, until they
  pass. Then run both commands of the step once more, in full, because the fix may have broken something else.
- `npm run check:all` failed: fix every failure it reported, then run it again.

A test that fails and then passes when run again, without a change in between, is flaky: the step is not done, so
follow "When a step cannot be finished".

## When a step cannot be finished

If a command fails or a "Test" item fails and you cannot fix it within the step (for example a check keeps failing,
Podman is not running, or an end-to-end test fails only now and then):

- Stop the whole plan, not only the step: do not start any later step. The steps committed before stay as they are.
- Do not tick the step off and do not commit.
- Do not push; the steps committed before stay local.
- Leave the changes in the working tree.
- Stop and report which command failed, with the relevant part of its output.
- Never skip, weaken or delete tests, and never loosen lint, type or format rules, to make the checks pass.
- If you believe a failure was already there before the step, say so separately from the failures the step caused, and
  say why. Do not stash, reset or check out anything to find out.
- Do not rerun a failing command over and over until it passes; report a flaky test instead.

## Fixing a finding of the review report

`review-report.md` holds only open findings. A fixed finding is deleted from it, and every document that relies on the
finding is brought in line in the same change, so the report and the specs never disagree. This holds for a finding
fixed on its own and for one fixed in a step of a plan, where all of it goes into the commit of that step. The checks
are those of "When a step is done", with "Changes to documentation only" for a fix that changes only documentation.

1. Fix the finding in the code or in the documentation. A finding whose Suggestion has the confidence High (see
   "Confidence levels" in `issue-report.md`) is fixed as its Suggestion describes; a finding with Medium, Low or no
   confidence is fixed only as agreed with the user, which is the line Decision of the finding once the user has
   decided.
2. Update the feature spec that the fix touches, and `architecture.md`, `testing.md` or `tech.md` where a rule or a
   convention changed. A finding that is closed by a documented reason instead of a change (a decision or a current
   limit in a feature spec) gets an entry in "Accepted deviations" of the report, with the ID of the requirement and
   the place in the spec.
3. Delete the section of the finding from `review-report.md`.
4. Bring the rest of the report in line:
   - "Summary": the counts by severity and by label, the "To fix first" list (remove the item and renumber the
     others), and "Not covered by this review" where it names the finding.
   - Each requirement the finding was the result for (ASVS, BSI, CWE, OWASP and the other standards) moves into the
     "Reviewed" list of its area, with what the fix does and how it was checked, so that "Standards coverage" stays
     complete.
   - Remove or reword every reference to the finding: "finding above" and similar in the "Reviewed" lists, "Accepted
     deviations", the tables of "Standards coverage" and "Open questions".
5. Update `roadmap.md` where it holds the same item, and `README.md` where a command or a setup step changed.
6. Search `spec/`, `README.md` and `CLAUDE.md` for the title and the key words of the finding, so that no reference to
   it is left.
7. When the last finding and the last open question are gone, move the content of the report that still applies to
   its place ("Checks on the deployment" into "What the environment has to provide" of `container-image.md`, and the
   item of `roadmap.md` that points to it), delete `review-report.md` and remove it from the spec catalog in
   `CLAUDE.md`.

## Step plan template

```markdown
# <Feature> – Steps

## Goal

What the feature does for the user, in two or three sentences.

## Scope

- In: …
- Not in: …

## Checklist

- [ ] <First step>
- [ ] …
- [ ] Wrap-up

## <First step>

### Goal

### Build

### Test

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed.
2. Remove the feature from `roadmap.md`.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
```

## Machine setup

The one-time setup of the development machine (Node.js via nvm, Podman, the Playwright browser) is described in
`README.md` under "Prerequisites" and "End-to-end tests".
