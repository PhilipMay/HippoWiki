# HippoWiki – Content Structure

A top-level description of how content is organised into folders, tabs and pages. It describes the intended behaviour
in plain words and is not yet a spec: data model, routes and limits follow in a step plan (see `workflow.md`). Today's
flat page list is described in `pages.md`.

## Overview

Content has three levels:

- **Folder**: the top level. A folder groups related content, such as one project, team or topic. Folders are also
  the unit that access rights will later be attached to.
- **Tab**: a section inside a folder. Tabs divide a folder into parts, such as "guides", "meetings" or "archive".
- **Page**: a Markdown document. Every page lives in exactly one tab, and so in exactly one folder.

There is no deeper nesting: no folders inside folders and no tabs inside tabs. The fixed depth keeps navigation,
addresses and rights simple.

## The Default Tab

- Every folder always has exactly one default tab. It is created together with the folder.
- The default tab has no name of its own (the empty name). It is the place for pages that need no further grouping, so
  a small folder works without anyone creating a tab.
- A page created without choosing a tab goes into the default tab.
- The default tab can not be renamed or deleted, and a folder can never be without it.
- Other tabs are optional and are added when a folder grows.

## Names

- Folders, tabs (except the default tab) and pages each have a name, which is also the part of their address (for a page
  followed by `.md`, see Addresses).
- A name is required and uses lowercase ASCII words joined by single hyphens, such as `release-notes`, the same rule as
  today's page slug, with a fixed maximum length.
- Names are unique only where they meet:
  - folder names are unique across the wiki
  - tab names are unique within their folder
  - page names are unique within their tab, so two tabs of one folder may each have a page `overview`
- Uniqueness applies to live items only. The name of a deleted item can be used again.
- The page title stays as today: it comes from the page's leading `# Title` heading and is separate from the name.

## Addresses

- A page is found by its folder, tab and name. Its address ends with `.md`, because a page is a Markdown document:
  `/<folder>/<tab>/<page>.md`.
- A page in the default tab has the shorter address `/<folder>/<page>.md`, because the default tab has no name.
- The `.md` belongs to the address only, not to the name. Names never contain a dot, so the suffix tells a page from a
  tab: `/<folder>/guides` is the tab `guides`, `/<folder>/guides.md` is the page `guides` in the default tab.
- A folder address `/<folder>` shows the folder with its tabs, opening on the default tab; a tab address
  `/<folder>/<tab>` shows the pages of that tab.

## Changing the Structure

- Folders, tabs and pages can be renamed; the default tab can not.
- A page can be moved to another tab of the same folder. Moving a page to another folder is not part of this feature.
- Tabs can not be moved to another folder.
- A rename or move changes the address; there are no redirects from the old address, as today.

## Lists and Order

- Folders, tabs and pages are listed by name, in a fixed order.
- A folder can list the pages of one tab, or all its pages across its tabs, each showing its tab.
- Lists show names and metadata only, never page content.

## Limits

- A page's content has a fixed maximum size, checked when it is created or edited. Renaming, moving and restoring do
  not check it, so a limit lowered later never blocks recovery.
- Names have a fixed maximum length.

## Related Features, Not Part of This One

These build on the structure and come with their own features (see `roadmap.md`):

- Rights per folder (`read`, `write`, `manage`): who may see a folder, edit its pages, and rename, move, delete or
  restore items. Until rights exist, every user may do everything.
- History and revert: a revision history per page and a change history per folder, with revert of a page or of a whole
  folder.
- Links between pages, backlinks and broken links, which need an address format; the addresses above are the basis.
- Search across folders.
- concurrent changes and locking
- Deleting and Restoring
