# HippoWiki – Review of the Code around the Markdown Parser

## Summary

- Verdict: one Blocker and one Major.
  - The Blocker: a rename of a page or a tab corrupts the content of a linking page when a footnote definition that
    holds a changed link comes before another changed link. The footnote rule moves the definitions to the end, and
    `rewriteWikiLinks()` expects the links in source order.
  - The Major: the footnote reference rule of markdown-it-footnote, which `markdown.ts` keeps, takes quadratic time as
    soon as the page defines a footnote. One parse of 100,000 characters then takes about 7 s, and every save or view
    of the page parses it two to four times.
  - The replaced footnote tail rule is correct and linear for every input without nested definitions. Nested
    definitions leak unbalanced tokens, which also defeats the depth limit.
- Findings: 10 in all, 1 Blocker, 1 Major, 4 Minor and 4 Nit (4 `issue:`, 1 `suggestion:`, 4 `nit:`, 1 `question:`).
  Of the 9 Suggestions, 4 are High, 3 Medium and 2 Low.
- To fix first: the order of the links in `rewriteWikiLinks()`, then the footnote reference rule and its input of the
  cost test.
- Not covered by this review: see "Not covered" at the end.

## Scope and method

- The review answers the three questions of the last item of "Things to Check" in `roadmap.md`: how closely the
  consumers depend on the tokens of markdown-it, the footnote rule that replaces the one of markdown-it-footnote, and
  the parses that are repeated for the same content.
- Reviewed: `src/features/pages/markdown.ts` and its consumers:
  - `components/markdownToReact.tsx`, `components/MarkdownContent.tsx`, `derive.ts`, `wiki-links.ts`, `schema.ts`,
    `forms.ts`, `links-service.ts` and the parse paths of `service.ts`
  - `src/features/search/text.ts` and `index-data.ts`
  - the editor modules `link-address.ts`, `safe-address.ts`, `live-preview.ts` and `wiki-links.ts`
  - `src/test/slow-markdown.ts` and the cost tests
- Compared with `node_modules/markdown-it-footnote/index.mjs` 4.0.0 and markdown-it 15.0.3. Specs read: `pages.md`,
  `wiki-links.md`, `search.md`, `markdown-editor.md`, `architecture.md`, `testing.md`, and the related parts of
  `review-report.md` and `list-layout-review.md`.
- Date: 2026-11-22. The code is the state of the branch `main` after the commit
  `add the ci times of the faster end-to-end tests`.
- Evidence comes from scratch scripts, not kept, that ran the functions of the repository with `npx tsx`: differences
  against the plugin over random inputs, the balance of the token stream, the depth limit, the rewrite of wiki links,
  and timings.
  - Timings are the best of 3 to 7 runs on an Apple M4 Pro with Node 26.13.
  - The unit tests of `markdown.test.ts`, `wiki-links.test.ts`, `text.test.ts`, `derive.test.ts` and
    `link-address.test.ts` pass (130 tests).
  - The Blocker and the quadratic time of the Major were reproduced a second time, on their own: the positions
    `[39, 17]` and the duplicated content of the Evidence, and 435 ms against 1,549 ms for 12,500 and 25,000 `[^` with
    a definition (24 and 46 ms without one).

## Findings

#### issue: a rename duplicates part of a linking page when a footnote definition with a changed link stands before another changed link

- Location: `src/features/pages/wiki-links.ts`, `rewriteWikiLinks()` and `wikiLinksOf()`. It is called from
  `src/features/pages/links-service.ts` for every linking page of a move, a rename or a rename of a tab.
- Severity: Blocker. Wrong results and silent corruption of the content of other users' pages, stored as a new
  revision.
- Category: correctness
- Problem:
  - `wikiLinksOf()` returns the links in the order of the tokens.
  - `footnoteTail()` moves every footnote definition to a footnote block at the end of the tokens. So a link inside a
    definition comes after every link of the text, even when the definition stands earlier in the source.
  - `rewriteWikiLinks()` builds the result with `content.slice(at, position)` and `at = position + target.length`.
    That only works for ascending positions.
  - With a smaller position after a larger one, the slice is empty, `at` moves backwards, and the closing
    `content.slice(at)` appends the rest of the content a second time.
- Impact:
  - Any page that defines a footnote after the paragraph that cites it, and links the renamed page or tab again later,
    gets text duplicated on every rename. Defining a footnote right after its paragraph is a common style.
  - The duplicate keeps the old link, so the page goes on linking the old name, and the index of links stores it
    again.
  - The result is not checked against the limits, so it can grow past 100,000 characters and compound with each
    rename.
- Evidence:
  - Input: `"# T\n\n[^1]: see [[old]]\n\nText[^1] and [[old]].\n"`. The positions from `wikiLinksOf()` are `[39, 17]`.
  - `rewriteWikiLinks(content, pageMoved(old → new))` returns
    `"# T\n\n[^1]: see [[old]]\n\nText[^1] and [[newnew]]\n\nText[^1] and [[old]].\n"`.
  - Content with CRLF and a rename of a tab behave the same way.
  - The corpus test "footnotes" in `wiki-links.test.ts` has the definition only after the text, so its order happens
    to be ascending.
- Suggestion (required):
  - Rewrite in source order, leaving out the links without a position, as now:
    ```ts
    const links = wikiLinksOf(content)
      .filter((link) => link.position !== null)
      .sort((a, b) => a.position! - b.position!);
    ```
    Then the same loop over `links`.
  - Add the input above, and one with two definitions in reverse order, to `describe("rewriteWikiLinks")` in
    `wiki-links.test.ts`.
  - Say in the comment of `wikiLinksOf()` that its order is that of the page view, with the footnote definitions last.
  - The positions are distinct, because each sits at its own `[[`. `linkTargetsOf()` and the comparison with the
    editor in `editor/wiki-links.test.ts` keep their order.
- Confidence: High. One fix in one function. The sorted version, run on the inputs above, the case in reverse order,
  CRLF and a rename of a tab, gives exactly the expected content, and the named test checks it.

#### issue: footnote references take quadratic time as soon as the content defines a footnote, so one page can block the server for seconds per view

- Location:
  - `node_modules/markdown-it-footnote/index.mjs`, `footnote_ref()`, used unchanged by `src/features/pages/markdown.ts`.
  - `src/test/slow-markdown.ts`, the input `"[^a]"`.
  - `spec/pages.md`, "The cost of the Markdown parse" ("The parse is linear in the length of the content").
  - `spec/review-report.md`, the Reviewed item "The cost of the Markdown parse" ("parses in linear time").
- Severity: Major. Any Writer, in the browser or through MCP, can make every view of a page block the event loop of
  Node.js for many seconds. No data is lost.
- Category: security, performance
- Problem:
  - Once `env.footnotes.refs` exists (any definition `[^x]: …`), `footnote_ref()` scans from every `[^` to the next
    space, line break or `]`.
  - A line of `[^` without such a stop makes every scan run to the end of the line, which is quadratic. The replaced
    `footnote_tail` is not involved.
  - The cost input `"[^a]"` defines no footnote, so the rule returns at its first check and the quadratic path is
    never measured.
- Impact:
  - About 7 s per parse at the content limit.
  - A save in the browser parses 4 times (about 28 s), a save through MCP 3 times. A view, a revision view, a view of
    a deleted page and the delete dialog parse 2 times (about 14 s).
  - A rename parses such a linking page 4 times inside the exclusive lock of the links, whose transaction ends after
    60 s.
  - The event loop is blocked for all users meanwhile.
  - A bump of `SEARCH_INDEX_VERSION` or `LINK_INDEX_VERSION` derives such a page again at the start.
  - The author's own browser freezes in `titleFromContent()` when "Save" opens the dialog.
- Evidence:
  - `"[^".repeat(n) + "\n\n[^a]: x\n"`: n = 12,500 takes 465 ms, n = 25,000 takes 1,789 ms, n = 50,000 (100,010
    characters) takes 7,124 ms. Each doubling costs 4 times as much.
  - The same without the definition takes 95 ms. markdown-it with the plugin alone takes the same 7,116 ms.
  - `"[^a".repeat(33_330)` with a definition takes 4,224 ms.
  - Rendering adds the same again (6,346 ms).
- Suggestion (required):
  - Bound the scan with the technique already used for wiki links: wrap the rule of the plugin and refuse a reference
    when the next `[` comes before the next `]`, with `nextMark()` of `markdown.ts`:
    ```ts
    const footnoteRefRule = markdown.inline.ruler.__rules__.find(({ name }) => name === "footnote_ref")!;
    function footnoteRef(state: StateInline, silent: boolean): boolean {
      const src = state.src;
      if (src.charCodeAt(state.pos) !== 0x5b || src.charCodeAt(state.pos + 1) !== 0x5e) return false;
      const close = nextMark(state, "]", state.pos + 2);
      if (close === -1) return false;
      const open = nextMark(state, "[", state.pos + 2);
      if (open !== -1 && open < close) return false;
      return footnoteRefRule.fn(state, silent);
    }
    markdown.inline.ruler.at("footnote_ref", footnoteRef);
    ```
  - Every scan then ends before the next `[`. The three inputs above then take 102, 89 and 103 ms instead of 6,811,
    4,588 and 7,241 ms.
  - Across 100,000 random inputs it renders the same HTML as the plugin, except for labels that contain `[`, such as
    `[^[^b]`, which no longer resolve.
  - Add two inputs to `SLOW_INPUTS`:
    - `"[^ with a definition"`: `` `${repeated("[^")}`.slice(0, CONTENT_MAX_LENGTH - 10) + "\n\n[^a]: x" ``.
    - `"[^a] with a definition"`: about 25,000 references to one footnote. Its page view renders 50,000 links and
      took 926 ms, half the budget, and is not measured today.
  - Correct "linear" in `pages.md` and in `review-report.md` once it is fixed.
- Confidence: Medium. Measured and compared with the plugin. Still open: labels with `[` no longer resolve, which
  GitHub probably does not allow either but which was not checked there, and the fix relies on the private
  `__rules__`, as `tableRule` already does.
- Alternatives: a footnote reference rule of its own (a copy of the plugin's, about 40 lines, with the bounded scan),
  without the private API but with more code to keep in step with the plugin.
- Reference: CWE-407 (Inefficient Algorithmic Complexity); ASVS 15.2.2.

#### issue: nested footnote definitions leak closing tokens into the content, which breaks the page view and the depth limit

- Location:
  - `src/features/pages/markdown.ts`, `footnoteTail()` and `analyseMarkdown()`.
  - The comment of `footnoteTail()` ("It makes the same tokens").
  - `spec/pages.md`, "Decisions" ("makes the same tokens in one pass").
- Severity: Minor. Only content that indents a footnote definition inside another one is affected, and `maxNesting`
  still bounds the nesting.
- Category: correctness
- Problem:
  - markdown-it-footnote allows a definition inside a definition, for example `[^a]: x\n    - [^b]: y`.
  - On the inner `footnote_reference_close`, `footnoteTail()` sets `definition = null`. So the rest of the outer
    definition, such as `list_item_close` and `bullet_list_close`, goes to the main tokens, while its opening tokens
    stay in the definition or are dropped with it.
  - The plugin leaks the same way. The two also differ in what the outer definition keeps, so "the same tokens" holds
    only without nesting.
- Impact:
  - In a quote, `> [^a]: x\n>     - [^b]: y\n>\n> after` gives
    `blockquote_open list_item_close bullet_list_close paragraph_open …`. The page view closes the quote early and
    shows "after" outside it.
  - `analyseMarkdown()` counts each stray `bullet_list_close` as one level less, so content with lists nested 25 deep
    passes the limit of 20.
- Evidence:
  - `# T\n\n` and a list nested 25 deep is refused with "Lists and quotes must be nested at most 20 levels deep". With
    `"[^a]: def a\n    - [^b]: def b\n\n".repeat(10)` before it, `analyseMarkdown().depth` is 15 and
    `pageContentInputSchema` accepts it.
  - Across 200,000 random inputs, `footnoteTail()` and the tail of the plugin differ in 1,821, and every one of them
    has a nested definition.
  - 419 of 100,000 random inputs give an unbalanced token stream.
- Suggestion (required):
  - Keep a stack in `footnoteTail()`. On `footnote_reference_open`, push the current `definition` before starting a
    new one. On `footnote_reference_close`, restore it with `definition = outer.pop() ?? null`.
  - This leaves 0 of the 100,000 inputs unbalanced, and the quote example keeps "after" inside the quote.
  - Add a unit test: nested definitions give a balanced token stream, and the depth example above is refused.
  - Reword the comment and `pages.md` to "the same tokens, except that a nested definition no longer leaks the end of
    the outer one".
- Confidence: Medium. The balance was checked on random inputs. The output for nested definitions changes from the
  plugin's, and what GitHub does with them was not checked.
- Alternatives: refuse nested definitions by wrapping `footnote_def` so that it returns `false` while
  `state.parentType === "footnote"`. Simpler, but a definition indented in another then shows as text of the outer
  one.

#### suggestion: the same content is parsed up to four times per save and per linking page of a rename

- Location:
  - The save in the browser: `src/features/pages/forms.ts` `parsePageContentFormData()`, then `service.ts`
    `updatePageContent()`, then `storeContentChange()` → `searchIndexData()` → `pageText()`, then `storeLinks()` →
    `linkRowsOf()` → `wikiLinksOf()`.
  - `createPage()`: `newPageInput()`, `searchIndexData()`, `linkRowsOf()`.
  - The rename: `links-service.ts`, with `rewriteWikiLinks()`, `titleFromContent()`, `pageText()` and `storeLinks()`.
  - The page view: `PageView.tsx`, `resolveWikiLinks()` → `wikiLinksOf()` and `markdownToReact()`.
- Severity: Minor. A few tens of milliseconds for realistic content at the limit; it matters mainly inside the
  exclusive lock of the links during a rename.
- Category: performance
- Problem: each consumer calls `parseMarkdown()` itself, so one content is parsed this many times:

  | Path                          | Parses                                  |
  | ----------------------------- | --------------------------------------- |
  | Save in the browser           | 4                                       |
  | Save through MCP              | 3                                       |
  | New page in the browser       | 4                                       |
  | Page view                     | 2                                       |
  | Each linking page of a rename | 4 (the last 3 on the rewritten content) |
  | Opening the editor            | 0 (only Lezer runs)                     |
  | Search indexing               | 1 per write                             |

  `pages.md` gives a reason only for the double validation.

- Impact:
  - Realistic content of 100,000 characters (headings, links, lists, tables, code) parses in 12 ms. A save in the
    browser costs 50 ms, about 37 ms of them repeats, and a linking page of a rename 51 ms.
  - With the slowest input that is still linear (`"!["`, 160–185 ms per parse), a save costs 690 ms and a linking
    page of a rename 691 ms. About 87 such pages at the limit would pass the 60 s timeout of `LINKS_TRANSACTION`, and
    the rename would fail.
  - Until the footnote finding above is fixed, a single such page needs only 28 s.
- Evidence: the call sites listed under Location, and the timings above.
- Suggestion (optional):
  - Let the derivations take tokens: `pageText(content, tokens)` and `wikiLinksOf(content, tokens)`, with the existing
    signatures parsing for themselves.
  - Parse once per stored content in `storeContentChange()`, `createPage()` and `updateLinkingPages()`. That gives 2
    parses per save and 2 per linking page instead of 4, and keeps the double validation that `pages.md` decided on.
  - Cover the rename with a linking page at the content limit in `integration/wiki-link-update.cost.test.ts`, whose
    pages today hold about 2,000 characters.
- Confidence: Low. It changes the interfaces of `text.ts` and `wiki-links.ts` across the pages and search features,
  and the gain was measured for the pure functions only, not end to end.
- Alternatives: share the tokens of the page view between `resolveWikiLinks()` and `markdownToReact()` (one parse less
  per view, about 12 ms); or a small memo of the last tokens per content (simple, but it holds the tokens of up to
  100,000 characters per entry).

#### issue: `pages.md` understates how often the content is parsed and how long a parse can take

- Location: `spec/pages.md`, "The cost of the Markdown parse" (the paragraph before the list, and the item "The length
  of the content is checked before any parse …"); `spec/review-report.md`, the Reviewed item "A save in the browser
  parses the content twice".
- Severity: Minor
- Category: docs
- Problem:
  - `pages.md` says that the parse "runs on the server at every save (twice in the browser …)" and that "the content
    of a new page is parsed once on the server". On the server, a save parses 3 times (4 in the browser), a new page 3
    times (4 in the browser), and a view 2 times.
  - `review-report.md` says that a parse "takes at most about 0.1 s at the content limit". `"!["` takes 160–185 ms,
    and footnote references 7 s until they are fixed.
- Impact: whoever weighs a limit or a change of the parse reads a cost of a half to a quarter of the real one.
- Evidence: the call sites and timings of the suggestion above.
- Suggestion (required):
  - Describe the parses without counts that drift: "at every save, once for each validation and once each for the
    search text and the index of links".
  - Replace "0.1 s" by a pointer to the budget of `markdown.cost.test.ts`.
- Confidence: Medium. The wording depends on whether the suggestion above is taken.

#### nit: `pages.md` names `markdown.ts` for `SAFE_PROTOCOLS` and for the prefix of the footnote ids

- Location: `spec/pages.md`, "Rendering", the items on safe addresses and on footnotes.
- Severity: Nit
- Category: docs
- Problem:
  - `pages.md` says "(`SAFE_PROTOCOLS` in `markdown.ts`)", but the set is in `src/features/pages/safe-address.ts`.
  - It says "their ids carry a prefix of their own (`markdown.ts`)", but the prefix is `ID_PREFIX` in
    `src/features/pages/components/markdownToReact.tsx`.
  - `npm run docs:check` checks only that the files exist, not where a symbol lives.
- Impact: a reader looking for the list of protocols or for the prefix opens the wrong module.
- Evidence: `grep -rn "SAFE_PROTOCOLS\|ID_PREFIX" src` finds only these two files.
- Suggestion (required): point to `safe-address.ts` and to `ID_PREFIX` in `components/markdownToReact.tsx`.
- Confidence: High. Both pointers were checked with grep, and `npm run docs:check` covers the file names.

#### nit: `wiki-links.md` restates the limit of 5,000 wiki links in "Decisions" without a pointer

- Location: `spec/wiki-links.md`, "Decisions" ("A page holds at most 5,000 wiki links, a guard for …").
- Severity: Nit
- Category: docs
- Problem: "The limit" in the same file states the value with its pointer (`CONTENT_MAX_WIKI_LINKS` in
  `src/features/pages/limits.ts`). The decision repeats the number without one, as does `pages.md`, which points only
  to the file.
- Impact: a change of the constant leaves a stale number in the decision.
- Evidence: `wiki-links.md`, "The limit" against "Decisions".
- Suggestion (optional): write "A page holds a limited number of wiki links (see "The limit")" in the decision.
- Confidence: High. A change of the document only, with one target, checked by reading both sections.

#### nit: the meta of the footnote tokens is read through untyped casts, unlike that of tasks, lists and wiki links

- Location: `src/features/pages/components/markdownToReact.tsx`, `footnoteNumber()` and `footnoteReferenceId()`;
  `src/features/pages/markdown.ts`, `footnoteTail()` (`open.meta` and `anchor.meta`).
- Severity: Nit
- Category: readability
- Problem:
  - `markdown.ts` exports `TaskMeta`, `ListMeta` and `WikiLinkMeta`. The metas of the footnotes, which it builds
    itself for `footnote_open` and `footnote_anchor` and which the plugin builds for `footnote_ref`, are read as
    `(token.meta as { id: number })` and `as { subId?: number }`.
  - The shape of the plugin's tokens reaches the renderer without a type.
- Impact: a change of the shape shows only in the render test of footnotes, not in the type check.
- Evidence: the cited functions.
- Suggestion (optional): export `type FootnoteMeta = { id: number; subId?: number; label?: string }` from
  `markdown.ts`, use `satisfies FootnoteMeta` in `footnoteTail()`, and cast to it in the two helpers.
- Confidence: High. Types only, no change of behaviour. `npm run typecheck` and "renders footnotes at the end with ids
  of the prefix user-content-" cover it.

#### nit: a footnote reference in the alt text of an image counts as a reference but shows nowhere

- Location: `src/features/pages/components/markdownToReact.tsx`, `leafElement()`, the case `"image"` (`plainText()` of
  the children); `src/features/pages/markdown.ts`, `plainText()`.
- Severity: Nit
- Category: correctness
- Problem: markdown-it parses the alt text of an image with the inline rules, so `![alt [^a]](/x.png)` creates a
  `footnote_ref` inside the image and counts it. The alt text becomes plain text without it, but the footnote still
  gets a back link `↩` to `#user-content-fnref-1`, and no element has that id.
- Impact: a dead back link, and a footnote listed without a visible reference.
- Evidence: `"![alt [^a]](/x.png)\n\n[^a]: note"` gives `inline(image(text footnote_ref))` and a `footnote_anchor` in
  the footnote block.
- Suggestion (optional): accept it as a current limit in `pages.md`, or skip a `footnote_ref` inside the label of an
  image in the footnote reference rule of the Major finding.
- Confidence: Low. It needs a decision on whether this is worth a rule, and the plugin behaves the same way.

#### question: should the wiki links of footnote definitions that are not shown be indexed and updated on renames?

- Location: `src/features/pages/markdown.ts`, `footnoteTail()`; `src/features/pages/wiki-links.ts`, `wikiLinksOf()`.
- Severity: Minor
- Category: correctness
- Problem: a definition that no reference uses, and the earlier of two definitions with the same label, leave no
  tokens. Their wiki links are not counted, indexed, shown as backlinks or rewritten on a rename.
  `"# T\n\n[^a]: unused [[x]]\n"` parses to `heading_open inline heading_close` only.
- Impact: once the footnote is referenced later, the link may point to an old name. `wiki-links.md` does not say
  whether that is intended.
- Evidence: the parse of the input above.
- Suggestion (optional): either state in `wiki-links.md` that only the links that are shown count, or collect the
  positions of the wiki links before `footnote_tail` drops tokens, for the rewrite only.

## Reviewed

- The replaced footnote tail:
  - Without nested definitions, `footnoteTail()` makes exactly the tokens of `footnote_tail` of the plugin: type, tag,
    nesting, level, content, markup, info, meta, map, hidden, block and children were the same for 200,000 random
    inputs. The inputs mixed references, duplicate and empty definitions, definitions of several paragraphs, lists,
    quotes, code, tables, headings, and references in links and images.
  - The last of duplicate labels wins, as in the plugin. The anchors go into the last paragraph, or after a closing
    list or code block. An empty definition gets its anchor alone.
  - With inline footnotes off, every entry has a label, which avoids the stale `tokens` variable of the plugin.
  - Its cost: one pass. "many footnotes" (3,291 footnotes) parses in 44 ms with it and in 235 ms with the tail of the
    plugin.
  - Its safety: the ids of footnotes come from their number only, never from the label, and carry `user-content-`.
    Labels reach the page only as React text. `footnote_def` scans only its own line, and `maxNesting` bounds the
    nesting.
- The shape of the tokens: the consumers depend on the token types, `nesting`, `hidden`, `info`,
  `attrGet("href"|"src"|"title"|"start"|"style")`, `markup === "linkify"` (the prose of search) and the metas. Each
  dependency either fails loudly or is covered:
  - `tableRule` throws at load if markdown-it has no table rule.
  - The parse of `style="text-align:…"` is covered by "renders a table with alignment".
  - `markup === "linkify"` is covered by "holds a file name in running text but no `www.` address" in `text.test.ts`.
  - The internals of linkify-it have the named test "links `www.` addresses only at the start of a word".
  - The positions of wiki links are checked against the source (`src.startsWith`), and the corpus tests cover every
    kind of block.
  - The default branches of the renderer show unknown tokens as text and unknown containers as fragments, so an
    upgrade that adds a token type stays safe, though silently.
  - The lockfile pins markdown-it 15.0.3 and markdown-it-footnote 4.0.0.
  - The editor imports no markdown-it. `link-address.ts` is tested against `parseMarkdown()` (`link-address.test.ts`),
    and `safe-address.ts` is shared.
  - The remaining gaps are the untyped footnote metas and the order of the tokens that `rewriteWikiLinks()` relies on
    (both findings above).
- The parse paths: traced as in the suggestion above. Opening the editor parses nothing with markdown-it on the
  server, and its list of pages comes from the database.
- Escaped task markers: already open in `list-layout-review.md` ("an escaped task marker `\[ ]` still makes a task
  item"). More evidence for it:
  - `- &#91; ] entity` is taken as a task too.
  - The editor (Lezer with GFM) shows neither as a task, so the editor and the page view disagree.
  - The cause is the order of the rules: `task_lists` runs after `text_join`, which merges the `text_special` of `\[`
    and `&#91;` into the text. Registered with `markdown.core.ruler.before("text_join", …)`, the first child of an
    escaped item is `text_special` and no longer matches, while `- [ ] real` stays one `text` token `"[ ] real"`. This
    is an alternative to the fix suggested there.
- Specs that restate values: the protocols in `pages.md` are the security rule itself, and the code points to the
  spec. The limits in `pages.md` name `limits.ts`. The budget of 2 s in `pages.md` and `testing.md` is a requirement
  that the cost tests implement. No message of `schema.ts` is restated in a spec.

## Not covered

- The real server under load. The blocking of the event loop of the footnote finding is inferred from measured times
  of the parse and the render of the pure functions, not observed end to end.
- The corruption of a rename through the database (`moveOrRenamePage()` in an integration test). Only the pure
  `rewriteWikiLinks()`, which `links-service.ts` calls directly, was run.
- What GitHub does with nested footnote definitions, footnote labels that contain `[`, and the task marker `\[ ]`.
- Timings on the CI runner. All numbers are from an Apple M4 Pro, so the margins of the cost budgets in CI may be
  smaller.
- The cost tests (`npm run test:cost`), the end-to-end and the integration tests. Only the unit tests named above ran.
- The cost of the editor (Lezer) when it opens large pages.
