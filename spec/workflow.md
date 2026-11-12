# HippoWiki – Development Workflow

How new features are planned, built and finished. The rules for implementing a step are addressed to you, the AI that
implements it.

## Step plans

- Each feature from `roadmap.md` is planned in its own file `spec/<feature>-steps.md` before work starts. The new file
  gets an entry in the spec catalog in `CLAUDE.md`.
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
- The steps build on each other. Finish each step completely (done, ticked off, committed) before you start the next
  one; never work on two steps at once. Before you start a step, check that every earlier step is ticked off and that
  the working tree is clean; otherwise stop and ask the user. Tick a step off in the checklist once it is done (see
  "When a step is done").
- Once a step is done and ticked off, commit all of its changes, including the updated step file, as one Git commit on
  the current branch, without asking first, then go on with the next step. The message is a short lowercase summary of
  what the step does, for example `add search index`. A step that is not done is not committed (see "When a step cannot
  be finished").
- After each commit, give a short report of the step: what it built, the commit message, any change to the plan, and
  the manual checks left for the user. Then continue with the next step. Your final reply, once the plan is finished or
  stopped, sums up all steps of the session.
- If a step shows that the scope needs to change (something the plan puts out of scope is needed, or something in scope
  should be dropped): stop before writing any code for the change, ask the user, and commit nothing. Once the user has
  approved the change, update the scope in the step file and continue with the step and the rest of the plan. If the
  user declines it, continue within the existing scope, or follow "When a step cannot be finished" if the step cannot
  be done without the change.
- If a step shows that the plan needs another change (a missing step, a wrong order, a wrong assumption): update the
  step file first, then continue. Name the change in the report of the step, and commit it together with the step.

## Wrap-up step

The last step of every plan moves its lasting content into the other spec files and removes the plan. It has the same
Goal/Build/Test sections as the other steps, and its Build section covers, in this order (the template below has the
same items, ready to copy):

1. Describe the feature as built in `spec/<feature>.md` (in the style of `pages.md`), or extend an existing feature
   spec; update `architecture.md`, `testing.md` or `tech.md` where conventions changed.
2. Remove the feature from `roadmap.md`.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file.

The wrap-up step is not ticked off, because its step file is deleted; its commit includes the deletion of the step
file. Otherwise it follows the same rules as every other step.

## Rules for every step

- Follow the conventions in `architecture.md` and `testing.md`.
- Follow the documentation of the installed version of each package, notably Next.js (`node_modules/next/dist/docs/`),
  Prisma, Material UI and Zod, instead of older conventions. When a step adds a package, use its latest stable version.
  Upgrading existing packages is a task of its own, not part of a feature step.
- Keep `README.md` up to date with the commands a developer needs.
- Do not add anything that the plan puts out of scope.

## When a step is done

A step is done only when both of the following hold:

- These commands pass. Run them one after another, in this order, and never in parallel: the integration and
  end-to-end tests use the same test database container and port (see `testing.md`).
  1. `npm run check`
  2. `npm run test:integration`
  3. `npm run test:e2e`
  4. `npm run build`
- Its "Test" items have been verified. Do the manual checks you can yourself, for example in the browser. A manual
  check you cannot do does not hold the step back: list it in the report of the step so that the user can do it. Never report
  a check as done that you did not do.

`npm run test:e2e:production` is left out of this list on purpose: CI runs it on every push to `main` and on every pull
request (`end_to_end_tests_production`, see `testing.md`). Run it as well when the step changes something that only
exists in a production build, such as prerendering, the route cache or `error.tsx`. When you run it, it runs last,
after `npm run build` and never in parallel with the other commands (it uses the same test database container), and it
must pass like them.

A test that fails and then passes when run again is flaky: the step is not done, so follow "When a step cannot be
finished".

## When a step cannot be finished

If a command fails or a "Test" item fails and you cannot fix it within the step (for example a check keeps failing,
Podman is not running, or an end-to-end test fails only now and then):

- Stop the whole plan, not only the step: do not start any later step. The steps committed before stay as they are.
- Do not tick the step off and do not commit.
- Leave the changes in the working tree.
- Stop and report which command failed, with the relevant part of its output.
- Never skip, weaken or delete tests, and never loosen lint, type or format rules, to make the checks pass.
- If you believe a failure was already there before the step, say so separately from the failures the step caused, and
  say why. Do not stash, reset or check out anything to find out.
- Do not rerun a failing command over and over until it passes; report a flaky test instead.

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

1. Describe the feature as built in `spec/<feature>.md` (in the style of `pages.md`), or extend an existing feature
   spec; update `architecture.md`, `testing.md` or `tech.md` where conventions changed.
2. Remove the feature from `roadmap.md`.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
```

## Machine setup

The one-time setup of the development machine (Node.js via nvm, Podman, the Playwright browser) is described in
`README.md` under "Prerequisites" and "End-to-end tests".
