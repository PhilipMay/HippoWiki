# HippoWiki – Development Workflow

How new features are planned, built and finished.

## Step plans

- Each feature from `roadmap.md` is planned in its own file `spec/<feature>-steps.md` before work starts. The new file
  gets an entry in the spec catalog in `CLAUDE.md`.
- A step plan has a goal, a scope (what is in, what is explicitly not in), an ordered checklist of steps, and for every
  step a "Goal", "Build" and "Test" section. "Test" lists the unit and end-to-end tests the step adds (see
  `testing.md`), plus any manual checks that cannot be automated.
- Each step is implemented with one Claude Code call, for example:

  ```text
  Implement the step "Search index" from spec/search-steps.md
  ```

- The steps build on each other and are worked through in order. The call that implements a step ticks it off in the
  checklist once the step is done (see "Rules for every step").
- Once the step is done and ticked off, the same call commits all of the step's changes, including the updated step
  file, as one Git commit on the current branch, without asking first. The message is a short lowercase summary of what
  the step does, for example `add search index`. A step that is not done is not committed.
- If a step shows that the plan needs to change (a missing step, a wrong order, a wrong assumption), the step file is
  updated first and the change is mentioned; then the work continues. Changes to the scope need the user's approval.

## Wrap-up step

The last step of every plan moves its lasting content into the other spec files and removes the plan. It has the same
Goal/Build/Test sections as the other steps, and its Build section covers, in this order:

1. Describe the feature as built in `spec/<feature>.md` (in the style of `pages.md`), or extend an existing feature
   spec; update `architecture.md`, `testing.md` or `tech.md` where conventions changed.
2. Remove the feature from `roadmap.md`.
3. Bring `README.md` up to date.
4. Delete the step file.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove the step file.

## Rules for every step

- A step is done only when `npm run check`, `npm run test:e2e` and `npm run build` pass and its "Test" items have been
  verified.
- Follow the conventions in `architecture.md` and `testing.md`.
- When a step adds a package, use its latest stable version and its current documentation instead of older
  conventions. Upgrading existing packages is a task of its own, not part of a feature step.
- Follow the documentation of the installed version, notably for Next.js (`node_modules/next/dist/docs/`), Prisma,
  Material UI and Zod.
- Keep `README.md` up to date with the commands a developer needs.
- Do not add anything that the plan puts out of scope.

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
```

## Machine setup

The one-time setup of the development machine (Node.js via nvm, Podman, the Playwright browser) is described in
`README.md` under "Prerequisites" and "End-to-end tests".
