# Bare Links – Steps

## Goal

File names in running text, such as `README.md` or `setup.py`, stay text in the page view instead of becoming links to
unrelated hosts. Bare addresses become links as on GitHub: those starting with `www.`, `http://` or `https://`, and bare
mail addresses. This fixes the finding "file names such as `README.md` or `setup.py` become links to unrelated hosts"
of `markdown-review.md`, the last finding of that report.

## Scope

- In: the linking of bare addresses in `src/features/pages/markdown.ts`, which the page view, the search text and the
  checks of the content share; its unit and cost tests; "Rendering" in `pages.md`; deleting the finding and with it
  `markdown-review.md`.
- In: the fix as the Suggestion of the finding describes it, which the user chose on 2026-11-21 (the Decision of the
  finding, "as suggested"), with one change found while planning: the regular expression of `validate` is built once,
  not at every call. Built at every call, it made the parse of content at the limit full of `www.` addresses about
  seven times slower (182 ms instead of 25 ms in a `node` script with markdown-it 15.0.3 and linkify-it 6.1.0).
- Not in: the Markdown editor. Its live preview and Ctrl+click already treat only `www.`, `http://`, `https://` and
  mail addresses as bare addresses (the GFM autolinks of its parser, `bareAddress()` in
  `src/features/pages/editor/preview-plugin.ts`), so after the fix it agrees with the page view and needs no change.
- Not in: the alternatives of the finding (a list of generic top-level domains, or a current limit instead of a fix),
  and the structure of the code around the parser, which the review named but did not report as findings.
- Not in: pages that are already stored. Their content stays as it is; only how it is shown changes.

## Checklist

- [x] Link bare addresses as GitHub does
- [ ] Wrap-up

## Link bare addresses as GitHub does

### Goal

A bare address becomes a link only when it starts with `www.`, `http://` or `https://`, or is a mail address, so that
file names and bare domains such as `example.com` stay text; the finding is closed and the report deleted.

### Build

- In `src/features/pages/markdown.ts`, switch fuzzy links off and add `www.` as a schema of linkify-it of its own, as
  the Suggestion of the finding shows: `markdown.linkify.set({ fuzzyLink: false })` and
  `markdown.linkify.add("www.", { validate, normalize })`, where `normalize` prefixes `http://`.
- `validate` matches the host, port and path that follow `www.` with `self.re.get_url_host_port()` and
  `self.re.get_path()`, typed in `REBuilder` of linkify-it 6.1.0. `self.re` exists only once linkify-it has compiled
  its schemas, so the sticky, case-insensitive regular expression is built at the first call and kept for every later
  one, not built at each call. Say in a comment that these builders are not documented by linkify-it, and that the
  unit test of this step shows when an update breaks them.
- Rewrite the two comments at the setup of the parser, the doc comment of `markdown` and the line comment at the
  linkify setting: bare addresses are linked as in GitHub Flavored Markdown, starting with `www.`, `http://` or
  `https://`, and bare mail addresses; a bare domain or a file name such as `README.md` stays text.
- In "Rendering" of `spec/pages.md`, drop "links from bare addresses as linkify-it finds them, which also links a bare
  domain with a known top-level domain such as `example.com`" from the differences from GitHub, so that links from bare
  addresses are one of the features of GitHub Flavored Markdown it supports as on GitHub. Add a sentence that file
  names such as `README.md` and bare domains such as `example.com` stay text. Add a decision to "Decisions" of
  `pages.md`: why bare domains are not linked (country codes such as `.md`, `.py`, `.rs` and `.sh` are file extensions,
  and a click would lead to a host outside the wiki that anyone may own), with the rejected alternatives of the
  finding (a list of generic top-level domains; keeping the links as a current limit).
- Close the finding as "Fixing a finding of the review report" in `spec/step-plan-workflow.md` describes:
  - Delete the finding from `spec/markdown-review.md`. It is the last finding and the report has no open questions,
    so delete the whole file and its entry in the spec catalog in `CLAUDE.md`.
  - Move what still applies: "Not covered by this review" names the structure of the code around the parser (the
    coupling of the consumers to the tokens of markdown-it, the replaced footnote rule, the repeated parses). Add it
    as one item to "Things to Check" in `spec/roadmap.md`, pointing to `markdown.ts`. The "Reviewed" list needs no new
    place: "Rendering" and "The cost of the Markdown parse" in `pages.md` already hold its rules.
  - Search `spec/`, `README.md` and `CLAUDE.md` for `markdown-review`, `fuzzyLink`, `linkify-it finds`, `README.md`
    and `bare domain`, so that no reference to the finding or the report is left.

### Test

- Unit, `src/features/pages/markdown.test.ts`: the test "turns bare addresses into links" keeps its input and expects
  the same addresses as today. A new test "leaves file names and bare domains as text": `README.md`, `setup.py`,
  `main.rs`, `config.sh`, `index.de`, `v2.io` and `example.com` in running text give no link. A new test "links `www.`
  addresses only at the start of a word": `www.example.org/a?b=1`, `(www.example.de)` and `WWW.Example.org` give
  `http://www.example.org/a?b=1`, `http://www.example.de` and `http://WWW.Example.org`; `awww.x.org` and a lone
  `www.` give no link.
- Unit, `src/features/search/text.test.ts`: a file name in running text is part of the prose (`pageText()` of
  `Edit README.md first.` has `README.md` in its prose), while a `www.` address is still searched but left out of the
  prose.
- Cost, `src/test/slow-markdown.ts`: add the input `"www addresses": repeated("www.a.de ")`, content at the limit with
  a `www.` link every nine characters, which calls `validate` most often. `npm run test:cost` passes with it, and
  the existing inputs `"www.a"` and `"bare addresses"`, for `markdown.cost.test.ts` and `text.cost.test.ts`.
- End-to-end: this is the last step that changes more than documentation, so the complete `npm run test:e2e` runs
  (see "The complete end-to-end suite" in `spec/step-plan-workflow.md`); `e2e/pages.spec.ts` and
  `e2e/editor-preview.spec.ts` hold bare addresses and keep passing unchanged.
- Manual, in the browser: a page with `See README.md, example.com and www.example.org.` shows `README.md` and
  `example.com` as text and `www.example.org` as a link to `http://www.example.org`; in the editor's live preview the
  same line styles only `www.example.org` as a link.
- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. `spec/pages.md` already describes the linking of bare addresses as built, with its decision, from the first step;
   check that "Rendering" and "Decisions" match the code. No other spec file changes: no convention of
   `architecture.md`, `testing.md` or `tech.md` changed.
2. `roadmap.md` holds no item for this fix; leave it, apart from the item of "Things to Check" added in the first step.
3. Check that `README.md` has all the commands a developer needs; the fix adds none, and its summary of what the
   prototype can do needs no change for it.
4. Delete this step file. There is no requirements file, and no requirement IDs are in the code or the tests.
5. Remove this step file from the spec catalog in `CLAUDE.md`; `markdown-review.md` was removed in the first step.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass: only `npm run check`, because the step
  changes only documentation.
