---
name: requirements
description: Start or continue gathering the requirements of a feature, as spec/requirements-workflow.md describes. If the session is in plan mode, switch it to auto mode first so the requirements file can be written each round. Started only with /requirements <feature>.
disable-model-invocation: true
argument-hint: <feature>
---

# Requirements

The feature: $ARGUMENTS

## Leave plan mode

If plan mode is active (a system message says so), switch to auto mode first. The workflow writes the requirements file
in every round, which plan mode would block, and plan mode would demand a plan file and an approval step instead.

- Call `mcp__ccd_session_mgmt__set_session_permission_mode` with `session_id: "self"` and `mode: "auto"`. If it is
  only listed as a deferred tool, load it first with ToolSearch
  (`select:mcp__ccd_session_mgmt__set_session_permission_mode`). The user confirms the switch on a card.
- If the tool is not available (for example in the terminal CLI) or the switch is refused, tell the user in one line
  that Shift+Tab switches the mode, and wait for them. Do not write a plan file and do not call ExitPlanMode.

If plan mode is not active, skip this section.

## Follow the workflow

Read `spec/requirements-workflow.md` and follow it exactly, as if the user had written "Gather the requirements for
<feature>" with the feature above. The workflow decides everything else: starting, or resuming when
`spec/<feature>-requirements.md` already exists, what may change, the rounds of questions, the checks and the template.

If no feature was given with the command, ask for it with the question tool. Offer the requirements files in `spec/`
that can be resumed and the entries of `spec/roadmap.md`; the user can also name a new idea.
