# Task List Layout – Steps

## Goal

Task lists in the page view are indented and nested like other lists. A nested task list moves to the right under its
parent item, the checkbox of a task item sits where the bullet of a plain item would be, and task items of an ordered
list keep their numbers.

## Scope

- In:
  - Task lists nested in a list item are indented under their parent, as plain lists are.
  - In a bullet list with both task items and plain items, the checkboxes sit where the bullets are, and the plain
    items keep their bullets inside the content, in line with the task items (GitHub style).
  - Task items of an ordered list keep their numbers, with the checkbox in front of the text.
  - The page view, the view of a revision and the view of a deleted page, which all show the content through
    `MarkdownContent`.
- Not in:
  - Loose task lists (blank lines between items), where the item text is a paragraph of its own and the checkbox shows
    on a line above it.
  - Checkboxes that can be ticked in the page view; they stay disabled.
  - Accessible names for the checkboxes.
  - Any change to the parse in `markdown.ts`: it already nests task lists and marks them correctly.

## Checklist

- [x] Indent task lists like other lists
- [ ] Wrap-up

## Indent task lists like other lists

### Goal

The styles of the page view stop removing the indent of task lists, so that nested task lists, mixed lists and ordered
task lists look like the same lists without checkboxes.

### Build

- In `src/features/pages/components/MarkdownContent.tsx`, remove the rule that sets the padding of
  `ul.contains-task-list` to zero, so that every list, task lists included, keeps the indent of `& ul, & ol`.
- A task item of a bullet list has no list marker, and its checkbox moves left into the indent with a negative margin,
  so that it sits where the bullet of a plain item sits and the text of a task item starts where the text of a plain
  item starts.
- A task item of an ordered list keeps its number (no `listStyle: "none"` for `ol > li.task-list-item`); its checkbox
  stays in front of the text with the space it has now.
- The rules stay a plain `sx` object, as the comment in the file asks, and keep the classes `contains-task-list` and
  `task-list-item` that `markdownToReact.tsx` sets.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. This is the last step that changes more
  than documentation, so it runs the complete `npm run test:e2e`.
- Unit tests in `src/features/pages/markdown.test.ts`:
  - A nested task list (`- [ ] parent` with `    - [ ] child` below it) renders a `ul` with the class
    `contains-task-list` inside the `li` with the class `task-list-item` of its parent, with one checkbox per item.
  - An ordered task list (`1. [ ] first`, `2. [x] second`) renders an `ol` with the class `contains-task-list` and two
    task items, the second one checked.
- End-to-end test in `e2e/pages.spec.ts`, a new test for a page with a nested task list, a bullet list of a task item
  and a plain item, and an ordered task list:
  - The checkbox of the nested item lies to the right of the checkbox of its parent by at least the indent of a list
    (compare their bounding boxes).
  - No checkbox lies left of the title heading of the content, so that the checkboxes stay inside the content.
  - The plain item of the mixed list has the list style `disc`, its task item `none` (`toHaveCSS` on the list items,
    found by role and text).
  - The task items of the ordered list have the list style `decimal`.
  - The checked item of each list is still checked, the others are not.
- Manual checks in the browser, light and dark, at desktop and phone width:
  - The checkbox of a task item sits where the bullet of a plain item would be, and the texts of task items and plain
    items start at the same place.
  - The nested item of the page `tech/scheidung/todo` shows indented under its parent.
  - An ordered task list shows its numbers in front of the checkboxes.
  - The view of a revision and the view of a deleted page show task lists the same way.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Extend "Rendering" in `spec/pages.md`: task lists are indented and nested like other lists; the checkbox of a task
   item of a bullet list sits in place of the bullet, a plain item of the same list keeps its bullet, and a task item
   of an ordered list keeps its number, with the checkbox in front of the text. Add to "Decisions" that task lists are
   laid out as on GitHub, with the checkbox in the indent of the list, and that a task list flush with the text was
   rejected, because it lost the indent of nested task lists and pushed the bullets of plain items out of the content.
   Add to "Current limits" that in a loose task list the checkbox shows on a line above the text of its item.
   `architecture.md`, `testing.md` and `tech.md` stay as they are, since no convention changes.
2. `roadmap.md` has no entry for this fix, so nothing is removed from it.
3. Check that `README.md` has all the commands a developer needs; its summary of what the prototype can do needs no
   change for a fix of the layout.
4. Delete this step file. The feature has no requirements file and no requirement IDs.
5. Remove this step file from the spec catalog in `CLAUDE.md`; the entry of `spec/pages.md` stays, since its question
   does not change.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes only documentation,
  so `npm run check` runs; the complete end-to-end suite has run in the step "Indent task lists like other lists", the
  last step that changes more than documentation.
- `spec/pages.md` describes the layout of task lists, and no file in `spec/`, `README.md` or `CLAUDE.md` names this
  step file.
