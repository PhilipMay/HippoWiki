# HippoWiki – Page Slugs and Content-First Creation: Step Plan

## Goal

Every page has a unique, URL-safe slug and is reached at `/pages/<slug>`. A new page is written first: `/pages/new`
shows only the Markdown editor, and "Save" asks for title and slug, prefilled from the first heading. Editing a page
offers title, slug and content together.

## Scope

In:

- `slug` column on `Page`, unique, with a migration that gives existing pages a slug
- slug rules: matches `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 80 characters, `new` is reserved
- deriving a title from the first Markdown heading and a slug from a title
- routes `/pages/[slug]` and `/pages/[slug]/edit` instead of `/pages/[id]`
- content-first `/pages/new` with a save dialog for title and slug
- title, slug and content on the edit page

Not in:

- redirects from old UUID URLs or from previous slugs after a rename (they show the not-found page)
- unique titles; `[[wiki links]]`
- stripping inline Markdown (`**bold**`, links) from a derived title; setext headings (`===`, `---`)
- automatic suffixes such as `-2` for taken slugs; the user picks another slug
- changing the slug automatically on the edit page

## Steps

- [x] Slug derivation
- [x] Slug column and edit form
- [x] Slug routes
- [ ] Content-first creation

## Slug derivation

### Goal

Pure helpers that derive a title from Markdown and a slug from a title, and a schema that validates slugs.

### Build

- `src/features/pages/derive.ts` (no server-only imports, it is used by Client Components):
  - `deriveTitle(markdown)`: the text of the first ATX heading of any level (`#` to `######`, up to three leading
    spaces), ignoring lines inside fenced code blocks (` ``` ` and `~~~`); an optional closing `#` sequence is
    removed, the result is trimmed and cut to `TITLE_MAX_LENGTH`. No heading → `""`.
  - `deriveSlug(title)`: replace ä/ö/ü/Ä/Ö/Ü/ß with ae/oe/ue/Ae/Oe/Ue/ss, normalize to NFKD and drop combining marks,
    lowercase, replace every run of characters other than `a-z0-9` with `-`, trim `-` at both ends. If longer than
    `SLUG_MAX_LENGTH` (80), cut at the last `-` within the limit (hard cut if there is none) and trim `-` again.
    Nothing left → `""`.
- `src/features/pages/schema.ts`:
  - `SLUG_MAX_LENGTH = 80`, `SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/`, `RESERVED_SLUGS = ["new"]` (`/pages/new` is a
    route).
  - `slugSchema`: trimmed, required ("Slug is required"), at most 80 characters, matches the pattern ("Use lowercase
    letters, digits and single hyphens"), not reserved ("This slug is reserved").
  - `parsePageSlug(slug)`: the slug if valid, otherwise `null` (like `parsePageId`).

### Test

- Unit tests in `derive.test.ts` and `schema.test.ts`:
  - `deriveTitle`: `# Title`, `### Title ###`, heading after a paragraph, heading inside a code fence is skipped,
    `#NoSpace` is not a heading, no heading → `""`, a long heading is cut to 200 characters.
  - `deriveSlug`: `"Übersicht Größen"` → `uebersicht-groessen`, `"Café & Crème"` → `cafe-creme`,
    `"  --Hello,   World!--  "` → `hello-world`, `"日本語"` → `""`, a 120-character title gives at most 80 characters
    ending without `-` and cut at a word boundary; every non-empty result matches `SLUG_PATTERN`.
  - `slugSchema`: accepts `a`, `a-1`, an 80-character slug; rejects `""`, `A`, `a--b`, `-a`, `a-`, `a_b`, 81
    characters, `new`.

## Slug column and edit form

### Goal

Pages store a unique slug, and the page form (still used for new and edit pages) edits title, slug and content.

### Build

- `prisma/schema.prisma`: `slug String @unique` on `Page`. Migration `add-page-slug` created with `--create-only` and
  edited so it works on existing data: add the column as nullable, fill it with SQL that approximates `deriveSlug`
  (umlaut replacement, `lower`, `regexp_replace` of non `[a-z0-9]` runs with `-`, trim `-`, cut to 80), give empty,
  reserved and duplicate results the suffix `-` plus the first 8 characters of the id (or use that id prefix alone),
  then set `NOT NULL` and add the unique index.
- `pageInputSchema` and `parsePageFormData` include `slug` (using `slugSchema`).
- `createPage` and `updatePage`: a unique violation on `slug` (Prisma error code `P2002`) returns the field error
  "Slug is already in use" instead of the generic save error; it is logged as a warning.
- `PageForm`: a "Slug" field between title and content, with helper text showing the address `/pages/<slug>`; field
  errors at the field. The slug does not follow the title here.
- `prisma/seed.ts`: fixed slugs for the sample pages. `e2e/support/database.ts`: `createPage()` sets a unique default
  slug (overridable).
- Routes stay on `/pages/[id]` in this step.

### Test

- Migration applied to a development database that has pages: every page has a valid, unique slug.
- e2e: creating a page with title, slug and content stores the slug; editing changes title, slug and content; a taken
  slug shows "Slug is already in use" at the slug field and keeps all entered values; an invalid and the reserved slug
  show their errors; an empty slug shows "Slug is required".

## Slug routes

### Goal

Pages are reached by slug.

### Build

- Move `src/app/pages/[id]/` to `src/app/pages/[slug]/` (view and edit).
- `queries.ts`: `getPageBySlug(slug)`, wrapped in `cache()`, returns `null` for malformed slugs without querying;
  `listPages()` also selects `slug`. Remove `getPage` if nothing uses it any more.
- `PageList`, the "Edit" button and the edit page's "Cancel" link use the slug.
- Actions keep working with the bound id. `createPage` and `updatePage` redirect to `/pages/<slug>` with the stored
  slug; after an update, revalidation covers the list, the old and the new slug route (e.g.
  `revalidatePath("/pages", "layout")`). `deletePage` stays id-based.

### Test

- e2e: list links, view and edit URLs use the slug; changing the slug on the edit page redirects to the new address and
  the old address shows the not-found page; an unknown or malformed slug (`/pages/Bad_Slug`) and an old UUID address
  show the not-found page; delete still works from the slug URL.

## Content-first creation

### Goal

`/pages/new` asks only for Markdown; title and slug are confirmed in a dialog when saving.

### Build

- New Client Component `src/features/pages/components/NewPageForm.tsx` used by `/pages/new` (the edit page keeps
  `PageForm`):
  - the Markdown textarea ("Content"), "Save" and "Cancel" (back to `/pages`); no title field.
  - "Save" opens an MUI `Dialog` "Save page". Each time it opens, "Title" is set to `deriveTitle(content)` and "Slug"
    to `deriveSlug(title)`. Typing in the title re-derives the slug until the user edits the slug field; from then on
    the slug stays as typed.
  - The dialog holds the form that calls `createPage` with title, slug and the content (hidden field), so that it works
    although the dialog renders in a portal. Dialog buttons: "Save" (submit, "Saving…" while pending) and "Cancel"
    (closes the dialog, content kept).
  - Field errors for title and slug are shown at the dialog fields and the dialog stays open; a content error or a
    general message is shown as an alert in the dialog. Entered values are kept.
  - Without a heading, title and slug start empty and must be entered.

### Test

- e2e:
  - `/pages/new` shows no title field; content with `## Getting started` as first heading → dialog prefilled with
    "Getting started" and `getting-started`; saving shows the page at `/pages/getting-started`.
  - a heading inside a code block is ignored; no heading → empty fields, saving shows "Title is required" and "Slug is
    required".
  - changing the title updates the slug; after editing the slug by hand, changing the title leaves it.
  - a taken slug shows "Slug is already in use" in the open dialog; "Cancel" in the dialog keeps the content and
    creates nothing; "Cancel" on the form returns to `/pages`.
  - an umlaut title ("Über Größen") gives `ueber-groessen`.

## When done

- `pages.md`: model (`slug`), input rules (slug rules, reserved `new`, derivation), routes (`/pages/[slug]`,
  content-first `/pages/new` with dialog).
- `architecture.md`: slugs parsed with `parsePageSlug` before they reach the database; `derive.ts` in the feature
  layout.
- `roadmap.md`: replace "unique titles or slugs and `[[wiki links]]`" with "`[[wiki links]]`".
- Delete this file and its line in the `CLAUDE.md` catalog.
