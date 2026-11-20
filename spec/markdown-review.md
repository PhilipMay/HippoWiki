# HippoWiki – Review of the Markdown Parsing

## Summary

- Verdict: no Blocker. The parser is sound: one markdown-it setup serves the title, the checks of the content, the
  search text and the page view; raw HTML stays text, unsafe addresses do not become links, and limits and benchmarks
  guard against slow or deeply nested content. The weak point is the links from bare addresses, which also turn file
  names into links to unrelated hosts.
- Findings: 1 in all, 0 Blocker, 0 Major, 1 Minor and 0 Nit (1 `issue:`). Of the 1 Suggestion, 0 are High, 1 Medium
  and 0 Low.
- To fix first: file names that become links.
- Not covered by this review: the structure of the code around the parser (the coupling of the consumers to the
  tokens of markdown-it, the replaced footnote rule, the repeated parses), which the review named but did not report
  as findings.

## Scope and method

- Reviewed: `src/features/pages/markdown.ts`, `src/features/pages/components/markdownToReact.tsx`,
  `src/features/pages/components/MarkdownContent.tsx` and `src/features/search/text.ts`, as far as they parse Markdown
  and use its tokens. The rules checked against are "Rendering" in `spec/pages.md`.
- Date: 2026-11-20. The code is the state of the branch `main` after the commit `add wiki link ideas`.
- Evidence comes from reading the code and from `node -e` scripts that render inline Markdown with the installed
  markdown-it 15 and linkify-it 6.1.0, with the options of `markdown.ts` and with the options of the Suggestion.

## Findings

### issue: file names such as `README.md` or `setup.py` become links to unrelated hosts

- Location: `src/features/pages/markdown.ts`, the setup of the parser `markdown`, the line
  `markdown.linkify.set({ fuzzyLink: true })`; `spec/pages.md`, "Rendering", the item on GitHub Flavored Markdown
- Severity: Minor. No script runs and no content is lost, but text is shown wrong and a click leads to a foreign host.
- Category: correctness
- Problem: with `fuzzyLink: true`, linkify-it links every word of the form `name.tld` whose last part is a known
  top-level domain, and its list holds every two-letter country code. Many file extensions are one: `.md` (Moldova),
  `.py` (Paraguay), `.rs` (Serbia), `.sh` (Saint Helena), and also `.de`, `.io` or `.ai`. A file name in running text therefore becomes a link to `http://<file name>`. The comment at the setting says the
  links follow GitHub Flavored Markdown, which links only addresses that start with `www.`, `http://` or `https://`.
  "Rendering" in `spec/pages.md` names the linking of a bare domain such as `example.com` as a deliberate difference
  from GitHub, but not that it also links file names.
- Impact: every author who writes about files, code or projects in prose, an everyday case in a wiki, gets links they
  did not write. A reader who clicks `README.md` lands on the site of the domain readme.md, a host outside the wiki that
  anyone may own. Search treats the text of such a link as a bare address (`inBareLink` in
  `src/features/search/text.ts`): the file name is left out of the prose that the language is detected from.
- Evidence: rendered inline with the options of `markdown.ts`:

  ```
  See README.md, setup.py, main.rs, config.sh, index.de and notes.md.
  → See <a href="http://README.md">README.md</a>, <a href="http://setup.py">setup.py</a>,
    <a href="http://main.rs">main.rs</a>, <a href="http://config.sh">config.sh</a>,
    <a href="http://index.de">index.de</a> and <a href="http://notes.md">notes.md</a>.
  Version 1.2 and v2.io
  → Version 1.2 and <a href="http://v2.io">v2.io</a>
  ```

  Inline code (`` `README.md` ``) is not linked.

- Suggestion (required): link bare addresses as GitHub Flavored Markdown does. Switch fuzzy links off, which also
  stops links of `www.` addresses, and add `www.` as a schema of linkify-it of its own:

  ```ts
  markdown.linkify.set({ fuzzyLink: false });
  markdown.linkify.add("www.", {
    validate(text, pos, self) {
      const re = new RegExp(self.re.get_url_host_port().source + self.re.get_path().source, "iy");
      re.lastIndex = pos;
      return re.exec(text)?.[0].length ?? 0;
    },
    normalize(match) {
      match.url = `http://${match.url}`;
    },
  });
  ```

  Tried with the installed markdown-it: `README.md`, `setup.py`, `main.rs` and `example.com` stay text;
  `www.example.org/a?b=1`, `(www.example.de)`, `WWW.Example.org`, `https://example.com/a` and `mail@example.net`
  still become links, with the same addresses as today; `awww.x.org` and a lone `www.` do not. Change the comment at
  the setting, and in "Rendering" of `spec/pages.md` replace the difference "links from bare addresses as linkify-it
  finds them, which also links a bare domain with a known top-level domain such as `example.com`" by links from bare
  addresses as on GitHub, starting with `www.`, `http://` or `https://`, and bare mail addresses. Add to the test "turns
  bare addresses into links" in `src/features/pages/markdown.test.ts` that `README.md`, `setup.py` and `example.com`
  give no link; the addresses that test expects today stay the same.

- Confidence: Medium. The fix was run only in a `node -e` script, not in the code and its tests; it takes away the
  links of bare domains that "Rendering" of `spec/pages.md` names on purpose, which users see; and the `validate`
  function uses `self.re.get_url_host_port()` and `self.re.get_path()`, regular expressions that linkify-it 6 builds
  for its own schemas but does not document, so that an update of linkify-it may break it (the test above would show
  it).
- Alternatives:
  - Keep fuzzy links, but replace the list of top-level domains with generic ones only, for example
    `markdown.linkify.tlds(["com", "org", "net", "info", "dev", "app"])`: file names with a country code stay text and
    `example.com` stays a link, but `example.de` or `example.io` lose theirs, and an extension such as `.app` or `.dev`
    is still linked.
  - Keep the code and add the linking of file names to "Current limits" in `spec/pages.md`: no change in behaviour,
    but the links to foreign hosts stay, and authors have to put file names in backticks.

## Reviewed

These parts hold the rules of "Rendering" in `spec/pages.md` without a finding:

- One parser for the title, the checks of the content, the search text and the page view, with no server-only
  imports, so that the name the save dialog suggests comes from the same rules.
- Raw HTML stays text; a link or image becomes one only with a relative address or one of `SAFE_PROTOCOLS`, entities
  and escapes included; the page view puts text into the page only as React children, never as HTML, and prefixes
  every id.
- Deep nesting and many footnotes, table cells or tokens stay fast: `maxNesting`, the limits of `limits.ts`, the walks
  with a stack of their own, the footnote rule in one pass, and the cost tests with `src/test/slow-markdown.ts`.
- A page view that cannot be rendered falls back to the source as text, and the error is logged without the content.
