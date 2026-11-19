# MCP Error Sentences – Steps

## Goal

When an MCP write tool refuses content or a name, its error quotes the field messages of the browser forms, which end
without a full stop, and runs them into the next sentence: "…nested at most 20 levels deep Nothing was changed." The
error of a tool reads as whole sentences instead, so that an AI app and a person reading the log see where each
message ends.

## Scope

- In: the tool error of refused input in `src/features/mcp/tools.ts` (`invalidInput`), for the content and for the
  name, as every MCP tool that writes content or names gives it; its unit and end-to-end tests; the decision in
  `spec/mcp.md`.
- Not in: the field messages themselves (`src/features/pages/schema.ts`, `src/lib/names.ts`), which the browser shows
  as they are; the other tool errors, which are written as sentences already; the error of a page named in a tab that
  does not exist, which keeps the error of the page.

## Checklist

- [x] Field messages as sentences in tool errors
- [ ] Wrap-up

## Field messages as sentences in tool errors

### Goal

Every field message that a tool error quotes ends with a full stop, so that several messages and the closing "Nothing
was changed." are separate sentences.

### Build

- `src/features/mcp/tools.ts`: a helper that makes a field message a sentence: a message that ends with `.`, `!` or `?`
  stays as it is, any other gets a full stop. `invalidInput` passes every content message and every name message
  through it before it joins them. The title error, which `invalidInput` replaces with its own sentence, stays as it
  is.

### Test

- Unit tests in `src/features/mcp/tools.test.ts`:
  - a content error with one message: "The content is not valid: <message>. Nothing was changed.", the whole text;
  - a content error with two messages, depth and table cells: both end with a full stop, in the order of the field
    errors;
  - a name error: "The name is not valid: <message>. A name has lowercase letters, …"; the expectation of
    `create_tab` that holds the text without the full stop is updated;
  - a field message that already ends with a full stop gets no second one;
  - the error of content without a title heading is unchanged.
- End-to-end test in `e2e/mcp-write.spec.ts`: `replace_page_content` with lists nested too deep gets the error with
  "…at most 20 levels deep. Nothing was changed." through the real endpoint, and the page stays unchanged.
- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. This is the last step that changes more
  than documentation, so the complete end-to-end suite runs.
- Manual check for the user: a call of `replace_page_content` with content nested too deep from an AI app shows the
  error with the full stop.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. `spec/mcp.md`, "Decisions": the field messages of the forms stay without a full stop, as the fields of the browser
   show them, and the tool error ends each one with a full stop, so that a tool error reads as sentences. Rejected:
   full stops in the field messages, which would change the browser. No other spec changes: `architecture.md`,
   `testing.md` and `tech.md` hold no convention that this fix changes.
2. `spec/roadmap.md` has no entry for this fix; nothing to remove.
3. `README.md` needs no new command, and its summary of the prototype does not change.
4. Delete this step file. There is no requirements file and there are no requirement IDs in the code.
5. Remove this step file from the spec catalog in `CLAUDE.md`. The question of the entry of `spec/mcp.md` does not
   change.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass: `npm run check` only, because the
  wrap-up changes only documentation.
