---
name: step-plan
description: Start or continue the step plan of a feature, as spec/step-plan-workflow.md describes. In plan mode it explores read-only and switches to auto mode only right before it writes or builds anything. Started only with /step-plan <feature>.
disable-model-invocation: true
argument-hint: <feature>
---

# Step plan

The feature: $ARGUMENTS

## Plan mode

Plan mode is welcome while reading: the spec, the requirements and the code can be explored in it. It has to be left
before anything is written, because the workflow writes the step plan into `spec/`, adds it to `CLAUDE.md` and commits
the new plan and every step, which plan mode blocks. Plan mode would also demand its own plan file and an approval step, which the
workflow does not use: the step plan in `spec/` is the plan, and the user reviews it there.

If plan mode is active (a system message says so):

- When the step plan has to be written, do all the reading for it in plan mode first. Switch to auto mode right before
  the first file is written.
- When an existing step plan is continued, switch to auto mode first, since building the next step starts with
  writing.
- Never write a plan-mode plan file and never call ExitPlanMode.

To switch:

- Call `mcp__ccd_session_mgmt__set_session_permission_mode` with `session_id: "self"` and `mode: "auto"`. If it is
  only listed as a deferred tool, load it first with ToolSearch
  (`select:mcp__ccd_session_mgmt__set_session_permission_mode`). The user confirms the switch on a card.
- If the tool is not available (for example in the terminal CLI) or the switch is refused, tell the user in one line
  that Shift+Tab switches the mode, and wait for them.

If plan mode is not active, skip this section.

## Follow the workflow

Read `spec/step-plan-workflow.md` and follow it exactly. The workflow decides everything else: how a plan is written,
the rules for every step, when a step is done, what to do when it cannot be finished, the wrap-up, the commits and the
push.

- If `spec/<feature>-steps.md` exists, continue it, as if the user had written "Implement spec/<feature>-steps.md": the
  steps that are already ticked off are skipped.
- If it does not exist, start it: write the step plan as the workflow describes, from `spec/<feature>-requirements.md`
  if that file exists (it must have the status `approved`), and add it to the spec catalog in `CLAUDE.md`. Then commit
  it, without pushing, and stop, as "Step plans" in `spec/step-plan-workflow.md` describes. Do not tell the user how
  to implement it.

If no feature was given with the command, ask for it with the question tool. Offer the step plans in `spec/` that can be
continued, the approved requirements files in `spec/` and the entries of `spec/roadmap.md`; the user can also name a new
feature.
