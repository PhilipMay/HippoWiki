# MCP Wiki Links – Steps

## Goal

The MCP tools tell an AI app that every address they return is for people: it opens only in a browser after logging
in, so the app gives it to its user instead of fetching it. Next to each address of a page or file the tools also
return the wiki link a page uses for it, and for an image its embed link, so that an AI app points to pages, PDFs and
images in the pages it writes without building the links itself. The requirements are in
`spec/mcp-wiki-links-requirements.md`.

## Scope

- In: `wikiLink` for every page whose address a tool returns: `list_folder`, `read_page`, `search_pages`,
  `create_page`, `replace_page_content`, `edit_page_content` and `move_or_rename_page` (R3).
- In: `wikiLink` and `embedLink` (null for a PDF) for every file whose address a tool returns: `list_folder`,
  `search_pages` and `read_file`, the same texts as the copy fields of the details page of a file (R4, R5).
- In: the hint of R1 in the description of every address field of every output schema: the folder, tabs, pages,
  files, the details pages of files and the deleted items (R1).
- In: the same hint once in the instructions of a Reader, a Writer and a Manager connection (R2).
- In: the descriptions of the tools that list what their result holds name the new link fields, so that a description
  and its output schema agree.
- Not in: link fields in `linkedFrom` of `read_page`, `shownOrLinkedFrom` of `read_file`, `updatedPages` of
  `move_or_rename_page` and `rename_tab`, and the pages and files of `delete_tab`.
- Not in: link fields for tabs, the folder and the deleted items, which get only the hint.
- Not in: a label in the links, the title of a page included; a limit or an option for the length of the results.
- Not in: the content of files through MCP, uploads through MCP, links to files that work without a login.
- Not in: any change in the browser, apart from the copy fields of the details page of a file taking their texts from
  the same helper, with the same values as today.

## Checklist

- [x] Wiki links of pages
- [ ] Wiki links and embed links of files
- [ ] Hint on the addresses
- [ ] Spec tests
- [ ] Wrap-up

## Wiki links of pages

### Goal

Every result that returns the address of a page also returns its wiki link `[[name]]` or `[[tab/name]]` in `wikiLink`
(R3).

### Build

- Add pure helpers to `src/features/pages/wiki-link-target.ts`, next to `wikiLinkTargetText()`, that build the wiki link
  `[[target]]` and the embed link `![[target]]` of a page or file from its tab and name, without a label. The module
  keeps its rule of no imports of Zod or markdown-it, so that the details page of a file can use the helpers as well
  (next step).
- `src/features/mcp/tool-schemas.ts`: a field `wikiLink` with one shared description (the link with which a page links
  this page, `[[name]]` for a page placed directly in the folder or `[[tab/name]]` for one in a tab, without a label),
  right after `address`, in the pages of `listFolderOutput`, the results of `searchPagesOutput`, `readPageOutput` and
  `storedPageOutput`, which `movedPageOutput` and `editedPageOutput` extend. No `embedLink` for a page.
- `src/features/mcp/tools.ts`: fill `wikiLink` wherever a page address is built, from the tab and name of the page as
  stored, so that after a move or rename it names the new tab and name.
- `src/features/mcp/server.ts`: the descriptions of `list_folder`, `read_page` and `search_pages`, which list what
  their result holds, name the wiki link of a page.
- Comments name the requirement R3 where the rule is not obvious from the code; the wrap-up replaces the ID.

### Test

- Unit, `src/features/pages/wiki-link-target.test.ts`: the wiki link and the embed link of an item placed directly in
  the folder and of one in a tab, with no label.
- Unit, `src/features/mcp/tools.test.ts`: `list_folder` (a page directly in the folder and one in a tab), `read_page`,
  `search_pages`, `create_page`, `replace_page_content`, `edit_page_content` and `move_or_rename_page` (a move into a
  tab and a rename, which give the new link) return `wikiLink`; it holds the name and no title, also when the title
  differs from the name; no page result has `embedLink`; the output schema of each of these tools names `wikiLink`.
- End-to-end: `e2e/mcp-read.spec.ts` (`list_folder` and `read_page`), `e2e/mcp-search.spec.ts` (`search_pages`),
  `e2e/mcp-write.spec.ts` (`create_page`, `replace_page_content`, `move_or_rename_page`) and `e2e/mcp-edit.spec.ts`
  (`edit_page_content`) check `wikiLink` of a page in a tab and of one placed directly in the folder.
- End-to-end specs that run: the four above, and `e2e/mcp-manager.spec.ts`, whose tools share the changed modules.

## Wiki links and embed links of files

### Goal

Every result that returns the address of a file also returns its wiki link in `wikiLink` and, for an image, its embed
link in `embedLink`, null for a PDF, the same texts as the copy fields of its details page (R4, R5).

### Build

- `src/features/files/components/FileDetailsView.tsx`: the copy fields "Wiki link" and "Embed link" take their texts
  from the helpers of the step before, so that the details page and the tools cannot drift apart. The values stay as
  they are.
- `src/features/mcp/tool-schemas.ts`: `fileOutput` gains `wikiLink` (the link with which a page links the file,
  `[[name.ext]]` or `[[tab/name.ext]]`, without a label) and `embedLink` (the embed with which a page shows an image,
  `![[name.ext]]` or `![[tab/name.ext]]`; null for a PDF, which cannot be shown), right after `detailsAddress`.
  `list_folder`, `search_pages` and `read_file` share `fileOutput`, so all three get both fields.
- `src/features/mcp/tools.ts`: the function that builds a file for the tools fills both fields, `embedLink` with
  `isImageType()` of `src/features/files/types.ts`.
- `src/features/mcp/server.ts`: the descriptions of `list_folder`, `search_pages` and `read_file` name the wiki link
  and, for an image, the embed link of a file.
- Comments name R4 and R5 where the rule is not obvious from the code.

### Test

- Unit, `src/features/mcp/tools.test.ts`: `list_folder`, `search_pages` (the files of its first call) and `read_file`
  return for an image in a tab `wikiLink` `[[tab/name.png]]` and `embedLink` `![[tab/name.png]]`, for an image placed
  directly in the folder the links without a tab, and for a PDF `wikiLink` and `embedLink` null; neither link has a
  label; the output schemas name both fields.
- End-to-end: `e2e/mcp-read.spec.ts` (`list_folder` and `read_file` of an image and a PDF) and `e2e/mcp-search.spec.ts`
  (the files of `search_pages`) check both fields; `e2e/file-details.spec.ts` keeps passing unchanged, which shows
  that the copy fields kept their values.
- End-to-end specs that run: `e2e/mcp-read.spec.ts`, `e2e/mcp-search.spec.ts`, `e2e/file-details.spec.ts`,
  `e2e/move-or-rename-file.spec.ts` and `e2e/hydration.spec.ts`, which read the copy fields, and
  `e2e/mcp-attachments-spec-tests.spec.ts`.

## Hint on the addresses

### Goal

Every address field of every output schema, and the instructions of every connection, say that the addresses are for
people and that a page or file is pointed to with its wiki link (R1, R2).

### Build

- `src/features/mcp/tool-schemas.ts`: one exported constant with the text of R1, word for word: "Addresses are for
  people: each opens only in a browser after logging in to the wiki, so an AI app cannot fetch it with its access
  token. To point to a page or file in a page, use its wiki link."
- Every address field ends its description with that text, after what it already says of its item: `addressOutput()`
  appends it, `DELETED_ITEMS_ADDRESS_OUTPUT`, `address` and `detailsAddress` of `fileOutput` too. The address fields
  that have no description today, the folder, the tabs and the pages of `listFolderOutput`, get one through
  `addressOutput()`. The address fields of the folder, the tabs (`list_folder`, `create_tab`, `rename_tab`) and the
  deleted items (`delete_page`, `delete_tab`) get the hint and no link field.
- `src/features/mcp/server.ts`: `instructionsFor()` states the same text once, for every role, after the grammar of
  files.
- Comments name R1 and R2 where the rule is not obvious from the code.

### Test

- Unit, `src/features/mcp/tools.test.ts`: for the tools of a Manager connection, which has all twelve, walk the output
  schema of every tool that `tools/list` returns and check that every field whose name is `address` or ends in
  `Address` has a description that ends with the text of R1 and starts with what it says of its item; that the tabs,
  the folder and the deleted items have no `wikiLink` or `embedLink`; and that the instructions of a Reader, a Writer
  and a Manager connection each hold the text of R1.
- End-to-end: `e2e/mcp-read.spec.ts` checks the hint in the instructions of a Reader connection and in an address field
  of the output schema of `list_folder` from `tools/list`; `e2e/mcp-manager.spec.ts` the hint in the instructions of a
  Manager connection and in `deletedItemsAddress` of `delete_tab`; `e2e/mcp-write.spec.ts` the hint in the instructions
  of a Writer connection.
- End-to-end specs that run: `e2e/mcp-read.spec.ts`, `e2e/mcp-write.spec.ts`, `e2e/mcp-manager.spec.ts`,
  `e2e/mcp-edit.spec.ts`, `e2e/mcp-search.spec.ts` and `e2e/mcp-access.spec.ts`, which reads the instructions as well.

## Spec tests

### Goal

Tests written from the requirements alone check the link fields and the hint, without knowledge of how they are
built.

### Build

- Start the `spec-tester` agent (`.claude/agents/spec-tester.md`) with `spec/mcp-wiki-links-requirements.md` and wait
  for it; do not write these tests yourself. The tests it keeps belong to this step.
- A finding with High confidence within the scope of this plan is fixed in this step, and the failing test of its
  Evidence is added back with the fix; any other finding stops the plan, as "When a step cannot be finished" in
  `spec/step-plan-workflow.md` says.

### Test

- The tests the agent keeps pass.
- This is the last step that changes anything but documentation, so the complete `npm run test:e2e` runs in place of
  the specs it affects.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Extend `spec/mcp.md`: in "Tools", `list_folder`, `read_page`, `search_pages` and `read_file` name `wikiLink` of
   pages and files and `embedLink` of files, null for a PDF; in "What holds for all of them", the rule "Every write
   tool of pages returns the page as stored" gains the wiki link, the rule on addresses gains the hint in every
   address field, and the instructions of every role gain the sentence of R1; add the tests of the spec tests step to
   the pointers. Move the decisions of the requirements file that still hold into "Decisions" (the hint in the field
   descriptions and the instructions, the hint without a link field for tabs, the folder and the deleted items, the
   names `wikiLink` and `embedLink` with null for a PDF, no label, link fields only where an address is returned, link
   fields in `list_folder`) and the lists without link fields into "Current limits". Extend "AI apps" in
   `spec/wiki-links.md`: AI apps get the wiki link of a page or file from the results of the tools, not only from the
   grammar in the instructions. In `spec/attachments.md`, the copy fields and the MCP results of files share their
   texts; name the helper of `src/features/pages/wiki-link-target.ts` where the code pointers of the copy fields are.
   `architecture.md`, `testing.md` and `tech.md` change only if a convention changed.
2. `spec/roadmap.md` has no item for this feature; check that none of its items promises the link fields or the hint,
   and remove such an item if there is one.
3. Check that `README.md` has all the commands a developer needs, and that its section "MCP server" says that the
   tools return the wiki links of pages and files next to their addresses, and that the addresses open only in a
   browser after a login.
4. Delete `spec/mcp-wiki-links-steps.md` and `spec/mcp-wiki-links-requirements.md`. Replace every requirement ID R1 to
   R5 in the comments of the code and the tests with the section of `spec/mcp.md` that holds the rule now, or drop it
   with its sentence kept.
5. Update the spec catalog in `CLAUDE.md`: remove the entries of the step file and the requirements file. The entries
   of `spec/mcp.md` and `spec/wiki-links.md` keep their questions, which still hold.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. If the wrap-up changes only
  documentation, `npm run check:docs` runs and no end-to-end spec, as that section says; if it changes a comment in
  code or a test to replace a requirement ID, it runs `npm run check:all` and the end-to-end specs whose files it
  changed.
- The comments of the files this plan changed or added, in `src/`, `e2e/` and `integration/`, hold no requirement ID
  of `spec/mcp-wiki-links-requirements.md`.
