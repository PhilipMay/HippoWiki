---
name: answer-only
description: Answer the user's question and nothing else - no changes on disk. If the session is in plan mode, switch it to auto mode first so the answer comes directly instead of through a plan. Started only with /answer-only <question>.
disable-model-invocation: true
argument-hint: <question>
---

# Answer only

The user wants an answer to a question, not work on the project. Treat this turn as read-only: answer, and leave the
files exactly as they are.

## Leave plan mode

If plan mode is active (a system message says so), switch to auto mode before answering. Plan mode would otherwise
demand a plan file and an approval step, which is pointless overhead for a question.

- Call `mcp__ccd_session_mgmt__set_session_permission_mode` with `session_id: "self"` and `mode: "auto"`. If it is
  only listed as a deferred tool, load it first with ToolSearch
  (`select:mcp__ccd_session_mgmt__set_session_permission_mode`). The user confirms the switch on a card.
- If the tool is not available (for example in the terminal CLI) or the switch is refused, stay in plan mode: tell
  the user in one line that Shift+Tab switches the mode, then answer anyway. Do not write a plan file and do not call
  ExitPlanMode.

If plan mode is not active, skip this section.

## Answer the question

The question: $ARGUMENTS

If no question was given with the command, answer the latest question in the conversation.

- Reading is fine and often needed: read files, search the code, run commands that only look (`ls`, `git status`,
  `grep`, `npm ls`), use read-only subagents, search the web.
- Change nothing on disk: no file edits or new files, no formatting runs, no installs, no builds or tests that write
  output, no git commits, branches or pushes, no memory files. Auto mode would allow these without asking, so the
  restraint has to come from you.
- If the answer points to a change that would help, describe it (a short code snippet is fine) instead of making it.
  The user can ask for it afterwards.
- Keep the answer focused on what was asked.
