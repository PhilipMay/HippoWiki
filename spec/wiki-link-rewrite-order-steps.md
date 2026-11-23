# Order of the Wiki Link Rewrite – Steps

## Goal

A move or rename of a page or a file, and a rename of a tab, changes every wiki link to it in the linking pages and
nothing else, also when a footnote definition with such a link stands before another such link. Today the rewrite
duplicates part of the linking page, writes a broken target such as `[[newnew]]` and keeps the old link in the
footnote, and every further rename makes the page longer. This fixes the Blocker "a rename duplicates part of a linking
page when a footnote definition with a changed link stands before another changed link" of `markdown-parser-review.md`.

## Scope

- In:
  - `rewriteWikiLinks()` of `src/features/pages/wiki-links.ts` rewrites the links in the order of their positions in
    the content, as the Suggestion of the finding describes (its confidence is High).
  - The comment of `wikiLinksOf()` says that its order is that of the page view, with the links of the footnote
    definitions last, and that it is not the order of the source.
  - Unit tests of the rewrite, and integration tests of a page rename, a file rename and a tab rename through the
    database, each with a linking page whose footnote definition stands before another link.
  - The finding is deleted from `markdown-parser-review.md`, and the report is brought in line, as "Fixing a finding of
    the review report" in `step-plan-workflow.md` says.
- Not in:
  - The other findings of `markdown-parser-review.md`: the quadratic time of footnote references, the nested footnote
    definitions, the repeated parses and the nits. Each needs its own decision or plan.
  - Repairing pages that an earlier rename has already corrupted. No reliable rule tells a duplicate of the rewrite
    from text a user wrote twice. Such a page holds the content before the rewrite in the revision before the one
    marked as links updated after a rename or move, which its Writers can revert to (`page-history.md`).
  - A new value of `LINK_INDEX_VERSION`: the links that the index derives from a content do not change, only the
    rewrite does.
  - The order of `wikiLinksOf()` itself, which `linkTargetsOf()`, the index of links and the comparison with the
    editor in `src/features/pages/editor/wiki-links.test.ts` rely on.

## Checklist

- [ ] Rewrite the links in the order of their positions
- [ ] Wrap-up

## Rewrite the links in the order of their positions

### Goal

The rewrite of the links of a move, a rename or a tab rename keeps every byte of a linking page except the changed
targets, wherever the footnote definitions stand, and the finding is gone from the review report.

### Build

- In `rewriteWikiLinks()`, loop over the links of `wikiLinksOf(content)` that have a position, sorted by that position
  in ascending order, and keep the rest of the loop as it is. The positions are distinct, because each one is the place
  of its own `[[`.
- Reword the comment of `wikiLinksOf()`: the links in the order of the page view, which puts the links of the footnote
  definitions after the links of the text; a caller that needs the order of the source sorts by `position`.
- `markdown-parser-review.md`, as "Fixing a finding of the review report" in `step-plan-workflow.md` says:
  - Delete the section of the finding.
  - "Summary": the verdict names one Major and no Blocker, the bullet of the Blocker goes, the counts become 9
    findings, 0 Blocker, 1 Major, 4 Minor and 4 Nit (3 `issue:`, 1 `suggestion:`, 4 `nit:`, 1 `question:`), and 8
    Suggestions, 3 High, 3 Medium and 2 Low; "To fix first" starts with the footnote reference rule.
  - "Scope and method": the sentence on what was reproduced a second time keeps only the quadratic time of the Major.
  - "Reviewed": the gap of the order of the tokens that `rewriteWikiLinks()` relied on is closed; the item names only
    the untyped footnote metas as the remaining gap ("finding above").
  - "Not covered": the item on the corruption of a rename through the database goes, because the integration tests of
    this step cover it.
  - Search the report for "Blocker", `rewriteWikiLinks` and "duplicat" so that no reference to the finding is left.
- Search `spec/`, `README.md` and `CLAUDE.md` for the title and the key words of the finding; `roadmap.md` holds no
  item for it.

### Test

- Unit tests in `describe("rewriteWikiLinks")` of `src/features/pages/wiki-links.test.ts`, each comparing the whole
  result:
  - `"# T\n\n[^1]: see [[old]]\n\nText[^1] and [[old]].\n"` with the page `old` renamed to `new` gives
    `"# T\n\n[^1]: see [[new]]\n\nText[^1] and [[new]].\n"`.
  - The same content with CRLF keeps CRLF and changes both links.
  - Two footnote definitions in reverse order of their references, `[^b]` before `[^a]`, each with a link, and a link
    in the text: all three links change and nothing else.
  - A tab rename, `[^1]: see [[guides/setup]]` before `[[guides/intro]]`: both become links into the new tab.
  - A file move, `[^1]: see ![[diagram.png]]` before `[[diagram.png]]`: the embed and the link name the new file.
  - A footnote definition whose link does not change, before a link that does: only that link changes.
- Integration tests through the database, each checking the stored content of the linking page as a whole, its links
  in the index and its marked revision:
  - In "the update of links on a move or rename" of `integration/wiki-links-service.test.ts`: a page rename with a
    linking page whose footnote definition with a link to the page stands before another link to it; then the page is
    renamed back, and the content is the original one.
  - The same for a tab rename (`renameTab()` of `src/features/folders/service.ts`), next to the tests of the link
    updates of a tab rename in `integration/folder-service.test.ts`.
  - The same for a file move or rename, in "moving and renaming a file" of `integration/file-service.test.ts`.
- The commands of "When a step is done" in `step-plan-workflow.md`. This is the last step of the plan that changes
  anything but documentation, so the complete `npm run test:e2e` runs, in place of the affected specs
  `e2e/wiki-link-updates.spec.ts`, `e2e/move-or-rename-page.spec.ts` and `e2e/move-or-rename-file.spec.ts`.
- The scratch reproduction of the finding gives the expected content for every case, run against the fixed code.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. `wiki-links.md`, "Updates on a move or rename": the rule that only the target changes and every other byte stays
   as it was says that this holds wherever the link stands, inside a footnote definition included. No convention of
   `architecture.md`, `testing.md` or `tech.md` changes.
2. `roadmap.md` holds no item for this fix; nothing is removed.
3. `README.md` needs no new command, and its summary of the prototype does not change.
4. Delete this step file. There is no requirements file, and the code and the tests carry no requirement IDs of this
   plan.
5. Remove the entry of this step file from the spec catalog in `CLAUDE.md`. The question of the entry of
   `markdown-parser-review.md` does not change.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes only documentation,
  so only `npm run check` runs.
