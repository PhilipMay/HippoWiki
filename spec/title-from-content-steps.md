# HippoWiki – Title from Content: Step Plan

Step plan for deriving the page title from the content (see `workflow.md`). The current page feature is described in
`pages.md`.

## Goal

The page title is stored twice today: in the `title` column, typed in the "Save page" dialog or the edit form, and as
the first heading of the Markdown content. Nothing keeps the two in step, and the page view shows both as top-level
headings.

After this plan, the content is the only source of the title:

- The content must start with a level-one heading (`# Title`). Its text is the page title.
- The title is derived again on every save and can never be entered or edited directly.
- The `title` column stays, because the page list, the browser tab and the delete dialog need it, but it is only ever
  written from the content.
- The page view no longer shows the stored title; the rendered heading of the content is the page's heading.

## Scope

In scope:

- The title rule:
  - After optional blank lines, the content must start with a level-one ATX heading: `#`, then a space or tab, then
    the text. Up to three leading spaces and an optional closing `#` sequence are allowed, as in CommonMark.
  - Nothing else counts: not a setext heading (`Title` underlined with `===`), not a `##` heading, and not a heading
    after any text, list, quote, code block, HTML or link reference definition.
- The title text:
  - The content is parsed as GitHub Flavored Markdown, as the page view renders it, and the heading is reduced to plain
    text: emphasis, strikethrough, code spans and links keep only their text, images their alt text, and raw HTML stays
    as typed text.
  - Runs of whitespace become a single space, and the text is trimmed.
  - A text longer than 200 characters is cut to 200 without splitting a surrogate pair.
- Refused content:
  - Content without a title is not saved: no title heading, or a heading whose text has no letter or digit (in any
    script), such as `#`, `# **` or `# ...`.
  - There is no fallback title. The error "Content must start with a title heading: # Title" is shown at the content
    field.
- Saving:
  - The title is derived on the server, in the create and update actions, on every save. The forms never submit a
    title, and a submitted `title` field is ignored.
  - The limits on content (100,000 characters) and slug are unchanged.
- `/pages/new`:
  - "Save" checks the content on the client with the same shared function. Without a valid title it shows the error at
    the content field and does not open the dialog.
  - The "Save page" dialog shows the derived title read-only and asks only for the slug, prefilled from the title as
    before. The slug no longer follows a title field, because the title cannot change in the dialog.
- `/pages/[slug]/edit`:
  - The title field is removed; the form has slug and content.
  - The slug never changes automatically, even when the heading changes.
- Page view `/pages/[slug]`:
  - The stored title is not rendered. "Last updated" and the "Edit" and "Delete" buttons stay above the content.
  - Markdown headings are drawn one size larger than now, because the content's `#` heading is now the visual top
    heading.
  - The browser tab and the delete dialog keep using the stored title.
- Data written outside the forms follows the rule: the seed and the e2e helper `createPage()` derive the title from the
  content.

Not in scope:

- No database migration and no change to the `Page` model. Existing pages keep their stored title until their next
  save; a page whose content does not start with a title heading can only be saved after one is added. The development
  database can be refreshed with `npm run db:reset` and `npm run db:seed`.
- No change to the slug rules, no automatic slug updates, no redirects from a previous slug.
- No setext headings and no front matter as title sources.
- No live display of the derived title while typing on the edit page.

## Checklist

1. [x] Title derivation
2. [x] Title from content on save
3. [ ] Page view without title
4. [ ] Spec update

## Step: Title derivation

### Goal

One pure function, shared by server and client code, that returns the title of a content or `null` when the content
has none.

### Build

- Add `mdast-util-from-markdown`, `mdast-util-gfm`, `micromark-extension-gfm` and `mdast-util-to-string` as direct
  dependencies in their latest versions. They are already installed as dependencies of `react-markdown`.
- Add `titleFromContent` to `src/features/pages/derive.ts`, a parser-based function that returns `string | null`:
  - Parse the content with GFM. Take the first child of the document; accept it only if it is a heading of depth 1
    whose source starts with `#`, which rules out setext headings.
  - Reduce the heading to plain text, collapse whitespace, trim, and cut it with the existing `truncate` helper.
  - Return `null` if the text is empty.
- `derive.ts` keeps no server-only imports. `derive.ts` and `schema.ts` must not import each other in a circle. If
  needed, move the length constants (`TITLE_MAX_LENGTH`, `SLUG_MAX_LENGTH`, `CONTENT_MAX_LENGTH`) into a small module
  such as `src/features/pages/limits.ts`.
- The forms are not changed in this step. The line-based `deriveTitle` and its tests stay until the next step replaces
  its last use, so the current behaviour stays intact.

### Test

- Unit tests in `src/features/pages/derive.test.ts` return the title for:
  - a plain `# Title`, after leading blank lines, with up to three leading spaces, with a closing sequence, and `# C#`
  - inline Markdown: emphasis, strikethrough, code spans, links and images give their text
  - raw HTML, which stays as typed text
  - whitespace inside the heading, which is collapsed
  - a heading longer than 200 characters, which is cut without splitting a surrogate pair
  - CRLF line breaks
- Unit tests return `null` for:
  - empty content and content of only blank lines
  - text, a list or a code block before the heading, including a `#` line inside a fenced code block
  - a `##` heading first, a setext heading, `#NoSpace`, an escaped `\# Title`, and `# Title` indented by four spaces
  - `#` alone and `# **`
- The existing e2e tests still pass.

## Step: Title from content on save

### Goal

The title is derived from the content on every save and cannot be entered anywhere.

### Build

- `src/features/pages/schema.ts`: the page input takes slug and content only and adds the derived title. Content
  without a title fails with the error at the `content` field. `parsePageFormData` ignores a submitted `title`.
- `src/features/pages/actions.ts`: `createPage` and `updatePage` store the derived title.
- `src/features/pages/derive.ts`: remove the line-based `deriveTitle` and its tests; `titleFromContent` replaces it.
- `src/features/pages/components/NewPageForm.tsx`:
  - "Save" derives the title; without one it shows the error at the content field and does not open the dialog.
  - The dialog shows the title as a read-only field "Title" that is not submitted, and an editable "Slug" prefilled
    from the title. The "slug follows the title" logic is removed.
  - Content errors from the server are still shown in the open dialog.
- `src/features/pages/components/PageForm.tsx` and `src/app/pages/[slug]/edit/page.tsx`: the title field is removed;
  the initial values are slug and content.
- `prisma/seed.ts`: the titles are derived from the content.
- `e2e/support/database.ts`: `createPage()` derives the title from the content. The content defaults to `# <title>`
  when only a title is given, so existing calls such as `createPage({ title: "Older page" })` keep working. A test can
  still set a title explicitly, to set up a page that was stored before this change.
- `prisma/schema.prisma`: the comment on `title` says it is derived from the content's first heading. No migration.

### Test

- Unit tests in `src/features/pages/schema.test.ts`: the title is derived from the content, a submitted title is
  ignored, content without a title heading is refused with the message at `content`, and the content limit and the
  slug rules still apply.
- End-to-end tests:
  - Creating a page from `# Getting started` stores the title "Getting started" and the slug `getting-started`.
  - Text or a `##` heading before the `#` heading shows the error at the content field, opens no dialog and creates
    nothing.
  - The dialog shows the title read-only and has no editable title field.
  - A heading with inline Markdown gives a plain title in the list and the browser tab.
  - Changing the heading on the edit page changes the stored title and the list entry, but not the slug.
  - Removing the heading on the edit page shows the error at the content field and keeps all entered values.
  - A form submission with an extra `title` field stores the derived title.
- Existing tests that type into a "Title" field are rewritten (`e2e/create-page.spec.ts`,
  `e2e/edit-delete-page.spec.ts`).

## Step: Page view without title

### Goal

The page view shows the content's heading once and does not repeat the stored title.

### Build

- `src/app/pages/[slug]/page.tsx`: remove the title heading. Keep "Last updated" and the "Edit" and "Delete" buttons
  above the divider and the content.
- `src/features/pages/components/MarkdownContent.tsx`: draw each heading level one size larger (a Markdown `h1` takes
  the size the page title had) and update the comment that explains the sizes.
- The browser tab (`generateMetadata`) and the delete dialog keep using the stored title.

### Test

- End-to-end tests:
  - The page view has exactly one level-one heading, the one from the content.
  - The browser tab still shows the title.
  - "Last updated", "Edit" and "Delete" still work.
- Existing tests that expect the title as a separate heading on the page view are adapted
  (`e2e/pages.spec.ts`, `e2e/create-page.spec.ts`, `e2e/edit-delete-page.spec.ts`).

## Step: Spec update

### Goal

The lasting content of this plan is in the spec files, and the step file is gone.

### Build

- `spec/pages.md`: update the model, the input rules, "Derived title and slug", the routes and the limits to the
  built behaviour.
- `spec/architecture.md`, `spec/tech.md` and `README.md`: update them if this plan changed anything they describe,
  such as the Markdown libraries or a new module.
- Delete this file and remove it from the spec catalog in `CLAUDE.md`.

### Test

- The spec files describe the built behaviour, and none of them refers to this step file.
- `npm run check` passes.
