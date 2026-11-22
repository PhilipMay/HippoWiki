# HippoWiki – Report of the Explorative Test of the Web Application

## Summary

- Verdict: no Blocker. The app holds together well: rights are enforced on the server, rendered Markdown is safe, wiki
  links follow every move and rename, and OAuth and MCP behave as an AI app expects. The two Major findings both lose
  text that a user typed in the editor. Most other findings are about forms and dialogs that give stale or missing
  feedback, and about layout on narrow screens.
- Findings: 25 in all, 0 Blocker, 2 Major, 10 Minor and 13 Nit (`issue:` 12, `suggestion:` 1, `nit:` 12), plus 6
  questions. Of the 25 Suggestions, 0 are High, 17 Medium and 8 Low.
- To fix first: the two Major findings, "browser Back leaves the editor without asking" and "saving over a newer
  version throws away the own changes".
- Not covered: see "Not covered" at the end.

## Scope and method

- Explorative test of the web application as a user sees it, without reading the specs or the code before the test.
  Only `issue-report.md` (for this format) and, after the test, `manual-check-report.md` (to drop duplicates; none
  were found) were read.
- Date: 2026-11-22. The code is the state of the branch `main` after the commit `add the report of the manual checks`.
- The app ran as a production build (`next build` into its own build directory, `next start` on port 3100) against a
  throwaway PostgreSQL container on port 5433, migrated, with the admin created by the admin setup. The server had
  `HIPPOWIKI_PUBLIC_URL=http://localhost:3100` and a files directory of its own.
- The browser was the Chromium of the Claude desktop app at 1024 × 768, with the mobile preset 375 × 812 for the
  layout of a phone. A second user worked in parallel through `http://127.0.0.1:3100`, which keeps its own cookies.
- Users: `admin`, `alice` (Owner of the folder `team-wiki`) and `bob` (Reader, then Writer, then without a role).
  OAuth and MCP were driven with `curl` and a test client registered through `/oauth/register`.

## Findings

#### issue: browser Back leaves the editor without asking and loses the unsaved changes

- Location: page editor, `/folders/<folder>/<page>.md?action=edit`; the "Discard changes?" dialog
- Severity: Major. Text typed by the user is lost without a warning.
- Category: correctness
- Problem: a click on a link, such as "Folders" in the header, opens "Discard changes? The changes to the content are
  not saved and will be lost." The Back button of the browser does not: the page view opens at once and the changes
  are gone. Forward opens the editor again with the stored content.
- Impact: every user who leaves the editor with Back, or with a Back gesture of a mouse or a trackpad, loses the edit
  without being asked, while the app suggests elsewhere that it guards against this.
- Evidence: open a page, click "Edit", type " Edited once." at the end of a line, press Back: the page view shows the
  old text. The same happened when the editor was opened by typing its address.
- Suggestion (required): ask the same "Discard changes?" question when the history entry changes while the editor
  has unsaved changes, and set a `beforeunload` handler for leaving the app or reloading.
- Confidence: Medium. How the router of Next.js lets a popstate be held up was not tried, and a `beforeunload`
  dialog can only show the browser's own text.
- Alternatives: keep a draft per page in `sessionStorage` and offer it when the editor opens again, which also
  covers a closed tab, at the cost of a stale draft that has to be dismissed.

#### issue: saving over a newer version throws away the own changes

- Location: page editor, saving after someone else saved the same page; the notice "This page was changed by … after
  you opened it."
- Severity: Major. The change is detected, but the text of the user who saves second is lost.
- Category: correctness
- Problem: when the page was saved in between, Save reloads the editor with the newer content and shows the notice.
  The text typed in this editor is replaced: it is neither kept, nor shown next to the newer version, nor reachable
  with undo.
- Impact: two people editing the same page, or one person in two tabs, lose the work of whoever saves second. The
  notice suggests a merge, but there is nothing left to merge.
- Evidence: open the same page in the editor in tabs A and B. Type " Edit from tab B." in B and save. Type " Edit from
  tab A." in A and save: A shows the notice and the content with "Edit from tab B." only; Cmd+Z and Ctrl+Z bring
  nothing back.
- Suggestion (required): keep the user's text in the editor and show the newer version beside it, or a diff of both,
  so that the user can merge and save again; the notice then says that the own text is still there.
- Confidence: Low. How to show both versions is a design decision.
- Alternatives: show the user's text read-only below the notice, with "Copy", which is simpler but leaves the merge
  to the user.

#### issue: a long word in a page widens the whole page

- Location: page view, `/folders/<folder>/<page>.md`; also the layout of a phone
- Severity: Minor
- Category: correctness
- Problem: a word without spaces, such as a long identifier or path, is not wrapped. It runs out of the content card
  and the whole document gets a horizontal scrollbar. The editor wraps the same line.
- Impact: a page with a long address or identifier is hard to read; on a phone the page scrolls sideways.
- Evidence: a line `A_very_long_word_without_spaces_` followed by 100 × `A`: at 1024 px wide,
  `document.documentElement.scrollWidth` is 1457; at 375 px it is 1371.
- Suggestion (required): let the rendered content wrap long words, for example `overflow-wrap: anywhere` on the
  content, and let tables and code blocks scroll inside their own box.
- Confidence: Medium. The effect on tables and code blocks was not tried.

#### issue: standard Markdown images and remote images break without a hint

- Location: page view and editor; images in the content
- Severity: Minor
- Category: correctness
- Problem: only `![[wide-banner.png]]` shows the uploaded image. `![alt text](wide-banner.png)` and
  `![x](/folders/team-wiki/wide-banner.png)` render as broken images, because they point to the file page and not to
  the file. `![remote](https://example.com/x.png)` renders as a broken image, because the Content Security Policy
  allows images only from the wiki itself. The live preview shows all three as plain source, so the author does not
  notice until the page is saved.
- Impact: users who know Markdown from elsewhere, or paste content from other tools, get broken images and no
  explanation.
- Evidence: a page with these lines after uploading `wide-banner.png` (1600 × 400) to the folder: in the page view the
  `<img>` of the three standard images have `naturalWidth` 0, the one of `![[wide-banner.png]]` 1600.
- Suggestion (required): render a standard image whose target is a file of the folder like `![[...]]`, and show a
  remote image as a link with a short note instead of a broken image; mark both in the live preview.
- Confidence: Low. Whether standard image syntax should resolve files of the folder is a product decision.
- Alternatives: keep the syntax as it is and only show a hint in the editor that files of the folder are embedded
  with `![[file]]` and that images from other sites are not shown.

#### issue: error messages of forms stay after the input was corrected

- Location: "New page" ("Content must start with a title heading: # Title"); "Move or rename page" ("Name is already
  in use"); "Restore page" ("Choose a place")
- Severity: Minor
- Category: error handling
- Problem: the red frame and the message stay until the next submit, also after the input was fixed. In "Move or
  rename page", "Name is already in use" was still shown under a free name while Save went through. The upload dialog
  clears its message when a new file is chosen, so the forms disagree.
- Impact: users read an error that no longer applies and may think the form is still wrong.
- Evidence: in "Move or rename page", type the name of an existing page and press Enter, then type a free name and
  pick another place: the message stays until Save.
- Suggestion (required): clear the message of a field when the field changes, as the upload dialog does.
- Confidence: Medium. All forms with this behaviour were not listed one by one.

#### issue: removing another user's role takes one click, and changing a role gives no feedback

- Location: folder roles, `/folders/<folder>?view=roles`
- Severity: Minor
- Category: correctness
- Problem: "Remove" for another user takes the role away at once. "Remove" for oneself asks "Remove your own role on
  this folder?" first. A new role picked in the select is saved at once without any message.
- Impact: a slip of the mouse locks a colleague out of a folder, and nothing on the page tells the owner what
  happened. Whether a role change was saved is only seen after a reload.
- Evidence: as `alice`, Owner, click "Remove" next to `bob`: the row is gone without a question.
- Suggestion (required): ask before removing any role, naming the user, and show a short confirmation after a role
  was changed.
- Confidence: Medium. A change users see.

#### issue: the header does not fit on a phone

- Location: header of every page at 375 px wide
- Severity: Minor
- Category: style
- Problem: "Folders" and "Users" stack on two lines, the user name sits in between, and "Log out" breaks into
  "LOG" and "OUT". The header takes about 70 px of the height. The editor toolbar also wraps into two rows.
- Impact: on a phone the app looks broken and the header uses much of the screen.
- Evidence: mobile preset 375 × 812 on `/folders/team-wiki`.
- Suggestion (required): put the links and the account into a menu below a breakpoint, and keep "Log out" on one
  line.
- Confidence: Medium. A change users see.

#### issue: search finds nothing for some words that are in a page

- Location: folder search, `/folders/<folder>?view=search&q=…`
- Severity: Minor
- Category: correctness
- Problem: `very` answers "No pages or files in this folder match very", although a page contains "a very very very
  … long cell". `<script>` finds nothing, while `script` finds the page with `<script>` in its text. `a` finds only one
  of the pages that contain the word "a".
- Impact: users who search for a word they can see in a page get "no match" and stop trusting the search.
- Evidence: the three queries above against the folder `team-wiki` of this test.
- Suggestion (required): when every word of a query is dropped as a common word, say so instead of "no match", and
  strip punctuation from the query as from the text.
- Confidence: Low. Why `very` and `a` behave this way was not looked up; it looks like a stop-word list of the full
  text search.

#### issue: a word with umlauts finds fewer pages than the same word without

- Location: folder search; the names that are proposed from a title
- Severity: Minor
- Category: correctness
- Problem: a title "Ünïcode Café …" gets the proposed name `uenicode-cafe-co-test`, so "Ü" becomes "ue". The search
  for `unicode` finds three pages, the one with the title and two that carry the name; the search for `Ünïcode` or
  `ünïcode` finds only the page with the title.
- Impact: in German content, searching with the umlaut misses the pages that only carry the word in their name or in
  a wiki link.
- Evidence: the queries `unicode`, `uenicode` and `Ünïcode` on the folder `team-wiki` of this test.
- Suggestion (optional): fold umlauts in the query the same way as in names, or search both spellings.
- Confidence: Low. Which folding is wanted for names and for search is a decision.

#### issue: "Back to folders" on the not-found page leads the admin to another not-found page

- Location: the not-found page as `admin`
- Severity: Minor
- Category: correctness
- Problem: the admin has no folders, and `/folders` is a not-found page for the admin. The not-found page offers only
  "Back to folders", which opens the same page again.
- Impact: an admin who mistypes an address only gets out through the header.
- Evidence: as `admin`, open `/does-not-exist` and click "Back to folders".
- Suggestion (required): for the admin, point the button to "Users".
- Confidence: Medium. The text of the button for the admin is a choice.

#### issue: "Give role" leaves the Roles page

- Location: "Give role" on `/folders/<folder>?view=roles`
- Severity: Minor
- Category: correctness
- Problem: the dialog opens at `/folders/<folder>?action=give-role`, on top of the folder overview, not of the Roles
  list. Cancel and Save both end on the folder overview.
- Impact: an owner who gives several roles has to open the Roles page again after each one and does not see the new
  role in the list.
- Evidence: on the Roles page, click "Give role", then Cancel.
- Suggestion (required): open the dialog on top of the Roles list and return there.
- Confidence: Medium. A change users see.

#### issue: losing access while editing shows "Page not found" and loses the edit

- Location: page editor, saving after the own role was removed
- Severity: Minor. Rare, and refusing the save is right.
- Category: error handling
- Problem: `bob`, Writer, edits a page; `alice` removes his role; `bob` saves. He gets the generic "Page not found"
  page, and his text is gone.
- Impact: the user does not learn that the access was taken away, and loses the text.
- Evidence: the steps above with two browsers.
- Suggestion (optional): keep the editor and show "You can no longer change this page", so that the text can be
  copied.
- Confidence: Low. Whether a refused save may reveal more than "not found" is a security decision.

#### suggestion: the only owner can start to remove their own role

- Location: folder roles, the row of the only Owner
- Severity: Nit
- Category: error handling
- Problem: "Remove" and the select are active for the only Owner. "Remove" asks "Remove your own role on this folder?
  You will no longer see the folder." and only after confirming answers "A folder needs at least one Owner, so the role
  of its last Owner stays."
- Impact: the dialog warns of something that cannot happen.
- Evidence: as `alice`, the only Owner, click "Remove" in her own row.
- Suggestion (optional): disable "Remove" for the last Owner, with the reason as a tooltip.
- Confidence: Medium. A change users see.

#### nit: not-found pages carry the title of the page that was asked for

- Location: the not-found page
- Severity: Nit
- Category: style
- Problem: the server sends the title "HippoWiki"; after loading, the tab title becomes "Folders – HippoWiki",
  "Folder roles – HippoWiki" or "Users – HippoWiki", depending on the address.
- Impact: the browser history and the tab show a not-found page as a real page.
- Evidence: as `alice`, open `/folder-roles`.
- Suggestion (optional): keep "Page not found – HippoWiki" as the title.
- Confidence: Medium. Where the title is set was not looked up.

#### nit: the history says "revisions 3 to 1 of 3"

- Location: page history, `?view=history`
- Severity: Nit
- Category: style
- Problem: "History: revisions 3 to 1 of 3" reads like a range that runs backwards.
- Impact: none beyond reading.
- Evidence: the history of a page with 3 revisions.
- Suggestion (optional): "3 revisions" or "Revisions 1 to 3 of 3, newest first".
- Confidence: Medium. Wording.

#### nit: "Compare with revision" allows only older revisions and answers with the browser's message

- Location: a revision of a page, "Compare with revision"
- Severity: Nit
- Category: style
- Problem: on revision 2 of 3, a 3 or 99 gets the browser's own message "Value must be 1."; revision 1 has no compare
  at all, and the current page has none either.
- Impact: a user who wants to see what the latest change did must first open the previous revision.
- Evidence: revision 2 of the page `uenicode-cafe-co-test` of this test, type 99, click "Compare".
- Suggestion (optional): allow any other revision, or offer "Compare with the previous revision" on each revision and
  on the current page.
- Confidence: Low. Which comparisons are offered is a design decision.

#### nit: the notice of a newer version names the user who is reading it

- Location: page editor, the notice after a save over a newer version
- Severity: Nit
- Category: style
- Problem: "This page was changed by alice via web …" is shown to `alice` herself, who saved in another tab.
- Impact: a short moment of confusion.
- Evidence: the steps of "saving over a newer version throws away the own changes".
- Suggestion (optional): "by you" when the other change is by the same user.
- Confidence: Medium. Wording.

#### nit: "Restore page" selects no place when the old one is taken

- Location: "Restore page" of a deleted page whose name is taken again
- Severity: Nit
- Category: style
- Problem: no place is selected, "Address:" is missing until one is picked, and the dialog then grows, so that "Save"
  moves away from under the pointer.
- Impact: a click on "Save" right after picking a place can miss.
- Evidence: delete a page, create a new page with its name, then restore the deleted one.
- Suggestion (optional): select the old place and show "Name is already in use" right away, with the address line
  always present.
- Confidence: Medium. A change users see.

#### nit: the page behind a dialog jumps up

- Location: dialogs opened through `?action=…`, such as "Revert page", "Rename tab", "Delete page"
- Severity: Nit
- Category: style
- Problem: the search box of the folder disappears behind the dialog, and the page moves up by about 45 px.
- Impact: a visible jump each time a dialog opens.
- Evidence: open a revision and click "Revert": the breadcrumbs move from y 127 to y 84.
- Suggestion (optional): keep the search box while the dialog is open.
- Confidence: Medium. Why it is removed was not looked up.

#### nit: the same things are named differently

- Location: dialogs and addresses
- Severity: Nit
- Category: style
- Problem:
  - The button of "New user" is "Create", the button of "New folder" is "Save".
  - Users are created at `?action=create`, folders, pages and tabs at `?action=new` and `?action=new-tab`.
  - "Deleted items" lists `uenicode-cafe-co-test`; every other list shows the name with `.md` at the end.
  - The hint of a user name says "3 to 30 characters"; the hint of a folder name says no length, and the field stops
    at 80 characters without a message.
  - A tab is listed with a folder icon, inside a folder.
- Impact: small inconsistencies that make the app feel less finished.
- Evidence: the dialogs and lists named above.
- Suggestion (optional): settle one word per action and one way to show names, and state the length in each hint.
- Confidence: Medium. Wording.

#### nit: the MCP message for an invalid name says the same thing twice

- Location: MCP tool `create_page` with an invalid name
- Severity: Nit
- Category: style
- Problem: the answer is "The name is not valid: Use lowercase letters, digits and single hyphens. A name has
  lowercase letters, digits and single hyphens, such as release-notes. Nothing was changed."
- Impact: a longer message for the AI app, no harm.
- Evidence: `create_page` with `name` `Bad Name`.
- Suggestion (optional): drop one of the two sentences.
- Confidence: Medium. The message may be built from two parts that are used elsewhere.

#### nit: Enter in the password field of "Connect an app" does nothing

- Location: `/oauth/authorize`, the field "Your password"
- Severity: Nit
- Category: style
- Problem: Enter in the password field does not approve; only a click on "Approve" does. The login and the password
  change both submit on Enter.
- Impact: keyboard users have to tab to the button.
- Evidence: type the password and press Enter: nothing happens.
- Suggestion (optional): let Enter approve, as in the other password forms.
- Confidence: Low. Not submitting on Enter may be a deliberate guard against approving by accident.

#### nit: a search address without words is a not-found page

- Location: `/folders/<folder>?view=search&q=` and `q=%20%20%20`
- Severity: Nit
- Category: error handling
- Problem: the address answers 404. The search box itself ignores an empty search.
- Impact: only seen through a typed or shared address.
- Evidence: `/folders/team-wiki?view=search&q=`.
- Suggestion (optional): show the search page with an empty box, or the folder.
- Confidence: Medium. A change users see.

#### nit: the search result shows the target of a wiki link instead of the shown text

- Location: snippets in the search results
- Severity: Nit
- Category: style
- Problem: a page with "[[docs/something-else]]", shown as "Something Else", appears in a result as "… a
  docs/something-else link".
- Impact: the snippet does not match what the user reads on the page.
- Evidence: the search for `bold` on the folder `team-wiki` of this test.
- Suggestion (optional): use the shown text, the label or the title, in the snippet.
- Confidence: Medium. How the snippet is built was not looked up.

#### nit: the live preview shows a footnote as "^1"

- Location: editor, live preview
- Severity: Nit
- Category: style
- Problem: `[^1]` is shown as an underlined "^1", and the definition `[^1]: …` as "^1: …"; the page view shows a
  raised 1 and a list of footnotes.
- Impact: footnotes look different while writing.
- Evidence: the line "Text with a footnote.[^1]" in live preview.
- Suggestion (optional): show the reference raised, as the page view does.
- Confidence: Low. How far the live preview should follow the page view is a choice.

#### question: how does an admin help a user who forgot the password?

- Location: `/users` as `admin`
- The rows of the user list cannot be opened, and there is no action to set a new first password, to lock an account
  or to remove it. Is this intended for now?

#### question: can a folder be deleted?

- Location: the folder page as Owner
- The Owner can rename a folder but finds no way to delete one. A folder created by mistake, such as the 80 × `a`
  folder of this test, can only be renamed. Is this intended?

#### question: what does "Updated" mean in the list of folders?

- Location: `/folders`
- The folder `team-wiki` shows "Updated Nov 22, 2026, 8:22 PM by alice via web", although its pages were changed until
  8:35 PM. Is "Updated" the change of the folder itself, such as its name? Users may read it as the latest change
  inside.

#### question: should deleting a page warn about the pages that link to it?

- Location: "Delete page"
- "Move or rename page" says "Links in 1 page will be updated." "Delete page" does not mention that other pages link
  to the page, and after the delete the folder opens without any message. Would a hint such as "2 pages link here"
  and a short "Page deleted" with a link to "Deleted items" help?

#### question: should `![[file|200]]` set a width?

- Location: embedded images
- `![[wide-banner.png|200]]` shows the image at full width with the alt text "200". Users who know Obsidian expect a
  width of 200 px. Is the text after `|` meant as a label only?

#### question: is the amount of prefetching intended?

- Location: every page
- Each navigation prefetches the header links (`/`, `/folders`, `/users`, `/account`) again, and every action link of
  the page, such as `?action=edit`, `?action=move-or-rename`, `?action=delete`, `?view=history` and the "create"
  links of missing wiki links. About 500 such requests built up in an hour of testing, most of them aborted. Each is
  a render on the server with database queries. Is this measured and fine for the deployment?

## Reviewed

- First login: the admin and each new user must set an own password; the rules for it are checked (built from the
  name or the wiki name, the same as before, not repeated) and the other pages are not reachable before.
- Users: names are validated, a duplicate is refused, the first password is shown once and Escape does not close
  that dialog.
- Rights: as Reader, every `?action=…` of the folder, page, tab and file and "Deleted items" answer 404; as Writer,
  delete, rename of tabs and "Give role" answer 404 while edit, move and upload work. The last Owner cannot be removed.
- Rendering: raw HTML, `<script>` and `onerror` in a page are shown as text; a `javascript:` link is not made a link;
  missing wiki links point to "New page" with the name filled in and carry "Page does not exist"; an invalid target
  carries "Not a valid page name"; footnotes, tables, task lists and code work.
- Names from titles: "Ünïcode Café & Co. 🚀 / Test" becomes `uenicode-cafe-co-test`.
- Wiki links: moving a page into a tab and renaming the tab rewrite the links in all pages, also links to missing
  pages, and each rewrite is a revision "Links updated after a move or rename".
- History: revisions, raw view, compare and revert work; revert records a new revision.
- Deleted items: a deleted page can be read and restored under a new place when its name is taken.
- Uploads: an SVG with a script, named `.png`, is refused as "Only PNG, JPEG, GIF, WebP and PDF files can be
  uploaded."; files are served with `Content-Security-Policy: default-src 'none'; sandbox` and need a login.
- Editor: "Discard changes?" on links, Esc then Tab leaves the editor, saving a page with the same name as a tab works.
- Login: after six wrong passwords in a row, "Too many failed logins. Please try again in 1 minute." holds also for
  the right password.
- OAuth and MCP: the consent page shows the address of the app and its self-chosen name as text, needs the password and
  offers 30, 90 or 365 days; a code works once; the Writer address lists 8 tools; pages created through MCP show "via
  mcp"; revoking stops the access token and the refresh token at once.
- No error in the log of the server during the whole test.

## Not covered

- Tabs deleted with their pages, files moved, a new version of a file uploaded, PDFs, files in tabs.
- The MCP tools beyond `list_folder` and `create_page`, the Manager address and OAuth through a real AI app.
- "Log out other browsers" and the password change from the account page.
- Screen readers, Safari and Firefox, and the speed of the app.
- The settings of the repository and anything that needs the deployment.
