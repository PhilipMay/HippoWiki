---
name: spec-tests
description: Check a spec against the code with tests that the spec-tester agent writes from the spec alone. If the session is in plan mode, switch it to auto mode first so the tests can be written. Started only with /spec-tests <spec file> [section].
disable-model-invocation: true
argument-hint: <spec file> [section]
---

# Spec tests

What to test: $ARGUMENTS

## Leave plan mode

If plan mode is active (a system message says so), switch to auto mode first. The agent writes and runs tests, which
plan mode would block, and plan mode would demand a plan file and an approval step instead.

- Call `mcp__ccd_session_mgmt__set_session_permission_mode` with `session_id: "self"` and `mode: "auto"`. If it is
  only listed as a deferred tool, load it first with ToolSearch
  (`select:mcp__ccd_session_mgmt__set_session_permission_mode`). The user confirms the switch on a card.
- If the tool is not available (for example in the terminal CLI) or the switch is refused, tell the user in one line
  that Shift+Tab switches the mode, and wait for them. Do not write a plan file and do not call ExitPlanMode.

If plan mode is not active, skip this section.

## Run it

1. Start the `spec-tester` agent with the spec file, and the section if one was given. If no spec file was given, ask
   for one with the question tool and offer the feature specs of the spec catalog in `CLAUDE.md`. Do not write these
   tests yourself.
2. Run the checks of "When a step is done" in `spec/step-plan-workflow.md` with the tests the agent kept.
3. Write the findings as `spec/issue-report.md` describes, in a new part at the end of `spec/review-report-v2.md`
   named after the spec tests of the topic; create the file if it does not exist and add it to the spec catalog in
   `CLAUDE.md`. No findings, no part.
4. Report the rules with their tests, the new test files, and the findings by severity.

This is a change outside a step plan: nothing is committed, as "Git Handling" in `CLAUDE.md` says. A finding is fixed
as "Fixing a finding of the review report" in `spec/step-plan-workflow.md` describes; the failing test of its Evidence
is added back with the fix.
