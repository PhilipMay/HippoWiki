# MCP Name Length – Steps

## Goal

An AI app learns the whole name rule before it calls a tool, the length limit included. Today the instructions and the
argument descriptions of the MCP tools say only that tab and page names are lowercase letters, digits and single
hyphens; that a name has at most 80 characters, the app finds out only when a tool refuses its name.

## Scope

- In:
  - One text of the name rule for MCP, with the limit taken from `NAME_MAX_LENGTH` in `src/lib/name-limits.ts`, so that
    the text follows the limit when it changes.
  - That text in the instructions of `initialize` (`instructionsFor()` in `src/features/mcp/server.ts`).
  - That text in the descriptions of the arguments that take a new name, in `src/features/mcp/tool-schemas.ts`: `name`
    of `create_page`, `newName` of `move_or_rename_page`, `name` of `create_tab` and `newName` of `rename_tab`.
  - That text in the tool error of `create_page` for a title that suggests no name and comes without a name
    (`no-suggested-name` in `src/features/mcp/tools.ts`).
- Not in:
  - A `maxLength` or `pattern` in the input schemas: a name is still a plain string, so that a name that breaks the
    rule stays a tool error with the rule, as "What holds for all of them" in `spec/mcp.md` decides.
  - The arguments that name an existing tab or page: they take the name as `list_folder` returns it.
  - The hints and messages of the name fields in the browser, and the messages of the name schema in
    `src/lib/names.ts`, which already name the limit when a name is too long.
  - User names, which have limits of their own.

## Checklist

- [ ] Name the length limit to MCP clients
- [ ] Wrap-up

## Name the length limit to MCP clients

### Goal

The instructions, the descriptions of the new-name arguments and the error for a title without a name state the whole
name rule, with the length limit, in the same words.

### Build

- Add one exported text of the name rule to `src/features/mcp/tool-schemas.ts`, built from `NAME_MAX_LENGTH`, for
  example `lowercase letters, digits and single hyphens, at most 80 characters`.
- Use it in `newTabNameArgument()` and in the descriptions of `name` of `create_page` and `newName` of
  `move_or_rename_page`, keeping the rest of each description (the example `meeting-notes`, "Leave it out to derive it
  from the title", "Pass the old name to keep it").
- Use it in the sentence on tab and page names in `instructionsFor()`.
- Use it in the `no-suggested-name` error of `create_page` in `src/features/mcp/tools.ts`.

### Test

- Unit tests in `src/features/mcp/tools.test.ts`:
  - `tools/list` of a Writer connection: the descriptions of `name` of `create_page` and `newName` of
    `move_or_rename_page` contain the length limit, built from `NAME_MAX_LENGTH`.
  - `tools/list` of a Manager connection: the descriptions of `name` of `create_tab` and `newName` of `rename_tab`
    contain it.
  - The instructions of a Reader, a Writer and a Manager connection contain it.
  - The existing test of a title that suggests no name expects the error with the limit.
- End-to-end: the `initialize` test of `e2e/mcp-read.spec.ts` checks that the instructions contain the length limit.
- The specs this step affects: `e2e/mcp-read.spec.ts`, `e2e/mcp-write.spec.ts`, `e2e/mcp-manager.spec.ts` and
  `e2e/mcp-access.spec.ts`; as the last step that changes code, it runs the complete `npm run test:e2e` instead.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Extend `spec/mcp.md`: in "What holds for all of them", say that the instructions and the descriptions of the
   arguments that take a new name state the name rule with its length limit, the limit pointing to
   `src/lib/name-limits.ts`, and that the input schema still refuses no name. No new feature spec is written.
2. The feature is not in `roadmap.md`, so nothing is removed there.
3. Check that `README.md` needs no change: no command changes, and its summary of what the prototype can do does not
   go down to the descriptions of the tools.
4. Delete this step file. There is no requirements file and there are no requirement IDs in the code or the tests.
5. Remove this step file from the spec catalog in `CLAUDE.md`. The question of `spec/mcp.md` does not change.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass; the wrap-up changes only documentation,
  so `npm run check` runs.
