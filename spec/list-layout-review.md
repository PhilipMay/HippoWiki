# HippoWiki – Review of the List Layout

## Summary

- Verdict: no Blocker. Bullet lists and task lists of bullet lists hold every rule of the layout in all cases, nested
  to six levels, mixed with plain items, inside a quote and at phone width. The weak point is a task item of an
  ordered list, whose wrapped lines and nested lists start under its checkbox instead of under its text. The task list
  rule also takes an escaped marker for a task, and one current limit of `spec/pages.md` is easier to hit than its
  wording says.
- Findings: 3 in all, 0 Blocker, 0 Major, 2 Minor and 1 Nit (2 `issue:`, 1 `suggestion:`). Of the 3 Suggestions,
  0 are High, 3 Medium and 0 Low.
- To fix first: the indent of a task item of an ordered list.
- Not covered by this review: Safari and Firefox (only the Chromium of the browser pane was used), a dark theme (the
  app has none), and the user's page `tech/scheidung/todo`, which is not in the local dev database.

## Scope and method

- Reviewed: the layout of lists in the page view, `MarkdownContent` in
  `src/features/pages/components/MarkdownContent.tsx`, and the task list rule in `src/features/pages/markdown.ts`, as
  far as it decides which list item is a task. The rules checked against are "Rendering" and "Current limits" in
  `spec/pages.md`.
- Date: 2026-11-19. The code is the state of the branch `main` after the commit `wrap up task list layout`.
- Evidence comes from three test pages in the local dev database (`next dev`, logged in as the seed user `alice`),
  measured with a script in the browser pane at 1024 px and at 375 px width, and from screenshots. For every list
  item the script read the left of its checkbox, of its text and of the item, its list marker, its height and the
  left of a wrapped second line, and checked these rules:
  - R1: in a bullet list, task items and plain items start their text at the same place.
  - R2: the checkbox of a task item of a bullet list lies in the indent of the list, where the bullet would be, and
    never left of the title heading.
  - R3: a nested list moves 24 px to the right.
  - R4: a task item of a bullet list has no marker, a plain item has its bullet, an ordered list keeps its numbers.
  - R5: an item of one line is 24 px high, task or plain.
  - R6: a wrapped line starts under the text of its item.
  - R7: the page does not scroll sideways.
- The cases, each under its own heading of a test page: task > task > task; task > bullet; bullet > task;
  task > numbered; task > numbered task; numbered > task; numbered task > task; numbered task > numbered task;
  numbered > numbered task; six levels of bullets, numbers and tasks; a bullet list of tasks and plain items with
  nested mixed lists; a numbered list of tasks and plain items; a numbered task list from 3 to 12; long wrapping text
  in bullet, numbered, task and plain items; bold, code, a link and strikethrough in task text; the markers `*`, `+`
  and `1)`; nesting by two spaces; a task list in a quote; markers that are not tasks (`[ ]text`, `[y]`, `\[ ]`, an
  empty `[ ]`); lists next to each other; a loose task list.
- The view of a revision was compared with the page view of the same page: every item has the same position and
  marker. The test pages were deleted afterwards; they can be restored from the deleted pages of the folder
  `getting-started02`.

## Findings

### issue: a task item of an ordered list has no hanging indent, so its wrapped lines and nested lists start under the checkbox

- Location: `src/features/pages/components/MarkdownContent.tsx`, the `sx` rules for `li.task-list-item` of
  `MarkdownContent`
- Severity: Minor. Nothing is lost or wrong in the content; the nesting of a list is hard to see.
- Category: correctness
- Problem: in an ordered list, the checkbox of a task item is an inline element at the start of the item, so the text
  of the item starts 28 px right of the start of the item (the default left margin of the checkbox, its width and its
  right margin). A wrapped line and a nested list start at the start of the item, under the checkbox. "Rendering" in
  `spec/pages.md` says that task lists are indented and nested like other lists; under a task item of an ordered
  list, a nested list starts 4 px left of the text of its parent, where under every other item it starts 24 px right
  of it.
- Impact: a reader of a numbered task list with nested tasks or long items does not see which items belong to which
  parent: the checkbox of a nested task sits right under the checkbox of its parent. It shows most at phone width,
  where long items wrap.
- Evidence: measured at 1024 px:
  - `1. [ ] C7 parent numbered task` with `    - [x] C7 child task`: parent checkbox at 147, parent text at 171; child
    checkbox at 143, child text at 167.
  - Six levels: `1. [x] C10 d4 numbered task` has its text at 243, its nested `- [ ] C10 d5 task` at 239.
  - `1. [ ] C14 numbered task with a long text …`: first line at 171, second line at 143; at 375 px first line at 85,
    the other lines at 57. A plain numbered item and a bullet task item wrap under their text.
- Suggestion (required): give a task item of an ordered list a left padding as wide as its checkbox and the space in
  front of it, and move the checkbox back into that padding, as a bullet task item does with the indent of its list:

  ```ts
  "& ol > li.task-list-item": { pl: 3.5 },
  "& ol > li.task-list-item > input": { ml: -3 },
  ```

  The first line stays where it is (checkbox at 147, text at 171), and wrapped lines and nested lists start at the
  text. Extend the end-to-end test "task lists are indented and nested like other lists" in `e2e/pages.spec.ts` with a
  bullet task under a numbered task, whose checkbox lies at or right of the text of its parent, and with a numbered
  task that wraps, whose lines start at the same x.

- Confidence: Medium. The two rules were tried by injecting them into the page in the browser pane, and the
  measurements above came out as described, but only in Chromium, without the test the Suggestion names, and the
  change is one users see.
- Alternatives: leave the layout as it is and add it to "Current limits" in `spec/pages.md`; this keeps the code
  simpler, but a nested list under a numbered task stays hard to read.

### issue: an escaped task marker `\[ ]` still makes a task item

- Location: `src/features/pages/markdown.ts`, `taskLists()` and `TASK_MARKER`
- Severity: Minor. Only content that escapes the marker on purpose is affected.
- Category: correctness
- Problem: `taskLists()` matches `TASK_MARKER` against the first text token of the item, after the inline parse has
  turned `\[` into `[`. The escape is then gone, and `- \[ ] text` becomes a task with an unticked checkbox. The
  comment of `TASK_MARKER` says that a list item whose text starts with `[ ] ` is a task "as in GitHub Flavored
  Markdown"; in the source, the text of this item starts with a backslash, which in CommonMark makes the bracket a
  plain character.
- Impact: an author who writes `\[ ]` to show the brackets as text, for example to describe the syntax of task lists,
  gets a checkbox instead, and has no way to write a list item that starts with `[ ] ` as text.
- Evidence: the test page held `- \[ ] C19 escaped marker` next to `- [ ]C19 no space after marker` and
  `- [y] C19 wrong letter`. The two others render as plain items with their brackets; the escaped one renders as a
  task item with a checkbox, no bullet and the text `C19 escaped marker`.
- Suggestion (required): match `TASK_MARKER` also against the source of the paragraph, the `content` of the `inline`
  token (`tokens[index + 2].content`), which keeps the backslash, and mark the item as a task only when both match.
  Add a unit test to "GitHub Flavored Markdown" in `src/features/pages/markdown.test.ts`: `- \[ ] escaped` renders
  `<li>[ ] escaped</li>` and no checkbox.
- Confidence: Medium. That the `content` of an `inline` token holds the source with its escapes is how markdown-it
  builds it, but the fix was not run, and that GitHub shows `\[ ]` as text was not checked on GitHub itself.

### suggestion: "Current limits" does not say that a blank line before another list makes a task list loose

- Location: `spec/pages.md`, "Current limits", the item on loose task lists
- Severity: Nit. The behaviour is documented; only how easily it happens is not.
- Category: docs
- Problem: the limit says that "in a loose task list (blank lines between its items), the checkbox shows on a line
  above the text of its item". It reads as if an author has to write blank lines between the tasks. A task list
  followed by a blank line and another list with the same marker is one loose list in CommonMark, so its tasks show
  the checkbox above the text as well.
- Impact: an author who writes a task list, a blank line and a plain list with `-` sees all checkboxes jump above
  their text and finds no hint in the spec why.
- Evidence: `- [ ] C20 task after paragraph`, `- [x] C20 task after paragraph two`, a blank line, `- C20 plain list`,
  `- C20 plain list two` render as one list of four items; each task item is 48 px high, its checkbox on a line of
  its own above the text.
- Suggestion (optional): add to the item in "Current limits": "a task list and a list with the same marker after a
  blank line are one loose list, as in CommonMark".
- Confidence: Medium. The wording is clear and the behaviour was shown, but lifting the limit instead is a product
  choice.
- Alternatives: lift the limit in the page view, by putting the checkbox of a task item into its first paragraph, and
  add it to `roadmap.md` until then; this removes the cause, but changes the code and its tests.

## Reviewed

These cases hold every rule above, at 1024 px and at 375 px, without a finding:

- Nesting of bullet lists, task lists and numbered lists under a bullet or task item, to six levels: every level moves
  24 px, task and plain items of one list start their text at the same place, and the checkbox of a task item lies in
  the indent of its list, never left of the title heading.
- A bullet list of task items and plain items: the plain items keep `disc`, and `circle` or `square` when nested, as
  in a list without tasks; the task items show no bullet.
- Numbered lists keep their numbers with tasks in them, from a start number other than 1 and with two-digit numbers,
  and a plain item of a numbered task list keeps its number without a checkbox.
- Every item of one line is 24 px high, task or plain, so a mixed list keeps one rhythm.
- Long text in a bullet task item wraps under its text.
- Bold, code, links and strikethrough in the text of a task item, the markers `*`, `+` and `1)`, nesting by two
  spaces, and a task list inside a quote.
- `[ ]text`, `[y] text` and an empty `[ ]` are not tasks.
- The page does not scroll sideways at 375 px, and the view of a revision lays the lists out like the page view.
