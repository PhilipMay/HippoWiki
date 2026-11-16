# Markdown Parser – Steps

## Goal

Pages are parsed and rendered with markdown-it instead of micromark and react-markdown, and content is checked against
limits on nesting and table cells when it is saved. No page, save or MCP call can then tie up the server for seconds or
minutes, and a page that can be saved can always be viewed, moved and deleted. This fixes the findings on Markdown in
the area "Content" of `review-report.md`, measured in a benchmark: micromark took up to 15 s for 100,000 characters,
more than 60 s for nested lists, and react-markdown built 4,000,000 table cells from 12,000 characters, while
markdown-it stayed below 110 ms for every input.

## Scope

- In:
  - The content check in a new order: line breaks normalised first, then NUL refused, then the length checked. Fixes
    the findings "the content limit is checked before line breaks are normalised, so content that fits the editor can
    be refused" and "a NUL character in the content reaches the database and gives "could not be saved" and an error
    in the log".
  - markdown-it as the only Markdown parser: for the title (`titleFromContent()`), for the page view
    (`MarkdownContent`), and in the browser for the name the save dialog suggests (`NewPageForm`). react-markdown,
    `remark-gfm`, `micromark-extension-gfm` and the `mdast-util-*` packages are removed.
  - A renderer of its own from markdown-it tokens to React elements with the Material UI components of today, still a
    Server Component, with the source shown as text if rendering fails.
  - The GFM features of today: tables with alignment, strikethrough, task lists, footnotes and links from bare
    addresses. Raw HTML stays text.
  - Limits checked at every save, in the browser and through MCP, with a field error: the depth of nested lists and
    quotes, and the number of table cells of a page. Title, depth and cells come from one parse per validation.
  - The MCP tool `create_page` checks the content before it derives a name from it.
  - End-to-end tests of the variants of unsafe links that the review checked by hand (the Markdown part of the finding
    "the protections that come from Next.js, the MCP SDK and Better Auth have no regression test").
  - Tests that the inputs of the benchmark stay fast, so that an update of markdown-it cannot bring the slow parse back
    unnoticed.
  - Deleting the findings this fixes from `review-report.md` and bringing the specs in line, in the step that fixes
    each of them.
- Not in:
  - A parse in a worker thread or with a time limit: markdown-it is linear on all inputs of the benchmark.
  - A stored or cached render of pages (part of "Public content" in `roadmap.md`).
  - Other Markdown features than the GFM features listed above: no math, no heading ids, no `[[wiki links]]`, no
    syntax highlighting.
  - Changes to the editor, which stays a textarea.
  - Rewriting stored content or titles: a stored title stays until the next save of its page.
  - The other findings of the area "Content" (counts and paging, the second statement of writes) and the other parts
    of the cross-cutting findings that this plan touches.

## Checklist

- [x] Content check order
- [x] markdown-it for title and page view
- [x] Limits on nesting and table cells
- [ ] Wrap-up

## Content check order

### Goal

Content that fits the editor is never refused for its length, and a NUL character gives a field error instead of a
failed write.

### Build

- `contentSchema` in `src/features/pages/schema.ts`: normalise CRLF and CR to LF first, then refuse content that
  contains U+0000 with a field error ("Content must not contain NUL characters" or similar), then check
  `CONTENT_MAX_LENGTH`. Zod checks after a transform go in a `.pipe()` or a refinement on the transformed value; keep
  the rule that too long content reports only the length error.
- The MCP write tools reach the same schema through the service; nothing else changes there.
- `pages.md`, "Content and title": the length counts the content with plain line breaks, as the editor counts it, and
  content with a NUL character is refused.
- Fix both findings as "Fixing a finding of the review report" in `step-plan-workflow.md` describes: delete them from
  `review-report.md`, update the counts of "Summary", move ASVS 2.2.1 and 16.5.3, CWE-180 and CWE-20 into the
  "Reviewed" list of the area "Content" with what the fix does and how it was checked, and search the report and the
  specs for references to them.

### Test

- Unit tests in `src/features/pages/schema.test.ts`: content of exactly `CONTENT_MAX_LENGTH` characters after
  normalisation but longer with CRLF is accepted; one character more is refused with the length error; content with
  U+0000 is refused with the NUL error at the content field; empty content still reports the missing title.
- Unit test in `src/features/pages/forms.test.ts`: a form with CRLF content at the limit parses.
- `e2e/edit-page.spec.ts` and `e2e/create-page.spec.ts` run unchanged.
- Manual check on `npm run dev`: a page of 100,000 characters with many line breaks, typed into the editor up to its
  `maxLength`, saves.

## markdown-it for title and page view

### Goal

One parser, markdown-it, derives the title and renders the page, linear in the length of the content, so that no
input takes seconds; the page view looks as before and stays free of script.

### Build

- Add `markdown-it` and `markdown-it-footnote` in their latest stable versions, and their types if the packages ship
  none. Remove `react-markdown`, `remark-gfm`, `micromark-extension-gfm`, `mdast-util-from-markdown`,
  `mdast-util-gfm` and `mdast-util-to-string`.
- A module `src/features/pages/markdown.ts`, with no server-only imports because `NewPageForm` uses it in the browser:
  - one markdown-it instance with `html: false` (raw HTML stays text), `linkify: true` (links from bare addresses),
    `typographer: false`, and an explicit `maxNesting` with a comment on how it relates to the depth limit of the
    next step;
  - `markdown-it-footnote`;
  - task lists as a small core rule of its own (a list item whose text starts with `[ ] ` or `[x] `), because the
    common plugins for them are no longer maintained;
  - `validateLink` with the protocols the page view allows today: `http`, `https`, `mailto`, `irc`, `ircs`, `xmpp` and
    relative addresses. A link or image with another address, `data:` and `javascript:` included, in any spelling,
    is not parsed as a link or image and stays its Markdown text;
  - a function that parses content into tokens, used by both the title and the page view;
  - the rule `footnote_tail` of `markdown-it-footnote` replaced by one of its own that makes the same tokens in one
    pass, because the rule of the plugin copies all tokens once per footnote (about 0.3 s at the content limit with
    many footnotes and many other tokens); inline footnotes (`^[text]`) are switched off, as on GitHub;
  - `fuzzyLink` of linkify-it switched on, because linkify-it no longer links `www.` addresses by default.
- `titleFromContent()` in `src/features/pages/derive.ts` works on the tokens: the first token must be a level-1
  heading written with `#` (`markup`), and it must start on the first line that is not blank (`map`), so that a link
  reference or footnote definition before it, which leaves no token in front of it, still counts as a block before the
  heading. The text is the plain text of its inline tokens: text, inline code and the alt text of images; line breaks
  become spaces. The rest of the rule (whitespace, trimming, the cut at `TITLE_MAX_LENGTH`, a letter or digit) stays.
  `derive.test.ts` stays as it is and must pass; a case that cannot is a change of the rule and goes to the user first.
- `MarkdownContent` renders the tokens to React elements with the components of today (headings two sizes smaller,
  `Typography`, `MuiLink`, the outlined table, the quote with its left border, the styles of lists, code and task
  lists). The conversion is plain code of its own, for example `src/features/pages/components/markdownToReact.tsx`:
  - text only ever as React children, never as HTML; no `dangerouslySetInnerHTML`;
  - the alignment of table cells as a prop or style object, not as a style string;
  - code blocks as `pre` and `code` with the class `language-<info>`;
  - footnotes in a section at the end, with ids prefixed `user-content-` as today, so that no id of the page can
    clobber a global of the DOM;
  - a `try`/`catch` around parse and conversion: on an error the source is shown in a `pre`, the error is logged with
    `{ err }` and without the content, and the page with its actions stays usable.
- `pages.md`, "Rendering": markdown-it with its features, what differs from GitHub (strikethrough only with `~~`,
  links from bare addresses as linkify-it finds them), unsafe links and images shown as their Markdown text, and the
  source shown when rendering fails; the code pointers name the new files; "Decisions" says why markdown-it (linear
  parse, measured) and why a renderer of its own instead of HTML from markdown-it (no `dangerouslySetInnerHTML`, the
  Material UI components). Update "Current limits" for `data:` images.
- `architecture.md`, "UI": the two bullets on Markdown name markdown-it and the shared module instead of
  react-markdown and the mdast packages.
- `e2e/security-headers.spec.ts`: the comment on the `data:` image names the new rule; the test still finds no image.
- In `review-report.md`: the finding "the protections that come from Next.js, the MCP SDK and Better Auth have no
  regression test" loses its Markdown part (Problem, Evidence and Suggestion); the "Reviewed" list of the area
  "Content" describes markdown-it in "Rendering and XSS" and "DOM clobbering", with the variants now tested; "What is
  good" and "Accepted deviations" no longer name react-markdown. The findings on the slow parse, the nested lists, the
  tables and the deep nesting stay until the next step, which completes them.

### Test

- Unit tests in `src/features/pages/markdown.test.ts`:
  - each input of the benchmark at the full content limit is parsed and rendered with `renderToString()` of
    `react-dom/server` within 2 s: `a~`, `**a`, `[a][`, `*a`, `_a`, `~~a`, `[`, `![`, `[a](`, `` `a ``, `<a`, `a]`,
    `www.a`, `[^a]`, one list item per line, lists and quotes nested 50,000 deep, and a table header of 3,000 columns
    with 3,000 rows of one cell; markdown-it took at most 110 ms for each, micromark and react-markdown between 2.5 s
    and more than 60 s;
  - raw HTML (`<script>`, `<img onerror>`) comes out as text;
  - `javascript:`, `JaVaScRiPt:`, `&#106;avascript:`, `vbscript:` and `data:` links, a reference to `javascript:`, an
    autolink `<javascript:…>` and a `data:` image give no `a` or `img` element with that address; `https:`, relative
    and `mailto:` links stay;
  - a table with alignment, strikethrough, a task list, a footnote with its `user-content-` ids and a bare address give
    the expected elements;
  - a conversion that throws shows the source as text.
- `src/features/pages/derive.test.ts` passes unchanged, plus cases for a link reference definition and a footnote
  definition before the heading (no title).
- `e2e/pages.spec.ts`: the test of raw HTML and unsafe links covers the variants above, with no dialog and no
  `javascript:` address on the page; the rendering test still finds headings, links, lists and the table.
- The specs that render or derive titles run: `e2e/pages.spec.ts`, `e2e/create-page.spec.ts`,
  `e2e/edit-page.spec.ts`, `e2e/security-headers.spec.ts`, `e2e/deleted-pages.spec.ts`, `e2e/mcp.spec.ts`.
- Manual check on `npm run dev`: a page with every GFM feature looks as before the switch, in light and dark mode.

## Limits on nesting and table cells

### Goal

Content with lists and quotes nested too deep, or with too many table cells, is refused at save with a field error, in
the browser and through MCP, and the cost of the Markdown parse is documented with its guards.

### Build

- `src/features/pages/limits.ts`: the depth of nested lists and quotes (20) and the number of table cells of a page,
  the cells that rows are filled up to their header's columns included (10,000).
- `src/features/pages/markdown.ts`: one function that parses the content once and returns the title, the deepest
  nesting of lists and quotes and the number of table cells. `maxNesting` stays high enough that content one level
  deeper than the limit still shows that depth in the tokens before markdown-it stops nesting.
- `src/features/pages/schema.ts`: `withDerivedTitle()` takes all three from that one parse and reports a field error
  at the content for each limit, after the length check. `titleFromContent()` stays for the browser.
- `src/features/mcp/tools.ts`, `createPage()`: the content is checked with the same content schema before a name is
  derived from it, so that content over the length limit is never parsed there.
- The browser save still validates in the form and again in the service, as `architecture.md` asks; each validation
  parses once. Write this down in `pages.md` as a decision: with a linear parse of at most about 0.1 s at the content
  limit, a second parse costs less than giving up the second validation. It closes the part "parse only once per save"
  of the finding on the slow parse by a reason, so it gets an entry in "Accepted deviations" of `review-report.md`.
- `pages.md`: the two limits and the reason for each under "Content and title", with a pointer to `limits.ts`; a
  section on the cost of the Markdown parse (linear, its worst case measured at the content limit, the guards: the
  length, the depth and the cells, checked at every save); "Current limits": pages stored before the limits that go
  past them render with deeper levels or extra cells dropped and can be saved only once they are within them, and
  inline nesting past `maxNesting` is dropped silently.
- `roadmap.md`, "Public content": the depth limit exists now; what is left is a stored or cached render.
- Fix the findings "some Markdown takes quadratic time to parse, so one page blocks the whole server for seconds on
  every view and save", "deeply nested lists make the parse run for minutes before it overflows the stack, so one save
  blocks the whole server", "a small table with many columns and many short rows expands to millions of cells, so one
  page blocks the whole server on every view" and "deeply nested Markdown overflows the stack, so a page can be saved
  but not viewed or deleted" as "Fixing a finding of the review report" in `step-plan-workflow.md` describes:
  - delete the four sections;
  - "Summary": the verdict's list of weak points, the counts, "To fix first" (remove the three items and renumber the
    rest) and the sentence in "Not covered by this review" on the nested lists and tables measured outside the server;
  - move ASVS 15.1.3, 15.2.2 and 16.5.3, CWE-407, CWE-674, CWE-405 and CWE-400 into the "Reviewed" list of the area
    "Content" with what the fix does and how it was checked; reword "Regular expressions" and "Limits" there, and the
    reference in the area "MCP server";
  - the finding "no spec lists the costly functions and how each is protected" no longer names the Markdown parse, the
    nested lists and the tables, and points to the new section of `pages.md` as the first entry of the table it asks
    for; the finding itself stays open;
  - search `spec/`, `README.md` and `CLAUDE.md` for the titles and key words (quadratic, nested, cells, stack).

### Test

- Unit tests in `src/features/pages/markdown.test.ts`: depth and cells for flat content, for lists and quotes nested to
  the limit and one deeper, mixed lists and quotes, and for tables whose rows are filled up; the count still reaches
  past the limit for content nested 50,000 deep.
- Unit tests in `src/features/pages/schema.test.ts`: content at both limits is accepted, one level or one cell more is
  refused with its field error at the content; too long content reports only the length error.
- Unit tests in `src/features/mcp/tools.test.ts`: `create_page` without a name and with content over the length limit
  answers with the length error and never derives a title; content nested too deep answers with the depth error.
- `e2e/create-page.spec.ts`: a new page with lists nested one level too deep is refused with the field error, and the
  typed content stays in the editor. `e2e/edit-page.spec.ts`: the same for a table with too many cells.
- `e2e/mcp.spec.ts`: `replace_page_content` with content nested too deep is refused, and the page keeps its version.
- The specs that run: `e2e/create-page.spec.ts`, `e2e/edit-page.spec.ts`, `e2e/mcp.spec.ts`, `e2e/pages.spec.ts`.
- Manual check on `npm run dev`: `/api/health` answers at once while a page of 100,000 characters of `a~` is saved and
  viewed.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `step-plan-workflow.md`), or extend an
   existing feature spec, and move the rules and decisions of the requirements file that still hold into it; update
   `architecture.md`, `testing.md` or `tech.md` where conventions changed. For this plan: check that `pages.md`
   covers parser, rendering, limits and the cost of the parse as built, and add to `testing.md` that the Markdown
   inputs of `markdown.test.ts` guard the cost of the parse.
2. Remove the feature from `roadmap.md`.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and the requirements file of the feature, if there is one.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file and the requirements file.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.
