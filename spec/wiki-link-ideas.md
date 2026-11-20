# HippoWiki – Wiki Link Ideas

Research and ideas for `[[wiki links]]` between pages, the entry "Wiki links" under "Links" in `roadmap.md`. The file
shows how comparable wikis, team wikis and note tools handle links between pages, and lays out the options for
HippoWiki with their trade-offs. It decides nothing: the requirements of the feature are gathered later, as
`requirements-workflow.md` describes, and the open questions at the end are the ones they have to answer.

Researched on 2026-11-20, from the official documentation and the source code of each system where it could be read.
A claim that rests only on a forum post, a third-party listing or a search snippet says so; a conclusion drawn from the
material, and not stated by a source, is marked as an inference.

## In short

- There is no standard. CommonMark and GitHub Flavored Markdown have no `[[...]]`; every implementation is an
  extension. Target first, `[[Target|Label]]`, is the majority (MediaWiki, DokuWiki, Obsidian, Foam, SilverBullet,
  Bear, MD4C). Label first, `[[Label|Target]]`, is used by Gollum, GitLab, TiddlyWiki and Dendron; Zettlr makes the
  order a setting, and Pandoc has one extension for each order.
- Every system that links by name resolves the link against a unique name or path, never against a display title
  that may repeat. "Link by name, show the title" is established: DokuWiki with `useheading`, Dendron, Trilium,
  Outline mentions and Confluence Smart Links. It fits HippoWiki, where the name is unique and URL-safe and the title
  is not unique.
- HippoWiki names (lowercase letters, digits, single hyphens) hold none of the characters that are link syntax in
  other tools (`|`, `#`, `/`, `]`, `^`, `:`), which Obsidian, SilverBullet and TiddlyWiki have to forbid or warn about
  in names.
- Rename and move are the hard part. Four strategies exist: rewrite the linking pages (BookStack, XWiki, Obsidian,
  Foam, SilverBullet), keep stable ids in the link (Notion, Outline, Joplin, Trilium), leave a redirect (MediaWiki,
  Gollum, GitLab), or patch only the rendered output (Wiki.js 2). A server that sees every write can rewrite all
  linking pages in one transaction, but in HippoWiki each rewrite is a content change, with a revision, a new version,
  a last editor and a channel.
- Mature systems keep a derived link table, one row per link, and also store links to pages that do not exist
  (MediaWiki `pagelinks`, Obsidian `unresolvedLinks`, SilverBullet "aspiring pages"). Backlinks and lists of broken
  links come from it.
- Links within one folder leak nothing, because every role reads the whole folder. Links across folders would show
  readers whether a page exists, as known from DokuWiki and Redmine, and an AI app could not follow them.
- The markdown-it plugins for wiki links are small, mostly unmaintained and render HTML strings. An own inline rule
  that emits a token of its own fits the rule that the page view is built from tokens into React.
- AI apps read and write the raw Markdown. A name in the link maps directly to the arguments of `read_page`; an id
  would not. The grammar has to be stated to the model, because models tend to write a title instead of a name, the
  other pipe order or a `.md` suffix (inference).

## What is compared

- Classic and Git-based wikis: MediaWiki, DokuWiki, XWiki, TiddlyWiki, Gollum, GitHub wikis, GitLab wikis and the
  Azure DevOps wiki.
- Team wikis: Confluence, Notion, Outline, BookStack, Wiki.js, Docmost and HedgeDoc.
- Note and knowledge tools: Obsidian, Logseq, Roam Research, Foam, Dendron, SilverBullet, Joplin, Trilium, Zettlr and
  Bear, with the Markdown support of VS Code as a reference for editors.
- Parsers: the CommonMark discussions, MD4C, Pandoc, Python-Markdown, and the plugins of markdown-it and remark.

Each aspect below first says how the systems do it and then what follows for HippoWiki. The options are collected in
"Options for HippoWiki", the open questions in "Open questions".

## The starting point in HippoWiki

- Structure: folders, optional tabs inside a folder, and pages, either directly in a folder or in one of its tabs; no
  deeper nesting. Pages and tabs move only within their folder, as a lasting rule (`content-structure.md`).
- Names: lowercase letters and digits in groups joined by single hyphens, at most 80 characters. Page names are unique
  within a tab and among the pages placed directly in a folder, so the same page name can exist once per tab and once
  directly in the folder. A tab and a page placed directly in the folder may share a name (`content-structure.md`).
- Addresses: `/folders/<folder>/<page>.md` and `/folders/<folder>/<tab>/<page>.md`. A rename or move changes the
  address, and there are no redirects; "Redirects from old addresses" is an entry of `roadmap.md`.
- Title: the text of the leading `# Heading`, plain text, at most 200 characters, derived again on every save, not
  unique. A new page's name is suggested from its title (`deriveName()`) and never changes automatically (`pages.md`).
- Rendering: markdown-it is the only parser, and the title, the page view, the suggested name and the search text come
  from the same parse rules. The page view is built from the tokens into React, without HTML strings. A link becomes
  one only with a relative address or a safe protocol (`SAFE_PROTOCOLS` in `src/features/pages/markdown.ts`). The
  view has no heading ids yet. `pages.md` lists "no `[[wiki links]]`" among its current limits and names links as a
  later reason to parse on the server.
- History: every content change records a revision with its user and channel; moves, renames, deletes and restores
  record none; a revert records a new revision with the content of an old one (`page-history.md`).
- Optimistic locking: every stored change of a page counts its version up; content saves, moves, renames and deletes
  state the version they are based on and are refused when it differs. Renaming a tab or a folder is not checked
  (`optimistic-locking.md`).
- Deletion: soft delete; a deleted page forgets its tab, its name is free at once and its old address shows the
  not-found page. A Manager or Owner restores it with a name and a place chosen anew in its own folder
  (`page-deletion.md`).
- Roles: one role per user and folder; every role reads all pages of its folder; a missing item and a missing role
  are answered alike (`folder-roles.md`).
- MCP: one connection works on one folder with one role. The tools find a page by its tab and name, `read_page`
  returns the raw Markdown, and page text is passed on unchanged, links included. The instructions and the tool
  descriptions state the name rule in the same words (`mcp.md`).
- Search: the content is searched as plain text that includes the addresses of links; every write of a page stores its
  search text in the same write, and `indexOutdatedPages()` derives outdated pages again at the start (`search.md`).

## Syntax and label order

The systems with a typed link syntax:

| System                 | Link                                     | With a label                                  | Section or block                         |
| ---------------------- | ---------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| MediaWiki              | `[[Target]]`, `[[Help:Target]]`          | `[[Target\|Label]]`                           | `[[Page#Section]]`, `[[#Section]]`       |
| DokuWiki               | `[[page]]`, `[[ns:page]]`                | `[[page\|text]]`                              | `[[page#section]]`                       |
| XWiki 2.1              | `[[PageA.PageB]]`, `[[page:../Sibling]]` | `[[label>>PageA]]`                            | `[[PageA\|\|anchor="HMyheading"]]`       |
| TiddlyWiki             | `[[Title]]`                              | `[[Label\|Title]]`                            | –                                        |
| Gollum 5               | `[[Page]]`, `[[/Page]]`                  | `[[Label\|Page]]`, reversed for MediaWiki     | `[[Page#section]]`, `[[#section]]`       |
| GitLab wiki            | `[[slug]]`, `[wiki_page:Home]`           | `[[Label\|slug]]`                             | –                                        |
| Obsidian               | `[[Note]]`, `[[folder/Note]]`            | `[[Note\|Label]]`                             | `[[Note#Heading]]`, `[[Note#^block-id]]` |
| Foam                   | `[[note]]`, `[[folder/note]]`, `[[./x]]` | `[[note\|Label]]`                             | `[[note#Section]]`, `[[note#^block-id]]` |
| SilverBullet           | `[[page]]`, `[[folder/page]]`            | `[[page\|Label]]`                             | `[[page#Header]]`, `[[page$anchor]]`     |
| Dendron                | `[[topic.note]]`                         | `[[Label\|topic.note]]`                       | `[[note#header]]`                        |
| Zettlr                 | `[[file]]` or `[[ID]]`                   | the order is a setting                        | –                                        |
| Bear                   | `[[Note title]]`                         | `[[Note title\|alias]]`                       | `[[Note title/Heading]]`                 |
| Logseq (file graphs)   | `[[Page]]`, `[[ns/Page]]`                | `[label]([[Page]])`                           | blocks `((uuid))`                        |
| Roam (third-party)     | `[[Page]]`                               | `[text]([[Page]])`                            | blocks `((uid))`                         |
| Trilium Markdown notes | `[[<note id>]]`                          | `[text](#root/<note id>)`                     | –                                        |
| Joplin Wikilinks       | `[[Title]]` (plugin)                     | `[[Title\|alias]]`                            | `[[Title#Heading]]`                      |
| MD4C, Pandoc           | `[[target]]`                             | target first; Pandoc reads both, by extension | –                                        |

A dash means that the notes found nothing on it, not that the system lacks it. Sources:
[MediaWiki Help:Links](https://www.mediawiki.org/wiki/Help:Links),
[DokuWiki syntax](https://github.com/dokuwiki/dokuwiki/blob/master/data/pages/wiki/syntax.txt),
[XWiki link syntax help](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-help/xwiki-platform-help-ui/src/main/resources/XWiki/XWikiSyntaxLinks.xml),
[TiddlyWiki Linking in WikiText](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/editions/tw5.com/tiddlers/wikitext/Linking%20in%20WikiText.tid),
[Gollum tags filter](https://github.com/gollum/gollum-lib/blob/master/lib/gollum-lib/filter/tags.rb),
[GitLab wiki Markdown](https://docs.gitlab.com/user/project/wiki/markdown/),
[Obsidian internal links](https://obsidian.md/help/links),
[Foam wikilinks](https://github.com/foambubble/foam/blob/main/docs/user/features/wikilinks.md),
[SilverBullet Link](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Link.md),
[Dendron wiki link](https://github.com/dendronhq/dendron-site/blob/HEAD/vault/dendron.topic.links.wiki-link.md),
[Zettlr Zettelkasten method](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/pkms/zkn-method.md),
[Bear FAQ](https://bear.app/faq/how-to-link-notes-together/),
[Logseq page reference with label](https://github.com/logseq/docs/blob/master/pages/term___page%20reference%20with%20label.md),
[Roam cheatsheet (third-party)](https://glama.ai/mcp/servers/@2b3pro/roam-research-mcp/blob/main/Roam_Markdown_Cheatsheet.md),
[Trilium Markdown notes](https://docs.triliumnotes.org/user-guide/note-types/markdown),
[Joplin Wikilinks plugin](https://joplinapp.org/plugins/plugin/joplin.plugin.alondmnt.wikilinks/),
[MD4C](https://github.com/mity/md4c), [Pandoc manual](https://pandoc.org/MANUAL.html).

The systems without a typed syntax:

- GitHub wikis document only Markdown links to the full URL of a wiki page for Markdown pages, and `[[Page|Link Text]]`
  for pages in MediaWiki syntax ([GitHub Docs](https://docs.github.com/en/communities/documenting-your-project-with-wikis/editing-wiki-content)).
  Gollum, the engine behind them, documents label first, which contradicts GitHub's own page
  ([Gollum Standard Syntax](https://raw.githubusercontent.com/wiki/gollum/gollum/Standard-Syntax.md)). Whether
  `[[...]]` works in GitHub's Markdown wiki pages today is unverified.
- The Azure DevOps wiki links pages with Markdown links to paths, `[text](/parent-page/child-page#heading)`; its only
  double-bracket tags are `[[_TOC_]]` and `[[_TOSP_]]`
  ([Azure DevOps Markdown guidance](https://learn.microsoft.com/en-us/azure/devops/project/wiki/markdown-guidance?view=azure-devops)).
- Notion, Outline and Docmost insert links from a picker opened with `@`; Notion also opens the same picker on `[[`
  and `+`. None stores a typed `[[Page]]`
  ([Notion help](https://www.notion.com/help/create-links-and-backlinks),
  [Outline document mentions](https://www.getoutline.com/changelog/document-mentions.md),
  [Docmost guide](https://docmost.com/blog/how-to-link-wiki-pages/)).
- Confluence stores page links as `<ac:link><ri:page ri:content-title="..."/></ac:link>` in its storage format, and
  also documents an id form ([Confluence storage format](https://confluence.atlassian.com/doc/confluence-storage-format-790796544.html)).
- BookStack stores ordinary HTML or Markdown links to page URLs
  ([BookStack ReferenceUpdater](https://raw.githubusercontent.com/BookStackApp/BookStack/development/app/References/ReferenceUpdater.php)).
  Wiki.js 2 is said to use Markdown links to paths (unverified). Wiki.js 3 has both: Markdown links to paths from its
  link picker, and `[[Page Name|shown text]]` (see "Wiki.js 3 in detail").
- HedgeDoc has no wiki links; a community proposal asks for them
  ([HedgeDoc community](https://community.hedgedoc.org/t/proposal-wikilinks-support-either-in-core-or-as-an-add-on/836)).
- Joplin's core links notes by id, `[text](:/<32 hex characters>)`
  ([Joplin Markdown](https://joplinapp.org/help/apps/markdown)).

Further points on syntax:

- Zettlr's documentation says it plainly: it is "not obvious" which part is the target and which the title, so the
  user has to choose in the settings ([Zettlr docs](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/pkms/zkn-method.md)).
  Its own migration page then gives an example in the other order
  ([Zettlr: migrating from Obsidian](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/getting-started/migrating-from-obsidian.md)).
- Obsidian warns that names with `# | ^ : %% [[ ]]` "may not work" in links; SilverBullet forbids `|`, `@`, `#`,
  `[[` and `]]` in page names; TiddlyWiki warns about titles with `| [ ] { }`
  ([Obsidian](https://obsidian.md/help/links),
  [SilverBullet Names](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Names.md),
  [TiddlyWiki title editor](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/core/ui/EditTemplate/title.tid)).
- Escaping: Gollum leaves `'[[Page]]` literal and never links inside code; MediaWiki uses `<nowiki />`; XWiki uses `~`
  ([Gollum tags filter](https://github.com/gollum/gollum-lib/blob/master/lib/gollum-lib/filter/tags.rb),
  [MediaWiki Help:Links](https://www.mediawiki.org/wiki/Help:Links)).
- The brackets are often shared with other tags: Gollum `[[_TOC_]]` and `[[include:Page]]`, Azure `[[_TOSP_]]`,
  embeds `![[Note]]` in Obsidian, Foam and SilverBullet. Gollum switches `[[...]]` off for AsciiDoc, where it collides
  with bookmarks ([Gollum Standard Syntax](https://raw.githubusercontent.com/wiki/gollum/gollum/Standard-Syntax.md)).
- In a GitHub Flavored Markdown table the cell is split at every unescaped `|` before inline rules run, so a label
  inside a table needs `[[a\|b]]`. Foam documents this form
  ([Foam changelog](https://github.com/foambubble/foam/blob/main/packages/foam-vscode/CHANGELOG.md)); for markdown-it
  this is an inference from its block-before-inline design, not checked in its table rule.

What follows for HippoWiki:

- The order has to be stated once and only one order accepted (inference from the Zettlr and Pandoc cases).
  `[[target|label]]` follows the majority and what AI models have seen most (inference); the label-first users are
  Gollum, GitLab, TiddlyWiki and Dendron.
- Since names hold no `|`, `#`, `/` or `]`, any of them can serve as a separator without forbidding anything in names.
  A tag such as `[[_TOC_]]` can never collide with a name, because names have no underscore or capital letter.
- `![[...]]` for embedding a page is not part of the roadmap entry. Whether it is reserved now, or left as text, is an
  open question.
- Escaping comes for free with markdown-it: `\[[` is an escape, and code spans and fenced code are consumed before an
  inline rule sees them (see "Parser implementation with markdown-it").

## Resolving the target

| System               | Resolves by                                                                   | Spelling and case                                      | Duplicates                                         |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| MediaWiki            | title with namespace prefix                                                   | first letter case-insensitive; space equals underscore | titles are unique                                  |
| DokuWiki             | page id; an id without `:` resolves in the current namespace                  | `cleanID()` lowercases and maps special characters     | ids are unique                                     |
| XWiki                | reference: a terminal page in the current space, else a non-terminal one, ... | –                                                      | a fixed order of lookups                           |
| Gollum 5             | path relative to the current directory; `/` for the root                      | exact and case-sensitive; a lenient 4.x mode is opt-in | a global lookup is opt-in, "Slow!" in the code     |
| GitLab, Azure DevOps | slug or path                                                                  | spaces become hyphens; Azure is case-sensitive         | paths are unique                                   |
| Obsidian             | file name, or as much path as makes it unique                                 | algorithm not documented                               | a new file of the same name can take links over    |
| Foam                 | any unique suffix of the path; `/` or `.` at the start make it a path         | case used to tell names apart                          | alphabetical, with a warning                       |
| SilverBullet 2.11    | exact path first, then the name anywhere in the space                         | case-insensitive, exact case preferred                 | marked as ambiguous, a picker; ranked by proximity |
| Logseq, Roam, Bear   | page or note title                                                            | Logseq is case-insensitive                             | titles are unique (Logseq DB: per tag)             |
| Joplin plugin        | id, then exact title, then title in any case                                  | –                                                      | shortest title wins                                |
| Joplin, Trilium      | note id                                                                       | –                                                      | none                                               |
| Notion, Outline      | page id in the editor's document model                                        | –                                                      | none                                               |

Sources: [MediaWiki Help:Links](https://www.mediawiki.org/wiki/Help:Links),
[DokuWiki Resolver](https://github.com/dokuwiki/dokuwiki/blob/master/inc/File/Resolver.php),
[DokuWiki pageutils](https://github.com/dokuwiki/dokuwiki/blob/master/inc/pageutils.php),
[XWiki link syntax help](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-help/xwiki-platform-help-ui/src/main/resources/XWiki/XWikiSyntaxLinks.xml),
[Gollum 5.0 release notes](https://github.com/gollum/gollum/wiki/5.0-release-notes),
[GitLab wiki Markdown](https://docs.gitlab.com/user/project/wiki/markdown/),
[Azure DevOps wiki](https://learn.microsoft.com/en-us/azure/devops/project/wiki/add-edit-wiki?view=azure-devops),
[Obsidian API](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache),
[Obsidian forum on link hijacking](https://forum.obsidian.md/t/links-need-to-be-updated-when-a-new-file-with-existing-name-is-added-to-the-vault-to-maintain-consistency/25064),
[Foam wikilinks](https://github.com/foambubble/foam/blob/main/docs/user/features/wikilinks.md),
[SilverBullet Link](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Link.md),
[Logseq forum on case](https://discuss.logseq.com/t/when-and-where-is-logseq-case-sensitive-on-linux/10016),
[Logseq DB version](https://github.com/logseq/docs/blob/master/db-version.md),
[Bear FAQ](https://bear.app/faq/how-to-link-notes-together/),
[Joplin Wikilinks plugin](https://joplinapp.org/plugins/plugin/joplin.plugin.alondmnt.wikilinks/),
[Trilium Markdown notes](https://docs.triliumnotes.org/user-guide/note-types/markdown),
[Outline Mention node](https://raw.githubusercontent.com/outline/outline/main/shared/editor/nodes/Mention.tsx).

Lessons from the systems:

- Loose matching was taken back where it was tried. Gollum 5 made links exact and case-sensitive, ended the global
  lookup and shipped a script to migrate old links; the lenient mode stayed as an option
  ([Gollum 5.0 release notes](https://github.com/gollum/gollum/wiki/5.0-release-notes)). MediaWiki warns that turning
  off its first-letter rule "may break links"
  ([MainConfigSchema](https://github.com/wikimedia/mediawiki/blob/master/includes/MainConfigSchema.php)).
- Resolving a bare name anywhere makes the meaning of a link depend on other pages. SilverBullet's decision record of
  2026-08-24 names the cost: a link "may now (silently) gain a target", and "a file appearing or disappearing changes
  what links elsewhere mean"
  ([SilverBullet ADR 011](https://github.com/silverbulletmd/silverbullet/blob/main/docs/ADR/011%20Link%20Resolution%20by%20Name.md)).
  Obsidian users report the same as "link hijacking"; the request from 2021 has no answer from staff in the thread
  ([Obsidian forum](https://forum.obsidian.md/t/links-need-to-be-updated-when-a-new-file-with-existing-name-is-added-to-the-vault-to-maintain-consistency/25064)).
- Systems that resolve by title require unique titles (Logseq, Roam, Bear). Dendron, Zettlr and Trilium keep a stable
  identity in the link and show the title; Zettlr gives its reason: with file names "you cannot change the file
  title", so ids "can be a good remedy" ([Zettlr docs](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/pkms/zkn-method.md)).
- DokuWiki normalises every target with `cleanID()`, so `[[Setup Guide]]` and `[[setup_guide]]` reach the same page
  ([DokuWiki pageutils](https://github.com/dokuwiki/dokuwiki/blob/master/inc/pageutils.php),
  [DokuWiki PageResolver](https://github.com/dokuwiki/dokuwiki/blob/master/inc/File/PageResolver.php)).

What follows for HippoWiki:

- A link names a page by its name, never by its title: titles need not be unique (`pages.md`). Resolving by title
  would need unique titles, which is a change of `pages.md` and not part of the roadmap entry.
- A bare name is not unique in a folder: the same name can exist once in every tab and once directly in the folder
  (`content-structure.md`). The ways out are the options A to D under "What a link names" in "Options for HippoWiki":
  a path like the address, a lookup relative to the linking page, a lookup of the name in the whole folder with
  ambiguity marked, or a mix.
- A link that names a tab, `guides`, and a link that names a page placed directly in the folder, `guides`, look the
  same without a marker. Links only to pages avoid the question; links to tabs or to the folder need a form of their
  own (open question).
- The folder is fixed: a page never leaves its folder (`content-structure.md`), and an MCP connection reaches one
  folder (`mcp.md`). A link inside the folder therefore never needs the folder name, and a folder rename changes no
  link (inference).
- How strict the spelling is: exact names only, as in Gollum 5, or the name derived from what is written, as DokuWiki
  does, which in HippoWiki would be `deriveName()` of `src/features/pages/derive.ts`. The second forgives
  `[[Setup Guide]]`, but lets one page be linked in several spellings, which a rewrite on rename has to find, and a
  title in a non-Latin script derives no name at all (`pages.md`).

## Display text

- Most classic engines show the target as written when no label is given: MediaWiki, Gollum (the path as text) and
  DokuWiki by default ([MediaWiki Help:Links](https://www.mediawiki.org/wiki/Help:Links),
  [Gollum tags filter](https://github.com/gollum/gollum-lib/blob/master/lib/gollum-lib/filter/tags.rb)).
- Several show the current title of the target: DokuWiki with the setting `useheading` shows the first heading of the
  target page ([DokuWiki renderer](https://github.com/dokuwiki/dokuwiki/blob/master/inc/parser/xhtml.php)); Dendron
  shows the note's title in preview and when published
  ([Dendron wiki link](https://github.com/dendronhq/dendron-site/blob/HEAD/vault/dendron.topic.links.wiki-link.md));
  Trilium renders `[[<note id>]]` with the current title and renames an untitled reference link with its target
  ([Trilium reference links](https://docs.triliumnotes.org/user-guide/note-types/text/links/reference-links)); Outline
  mentions "keep the title and icon automatically updated"
  ([Outline changelog](https://www.getoutline.com/changelog/document-mentions.md)); a Confluence Smart Link changed
  its text after the target was renamed ([CONFCLOUD-79554](https://jira.atlassian.com/browse/CONFCLOUD-79554)).
- XWiki generates a label when none is given, with a pattern the admin sets
  ([XWiki link syntax help](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-help/xwiki-platform-help-ui/src/main/resources/XWiki/XWikiSyntaxLinks.xml)).
- An explicit label is kept as written everywhere. Some editors write the title into the label at the time of
  linking: Zettlr's setting "Always use the file title as label" inserts `[[filename|file title]]`, and Obsidian
  inserts `[[Target|Alias]]` for an alias "to keep links compatible with other Wikilink-based apps"
  ([Zettlr docs](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/pkms/zkn-method.md),
  [Obsidian aliases](https://obsidian.md/help/aliases)). Such a label goes stale when the title changes.
- Labels with markup: XWiki allows wiki syntax in labels; DokuWiki allows only an image
  ([DokuWiki syntax](https://github.com/dokuwiki/dokuwiki/blob/master/data/pages/wiki/syntax.txt)).
- A link to the page itself is shown as bold text and not as a link in MediaWiki
  ([MediaWiki Help:Links](https://www.mediawiki.org/wiki/Help:Links)).

What follows for HippoWiki:

- A natural split (inference, also drawn in the notes): `[[name]]` shows the current title of the page,
  `[[name|text]]` shows the text. A missing target has no title and shows what is written.
- Showing the current title makes the view of a page depend on other pages: a changed heading changes the text of
  every link to it, without a revision of the linking pages. The rendered revisions of a page (`page-history.md`)
  would show today's titles, not those of the time of the revision (inference).
- The title is plain text of at most 200 characters (`pages.md`), so it fits a link; a long title makes a long link.
- A label as plain text only is the simplest rule and matches the title, which is plain text too. Markup in labels
  would need the inline rule to parse nested inline Markdown.

## Section anchors

- MediaWiki: `[[Page#Section]]` and `[[#Section]]`; headings get automatic anchors, and a repeated heading gets `_2`,
  `_3` ([MediaWiki Help:Links](https://www.mediawiki.org/wiki/Help:Links)).
- XWiki: the anchor is a parameter, `||anchor="HMyheading"`, made of "H" and the letters of the heading
  ([XWiki link syntax help](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-help/xwiki-platform-help-ui/src/main/resources/XWiki/XWikiSyntaxLinks.xml)).
- DokuWiki warns: "When a section's heading is changed, its bookmark changes, too. So don't rely on section linking
  too much." ([DokuWiki syntax](https://github.com/dokuwiki/dokuwiki/blob/master/data/pages/wiki/syntax.txt))
- Obsidian links headings by their text, `[[Note#Heading#Subheading]]`, and blocks by an id written into the text,
  `[[Note#^id]]`, which "won't work outside of Obsidian" ([Obsidian internal links](https://obsidian.md/help/links)).
- Foam accepts the heading text and, since 0.49.0, the slug; renaming a section updates every link to it and keeps
  each link's form ([Foam changelog](https://github.com/foambubble/foam/blob/main/packages/foam-vscode/CHANGELOG.md)).
  VS Code's rename of a heading updates the links to it as well
  ([VS Code Markdown](https://code.visualstudio.com/docs/languages/markdown)).
- SilverBullet adds explicit anchors, `$my-anchor`, unique in the space, because they "survive edits to the page" and
  "don't collide when two sections share a title"
  ([SilverBullet Anchor](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Markdown/Anchor.md)).
- Bear does not update heading links when a heading is renamed, acknowledged by staff
  ([Bear community](https://community.bear.app/t/links-to-headers-arent-updated-on-header-rename/6836)). Dendron's
  heading links do not survive its export
  ([Dendron wiki link](https://github.com/dendronhq/dendron-site/blob/HEAD/vault/dendron.topic.links.wiki-link.md)).
- Confluence (`ac:anchor`), Outline (`anchorId`), Notion ("Copy link to block"), Docmost and BookStack (a permalink
  copied from the heading or a selection) all reach sections, mostly by copying a link
  ([Confluence storage format](https://confluence.atlassian.com/doc/confluence-storage-format-790796544.html),
  [Outline Mention node](https://raw.githubusercontent.com/outline/outline/main/shared/editor/nodes/Mention.tsx),
  [BookStack permalinks](http://www.bookstackapp.com/docs/user/content-permalinks/)). None of these sources says what
  happens when the heading changes.

What follows for HippoWiki:

- The page view has no heading ids yet (`pages.md`, "Current limits"). Anchors need them first, which is a feature of
  its own with its own questions: the form of the id, repeated headings, and a prefix like the one footnote ids carry
  so that no id of the content clobbers a global of the browser (`pages.md`, "Rendering").
- Options: no anchors in the first version; anchors by slug, as GitHub-style ids would give; anchors by heading text,
  as Obsidian does. A slug is what the address bar shows, heading text is what a person types (inference).
- A broken anchor is hard to see: none of the systems except Foam and VS Code keeps anchors in step with headings.
  Whether a link with an anchor to a missing heading counts as broken is an open question.

## Missing links

| System       | A link to a missing page                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| MediaWiki    | red, class `new`, links to the editor with `redlink=1`, tooltip "page does not exist"                  |
| DokuWiki     | class `wikilink2` and `rel="nofollow"`                                                                 |
| XWiki        | wrapped in `wikicreatelink`                                                                            |
| TiddlyWiki   | class `tc-tiddlylink-missing`                                                                          |
| Gollum       | class `internal absent`, pointing at the path the page would have                                      |
| GitLab       | selecting the link lets you create the page                                                            |
| Confluence   | Data Center: dark red, click creates it, "Undefined Pages" lists them; Cloud: not yet                  |
| Wiki.js 2    | red; users report it stays red after the page is created, until the linking page is rendered again     |
| Wiki.js 3    | class `is-broken-link` set on the server, also when the target is created or deleted; red by a setting |
| Obsidian     | class `is-unresolved`; a click creates the note at the path of the link                                |
| Foam         | placeholder, styled differently, listed in a "Placeholders" panel, a click creates it                  |
| SilverBullet | "aspiring page", offered in the page picker with "Create", listed by a query                           |
| Dendron      | yellow instead of blue                                                                                 |
| Trilium      | a deleted target keeps its last title, in red, with a "Fix link" dialog                                |
| Zettlr       | a click creates the file, only when a Zettelkasten folder is set                                       |

Sources: [MediaWiki LinkRenderer](https://github.com/wikimedia/mediawiki/blob/master/includes/Linker/LinkRenderer.php),
[DokuWiki renderer](https://github.com/dokuwiki/dokuwiki/blob/master/inc/parser/xhtml.php),
[XWiki link renderer](https://github.com/xwiki/xwiki-rendering/blob/master/xwiki-rendering-syntaxes/xwiki-rendering-syntax-xhtml/src/main/java/org/xwiki/rendering/internal/renderer/xhtml/link/DocumentXHTMLLinkTypeRenderer.java),
[TiddlyWiki link widget](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/core/modules/widgets/link.js),
[Gollum tags filter](https://github.com/gollum/gollum-lib/blob/master/lib/gollum-lib/filter/tags.rb),
[GitLab wiki Markdown](https://docs.gitlab.com/user/project/wiki/markdown/),
[Confluence undefined page links](https://confluence.atlassian.com/doc/undefined-page-links-139580.html),
[Atlassian Community on Cloud](https://community.atlassian.com/t5/Confluence-questions/How-do-I-create-a-link-to-a-page-that-doesn-t-exist-yet/qaq-p/1240674),
[Wiki.js feedback (search snippets)](https://feedback.js.wiki/wiki/p/moving-a-page-should-update-links),
[Obsidian internal links](https://obsidian.md/help/links),
[Obsidian 0.9.4](https://obsidian.md/changelog/2020-10-13-desktop-v0.9.4/),
[Foam wikilinks](https://github.com/foambubble/foam/blob/main/docs/user/features/wikilinks.md),
[SilverBullet Aspiring Pages](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Aspiring%20Pages.md),
[Dendron wiki link](https://github.com/dendronhq/dendron-site/blob/HEAD/vault/dendron.topic.links.wiki-link.md),
[Trilium reference links](https://docs.triliumnotes.org/user-guide/note-types/text/links/reference-links),
[Zettlr settings](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/reference/settings.md).

- A list of wanted pages comes from keeping links to missing pages in the link table: MediaWiki builds
  Special:WantedPages from `pagelinks`, which holds links whether or not the target exists
  ([MediaWiki pagelinks](https://www.mediawiki.org/wiki/Manual:Pagelinks_table)).
- Confluence Cloud's workaround, a link to a create URL, can create duplicate pages when several people click it
  ([Atlassian Community](https://community.atlassian.com/t5/Confluence-questions/How-do-I-create-a-link-to-a-page-that-doesn-t-exist-yet/qaq-p/1240674)).
- Some tools also find "unlinked mentions", text that names a page without linking it: Obsidian, also for aliases, and
  Logseq ([Obsidian backlinks](https://obsidian.md/help/plugins/backlinks),
  [Logseq Unlinked References](https://github.com/logseq/docs/blob/master/pages/Unlinked%20References.md)).
- Color alone does not tell every reader that a link is missing; WCAG 1.4.1 "Use of Color" applies, though the notes
  did not fetch it. A dashed underline, an icon or an accessible description are the usual second cues (inference).

What follows for HippoWiki:

- A missing link needs a look of its own and a second cue besides color.
- For a Writer and up it can lead to creating the page. Today `?action=new` exists on folder and tab addresses, with
  the content first and the name chosen in the "Save page" dialog (`pages.md`). Presetting the name and the place
  needs parameters that `?action=new` does not accept yet; every address accepts only its own parameters
  (`content-structure.md`).
- For a Reader, a missing link can be plain text with the marker, or a link to the not-found page.
- A link whose target breaks the name rule, such as `[[My Page]]` under strict spelling, can stay text, show as a
  missing link, or show as an error of its own (open question).
- "Broken links" in `roadmap.md` asks for "which links lead to no page"; a folder view listing them is the same
  feature as MediaWiki's wanted pages and Confluence's "Undefined Pages".
- None of the systems refuses a save because of a missing link. A link to a page that is still to be written is how
  wikis grow (Obsidian, Foam, SilverBullet, MediaWiki).

## Rename and move

| System                  | On rename or move                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| MediaWiki               | leaves a redirect; links in other pages are not rewritten; double redirects can arise         |
| DokuWiki                | core cannot rename; the Move plugin rewrites links and marks the edits minor                  |
| XWiki                   | rewrites links and leaves a redirect, both on by default                                      |
| TiddlyWiki              | core rewrites only tags and list fields, opt-in; text links only with the third-party Relink  |
| Gollum 5                | writes a redirect into `.redirects.gollum`; no rewrite stated                                 |
| GitLab (17.1 and later) | writes a redirect into `.gitlab/redirects.yml`; no rewrite stated                             |
| Azure DevOps            | the Move dialog offers "Update affected links"; drag and drop leaves links broken             |
| BookStack               | rewrites every referencing page with a new revision; slug history for old URLs since v25.12   |
| Wiki.js 2               | patches only the cached HTML of linking pages; users report it broken                         |
| Wiki.js 3               | optional, on by default: rewrites linking pages with a version each; not their wiki links     |
| Docmost                 | nothing; fix by hand after searching for the old title                                        |
| Notion, Outline         | links hold the page id, nothing to rewrite                                                    |
| Confluence Cloud        | picker links hold the page id; a move updates Smart Links and fires `page_updated` events     |
| Obsidian                | rewrites links by default, or asks                                                            |
| Foam                    | rewrites links, also for folders and sections; moves first, so a refused move changes no note |
| Dendron                 | its "Rename Note" rewrites; the rename of VS Code itself does not                             |
| SilverBullet            | rewrites links in a configured form (`linkWriteFormat`)                                       |
| Logseq (file graphs)    | rewrites, with misses reported by users                                                       |
| Joplin, Trilium, Zettlr | links hold ids (Zettlr optionally), nothing to rewrite                                        |

Sources: [MediaWiki moving a page](https://www.mediawiki.org/wiki/Help:Moving_a_page),
[DokuWiki Move plugin](https://github.com/michitux/dokuwiki-plugin-move),
[XWiki copy or move request](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-refactoring/xwiki-platform-refactoring-api/src/main/java/org/xwiki/refactoring/job/AbstractCopyOrMoveRequest.java),
[XWiki move request](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-refactoring/xwiki-platform-refactoring-api/src/main/java/org/xwiki/refactoring/job/MoveRequest.java),
[TiddlyWiki tm-rename-tiddler](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/editions/tw5.com/tiddlers/messages/WidgetMessage_%20tm-rename-tiddler.tid),
[Relink](https://github.com/flibbles/tw5-relink),
[Gollum 5.0 release notes](https://github.com/gollum/gollum/wiki/5.0-release-notes),
[GitLab wiki](https://docs.gitlab.com/user/project/wiki/),
[Azure DevOps wiki](https://learn.microsoft.com/en-us/azure/devops/project/wiki/add-edit-wiki?view=azure-devops),
[BookStack v22.09](https://www.bookstackapp.com/blog/bookstack-release-v22-09/),
[BookStack v25.12](https://www.bookstackapp.com/blog/bookstack-release-v25-12/),
[Wiki.js pages model](https://raw.githubusercontent.com/requarks/wiki/v2.5.312/server/models/pages.js),
[Docmost guide](https://docmost.com/blog/how-to-link-wiki-pages/),
[Outline BacklinksProcessor](https://raw.githubusercontent.com/outline/outline/main/server/queues/processors/BacklinksProcessor.ts),
[CONFCLOUD-84308](https://jira.atlassian.com/browse/CONFCLOUD-84308),
[Obsidian settings](https://obsidian.md/help/settings),
[Foam wikilinks](https://github.com/foambubble/foam/blob/main/docs/user/features/wikilinks.md),
[Dendron rename note](https://github.com/dendronhq/dendron-site/blob/HEAD/vault/dendron.topic.refactoring.commands.rename-note.md),
[SilverBullet ADR 011](https://github.com/silverbulletmd/silverbullet/blob/main/docs/ADR/011%20Link%20Resolution%20by%20Name.md),
[Logseq forum (user reports)](https://discuss.logseq.com/t/page-links-not-updating-after-renaming-a-page/34692),
[Zettlr docs](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/pkms/zkn-method.md).

The four strategies:

- Rewrite the text of the linking pages. The stored Markdown stays true for people and AI apps. It touches many pages,
  each with its own revision and lock, and it misses links written in another form.
- Keep a stable id in the text. Renames cost nothing, but the raw text is opaque unless every reader and writer
  translates it.
- Leave a redirect or keep the old name. Simple, and old addresses keep working, but stored links stay outdated and
  chains of redirects build up. MediaWiki warns that fixing double redirects automatically "tends to conflict with page
  move vandalism" ([MainConfigSchema](https://github.com/wikimedia/mediawiki/blob/master/includes/MainConfigSchema.php)).
- Resolve at render time from the link table. Wiki.js 2 does this on cached HTML only; the source keeps the old name.
  Wiki.js 3 rewrites the source instead, like BookStack (see "Wiki.js 3 in detail").

How BookStack rewrites, the closest precedent for a server-side wiki with revisions:

- `ReferenceUpdater` finds the referencing pages in its `references` table, replaces the old URL in HTML links and in
  Markdown inline and reference links, counts the revision number up, saves, and stores a new revision with the
  summary "System auto-update of internal links"
  ([BookStack ReferenceUpdater](https://raw.githubusercontent.com/BookStackApp/BookStack/development/app/References/ReferenceUpdater.php)).
- The revision is made by the user who renamed (`created_by = user()->id`)
  ([BookStack RevisionRepo](https://raw.githubusercontent.com/BookStackApp/BookStack/development/app/Entities/Repos/RevisionRepo.php)).
- The default limit of revisions rose from 50 to 100 to make room, and the release post admits "logical gaps", such as
  restoring an old revision ([BookStack v22.09](https://www.bookstackapp.com/blog/bookstack-release-v22-09/)).
- DokuWiki's Move plugin marks its link edits as minor, so that they do not go out in feeds and mails
  ([DokuWiki Move plugin](https://github.com/michitux/dokuwiki-plugin-move)); Confluence's link refactoring fires
  automations and shows an anonymous user in the audit log
  ([CONFCLOUD-84308](https://jira.atlassian.com/browse/CONFCLOUD-84308)).
- No source describes what happens to a user who is editing a linking page while it is rewritten.

What follows for HippoWiki, for a rewrite of the linking pages:

- A move or rename does not touch content today: "Moving or renaming does not validate or touch the content"
  (`content-structure.md`). A rewrite changes the content of other pages and needs that rule worded anew.
- Every rewritten page gets a revision (`page-history.md`), with a user and a channel: the renaming user and the
  channel of the rename, as BookStack attributes it (inference). Revisions carry no summary; a mark like the one a
  revert carries ("went back to revision n") could say "links updated after a rename" (open question).
- Every rewritten page counts its version up (`optimistic-locking.md`). An editor or an AI app holding an older
  version of a linking page is refused and reads the page again, which is the existing contract. The rename itself
  states only the version of the renamed page; the linking pages are taken as they are, as deleting a tab takes its
  pages (inference).
- Every rewritten page gets the renaming user as its last editor (`content-structure.md`, "Last editor"), so a rename
  can make one user the last editor of many pages (open question).
- Roles fit: whoever may move or rename a page, a Writer and up, may also edit every page of the folder
  (`folder-roles.md`). Links across folders would break this.
- Limits: a longer name can push a page over `CONTENT_MAX_LENGTH`, and a page stored before a lowered limit fails
  validation (`pages.md`). A rewrite either skips the validation, like a move, or refuses the move.
- Renaming a tab: if links name the tab (`[[guides/setup]]`), renaming the tab rewrites every link into it. Tab renames
  are not checked against changes meanwhile, also through `rename_tab` (`optimistic-locking.md`, `mcp.md`).
- One transaction: the rename, the rewritten pages, their revisions, versions, search text and link rows. The number
  of linking pages has no bound; deleting a tab already writes an unbounded number of pages in one write
  (`content-structure.md`).
- Foam's order is the precedent for refusals: move first, then update the links, so that a refused move changes no
  note ([Foam changelog](https://github.com/foambubble/foam/blob/main/packages/foam-vscode/CHANGELOG.md)). In one
  database transaction this holds by itself (inference).
- A revert to an old revision brings back the old link text, which may then point to nothing or to another page; this
  is BookStack's "logical gap" (inference).
- Rewriting needs the place of each link in the source text. markdown-it gives line ranges for blocks, but no
  character positions for inline tokens; the inline rule would have to record them (inference, not checked in code).

Redirects, the roadmap entry "Redirects from old addresses", are a separate idea that can be combined with any of the
above. A name history clashes with "the name is free at once" (`page-deletion.md`, `content-structure.md`): a new
page of an old name has to win over the history, and links then change meaning (inference).

## Backlinks and link tables

| System       | Link store                                                  | When it is updated                   | Links to missing pages  |
| ------------ | ----------------------------------------------------------- | ------------------------------------ | ----------------------- |
| MediaWiki    | `pagelinks`, with targets in `linktarget` since 1.41–1.43   | on parse, through a job queue        | kept                    |
| DokuWiki     | `relation_references` in the metadata index                 | when the metadata is rendered        | kept, with existence    |
| Wiki.js 2    | `pageLinks(path, localeCode, pageId)`                       | on render                            | kept, by path           |
| Wiki.js 3    | `pageLinks`, one row per href as written, target by address | on save and move, in one transaction | kept, by address        |
| BookStack    | `references`, from and to ids                               | on save; a command fills old content | none, links hold ids    |
| Outline      | `relationships` of type backlink                            | by a queue, on publish and update    | none; dropped on delete |
| Obsidian     | `resolvedLinks` and `unresolvedLinks` of the metadata cache | in memory                            | kept apart              |
| SilverBullet | the object index, with resolved full paths                  | on index                             | kept as aspiring pages  |
| TiddlyWiki   | none; `backlinks[]` computed live                           | –                                    | –                       |

Sources: [MediaWiki pagelinks](https://www.mediawiki.org/wiki/Manual:Pagelinks_table),
[MediaWiki job queue](https://www.mediawiki.org/wiki/Manual:Job_queue),
[DokuWiki MetadataSearch](https://github.com/dokuwiki/dokuwiki/blob/master/inc/Search/MetadataSearch.php),
[Wiki.js migration 2.0.0](https://raw.githubusercontent.com/requarks/wiki/v2.5.312/server/db/migrations/2.0.0.js),
[BookStack v22.09](https://www.bookstackapp.com/blog/bookstack-release-v22-09/),
[Outline BacklinksProcessor](https://raw.githubusercontent.com/outline/outline/main/server/queues/processors/BacklinksProcessor.ts),
[Obsidian API](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache),
[SilverBullet ADR 011](https://github.com/silverbulletmd/silverbullet/blob/main/docs/ADR/011%20Link%20Resolution%20by%20Name.md),
[TiddlyWiki title editor](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/core/ui/EditTemplate/title.tid).

- The Git-based wikis (Gollum, GitHub, GitLab, Azure DevOps) document no backlinks
  ([GitLab wiki](https://docs.gitlab.com/user/project/wiki/)).
- In the user interface: Notion shows "{#} backlinks" under the title, only from pages the reader can access; Obsidian
  has a backlinks panel with linked and unlinked mentions; SilverBullet docks "Linked Mentions" at the bottom of every
  page; Logseq has linked and unlinked references; Foam has panels for connections, orphans and placeholders
  ([Notion help](https://www.notion.com/help/create-links-and-backlinks),
  [Obsidian backlinks](https://obsidian.md/help/plugins/backlinks),
  [SilverBullet Linked Mention](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Linked%20Mention.md),
  [Logseq DB version](https://github.com/logseq/docs/blob/master/db-version.md)).
- MediaWiki moved the target title out of every link row into `linktarget`, stored once and referenced by id; Commons
  switched to it in January 2024 ([Phabricator T351237](https://phabricator.wikimedia.org/T351237)).
- MediaWiki updates link tables through a job queue that reaches "a few million" jobs on busy days at Wikimedia, and
  creating or deleting a page only refreshes the HTML of linking pages, not the tables
  ([MediaWiki job queue](https://www.mediawiki.org/wiki/Manual:Job_queue)).
- Outline updates its rows by a queue, after the write. Since it only reacts to publish, update and delete, a restored
  document is likely without backlinks until its linking documents are saved again (inference from the processor).
- SilverBullet keeps resolved full paths in its index, "so queries, backlinks and the graph never see write format"
  ([SilverBullet ADR 011](https://github.com/silverbulletmd/silverbullet/blob/main/docs/ADR/011%20Link%20Resolution%20by%20Name.md)).

What follows for HippoWiki:

- A link table whose rows are rebuilt from the content in the same write as the content, as the search text is
  (`search.md`, "Operation"), avoids the window of a queue. A table that is filled again at the start for outdated
  pages, like `indexOutdatedPages()` with `SEARCH_INDEX_VERSION`, covers pages stored before the feature and changes
  of the parse rules (inference).
- A row could hold the linking page, the target as written (tab and name), the resolved target page or none, and the
  anchor. Keeping the target as written lets a new page "heal" its missing links with one update, as in MediaWiki
  (inference).
- Besides content saves, the resolved target changes on creating, moving, renaming, deleting and restoring a page and
  on deleting or renaming a tab, none of which records a revision (inference).
- Backlinks: a section of the page view, or a view of the page address, such as `?view=links`; the views of a page and
  a folder are listed in `content-structure.md`, and a new one has to be added there.
- Lists of a folder: broken links (the roadmap entry), and possibly orphans (pages that nothing links to). Unlinked
  mentions would come from search, which `search.md` already provides, but no system makes them essential.
- Deleted pages link nothing: their rows either stay and are left out of every list, or are removed and built again
  at restore (open question).

## Storage of links

- All the classic engines store the raw markup with a textual target and resolve it on render; none stores ids in the
  text. Azure DevOps has page ids but links by path; a page recreated at the same path within 30 days keeps its id
  "which preserves existing links" ([Azure DevOps wiki](https://learn.microsoft.com/en-us/azure/devops/project/wiki/add-edit-wiki?view=azure-devops)).
- Confluence's storage format links by title and space key, with an id form documented as well; its Data Center
  issues show the trouble with links by title ([CONFSERVER-28033](https://jira.atlassian.com/browse/CONFSERVER-28033),
  [CONFSERVER-45898](https://jira.atlassian.com/browse/CONFSERVER-45898)).
- Notion stores a mention with the page UUID; Outline stores a mention node with the target id, and writes it into
  Markdown as an ordinary link to `/doc/<slug>-<urlId>`, whose title part can change while the id stays
  ([Notion API rich text](https://developers.notion.com/reference/rich-text),
  [Outline Mention node](https://raw.githubusercontent.com/outline/outline/main/shared/editor/nodes/Mention.tsx),
  [Outline discussion 1603](https://github.com/outline/outline/discussions/1603)).
- Joplin and Trilium put the note id into the text. Trilium generates new ids when notes are imported again, so links
  depend on the metadata of the export ([Trilium Note ID](https://docs.triliumnotes.org/user-guide/advanced-usage/note-id),
  from a search excerpt).
- A server-to-cloud migration of Confluence does not keep page ids, which breaks links by id, and Atlassian runs a
  "link fixing" step ([Atlassian KB](https://support.atlassian.com/jira/kb/how-to-update-old-confluence-page-id-and-tinyurls-with-new-values-inside-the-jira-issues/)).

What follows for HippoWiki:

- The content is raw Markdown, edited in a textarea and through MCP, and it is the source of truth: the title and the
  search text are derived from it (`pages.md`, `search.md`). A link table would be derived as well and could be built
  again from the content at any time (inference).
- Ids in the text would make the stored content opaque, and every reader and writer would translate. `read_page` would
  then no longer pass the content on unchanged (`mcp.md`, "Prompt injection"), and `edit_page_content` would have to
  match the agent's text in names against stored ids (`mcp.md`, "Changing parts of a page") (inference).
- Revisions are full copies of the content (`page-history.md`), so old revisions keep the names of their time,
  whatever strategy is chosen.

## Permissions and existence leaks

- MediaWiki "was not designed to support per-page or partial-page access restrictions"
  ([MediaWiki preventing access](https://www.mediawiki.org/wiki/Manual:Preventing_access)), and its red links are an
  intended existence signal
  ([MediaWiki checking for page existence](https://www.mediawiki.org/wiki/Manual:Checking_for_page_existence)).
- DokuWiki filters backlinks by the reader's rights, but its link renderer checks only existence, so the link color
  can tell whether a protected page exists (inference from the code:
  [renderer](https://github.com/dokuwiki/dokuwiki/blob/master/inc/parser/xhtml.php),
  [MetadataSearch](https://github.com/dokuwiki/dokuwiki/blob/master/inc/Search/MetadataSearch.php)).
- In Redmine a proposed patch was reported to let a user without access to a wiki probe whether a page exists through
  how links render ([Redmine 26530](https://redmine.org/issues/26530.pdf)).
- Confluence shows the same "restricted content" page for a missing page and a forbidden one, on purpose
  ([Atlassian KB](https://support.atlassian.com/confluence/kb/page-not-found-error-when-trying-to-reach-a-page-accessible-to-other-users/)).
  Notion's API returns a mention of an inaccessible page "with just the ID" and the text "Untitled", and its backlinks
  hide pages the reader cannot open ([Notion API rich text](https://developers.notion.com/reference/rich-text),
  [Notion help](https://www.notion.com/help/create-links-and-backlinks)).

What follows for HippoWiki:

- Within one folder nothing leaks: every role reads every page of its folder (`folder-roles.md`), so a reader learns
  nothing from the look of a link or from backlinks.
- Across folders, a title, a link color or a backlink would tell a reader about a folder without a role, against the
  rule that a missing item and a missing role are answered alike (`folder-roles.md`). The pattern of Confluence and
  Notion is to show a link to a forbidden page like a missing one.
- An AI app reaches only the folder of its connection (`mcp.md`) and could not follow a link into another folder.
- Pages never leave their folder (`content-structure.md`), so a link inside the folder never has to follow its target
  out of it. Links within the folder only is the simplest rule (inference); links across folders are an open question
  for later.
- Admins see no content; links change nothing for them.

## Deleted pages

- MediaWiki keeps the link rows of linking pages when a page is deleted; the links turn red, and blue again on undelete
  ([MediaWiki job queue](https://www.mediawiki.org/wiki/Manual:Job_queue)).
- Outline deletes the backlink rows of a deleted document, as source and as target
  ([Outline BacklinksProcessor](https://raw.githubusercontent.com/outline/outline/main/server/queues/processors/BacklinksProcessor.ts)).
- Trilium keeps the last title of a deleted target, shows it in red and offers to fix the link
  ([Trilium reference links](https://docs.triliumnotes.org/user-guide/note-types/text/links/reference-links)).
- Azure DevOps keeps the page id for 30 days, so a page recreated at the same path keeps its links
  ([Azure DevOps wiki](https://learn.microsoft.com/en-us/azure/devops/project/wiki/add-edit-wiki?view=azure-devops)).

What follows for HippoWiki:

- A link to a deleted page is a missing link: the page is invisible, its address shows the not-found page and its name
  is free at once (`page-deletion.md`). A new page of the same name at the same place takes the links over (inference).
- Showing "deleted" instead of "missing" would tell a Reader or Writer about deleted pages, which only a Manager and
  an Owner see (`page-deletion.md`). Whether a Manager gets such a hint is an open question.
- A restored page gets a name and a place chosen anew (`page-deletion.md`). Links to it work again only when both are
  the old ones, unless the link table remembered the page and the restore rewrites the links (open question).
- A deleted page has no tab (`page-deletion.md`). Its view under `/deleted-pages` and the views of its revisions have
  no place to resolve a relative link from (inference). The links of a deleted page could render as text, or resolve
  as if the page were placed directly in the folder.
- Deleting a tab deletes all its pages (`content-structure.md`); every link into the tab becomes missing at once.
- Search derives deleted pages too, "so that a restore needs nothing more" (`search.md`); the link rows of a deleted
  page could follow the same rule.

## Editor support

- Typing `[[` opens a search of notes in Obsidian, Foam, SilverBullet, Dendron, Zettlr, Bear, Trilium and Logseq; in
  Notion `[[` opens the page picker ([Obsidian internal links](https://obsidian.md/help/links),
  [Foam wikilinks](https://github.com/foambubble/foam/blob/main/docs/user/features/wikilinks.md),
  [Bear FAQ](https://bear.app/faq/how-to-link-notes-together/),
  [Trilium Markdown notes](https://docs.triliumnotes.org/user-guide/note-types/markdown),
  [Notion help](https://www.notion.com/help/create-links-and-backlinks)).
- What the picker inserts is the real link format: GitLab searches by title and inserts the slug
  ([GitLab MR 143654](https://gitlab.com/gitlab-org/gitlab/-/merge_requests/143654); its release was not confirmed);
  Obsidian inserts `[[Target|Alias]]` for an alias; Zettlr can insert `[[filename|file title]]`; Trilium inserts
  `[[<note id>]]`; SilverBullet follows `linkWriteFormat`.
- Bear lists the headings of a note when `/` is typed instead of Return; VS Code completes paths and `#` headings in
  Markdown links ([VS Code Markdown](https://code.visualstudio.com/docs/languages/markdown)).
- Pickers offer pages that do not exist yet: SilverBullet shows aspiring pages in its completion, Outline and Trilium
  create a page from the picker ([SilverBullet Link](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Link.md),
  [Outline changelog](https://www.getoutline.com/changelog/document-mentions.md)).
- VS Code checks links on demand, off by default, and reports missing files and headings as warnings
  ([VS Code Markdown](https://code.visualstudio.com/docs/languages/markdown)).

What follows for HippoWiki:

- The editor is a raw Markdown textarea; a rich editor (TipTap or Milkdown) is an entry of `roadmap.md`, and
  `pages.md` names the textarea among its current limits. A picker on `[[` is a script on the textarea, or waits for
  the rich editor.
- A picker that searches titles and inserts names solves the tension between titles that people know and names that
  are unique, as GitLab does. Search already finds pages by title, name and content, also with typos (`search.md`).
- A first version could work without a picker: names are short and readable, and the save dialog, or the page view
  after saving, shows which links lead nowhere (inference).

## Rendering and security

- markdown-it checks addresses only in its own link and autolink rules (`validateLink`, which HippoWiki sets to
  `isSafeAddress`). A custom inline rule does not get that check
  ([markdown-it source](https://github.com/markdown-it/markdown-it/blob/master/lib/index.mjs)).
- markdown-it-wikilinks does not trust the raw target: it cleans every path segment and adds a suffix
  ([markdown-it-wikilinks](https://unpkg.com/markdown-it-wikilinks@1.4.0/index.js)). Gollum builds the anchor as an
  unescaped string in that function and presumably relies on a later sanitizer, not inspected
  ([Gollum tags filter](https://github.com/gollum/gollum-lib/blob/master/lib/gollum-lib/filter/tags.rb)).
- DokuWiki escapes labels and allows only registered URL schemes for external links; Azure DevOps blocks `file://`
  ([DokuWiki renderer](https://github.com/dokuwiki/dokuwiki/blob/master/inc/parser/xhtml.php),
  [Azure DevOps Markdown guidance](https://learn.microsoft.com/en-us/azure/devops/project/wiki/markdown-guidance?view=azure-devops)).
- MediaWiki puts the page name into the `title` attribute as a tooltip; DokuWiki adds the page id as `title` and
  `data-wiki-id`, and `rel="nofollow"` on missing links
  ([MediaWiki LinkRenderer](https://github.com/wikimedia/mediawiki/blob/master/includes/Linker/LinkRenderer.php),
  [DokuWiki renderer](https://github.com/dokuwiki/dokuwiki/blob/master/inc/parser/xhtml.php)).
- SilverBullet renders wiki links on the server as well, so that "crawlers and no-JS visitors get working links"
  ([SilverBullet changelog](https://github.com/silverbulletmd/silverbullet/blob/main/docs/CHANGELOG.md)).

What follows for HippoWiki:

- The target is a name, never an address: it is checked against the name rule (`src/lib/names.ts`) and the href is
  built from the parts with the address builder (`src/lib/addresses.ts`). Then no protocol can get in, and
  `SAFE_PROTOCOLS` does not come into play (inference).
- The label and the title reach the page as React text children, never as HTML (`pages.md`, "Rendering").
- The links of a page are resolved in one query for all of them, not one per link (inference). The content may be
  100,000 characters long, which allows some ten thousand links; a limit on the number of links, like the limit on
  table cells, is an option (inference).
- The parse runs at every save and every view (`pages.md`, "The cost of the Markdown parse"); `[[` inputs belong in
  `src/features/pages/markdown.cost.test.ts`, and the rule must stay linear on input such as long runs of `[[`
  (inference).
- Every view that renders content resolves links: the page, its revisions, the deleted page and its revisions, and the
  delete dialog. Search results show plain text excerpts and need no resolution (`search.md`).
- The page view is rendered on the server (`pages.md`), so links work without JavaScript, as SilverBullet wants for
  its public pages.

## Parser implementation with markdown-it

- No CommonMark decision on wiki links exists, only forum threads
  ([CommonMark forum: page links](https://talk.commonmark.org/t/implict-mediawiki-gollum-style-page-links/830),
  [CommonMark forum: autolinks](https://talk.commonmark.org/t/cmark-autolinking-syntax-vs/3397)). MD4C has the flag
  `MD_FLAG_WIKILINKS` and renders an `<x-wikilink>` element ([MD4C](https://github.com/mity/md4c)); Pandoc has
  `wikilinks_title_after_pipe` and `wikilinks_title_before_pipe`
  ([Pandoc manual](https://raw.githubusercontent.com/jgm/pandoc/main/MANUAL.txt)); Python-Markdown ships a WikiLinks
  extension ([Python-Markdown](https://python-markdown.github.io/extensions/wikilinks)); Djot has none
  ([Djot syntax](https://github.com/jgm/djot/blob/main/doc/syntax.md)).
- The npm packages, as of 2026-11-20 ([npm registry](https://registry.npmjs.org/-/v1/search?text=markdown-it%20wikilink&size=20)):

  | Package                          | Latest | Published  |
  | -------------------------------- | ------ | ---------- |
  | `markdown-it-wikilinks`          | 1.4.0  | 2023-08-12 |
  | `markdown-it-wikilinks-plus`     | 1.4.0  | 2025-08-18 |
  | `markdown-it-obsidian`           | 1.1.0  | 2021-07-13 |
  | `remark-wiki-link`               | 2.0.1  | 2023-10-10 |
  | `@flowershow/remark-wiki-link`   | 4.1.0  | 2026-11-19 |
  | `remark-obsidian`                | 1.15.0 | 2026-10-15 |
  | `markdown-it`, used by HippoWiki | 15.0.3 | 2026-10-16 |

- `markdown-it-wikilinks` matches `/\[\[([^|\]\n]+)(\|([^\]\n]+))?\]\]/` through `markdown-it-regexp`, target first, on
  one line, and renders through a callback that returns an HTML string. It depends on a fork hosted on Git
  ([index.js](https://unpkg.com/markdown-it-wikilinks@1.4.0/index.js),
  [package.json](https://unpkg.com/markdown-it-wikilinks@1.4.0/package.json)).
- The maintained implementations are on the remark side, which HippoWiki does not use: `pages.md` records that
  micromark took many seconds on the inputs that are slow for parsers, where markdown-it stayed linear.

What follows for HippoWiki (inferences from the notes and from `src/features/pages/markdown.ts`):

- An own inline rule, registered before markdown-it's `link` rule, that pushes a token of its own with the target, the
  anchor and the label. The page view in `src/features/pages/components/markdownToReact.tsx` renders it like the other
  tokens; the existing task list and footnote rules in `markdown.ts` are the precedent for own rules.
- Code spans and fenced code are consumed before the rule runs, so `[[...]]` in code stays text; `\[[` is handled by
  the earlier escape rule; linkify runs over text tokens after the inline parse and so never sees a wiki link.
- One parse serves the title, the suggested name, the search text and the view (`pages.md`). The new token needs a
  plain text form for each: `# About [[setup]]` gives a title, and the text of a link enters the search text, where
  today the addresses of links are searched (`search.md`). Whether that text is the label, the name or the title is
  an open question.
- The resolution needs the database, the parse does not: the rule only reads the syntax, and the view looks the targets
  up. The link table, if any, is filled from the same tokens.

## Markdown export and interoperability

- `[[...]]` is no standard Markdown, and tools work around it: Foam appends link reference definitions such as
  `[Data Science]: data-science.md 'Data Science'` so that other renderers show the links
  ([Foam link reference definitions](https://github.com/foambubble/foam/blob/main/docs/user/features/link-reference-definitions.md));
  Bear's HTML export turns wiki links into ordinary links
  ([Bear 1.7.15](https://blog.bear.app/2020/09/bear-1-7-15-is-out-with-new-features-for-wiki-links-html-export-and-more));
  Zettlr's export can remove links, unlink them to their target, or leave them
  ([Zettlr settings](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/reference/settings.md)); Logseq's
  "standard Markdown" export is lossy ([Logseq DB version](https://github.com/logseq/docs/blob/master/db-version.md)).
- Outline's export keeps links to `/doc/...` that "only work in Outline"; the maintainer was open to an option, but the
  default stayed ([Outline discussion 1603](https://github.com/outline/outline/discussions/1603)).
- SilverBullet changed its resolution so that "Obsidian vaults just work"
  ([SilverBullet ADR 011](https://github.com/silverbulletmd/silverbullet/blob/main/docs/ADR/011%20Link%20Resolution%20by%20Name.md));
  Zettlr says its files work in Obsidian, but not the other way round
  ([Zettlr: migrating from Obsidian](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/getting-started/migrating-from-obsidian.md)).
- Block references and ids travel worst: Obsidian's block links "won't work outside of Obsidian", and Trilium's ids
  change on import ([Obsidian internal links](https://obsidian.md/help/links),
  [Trilium Note ID](https://docs.triliumnotes.org/user-guide/advanced-usage/note-id)).
- Joplin's plugin converts `[text](:/noteId)` into `[[Title|text]]`
  ([Joplin Wikilinks plugin](https://joplinapp.org/plugins/plugin/joplin.plugin.alondmnt.wikilinks/)).

What follows for HippoWiki:

- "Import and export" is an entry of `roadmap.md`. Exported with tabs as directories and pages as files named by
  their names, `[[setup]]` and `[[guides/setup]]` would likely resolve in Obsidian and Foam, which read a bare name as
  a unique file name and a slash as a path (inference from
  [Foam wikilinks](https://github.com/foambubble/foam/blob/main/docs/user/features/wikilinks.md), not tested).
  Obsidian would show the file name, not the title, for a link without a label.
- Converting to relative Markdown links with the title as text on export is the portable alternative.
- Importing from Obsidian needs names converted to the name rule, with possible collisions (inference).
- An alternative to a new syntax: relative Markdown links to page addresses already work today, because a relative
  address is allowed (`pages.md`). GitLab, Azure DevOps, BookStack and Wiki.js link this way, and BookStack tracks and
  rewrites such links. They are standard Markdown, but they hold the folder name, which an Owner can rename, and they
  are long to type. Counting them in the link table as well is an option (inference).

## AI apps and MCP

- Notion's MCP returns "enhanced Markdown" with `<mention-page url="...">Title</mention-page>`, being replaced by
  `<mention url="...">`, and tells agents to fetch the spec resource and "Do NOT guess" the syntax
  ([Notion enhanced Markdown](https://developers.notion.com/guides/data-apis/enhanced-markdown),
  [Notion-flavored Markdown](https://developers.notion.com/guides/data-apis/notion-flavored-markdown.md),
  [Composio listing of Notion MCP](https://docs.composio.dev/toolkits/notion_mcp.md), third-party). A third-party skill
  reports that a wrong tag moves the target page, unverified
  ([skillsmp](https://skillsmp.com/creators/davidteju/shared-skills/skills-notion-page-link-syntax)).
- Outline writes document mentions into Markdown as ordinary links, and third-party Outline MCP servers offer a tool
  for backlinks ([Outline Mention node](https://raw.githubusercontent.com/outline/outline/main/shared/editor/nodes/Mention.tsx),
  [glama listing](https://glama.ai/mcp/servers/@huiseo/outline-wiki-mcp/tools/get_document_backlinks)).
- Atlassian's Rovo MCP returns Confluence pages as Markdown; how it writes internal links is not documented in the
  sources found ([Atlassian Rovo MCP](https://developer.atlassian.com/cloud/rovo-mcp/)).
- Community MCP servers for Obsidian offer `get_backlinks`, `get_outgoing_links` and tools for orphans and broken
  links next to raw Markdown ([glama listing](https://glama.ai/mcp/servers/getglad/obsidian_mcp/tools/get_backlinks),
  [docs.rs obsidian-mcp](https://docs.rs/crate/obsidian-mcp/1.0.3/source/src/tools/graph.rs)); these are not official
  products.
- Foam has a CLI and an MCP server built on its link index
  ([Foam changelog](https://github.com/foambubble/foam/blob/main/packages/foam-vscode/CHANGELOG.md)).
- No guidance from Anthropic or OpenAI on link formats for agents was found.

What follows for HippoWiki:

- A name in the link is what `read_page` takes: an agent that reads `[[guides/setup]]` calls `read_page` with the tab
  `guides` and the name `setup`. `list_folder` already returns every name and tab (`mcp.md`).
- The instructions of a connection state the name rule in the same words as the tool descriptions (`mcp.md`). The
  grammar of links would be stated the same way: the order, names and not titles, no `.md`, and what happens to a
  missing target. The likely mistakes of a model are the other pipe order, a title such as `[[Setup Guide]]` and a
  suffix such as `[[setup.md]]` (inference).
- `create_page` without a name gets the name the browser would suggest (`mcp.md`); an agent that writes several pages
  that link to each other learns the names from the results.
- Links in a result: `read_page` could list the outgoing links with their status, or a tool of its own could, along
  with backlinks and broken links of the folder. A result that carries titles starts with the field `note` (`mcp.md`,
  "Prompt injection").
- With a rewrite on rename, `move_or_rename_page` changes other pages as well. Its result could name them, and an agent
  that holds their versions gets the usual conflict and reads them again (`optimistic-locking.md`). Foam and
  SilverBullet give agents the same "rename and update the links" in one call (inference from their changelogs).
- `edit_page_content` matches exact text (`mcp.md`). After a rewrite, an agent's old text is gone, but the version
  check comes first and tells it to read the page again.
- Labels are page text and data, like every page text (`mcp.md`, "Prompt injection"). Wiki links lead only into the
  folder, so they carry no data out of a conversation, unlike external links and images (inference).

## Wiki.js 3 in detail

Wiki.js 3 was read from its source code, version 3.0.0-dev, with changes up to 2026-11-12, on 2026-11-20. It is the
most complete server-side implementation of links among the systems compared. The rows of the tables above that name
Wiki.js 2 come from its published 2.5 source and from user reports, and Wiki.js 3 differs from them in most points.
File names below are paths in the Wiki.js repository. Where this section draws a conclusion from the code that the code
does not state, it says "inference"; nothing here was tried in a running instance.

How a page is stored and rendered:

- A page stores its source and its rendered HTML. The HTML is made in the browser of the editor, by the same
  markdown-it pipeline as the page view, and sent to the server with the source. The server has no Markdown parser:
  pages that are written without a browser, by an import or through MCP, are queued and rendered by a headless Chrome
  that runs the same renderer bundle (`backend/models/rendering.ts`).
- So the server reads the links of a page from its stored HTML, with cheerio, and not from its source
  (`linksFromRender` in `backend/helpers/pageLinks.ts`). This split between the source and the render is behind most
  of the special cases below.

The wiki link syntax:

- A markdown-it inline rule of its own, `frontend/src/renderers/modules/markdown-it-wikilinks.js`, on by default and
  switchable in the settings of the Markdown editor (`wikiLinks` in `backend/models/sites.ts`). Its comment calls it
  "MediaWiki's link syntax": `[[Page Name]]`, `[[Page Name|shown text]]`, `[[Page Name#Section]]` and `[[#Section]]`,
  target first.
- The target is a name that is turned into a path with the same rule as every path field (`normalizePagePath`): spaces
  become hyphens and everything is lowercased. `[[Getting Started]]` links `/getting-started`, and
  `[[Guides/Getting Started]]` links `/guides/getting-started`. A link is always from the root of the site and never
  relative to the page it is written on, and it lands in the primary language of a site with several languages.
- The section is turned into a heading id by the same function that gives headings their ids (`slugifyHeading`, with
  copies in the browser and on the server), so `[[Page#Some Heading]]` finds the heading "Some Heading".
- `[[Glossary:REST]]` links a term of the glossary instead of a page, MediaWiki's namespace idea for one other kind of
  target.
- The label is inline Markdown, `[[Page|**bold** text]]`. Without a label the target is shown as written, as plain
  text, and not the title of the target.
- Refused, and left as text: a target with `[`, `]`, `{`, `}`, `<`, `>`, `|` or a line break, a target that is a URL
  such as `[[https://…]]`, and a wiki link inside a link. `[[1]](https://…)` and `[[x]][ref]` stay ordinary links,
  because citations are written that way. A backslash escapes; a link does not span lines.
- The rule emits the ordinary `link_open` and `link_close` tokens of markdown-it, with the markup `wikilink` and the
  target as written in `meta.wikilink`. Everything that reads links reads these too, and the href passes markdown-it's
  own `normalizeLink` and `validateLink`.
- The visual editor keeps the target in an attribute of the link and writes `[[Target]]` back while the text of the
  link is still the target, `[[Target|text]]` once the text differs, and an ordinary Markdown link once the address is
  changed (`frontend/src/editor/visual/serialize.js`, `frontend/src/editor/visual/links.js`).

The other ways to link a page:

- The link picker and the completion of the Markdown editor write ordinary Markdown links to paths from the root,
  `[label](/path)`. The completion starts after `](`: with nothing typed yet it offers the pages whose title or path
  matches the text of the link, after a `/` the pages whose path starts with what is typed
  (`frontend/src/composables/linkCompletions.js`). No completion is registered on `[[` (inference from the completion
  providers of the editor).
- Two short addresses survive every move: `/a/<alias>` for a page with an alias, and `/i/<page id>`.
- `resolveLink` reads every spelling of a page address as the browser would follow it: relative paths, a language
  prefix, a page extension, and absolute URLs to a host name of one of the sites of the instance. Its comment calls it
  "the THIRD copy of the rules for reading a page URL", which has to agree with the router.
- Links are also collected from the target of a redirect page and from the "relations", the sidebar links of a page.

The link table:

- `pageLinks` (`backend/db/schema.ts`), one row per link of a page: the kind (`page` by path, `alias`, `pageId` or
  `asset` for an uploaded file), the href exactly as written, and the target as site, language and path, or as the
  alias or id. Links that leave the wiki are not recorded.
- "One row per spelling, not per target": `../two` and `/one/two` on the same page are two rows, because a repair has
  to find each string in the source again. The href is limited to 2048 characters, the size a unique index can hold;
  a longer one is not recorded, and the save never fails for it.
- Targets are stored by address and not by page id, on purpose. A link to a page that does not exist is a row like any
  other, and a page created at that path makes it good without anything having to notice. After a move, the links
  still name the old path, "which is what makes them findable as the ones it broke".
- The rows of a page are replaced as a whole, in one transaction, on every save and also on every move of the page
  itself, because its relative links then mean other pages (`refreshForPage` and `replaceFor` in
  `backend/models/pageLinks.ts`). A rebuild of all rows runs as a background job
  (`backend/tasks/workers/rebuild-page-links.ts`). The rows of a page are deleted with it by a cascade.
- Outgoing links and whether their targets exist come from a left join of the rows with the pages (`outboundFor`);
  backlinks from the rows with the address of a page, its id and its alias, without links of a page to itself
  (`backlinksFor`).
- The table also feeds the Links tab of a page with its backlinks (`frontend/src/components/PageLinks.vue`) and a
  graph of pages and links in the file manager (`backend/models/pageGraph.ts`). The scan for page problems checks the
  targets of redirect pages, but not broken links in content (`backend/models/pageProblems.ts`, inference from its
  list of checks).

Red links:

- The server sets the class `is-broken-link` on the anchors of the stored HTML whose target does not exist, and
  removes it from all others (`markBrokenLinks`). It does so when a page is saved, and for every page linking to a
  page that was created, moved or deleted (`refreshLinksTo`), by path, by id and by alias. It writes without changing
  the time of the last change, and only over the HTML it read, so that a save in between wins.
- Whether the class is drawn red is a setting of the site, `colorizeBrokenLinks`, on by default, applied as a class on
  the container of the page, so that switching it changes no stored page.
- This answers the complaint about Wiki.js 2 that a link stayed red after its page was created (inference).

Rename and move:

- A move on its own changes no other page and leaves no redirect (inference from `movePage` in
  `backend/models/pages.ts`); redirects are pages of a kind of their own that a user creates.
- The rename dialog offers "Update pages linking to this page with the new location", on by default. The REST API
  takes `updateLinks`, and the MCP tool `move_page` has `updateLinks` on by default.
- `relinkMovedPage` in `backend/models/pages.ts` takes every page with a row of kind `page` at the old address, one by
  one:
  - It skips a page the mover may not edit (`forbidden`) and a page locked against edits (`locked`): a move is "not a
    way to write to pages the mover could not have saved".
  - It writes each new href in the form the author chose (`relinkHref` in `backend/helpers/pageLinks.ts`): a relative
    link stays relative to where the linking page is now, a path stays a path, a full URL keeps its host, and a
    query, a fragment, a page extension and a language prefix are kept. The result is checked with `resolveLink`, and
    falls back to the plain path from the root when it would land elsewhere.
  - It rewrites only the characters of the href in the source, with patterns for Markdown links, reference
    definitions, HTML `href` and `src` and AsciiDoc macros, and skips fenced code and code spans
    (`backend/helpers/linkRewrite.ts`). It also rewrites the target of a redirect page, the links of drawing elements
    and the relations.
  - It rewrites the stored HTML too, so that readers see the fix at once, but never the HTML alone: a link that is in
    the HTML but cannot be found in the source is left and reported (`notInSource`), "because a fixed render over an
    unfixed source would break again".
  - It saves the page through the ordinary update as the mover, with a new version whose reason is "Updated links to a
    page that moved from {from} to {to}", in the primary language of the wiki, since every linking page's history
    shows it.
  - A page whose save fails gets its HTML back and is reported (`failed`); the others go on, because the move has
    already happened.
- The result counts the updated and the skipped pages and names a skipped page only to a mover who may read it. The
  browser shows the skipped pages in a notice that stays until it is closed, because they "have to be updated by
  hand".
- Links by alias or by id are not touched; they survive the move.
- Wiki links are not rewritten (inference from the code, not tried). The source rewrite and `sourceLinkHrefs` know
  Markdown links, reference definitions, HTML and AsciiDoc, but not `[[...]]`. A `[[Getting Started]]` is recorded
  from the HTML as `/getting-started`, but that href is not in the source, so the linking page is reported as
  `notInSource` and keeps the link to the old path, now red.

Deleted pages:

- A page is deleted for good; its history keeps a version that records the deletion. Its own rows go with it, and the
  links of other pages to it, by path, id and alias, turn red at once.

Permissions:

- Every role check is per page, by rules on paths and tags. The routes for backlinks and outgoing links and the MCP
  tools filter each linked page by the right to read it and by its publishing state: a link to a page the caller may
  not read is answered as `exists: false`, without its id and title, "which is also what clicking it would give them".
  A page behind a password shows no backlinks.
- The red-link class, though, is set once in the shared HTML from whether the target exists at all, without a reader.
  So a link to an existing page that the reader may not read is not drawn red, which tells the reader that the page
  exists (inference from `syncBrokenLinks`).
- Backlinks can be switched off for a site (`features.backlinks`) or hidden for a page (`allowBacklinks`); the rows
  are written all the same, so that switching them on again shows a complete list.

AI apps and MCP:

- `read_page` returns the Markdown source. `get_page_links` lists the outgoing links of a page with `exists`, and the
  title and address of each target the agent may read; `get_backlinks` lists the readable pages that link to a page
  (`backend/mcp/tools/pages.ts`). The description of `get_page_links` names its use: "to find a page's broken links".
- `move_page` reports `linksUpdated` and the pages it could not update (`backend/mcp/tools/destructive.ts`). Its
  description asks the agent to move a page only when the person it works for asked for it.
- Every write through MCP answers with `brokenLinks`, the links of the new source that reach no page the agent may
  read, and the note "Fix them with update_page, or create the pages they point at" (`backend/mcp/tools/edit.ts`).
  They are read from the source with `sourceLinkHrefs`, because the HTML is not rendered yet, so a wiki link to a
  missing page is not among them (inference).

What follows for HippoWiki:

- Wiki.js 3 is the closest precedent for a server-side link table with an optional rewrite on move: rows by address and
  as written, a rewrite in the author's form, one new version per linking page with the move as its reason, a report
  of the pages left alone, and the same for AI apps. Its option is on by default.
- Its gap with wiki links comes from reading links from the HTML and rewriting them with patterns over the source.
  HippoWiki parses the source on the server with markdown-it (`pages.md`), so the link table and a rewrite could both
  come from the tokens of one parse, with the positions of each link in the source, and every syntax that is recorded
  would also be rewritable (inference).
- Its `[[Getting Started]]` to `/getting-started` is the option of deriving the name from what is written, as
  `deriveName()` does in HippoWiki. In Wiki.js the source then keeps a spelling that no rewrite finds.
- Rows by address keep links to missing pages and the links that a move broke, which a "Broken links" list needs.
- It marks red links in stored HTML; HippoWiki renders at every view (`pages.md`) and would look up the targets of a
  page in one query instead.
- Within a HippoWiki folder every Writer may edit every page (`folder-roles.md`), so a rewrite by a Writer has no
  forbidden pages to skip; a locked page has no counterpart, but a page over a lowered content limit would need a
  reason of its own to be skipped (`pages.md`).
- Its per-page roles show why a shared red-link marker leaks; HippoWiki, with roles per folder and links within a
  folder, has no such case.

## Profiles of the systems

- MediaWiki: `[[Target|Label]]`, namespaces, subpages, interwiki prefixes; red links to the editor; redirects on move,
  no rewrite; `pagelinks` with `linktarget`; no read rights per page.
- DokuWiki: `[[ns:page|text]]`, ids cleaned to lowercase, links without a colon relative to the namespace; `useheading`
  shows the target's first heading; renames only with the Move plugin, which rewrites; backlinks from the metadata
  index, filtered by rights.
- XWiki: `[[label>>reference]]` with typed references and anchors as parameters; a fixed lookup order for relative
  links; moves rewrite links and leave a redirect, both by default.
- TiddlyWiki: `[[Label|Title]]`, a flat set of titles, CamelCase links; rename relinks only tags and lists; backlinks
  computed live.
- Gollum: `[[Label|Page]]`, relative to the directory, exact and case-sensitive since 5.0; redirects in
  `.redirects.gollum`; no backlinks.
- GitHub wikis: Markdown links to wiki URLs, `[[Page|Text]]` documented only for MediaWiki pages; built on Gollum.
- GitLab wikis: `[[Label|slug]]` and `[wiki_page:...]` across projects; redirects since 17.1; `[[` autocomplete by
  title.
- Azure DevOps wiki: Markdown links to paths; the Move dialog offers to update links.
- Confluence: links by title and space in the storage format, by page id in Cloud's picker; Smart Links follow
  renames; Data Center lists undefined pages; missing and forbidden pages look the same.
- Notion: `@`, `[[` or `+` open a picker; mentions hold the page id and show the live title; backlinks only from
  pages the reader can open; MCP speaks an own Markdown with mention tags.
- Outline: `@` mentions with the target id, written to Markdown as links to `/doc/<slug>-<urlId>`; backlinks in a
  table updated by a queue; exports keep app URLs.
- BookStack: ordinary links to page URLs; a references table, a rewrite of all referencing pages with a revision each,
  and slug history since v25.12.
- Wiki.js 2: Markdown links to paths; a `pageLinks` table; on move only the cached HTML is patched, which users report
  as broken.
- Wiki.js 3: `[[Page Name|Label]]` with sections, turned into a path from the root, next to Markdown links to paths
  and short links by alias and id; links read from the rendered HTML into `pageLinks` by address and as written; red
  links marked on the server; an optional rewrite of linking pages on move, on by default, which skips wiki links; MCP
  tools for links and backlinks (see "Wiki.js 3 in detail").
- Docmost: `@` mentions and copied links; no backlinks, no update on rename.
- HedgeDoc: no wiki links; a community proposal only.
- Obsidian: `[[Note|Label]]`, headings and blocks; resolution by unique file name, not documented; rewrites on rename;
  resolved and unresolved links in a cache; backlinks with unlinked mentions.
- Logseq: `[[Page]]` by title, case-insensitive; aliases; block references by UUID; the DB version unifies pages and
  blocks as nodes.
- Roam Research: `[[Page]]` and `((block uid))`; read from a third-party cheatsheet only.
- Foam: identifiers as unique path suffixes, ambiguity resolved alphabetically with a warning; placeholders; rewrites
  on move, also sections; link reference definitions for portability; a CLI and an MCP server.
- Dendron: label first, dotted hierarchical names, the title shown; maintenance only.
- SilverBullet: exact path, then the name anywhere (2.11.0, 2026-09-17), ambiguous links marked; aspiring pages;
  explicit anchors; rewrites in a configured form.
- Joplin: links by note id in core; wiki links only through a plugin, which resolves id, then title.
- Trilium: `[[<note id>]]` in Markdown notes, rendered with the current title; a deleted target stays red with its
  last title.
- Zettlr: the label order is a setting; links by file name or by a Zettelkasten id that survives renames.
- Bear: `[[Note title]]` by title, headings after `/`; heading links not updated on heading rename.

## Options for HippoWiki

Each decision below lists its options with their trade-offs. The options are independent where nothing else is said.

### What a link names

| Option                                                                                                             | For                                                                        | Against                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A: a path like the address: `[[setup]]` is a page directly in the folder, `[[guides/setup]]` one in a tab          | one meaning, like the address; no lookup order; easy to explain to AI apps | moving a page between tabs and renaming a tab change its links                          |
| B: relative to the linking page: `[[setup]]` in the same place first, `[[guides/setup]]` and `[[/setup]]` explicit | short links within a tab; a tab rename changes no link inside the tab      | two links to one page can look different; a deleted page has no place to resolve from   |
| C: the name anywhere in the folder; a name in several places is marked as ambiguous                                | shortest links; close to Obsidian and SilverBullet                         | meaning depends on other pages: a new page can take links over (SilverBullet, Obsidian) |
| D: C for writing, with the server writing back the full form A on save                                             | short to type, stored text unambiguous                                     | the server changes what the user wrote; more to explain                                 |
| E: the title                                                                                                       | what people know                                                           | titles are not unique (`pages.md`)                                                      |
| F: a page id                                                                                                       | renames cost nothing                                                       | opaque to people and AI apps; translation on every read and write                       |

### Label, spelling and display

- Order: `[[target|label]]` (majority, MediaWiki and Obsidian) or `[[label|target]]` (Gollum, GitLab); one order only.
- Label: plain text only, or inline Markdown inside.
- Spelling: exact names only, or the name derived with `deriveName()` from what is written. Exact is predictable and
  easy to rewrite; derived forgives titles and capitals, but stores several spellings of one link.
- Without a label: the current title of the target (DokuWiki `useheading`, Dendron, Trilium) or the name as written
  (MediaWiki, Gollum). The title is friendlier; the name keeps the view of a page independent of other pages.
- A link to the page itself: a link, or bold text as in MediaWiki.

### Anchors and embeds

- Anchors: not in the first version; by slug; by heading text. All need heading ids in the page view first.
- Embeds `![[...]]`: left as text, reserved as an error, or a feature of their own later.

### Missing and broken links

- The look: a marker with color and a second cue.
- For a Writer and up: a link that opens the editor of a new page with the name and place preset, or no link.
- A list of broken links per folder (the roadmap entry), with or without a list of orphans.
- A target that breaks the name rule: text, a missing link, or an error of its own.
- Warnings at save: none, or the save dialog lists the links that lead nowhere; a save is never refused for them.

### Rename, move and tab rename

| Option                                                          | For                                                                   | Against                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| R1: nothing; links break and show as missing                    | no new kind of write; the broken links list finds them                | every rename breaks links; users fix them by hand (Docmost, Azure drag and drop)         |
| R2: rewrite the linking pages in the same transaction           | the stored text stays true for people and AI apps; one place of truth | a revision, a version, a last editor per linking page; content limits; long transactions |
| R3: R2 after asking, as Obsidian and Azure DevOps offer         | the user sees which pages change                                      | a dialog step more; two outcomes to explain                                              |
| R4: redirects or a name history, no rewrite                     | old addresses keep working too (roadmap entry)                        | outdated text; a new page of the old name changes the meaning; chains of redirects       |
| R5: resolve by the target page in the link table, keep the text | no writes to other pages                                              | the text says one name and the link goes to another, confusing for AI apps (Wiki.js)     |
| R6: ids in the stored text                                      | nothing to rewrite                                                    | see option F                                                                             |

For R2 and R3, the decisions that come with them: the user and channel of the rewrite revisions, a mark on them,
whether the last editor changes, what happens to a page over a content limit, whether tab renames rewrite as well,
and what the result of `move_or_rename_page` reports.

### Link table and backlinks

- No table: resolve at every view, no backlinks. The smallest step, but no "Broken links" and no rewrite on rename.
- A table maintained in the same write as the content and on every move, rename, delete, restore and tab change, and
  filled again at the start for outdated pages like the search index. Backlinks, broken links and rewrites come from
  it.
- Backlinks shown: at the bottom of the page, in a view of the page address, or both; through MCP in `read_page` or
  in a tool of its own.

### Scope

- Within one folder only, as a lasting rule like moves; or within the folder now, with a form across folders that
  renders a forbidden target like a missing one later.
- Links to tabs and to the folder: none, or a form of their own.
- Relative Markdown links to page addresses: left as they are, or counted in the link table and rewritten too.

### Three sizes of a first version

- Small: `[[name]]` and `[[tab/name]]` with an optional label, within the folder, exact names, the current title as
  text, missing links marked, no table, no rewrite. Small to build, but renames break links silently until broken links
  can be listed.
- Middle: the small version, a link table, backlinks on the page, a list of broken links of the folder, a rewrite of
  linking pages on move and rename, and MCP tools or fields for links. This covers both entries of "Links" in
  `roadmap.md`.
- Large: the middle version with anchors and heading ids, a picker on `[[`, creating a page from a missing link,
  redirects and conversion on export.

## Open questions

- Syntax: which order of target and label? Is a label plain text or inline Markdown? Is `![[...]]` reserved?
- Target: which of the options A to F names a page? How are tabs and pages placed directly in the folder told apart?
  Can a link name a tab or the folder?
- Spelling: are only exact names accepted, or is `[[Setup Guide]]` derived to `setup-guide`? What does a target that
  breaks the name rule show?
- Display: does a link without a label show the target's current title or its name? What does a link to the page
  itself show? Do rendered revisions show today's titles?
- Anchors: are anchors part of the first version? If so, heading ids by slug or by heading text, with which prefix,
  and is a missing heading a broken link?
- Missing links: how do they look for each role? Does a Writer get a way to create the page from the link, and with
  which parameters on `?action=new`?
- Rename and move: which of R1 to R6? With a rewrite: which user and channel, which mark on the revision, does the
  last editor change, what about content limits and pages over a lowered limit, are tab renames included, and is the
  number of linking pages limited?
- Revert and restore: does anything happen to links when a page is reverted to a revision with old link names, or
  restored under a new name?
- Link table: is there one from the start, and what does it store for links to missing and deleted pages?
- Backlinks and broken links: where are they shown in the browser, for which roles, and are orphans listed?
- Deleted pages: does a Manager see that a link points to a deleted page? How do the links of a deleted page render?
- Scope: are links within one folder a lasting rule, or is a form across folders planned?
- Markdown links: are relative Markdown links to page addresses treated as links as well?
- Search: does the label, the name or the title of a link enter the search text?
- Editor: is a picker on `[[` part of the first version, or does it wait for the rich editor? Does the save dialog
  list links that lead nowhere?
- Limits: is the number of links per page limited, like table cells?
- MCP: how are the links of a page given to an agent, as fields of `read_page` or a tool of its own? Is there a tool
  for backlinks and broken links? What do the instructions say about the grammar? What does `move_or_rename_page`
  report when it rewrites other pages?
- Export: are wiki links kept for Obsidian and Foam, or converted to Markdown links, once "Import and export" comes?

## Sources

Classic and Git-based wikis:

- [MediaWiki Help:Links](https://www.mediawiki.org/wiki/Help:Links)
- [MediaWiki Help:Moving a page](https://www.mediawiki.org/wiki/Help:Moving_a_page)
- [MediaWiki Manual:Pagelinks table](https://www.mediawiki.org/wiki/Manual:Pagelinks_table)
- [MediaWiki Manual:Job queue](https://www.mediawiki.org/wiki/Manual:Job_queue)
- [MediaWiki Manual:Preventing access](https://www.mediawiki.org/wiki/Manual:Preventing_access)
- [MediaWiki Manual:Checking for page existence](https://www.mediawiki.org/wiki/Manual:Checking_for_page_existence)
- [MediaWiki MainConfigSchema.php](https://github.com/wikimedia/mediawiki/blob/master/includes/MainConfigSchema.php)
- [MediaWiki LinkRenderer.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Linker/LinkRenderer.php)
- [Phabricator T351237](https://phabricator.wikimedia.org/T351237)
- [DokuWiki syntax.txt](https://github.com/dokuwiki/dokuwiki/blob/master/data/pages/wiki/syntax.txt)
- [DokuWiki Resolver.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/File/Resolver.php)
- [DokuWiki PageResolver.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/File/PageResolver.php)
- [DokuWiki pageutils.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/pageutils.php)
- [DokuWiki xhtml.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/parser/xhtml.php)
- [DokuWiki MetadataSearch.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/Search/MetadataSearch.php)
- [DokuWiki Move plugin](https://github.com/michitux/dokuwiki-plugin-move)
- [XWiki link syntax help](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-help/xwiki-platform-help-ui/src/main/resources/XWiki/XWikiSyntaxLinks.xml)
- [XWiki AbstractCopyOrMoveRequest.java](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-refactoring/xwiki-platform-refactoring-api/src/main/java/org/xwiki/refactoring/job/AbstractCopyOrMoveRequest.java)
- [XWiki MoveRequest.java](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-refactoring/xwiki-platform-refactoring-api/src/main/java/org/xwiki/refactoring/job/MoveRequest.java)
- [XWiki DocumentXHTMLLinkTypeRenderer.java](https://github.com/xwiki/xwiki-rendering/blob/master/xwiki-rendering-syntaxes/xwiki-rendering-syntax-xhtml/src/main/java/org/xwiki/rendering/internal/renderer/xhtml/link/DocumentXHTMLLinkTypeRenderer.java)
- [TiddlyWiki Linking in WikiText](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/editions/tw5.com/tiddlers/wikitext/Linking%20in%20WikiText.tid)
- [TiddlyWiki title editor](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/core/ui/EditTemplate/title.tid)
- [TiddlyWiki link widget](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/core/modules/widgets/link.js)
- [TiddlyWiki tm-rename-tiddler](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/editions/tw5.com/tiddlers/messages/WidgetMessage_%20tm-rename-tiddler.tid)
- [TiddlyWiki Relink plugin](https://github.com/flibbles/tw5-relink)
- [Gollum tags filter](https://github.com/gollum/gollum-lib/blob/master/lib/gollum-lib/filter/tags.rb)
- [Gollum 5.0 release notes](https://github.com/gollum/gollum/wiki/5.0-release-notes)
- [Gollum Standard Syntax](https://raw.githubusercontent.com/wiki/gollum/gollum/Standard-Syntax.md)
- [GitHub Docs: editing wiki content](https://docs.github.com/en/communities/documenting-your-project-with-wikis/editing-wiki-content)
- [GitLab wiki-specific Markdown](https://docs.gitlab.com/user/project/wiki/markdown/)
- [GitLab wiki](https://docs.gitlab.com/user/project/wiki/)
- [GitLab MR 143654](https://gitlab.com/gitlab-org/gitlab/-/merge_requests/143654)
- [Azure DevOps Markdown guidance](https://learn.microsoft.com/en-us/azure/devops/project/wiki/markdown-guidance?view=azure-devops)
- [Azure DevOps add and edit wiki pages](https://learn.microsoft.com/en-us/azure/devops/project/wiki/add-edit-wiki?view=azure-devops)
- [Redmine issue 26530](https://redmine.org/issues/26530.pdf)

Team wikis:

- [Confluence storage format](https://confluence.atlassian.com/doc/confluence-storage-format-790796544.html)
- [Confluence undefined page links](https://confluence.atlassian.com/doc/undefined-page-links-139580.html)
- [Atlassian Community: link to a page that does not exist yet](https://community.atlassian.com/t5/Confluence-questions/How-do-I-create-a-link-to-a-page-that-doesn-t-exist-yet/qaq-p/1240674)
- [Atlassian Community: update references after a move](https://community.atlassian.com/t5/Confluence-questions/Automatically-update-references-to-a-Confluence-article-after/qaq-p/2368434)
- [CONFCLOUD-79554](https://jira.atlassian.com/browse/CONFCLOUD-79554),
  [CONFCLOUD-84308](https://jira.atlassian.com/browse/CONFCLOUD-84308),
  [CONFSERVER-28033](https://jira.atlassian.com/browse/CONFSERVER-28033),
  [CONFSERVER-45898](https://jira.atlassian.com/browse/CONFSERVER-45898)
- [Atlassian KB: page not found](https://support.atlassian.com/confluence/kb/page-not-found-error-when-trying-to-reach-a-page-accessible-to-other-users/)
- [Atlassian KB: old page ids](https://support.atlassian.com/jira/kb/how-to-update-old-confluence-page-id-and-tinyurls-with-new-values-inside-the-jira-issues/)
- [Atlassian Rovo MCP](https://developer.atlassian.com/cloud/rovo-mcp/)
- [Notion help: links and backlinks](https://www.notion.com/help/create-links-and-backlinks)
- [Notion API: rich text](https://developers.notion.com/reference/rich-text)
- [Notion enhanced Markdown](https://developers.notion.com/guides/data-apis/enhanced-markdown)
- [Notion-flavored Markdown](https://developers.notion.com/guides/data-apis/notion-flavored-markdown.md)
- [Composio: Notion MCP (third-party)](https://docs.composio.dev/toolkits/notion_mcp.md)
- [skillsmp: Notion page link syntax (third-party, unverified)](https://skillsmp.com/creators/davidteju/shared-skills/skills-notion-page-link-syntax)
- [Outline changelog: document mentions](https://www.getoutline.com/changelog/document-mentions.md)
- [Outline Mention.tsx](https://raw.githubusercontent.com/outline/outline/main/shared/editor/nodes/Mention.tsx)
- [Outline BacklinksProcessor.ts](https://raw.githubusercontent.com/outline/outline/main/server/queues/processors/BacklinksProcessor.ts)
- [Outline discussion 1603](https://github.com/outline/outline/discussions/1603)
- [glama: Outline MCP get_document_backlinks (third-party)](https://glama.ai/mcp/servers/@huiseo/outline-wiki-mcp/tools/get_document_backlinks)
- [BookStack ReferenceUpdater.php](https://raw.githubusercontent.com/BookStackApp/BookStack/development/app/References/ReferenceUpdater.php)
- [BookStack RevisionRepo.php](https://raw.githubusercontent.com/BookStackApp/BookStack/development/app/Entities/Repos/RevisionRepo.php)
- [BookStack v22.09](https://www.bookstackapp.com/blog/bookstack-release-v22-09/)
- [BookStack v25.12](https://www.bookstackapp.com/blog/bookstack-release-v25-12/)
- [BookStack page permalinks](http://www.bookstackapp.com/docs/user/content-permalinks/)
- [Wiki.js migration 2.0.0](https://raw.githubusercontent.com/requarks/wiki/v2.5.312/server/db/migrations/2.0.0.js)
- [Wiki.js pages.js](https://raw.githubusercontent.com/requarks/wiki/v2.5.312/server/models/pages.js)
- [Wiki.js feedback: moving a page should update links (search snippets)](https://feedback.js.wiki/wiki/p/moving-a-page-should-update-links)
- The source code of Wiki.js 3.0.0-dev ([requarks/wiki](https://github.com/requarks/wiki)), read from a local checkout
  with changes up to 2026-11-12; the files are named in "Wiki.js 3 in detail"
- [Docmost: how to link wiki pages](https://docmost.com/blog/how-to-link-wiki-pages/)
- [HedgeDoc community: wikilinks proposal](https://community.hedgedoc.org/t/proposal-wikilinks-support-either-in-core-or-as-an-add-on/836)

Note and knowledge tools:

- [Obsidian help: internal links](https://obsidian.md/help/links)
- [Obsidian help: settings](https://obsidian.md/help/settings)
- [Obsidian help: aliases](https://obsidian.md/help/aliases)
- [Obsidian help: backlinks](https://obsidian.md/help/plugins/backlinks)
- [Obsidian API: MetadataCache](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache)
- [Obsidian changelog 0.9.4](https://obsidian.md/changelog/2020-10-13-desktop-v0.9.4/)
- [Obsidian forum: links and new files of the same name](https://forum.obsidian.md/t/links-need-to-be-updated-when-a-new-file-with-existing-name-is-added-to-the-vault-to-maintain-consistency/25064)
- [Logseq docs: page reference with label](https://github.com/logseq/docs/blob/master/pages/term___page%20reference%20with%20label.md)
- [Logseq docs: unlinked references](https://github.com/logseq/docs/blob/master/pages/Unlinked%20References.md)
- [Logseq docs: DB version](https://github.com/logseq/docs/blob/master/db-version.md)
- [Logseq forum: case sensitivity](https://discuss.logseq.com/t/when-and-where-is-logseq-case-sensitive-on-linux/10016)
- [Logseq forum: links not updated after rename](https://discuss.logseq.com/t/page-links-not-updating-after-renaming-a-page/34692)
- [Roam Markdown cheatsheet (third-party)](https://glama.ai/mcp/servers/@2b3pro/roam-research-mcp/blob/main/Roam_Markdown_Cheatsheet.md)
- [Foam docs: wikilinks](https://github.com/foambubble/foam/blob/main/docs/user/features/wikilinks.md)
- [Foam docs: link reference definitions](https://github.com/foambubble/foam/blob/main/docs/user/features/link-reference-definitions.md)
- [Foam changelog](https://github.com/foambubble/foam/blob/main/packages/foam-vscode/CHANGELOG.md)
- [Dendron docs: wiki link](https://github.com/dendronhq/dendron-site/blob/HEAD/vault/dendron.topic.links.wiki-link.md)
- [Dendron docs: rename note](https://github.com/dendronhq/dendron-site/blob/HEAD/vault/dendron.topic.refactoring.commands.rename-note.md)
- [SilverBullet docs: Link](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Link.md)
- [SilverBullet docs: Names](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Names.md)
- [SilverBullet docs: Anchor](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Markdown/Anchor.md)
- [SilverBullet docs: Aspiring Pages](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Aspiring%20Pages.md)
- [SilverBullet docs: Linked Mention](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Linked%20Mention.md)
- [SilverBullet ADR 011: link resolution by name](https://github.com/silverbulletmd/silverbullet/blob/main/docs/ADR/011%20Link%20Resolution%20by%20Name.md)
- [SilverBullet changelog](https://github.com/silverbulletmd/silverbullet/blob/main/docs/CHANGELOG.md)
- [Joplin help: Markdown](https://joplinapp.org/help/apps/markdown)
- [Joplin Wikilinks plugin](https://joplinapp.org/plugins/plugin/joplin.plugin.alondmnt.wikilinks/)
- [Trilium docs: Markdown notes](https://docs.triliumnotes.org/user-guide/note-types/markdown)
- [Trilium docs: reference links](https://docs.triliumnotes.org/user-guide/note-types/text/links/reference-links)
- [Trilium docs: note id](https://docs.triliumnotes.org/user-guide/advanced-usage/note-id)
- [Zettlr docs: Zettelkasten method](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/pkms/zkn-method.md)
- [Zettlr docs: settings](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/reference/settings.md)
- [Zettlr docs: migrating from Obsidian](https://github.com/Zettlr/zettlr-docs/blob/master/docs/en/getting-started/migrating-from-obsidian.md)
- [Bear FAQ: linking notes](https://bear.app/faq/how-to-link-notes-together/)
- [Bear blog: 1.7.15](https://blog.bear.app/2020/09/bear-1-7-15-is-out-with-new-features-for-wiki-links-html-export-and-more)
- [Bear community: heading links on rename](https://community.bear.app/t/links-to-headers-arent-updated-on-header-rename/6836)
- [VS Code docs: Markdown](https://code.visualstudio.com/docs/languages/markdown)
- [glama: Obsidian MCP get_backlinks (third-party)](https://glama.ai/mcp/servers/getglad/obsidian_mcp/tools/get_backlinks)
- [docs.rs: obsidian-mcp graph.rs (third-party)](https://docs.rs/crate/obsidian-mcp/1.0.3/source/src/tools/graph.rs)

Parsers and standards:

- [CommonMark forum: MediaWiki and Gollum style page links](https://talk.commonmark.org/t/implict-mediawiki-gollum-style-page-links/830)
- [CommonMark forum: autolinking syntax](https://talk.commonmark.org/t/cmark-autolinking-syntax-vs/3397)
- [MD4C](https://github.com/mity/md4c)
- [Pandoc manual](https://pandoc.org/MANUAL.html) and [MANUAL.txt](https://raw.githubusercontent.com/jgm/pandoc/main/MANUAL.txt)
- [Python-Markdown WikiLinks](https://python-markdown.github.io/extensions/wikilinks)
- [Djot syntax](https://github.com/jgm/djot/blob/main/doc/syntax.md)
- [markdown-it source](https://github.com/markdown-it/markdown-it/blob/master/lib/index.mjs)
- [markdown-it-wikilinks 1.4.0 index.js](https://unpkg.com/markdown-it-wikilinks@1.4.0/index.js) and
  [package.json](https://unpkg.com/markdown-it-wikilinks@1.4.0/package.json)
- [npm registry search: markdown-it wikilink](https://registry.npmjs.org/-/v1/search?text=markdown-it%20wikilink&size=20)
