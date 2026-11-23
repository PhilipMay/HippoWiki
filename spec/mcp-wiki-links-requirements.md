# MCP Wiki Links – Requirements

Status: approved

## Goal

The MCP tools give out addresses of pages, files, tabs and the folder, but an AI app cannot open them: every address
needs a login to the wiki in a browser, and the access token of the connection works only for MCP. The tools tell the
AI app so, so that it gives the addresses to its user instead of trying to fetch them. Next to each address of a page
or file they also return the wiki link that a page uses for it, so that the AI app can point to pages, PDFs and images
in the pages it writes without building the link itself.

## Users and roles

- AI apps connected to a folder through MCP, with a Reader, Writer or Manager connection. Every role gets the hint and
  the new link fields in the results of the tools it has; nothing about who may see or do what changes.
- The user of the AI app, who opens the addresses in a browser after logging in.
- Security and privacy do not change: the links hold only the names and tabs that the results already hold, the
  addresses keep needing a login and a role on the folder, and no file content reaches the AI app.

## Scenarios

- A user asks the AI app for the manual of a device. The app finds `manual.pdf` with `search_pages`, tells the user
  its address to open in the browser, and does not try to download it.
- A user asks the AI app to write a page about the setup of a server and to show the network diagram on it. The app
  finds `diagrams/network.png` with `list_folder`, takes its embed link `![[diagrams/network.png]]` from the result and
  puts it into the content of the new page.
- An AI app creates a page and then links it from an overview page, with the wiki link that `create_page` returned.

## Requirements

### Hint on the addresses

- R1: Every address that an MCP tool returns must say in the description of its field that it is for people: it opens
  only in a browser after logging in to the wiki, so an AI app cannot fetch it with its access token, and a page or
  file is pointed to in a page with its wiki link. This holds for the addresses of the folder, tabs, pages, files, the
  details pages of files and the deleted items.
  - Acceptance: in the output schema of every tool, the description of every address field holds the text "Addresses
    are for people: each opens only in a browser after logging in to the wiki, so an AI app cannot fetch it with its
    access token. To point to a page or file in a page, use its wiki link.", after what it already says of its item.
  - Acceptance: the addresses of tabs, the folder and the deleted items get this hint and no link field, because a
    page cannot link them.
- R2: The instructions that an AI app gets when it connects must say the same once for all addresses, for every role.
  - Acceptance: the instructions of a Reader, a Writer and a Manager connection each hold the text of R1.

### Wiki links of pages

- R3: Every result that returns the address of a page must also return its wiki link in a field `wikiLink`: `[[name]]`
  for a page placed directly in the folder, `[[tab/name]]` for a page in a tab.
  - Acceptance: `list_folder` (each page), `read_page`, `search_pages` (each result), `create_page`,
    `replace_page_content`, `edit_page_content` and `move_or_rename_page` return `wikiLink`, and the link names the
    page as stored, after a move or rename its new tab and name.
  - Acceptance: the link carries no label, not the title either, so that it holds only the name and stays right when
    the title changes.
  - Acceptance: a page has no `embedLink`, because pages cannot be embedded.

### Wiki links and embed links of files

- R4: Every result that returns the address of a file must also return its wiki link in a field `wikiLink`:
  `[[name.ext]]` for a file placed directly in the folder, `[[tab/name.ext]]` for a file in a tab, the same text as the
  copy field "Wiki link" of its details page.
  - Acceptance: `list_folder` (each file), `search_pages` (each file of its first call) and `read_file` return
    `wikiLink` for images and PDFs, without a label.
- R5: The same results must return the embed link of an image in a field `embedLink`: `![[name.ext]]` or
  `![[tab/name.ext]]`, the same text as the copy field "Embed link" of its details page. For a PDF `embedLink` is
  null, so that every file has the same fields.
  - Acceptance: an image has `embedLink` with its embed link; a PDF has `embedLink` null.

## Scope

- In: the hint on every address field and in the connection instructions; `wikiLink` for pages and files and
  `embedLink` for files wherever a tool returns their address today.
- Not in: link fields in the lists of pages and files that have no address today: `linkedFrom` of `read_page`,
  `shownOrLinkedFrom` of `read_file`, `updatedPages` of `move_or_rename_page` and `rename_tab`, and the pages and
  files of `delete_tab`; they keep name, tab and title, from which the grammar in the instructions builds the link.
- Not in: a label in the links; a limit or an option for the length of the results.
- Not in: the content of files through MCP, uploads through MCP, links to files that work without a login (all stay as
  `attachments.md` and `roadmap.md` describe them).

## Effect on existing features

- `mcp.md`: the results of the read tools and of the write tools of pages gain `wikiLink`, and the files `wikiLink`
  and `embedLink`; the rule "Every write tool of pages returns the page as stored: its name, title, tab, address and
  version" gains the wiki link; the instructions of every role gain the sentence of R1; the descriptions of the address
  fields change.
- `wiki-links.md`, "AI apps": AI apps get the wiki link of a page or file from the results of the tools, not only from
  the grammar in the instructions.
- The browser does not change.

## Decisions

- The hint is given in the description of every address field and once in the connection instructions, so that the
  client sees it when it connects and in the schema of every result. Rejected: the field descriptions alone; a `note`
  in every result, which adds text to every answer.
- Tabs, the folder and the deleted items get the hint but no link field, because a page cannot link them. Rejected:
  leaving their address fields as they are.
- The hint says the address is for people and opens only after a login in a browser. Rejected: a shorter text without
  the pointer to the wiki link; a softer "can most likely not fetch it".
- The fields are named `wikiLink` and `embedLink`, after the copy fields "Wiki link" and "Embed link" of the details
  page; `embedLink` of a PDF is null. Rejected: leaving `embedLink` out for a PDF; one list `links` per item, which
  the client would have to tell apart.
- The links carry no label, like the copy fields of the details page. Rejected: the title as the label of a page,
  which puts text written by users into the field and goes stale when the title changes.
- Link fields only where an address is returned today. Rejected: `wikiLink` in `linkedFrom`, `shownOrLinkedFrom` and
  `updatedPages` as well.
- `list_folder` gets the link fields as well; the results grow by a few short fields per item. Rejected: leaving them
  out of `list_folder`.

## Open questions
