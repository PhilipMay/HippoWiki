# HippoWiki – Optimistic Locking

Optimistic locking for pages as built: two users who change the same page at the same time no longer overwrite each
other without noticing. A content save, move, rename or delete of a page that is based on an older state of the page
than the one stored is refused; the editor or dialog is shown again with the page as stored and a message that names
who changed it last and when. The rule lives in the page service, so that every caller follows it. Pages are
described in `pages.md`, moving and renaming in `content-structure.md`, deleting and restoring in `page-deletion.md`.

Code: the version of a page in `Page` of `prisma/schema.prisma` and the migration
`prisma/migrations/20261116103037_init/`, the check in `updatePageContent`, `moveOrRenamePage` and
`deletePage` of `src/features/pages/service.ts`, the version of a form in `src/features/pages/forms.ts`, the notice of
a page address in `src/lib/addresses.ts` and `src/features/pages/components/PageView.tsx`, the editor and the dialogs
in `src/features/pages/components/`. Tests: `integration/page-service.test.ts`, the unit tests next to the code
(`src/features/pages/service.test.ts`, `src/features/pages/forms.test.ts`, `src/features/pages/actions.test.ts`,
`src/features/pages/schema.test.ts`, `src/lib/addresses.test.ts`), `e2e/edit-page.spec.ts`,
`e2e/move-or-rename-page.spec.ts`, `e2e/delete-page.spec.ts`, `e2e/restore-page.spec.ts`.

## The version of a page

- Every page has a version: 1 when it is created, counted up by one by every stored change of the page: a content
  save, a move or rename, a delete and a restore. It changes in the same write as the time of the last change and the
  last editor (see "Last editor" in `content-structure.md`), and a write that fails changes none of them.
- Pages stored before the version existed have the version 1.
- Renaming a folder or a tab, and every change inside a folder or tab, is no change of its pages and leaves their
  versions as they are.

## Which changes are refused

- A content save, a move or rename and a delete state the version of the page they are based on: the one the page had
  when the editor or dialog was opened. If the stored page has another version, the change is refused and nothing is
  stored.
- Every stored change counts, whatever kind of change is being made: a rename refuses a content save opened before it,
  a content save refuses a move or delete opened before it.
- A change that the same user stored in another browser tab counts like one by another user.
- A change of a page that was deleted after the editor or dialog was opened is refused as before, with the message
  that the page no longer exists, whatever its version.
- A change that states no valid version is refused like one based on an older state.
- A move to a name that is taken at the target, based on an older state, is refused as changed, not as a taken name.
- The role is checked before the version, so a refusal tells nothing to a user without the role for the change.
- A change that nobody overtook works as before.

## What the browser shows

- After a refused change the editor or dialog of the change is shown again at the page's current address, which is a
  new one when the page was moved or renamed in the meantime, with the search parameter `notice=changed` next to its
  action (see "Actions and views" in `content-structure.md`).
- It shows the page as stored: the editor its current content, the "Move or rename page" dialog its current name and
  place, the "Delete page" dialog its current name. What the user entered is not kept.
- Above its fields a message names the user who last changed the page and the time of that change, as the page view
  shows them.
- Saving or confirming again succeeds, unless the page was changed once more.
- A notice is allowed only on a page address together with one of its actions. A notice without an action, an
  unknown, empty or repeated notice shows the not-found page.

## Callers other than the browser

- The rule does not depend on the browser. Every caller of the page service states, with every content save, move,
  rename and delete, the version of the page its change is based on, and is refused in the same cases; a change
  without a version is refused and changes nothing.
- The MCP write tools follow the rule unchanged (see `mcp.md`): `read_page` gives the version of a page, and
  `replace_page_content` and `move_or_rename_page` state it. A change based on an older version, or on none, is
  refused with a tool error that names who changed the page last and when and tells the agent to read the page again;
  nothing is changed.

## Restoring

- Restoring a deleted page is not checked against a change in the meantime and states no version. It counts the
  version up like every write. Of two restores of the same page at once, the second finds the page no longer deleted
  and shows that it no longer exists among the deleted pages, as before.

## Editors and dialogs open over a deployment

- An editor or dialog that was opened before this feature was deployed submits no version. Its next change is refused
  once and shows the current page with the message; the change after that succeeds.

## Decisions

- The feature protected the browser first and set the rule for the MCP write tools, which then needed no rule of
  their own. Rejected: protecting only the browser and leaving the rule for MCP to its own feature.
- Every change of a page is checked, delete included, not only content saves: a move, rename or delete should not
  happen to a page whose latest change the user has not seen. Rejected: checking only content saves, or content saves
  with moves and renames.
- Any stored change of the page counts, not only the kind of change being made: the rule is "the page is as you saw
  it, or your change is refused". Rejected: only content saves counting, which would make the rule differ per change.
- The user's own changes in another tab count like those of another user, so that one tab never overwrites the other
  silently. Rejected: refusing only changes of other users.
- After a refused content save the editor is loaded again with the current content and the user's text is dropped.
  Rejected: keeping the user's text with a message and a link to the current page, and keeping it with the current
  content shown below the editor for comparison.
- A refused move, rename or delete reloads its dialog, like the editor. Rejected: closing the dialog and showing the
  page with a message.
- The message names the last editor and the time, which the page already shows to everyone who may change it.
  Rejected: a message that says nothing about who or when.
- The state of a page is an integer version, not the time of the last change: that time comes from the clock of the
  app, which can jump back or differ between instances, and an exact time is more fragile to send back through a form
  field or an MCP call and compare than an integer. Rejected: comparing the time of the last change, which would have
  needed no column of its own.
- The check is part of the write itself, so that no change can slip in between a check and the write.
- A refused change redirects to the page's address as stored, with its action and the notice, for every case alike,
  also when the address has changed. Rejected: returning the current page in the form state without a redirect,
  because the address can have changed and a second path for the same refusal would differ from the first; a cookie
  for the notice, which is more code for a message that may show again on a reload.
- A caller other than the browser must always state the version, so that an AI assistant cannot skip the check and
  overwrite a page it read minutes ago. Rejected: an optional version, with "the last save wins" without it.
- A browser change without a version is refused as well, so that one rule holds for every caller. It costs a user at
  most one reload for an editor or dialog left open over the deployment. Rejected: accepting it as before, which would
  weaken the rule for the browser for good or need a later change to remove the exception; accepting it for one
  release only.
- Restoring is not checked: nothing changes a deleted page, and two restores at once are already told apart. Rejected:
  checking restore as well, for the very rare delete, restore and delete again while the dialog is open.
- Folders and tabs are left out: a rename changes only a name, and a taken name is already refused. Creating a page is
  left out for the same reason.

## Current limits

- Folders and tabs keep "the last save wins": two renames of the same folder or tab at once are not told apart.
- No merging of two changes: a refused change has to be made again on the current page.
- No history of a page, so the change that overtook the user's cannot be compared with it.
- No display of who else is editing a page right now.
