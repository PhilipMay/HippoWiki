---
name: step-plan
description: Start or continue the step plan of a feature, as spec/step-plan-workflow.md describes. If the session is in plan mode, switch it to auto mode first so the steps can be built and committed. Started only with /step-plan <feature>.
disable-model-invocation: true
argument-hint: <feature>
---

# Step plan

The feature: $ARGUMENTS

## Leave plan mode

If plan mode is active (a system message says so), switch to auto mode first. The workflow writes files and commits
every step, which plan mode would block, and plan mode would demand a plan file and an approval step instead.

- Call `mcp__ccd_session_mgmt__set_session_permission_mode` with `session_id: "self"` and `mode: "auto"`. If it is
  only listed as a deferred tool, load it first with ToolSearch
  (`select:mcp__ccd_session_mgmt__set_session_permission_mode`). The user confirms the switch on a card.
- If the tool is not available (for example in the terminal CLI) or the switch is refused, tell the user in one line
  that Shift+Tab switches the mode, and wait for them. Do not write a plan file and do not call ExitPlanMode.

If plan mode is not active, skip this section.

## Follow the workflow

Read `spec/step-plan-workflow.md` and follow it exactly. The workflow decides everything else: how a plan is written,
the rules for every step, when a step is done, what to do when it cannot be finished, the wrap-up, the commits and the
push.

- If `spec/<feature>-steps.md` exists, continue it, as if the user had written "Implement spec/<feature>-steps.md": the
  steps that are already ticked off are skipped.
- If it does not exist, start it: write the step plan as the workflow describes, from `spec/<feature>-requirements.md`
  if that file exists (it must have the status `approved`), and add it to the spec catalog in `CLAUDE.md`. Then stop,
  so the user can review the plan before any step is built; `/step-plan <feature>` again implements it.

If no feature was given with the command, ask for it with the question tool. Offer the step plans in `spec/` that can be
continued, the approved requirements files in `spec/` and the entries of `spec/roadmap.md`; the user can also name a new
feature.
