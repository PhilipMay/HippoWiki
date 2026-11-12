# HippoWiki – Review of workflow.md

Review of `spec/workflow.md`, following the structure and severity levels in `issue-report.md`.

## Summary

The workflow is clean, short and mostly helpful for AI use. There are no blockers and no hard contradictions, apart
from one conflict in the wrap-up step. The main gaps are what to do when a step fails and some cases the file does not
cover.

- Blocker: 0
- Major: 1
- Minor: 8
- Nit: 3

What is good:

- "Done" is defined by commands that can be run, and "not done means not committed" is unambiguous.
- The example call for a step is ready to copy and paste.
- The Goal/Build/Test split of each step gives an AI a clear contract.
- The order of the wrap-up step is spelled out.

## Issues

### No rule for a step that cannot be finished

- **Location:** `spec/workflow.md`, "Step plans" and "Rules for every step"
- **Severity:** Major
- **Category:** docs
- **Problem:** The file says what happens when a step is done, but not when it is not: a check fails, Podman is not
  running, an end-to-end test is flaky, or a failure was already there before the step.
- **Impact:** This is the most common situation in which an AI guesses. It may weaken or skip tests to get to green,
  retry forever, or stop with an unclear dirty working tree.
- **Evidence:** "A step that is not done is not committed." That is the only rule on this case.
- **Suggestion (required):** Add a short procedure:
  - Do not tick and do not commit.
  - Leave the changes in the working tree.
  - Report which command failed, with its output.
  - Never skip, weaken or delete tests to make checks pass.
  - Call out failures that were already there separately.

### The done rule skips the production end-to-end run

- **Location:** `spec/workflow.md`, "Rules for every step", first bullet
- **Severity:** Minor
- **Category:** tests
- **Problem:** The rule lists `check`, `test:integration`, `test:e2e` and `build`, but not `test:e2e:production`.
  `testing.md` says that run covers what only exists in a production build, and CI runs it.
- **Impact:** A step can count as done locally and still fail in CI.
- **Evidence:** "`npm run check`, `npm run test:integration`, `npm run test:e2e` and `npm run build` pass"
- **Suggestion (optional):** Add it, or state on purpose that CI covers it.

### The integration and end-to-end tests must not run at the same time

- **Location:** `spec/workflow.md`, "Rules for every step", first bullet
- **Severity:** Minor
- **Category:** docs
- **Problem:** `testing.md` says both test runs use the same container name and port. `workflow.md` lists them side by
  side with no order.
- **Impact:** An AI that runs commands in parallel to save time gets confusing failures.
- **Evidence:** `testing.md`: "integration and end-to-end tests must not run at the same time"
- **Suggestion (required):** Say "run them one after another, in this order: …".

### The wrap-up step conflicts with the tick-and-commit rule

- **Location:** `spec/workflow.md`, "Step plans" (tick and commit bullets) and "Wrap-up step"
- **Severity:** Minor
- **Category:** docs
- **Problem:** Every step ticks itself off and commits "including the updated step file". The wrap-up step deletes that
  file, so it cannot be ticked off.
- **Impact:** An AI may tick it off and then delete the file, or stall over the rule.
- **Evidence:** "commits all of the step's changes, including the updated step file" and "Delete the step file."
- **Suggestion (required):** Add one sentence: "The wrap-up step is not ticked off; its commit includes the deletion of
  the step file."

### Approving a scope change has no defined mechanism

- **Location:** `spec/workflow.md`, "Step plans", last bullet
- **Severity:** Minor
- **Category:** docs
- **Problem:** "Changes to the scope need the user's approval", but the file does not say whether to stop and ask before
  writing code, or whether to commit the plan change. "The change is mentioned" does not say where: in the reply or in
  the commit.
- **Impact:** The AI may carry on with a scope change and ask afterwards, or the change may never get noticed.
- **Suggestion (required):** Spell it out:
  - For a scope change: stop, ask, do not commit.
  - For other plan changes: update the step file, name the change in the final reply, and commit it together with the
    step.

### Manual checks have no owner

- **Location:** `spec/workflow.md`, "Step plans", Goal/Build/Test bullet, and "Rules for every step", first bullet
- **Severity:** Minor
- **Category:** tests
- **Problem:** A step is done only when its Test items "have been verified", and those items include manual checks. The
  file does not say who verifies them: the AI, for example in the browser, or the user.
- **Impact:** The AI either blocks the commit or claims checks it never did.
- **Suggestion (required):** Say that the AI does the manual checks it can (for example in the browser) and lists in its
  reply the ones it could not do.

### The Test section leaves out integration tests

- **Location:** `spec/workflow.md`, "Step plans", second bullet
- **Severity:** Minor
- **Category:** tests
- **Problem:** The bullet asks only for "unit and end-to-end tests". `testing.md` also has rules for integration tests,
  such as a case for every new unique constraint and for queries with conditions.
- **Impact:** Plans leave those tests out.
- **Evidence:** "'Test' lists the unit and end-to-end tests the step adds"
- **Suggestion (required):** Change it to "unit, integration and end-to-end tests".

### Writing the step plan itself has no rules

- **Location:** `spec/workflow.md`, "Step plans", first bullet
- **Severity:** Minor
- **Category:** docs
- **Problem:** The file does not say:
  - whether the plan needs the user's approval before step 1;
  - whether creating the plan gets its own commit;
  - how big a step should be.
- **Impact:** Steps vary in size. One that is too big for one call leaves half-done work that cannot be committed.
- **Suggestion (optional):**
  - Add an example call for writing a plan.
  - Add the rule "the plan is committed on its own, and the user reviews it before step 1".
  - Add a sizing rule: a step fits in one call, leaves the app working, and can be tested on its own.

### The template has no wrap-up section

- **Location:** `spec/workflow.md`, "Step plan template"
- **Severity:** Minor
- **Category:** docs
- **Problem:** The checklist lists "Wrap-up", but the template shows only `<First step>`. The five wrap-up items have to
  be copied in by hand.
- **Suggestion (optional):** Add a ready-made `## Wrap-up` section with the five Build items.

### Work that is not a roadmap feature is not covered

- **Location:** `spec/workflow.md`, "Step plans", first bullet, and "Wrap-up step"
- **Severity:** Minor
- **Category:** docs
- **Problem:**
  - The file does not say whether bug fixes, refactors and package upgrades ("a task of its own") need a plan, and what
    counts as done for them.
  - If a feature covers only part of a roadmap item, "Remove the feature from roadmap.md" is wrong; the rest should
    stay.
- **Suggestion (optional):**
  - Add a short "Other work" section: same done rule and commit rule, no plan needed.
  - Change the wrap-up item to: remove or shorten the roadmap entry.

### The README rule is in two places

- **Location:** `spec/workflow.md`, "Rules for every step", second-to-last bullet, and "Wrap-up step"
- **Severity:** Nit
- **Category:** docs
- **Problem:** Every step keeps `README.md` up to date, and the wrap-up "brings it up to date" again. It is not a
  contradiction, but it is unclear which one is the main rule.
- **Evidence:** "Keep `README.md` up to date with the commands a developer needs." and "Bring `README.md` up to date."
- **Suggestion (optional):** Word the wrap-up item as "check that README.md is complete".

### The two package and documentation bullets overlap

- **Location:** `spec/workflow.md`, "Rules for every step", third and fourth bullets
- **Severity:** Nit
- **Category:** docs
- **Problem:** "latest stable version and its current documentation" and "documentation of the installed version" say
  much the same thing in two places.
- **Suggestion (optional):** Merge them into one bullet.

### Third-person wording and one long line

- **Location:** `spec/workflow.md`, "Step plans" and "Rules for every step", first bullet
- **Severity:** Nit
- **Category:** style
- **Problem:**
  - "The call that implements a step…" talks about the AI in the third person. Direct instructions ("When you implement
    a step: …") are a bit clearer for a model.
  - "Claude Code call" is vague; "prompt" or "session" would be more precise.
  - The first bullet of "Rules for every step" goes past the line width used everywhere else.
- **Suggestion (optional):** Use direct instructions and re-wrap the line.
