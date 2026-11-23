# Signed Upload Links – Requirements

Status: approved

## Goal

An AI app connected through MCP can put an image or a PDF into its folder: a tool hands it a short-lived link for one
upload, and the app sends the bytes of the file to that link with an ordinary HTTP request, such as `curl`, without a
login. This lets an agent that works with files on a computer, such as Claude Code, Cursor or Codex, add the
screenshots, charts and PDFs it has to the wiki and show them in the pages it writes, which today only a person can do
in the browser.

## Users and roles

- A Writer connection and a Manager connection get the tool and upload files with its links, as a Writer, a Manager
  and an Owner upload files in the browser.
- A Reader connection does not get the tool.
- The user of the connection is recorded as the uploader, and the upload is marked as done through MCP.
- Anyone who holds a link while it is valid can use it, as with the download links of `signed-file-links.md`.
- The operator sets the lifetime of the links and withdraws all links at once.

## Scenarios

- A new screenshot: Claude Code documents a project and has taken a screenshot of a dialog. It asks
  `get_file_upload_link` for a link for `settings-dialog.png` in the tab `guide`, with the size of the file, and runs
  the `curl` command of the result with the path of the screenshot. It adds the embed `![[guide/settings-dialog.png]]`
  to the page `guide/setup` with `edit_page_content`. The page shows the image, and the details page of the file names
  the user of the connection as its uploader, through MCP.
- A new version: an agent has exported a new version of `architecture.pdf`. It reads the file with `read_file`, asks
  the tool for a link for a new version of it, based on the lock version it read, and sends the file. Every page that
  links the PDF now leads to the new version, and the old version stays in the list of versions.
- A change at the same time: while the agent prepares the new version, a person uploads another version in the
  browser. The upload by the agent is refused with a message that the file was changed, and stores nothing; the agent
  reads the file again and decides what to do.

## Requirements

### The tool

- R1: A Writer connection and a Manager connection must have the tool `get_file_upload_link`, which hands out a
  short-lived link for uploading one image or PDF into the folder of the connection, either as a new file or as a new
  version of an existing file. It carries the hints of a tool that writes and no `destructiveHint`, like
  `create_page`. A Reader connection must not have it.
  - Acceptance: the list of tools of a Writer and of a Manager connection holds the tool with these hints; that of a
    Reader connection does not, and a call of it by a Reader connection changes nothing.
- R2: Before it hands out a link, the tool must check everything that can be checked without the bytes of the file, and
  refuse with a tool error that says what to do next: the place (the folder itself, or a tab of it that exists), the
  name and its extension by the rules of file names (`attachments.md`), the size the app states against the size limit
  of the wiki, for a new file that the name is free at that place, and for a new version that the file exists there
  and still has the lock version the app states.
  - Acceptance: a name against the rule, an extension of another type, a tab that does not exist, a size over the size
    limit, a taken name for a new file, a missing file or a lock version that is not the current one for a new version
    each give a tool error and no link.
- R12: The app must state the exact size of the file in bytes when it asks for a link, and the link must take only a
  file of exactly that size and of the type of its extension. The type follows from the extension, as for every file.
  - Acceptance: an upload by link of a file with one byte more or one byte less than stated is refused and stores
    nothing; the bytes are counted, whatever the request announces, and nothing after the stated size is kept.
- R13: For an image, the tool must take the choice "Remove location and camera data", on unless the app turns it off,
  as the browser offers it; the link carries the choice, and the upload follows it. A PDF is always stored byte for
  byte.
  - Acceptance: an image uploaded by a link made without the choice has no location data; one made with the choice
    turned off keeps the bytes as sent.
- R21: The result of the tool must hold, in its structured data and in its text, first the note on prompt injection of
  every result with names of files (see "Prompt injection" in `mcp.md`), then the name, the tab, the type and the
  stated size of the file, the link in `uploadLink`, the time it expires in `expiresAt` in ISO 8601 in UTC, a ready
  `curl` command that sends a file to the link, with a placeholder for its local path, and the wiki link and, for an
  image, the embed link that the file will have. The description of the tool ends with the same note.
  - Acceptance: the result holds these fields in this order; the `curl` command, with the placeholder replaced by the
    path of a file of the stated size and type, uploads it; the wiki link and embed link are those that `read_file`
    gives for the file after the upload.
- R3: While the files of the wiki are off (no usable files directory), the tool must answer with a tool error that says
  the server has no place to keep files, and hand out no link.
  - Acceptance: with the files off, a call gives that error and no link.

### Uploading with a link

- R4: An app must be able to upload the file by sending its bytes as the body of a `POST` to the link, the upload
  address of the browser with the token as its query, `/api/uploads/<folder>/[<tab>/]<name.ext>?token=…`, without a
  login, as long as the link is valid. A request with a token is checked by the token alone, with or without a session
  cookie; a request without one is checked by the session, as before.
  - Acceptance: an upload by a valid link with a file that passes the checks of R5 stores the file at the place and
    under the name of the link; the same request with a session cookie of another user stores it with the user of the
    connection.
- R22: A request to the upload address with a token must have no other query; one with another query, a second token
  included, must be refused and store nothing. Every choice of the upload comes from the link.
  - Acceptance: a valid link with `&replace=1`, with `&removeMetadata=0` or with a second `token` is refused and stores
    nothing.
- R17: An upload by link from a page of another site must be refused, as an upload in the browser is: a foreign
  `Origin` or `Sec-Fetch-Site: cross-site`.
  - Acceptance: an upload by a valid link with a foreign `Origin`, or with `Sec-Fetch-Site: cross-site`, is refused and
    stores nothing; the same upload without these headers, as `curl` sends it, is stored.
- R5: An upload by link must pass the same checks and get the same treatment as an upload in the browser: the type
  detected from the content and only PNG, JPEG, GIF, WebP and PDF, an image that decodes within the limits of
  untrusted input, the size limit of the wiki, a refusal when the disk is full, and the same content stored once.
  - Acceptance: HTML named `.png`, a PDF sent for a `.png` link and an image that does not decode are each refused and
    store nothing.
- R6: A file uploaded by link must show the user of the connection as its uploader and MCP as the way it was uploaded,
  on its details page, in its list of versions and in `list_folder` and `read_file`, like a page changed through MCP.
  - Acceptance: after an upload by link, the details page and `read_file` show the user of the connection and the
    channel `mcp` for the new version.
- R7: An upload of a new version must be stored only when the file still has the lock version that the link was made
  for; an upload of a new file only when the name is still free. Otherwise it must be refused and store nothing; an
  upload for a new file never becomes a new version of a file uploaded under that name in the meantime.
  - Acceptance: a version uploaded in the browser after the link was handed out makes the upload by link fail; a file
    uploaded in the browser under the free name after the link was handed out makes the upload of a new file by link
    fail; in both cases the file stays as the browser left it.
- R20: A link must store at most one upload: after it, a second upload by the same link is refused and stores nothing,
  for a new file because its name is now taken, for a new version because the lock version has changed. Handing out a
  link stores nothing.
  - Acceptance: the second upload by a link that stored a file is refused with the reason of R15, and the file keeps
    the version of the first upload.
- R9: An upload by link must not change any page; the app adds the file to a page with the tools of pages.
  - Acceptance: after an upload by link, no page has a new revision.
- R14: A stored upload must answer with the file as stored: its name, tab, type, size, version number, the width and
  height of an image, its wiki link and, for an image, its embed link, so that the app can add it to a page.
  - Acceptance: the answer of a successful upload holds these details, and its wiki link and embed link are the same
    texts as those of `read_file`.
- R15: An upload by a valid link that is refused must answer with a short message that says why and what to do: the
  type does not match, the size is not the stated one, the image does not decode, the disk is full, or in the meantime
  the name was taken, the file was changed or the tab was renamed or deleted. A link that is broken, forged, expired or
  no longer accepted (R8) must get one and the same plain 404, which tells nothing about why.
  - Acceptance: each refusal of a valid link names its reason; an expired link, a forged link and a link of a revoked
    app get the same status and body.
- R19: An upload by link must not count against the rate limit of MCP and must not count as a use of the connected
  app: "last used" on the account page stays the last request of the app with its access token. The tool call that
  hands out the link counts, as every tool call does.
  - Acceptance: an upload by link leaves the MCP budget of the user and "last used" of the app as they were.

### Validity of a link

- R18: An upload link must live as long as a download link: the lifetime of `HIPPOWIKI_FILE_LINK_LIFETIME`, 10 minutes
  by default, and a shorter lifetime set by the operator also shortens the links already handed out.
  - Acceptance: an upload by a link after its expiry is refused; with the lifetime lowered and the server restarted, a
    link older than the new lifetime is refused.
- R8: A link must stop working as soon as its connected app may no longer upload into the folder, for every reason that
  ends a download link (see "Downloading with a link" in `signed-file-links.md`): the app revoked, all apps revoked,
  the password changed with the choice to disconnect the apps, the grant ended, the role on the folder lowered below
  the role of the grant or taken away, the same app connected to the same address again, OAuth off, a server without
  `HIPPOWIKI_PUBLIC_URL`.
  - Acceptance: after each of these, an upload by a link that has not expired is refused and stores nothing.
- R24: The operator must be able to withdraw all upload links at once in the same way as all download links: deleting
  the key of the links and restarting the server ends both. A download link must never pass as an upload link, and an
  upload link never as a download link.
  - Acceptance: after the key is deleted and the server restarted, an upload link handed out before is refused; a
    download link sent to the upload address and an upload link sent to the file address are both refused.

### Reading files

- R16: `read_file` and `list_folder` must give the lock version of each file, as `read_page` gives the version of a
  page, so that an app can state it for a new version.
  - Acceptance: `read_file` and `list_folder` return the lock version of a file; after a new version, a move or a
    rename it is one higher.

### Instructions

- R10: The instructions of a Writer and of a Manager connection must name `get_file_upload_link`, say how a file is
  uploaded with it and added to a page, warn that an upload link must never be written into a page, because it lets
  anyone who reads it upload into the folder until it expires, and must no longer say that a file is uploaded only in
  the browser.
  - Acceptance: the instructions of a Writer and of a Manager connection name the tool and hold the warning; those of
    a Reader connection do not offer uploading.

### Logs

- R11: The wiki must never write the token of an upload link to its log: not of the tool call, of an upload, of a
  refused upload or of an error.
  - Acceptance: after a tool call, an upload and a refused upload, the log holds no token.
- R23: Every stored upload by link must be logged at `info` with the grant, the user, the folder, the tab, the file name
  and the version number, so that an upload by whoever held the link can be traced. A refused link must be logged with
  its reason: at `warn` when its shape, signature or data fail, which only a broken or forged link does; at `info` when
  a valid link no longer passes or its file is refused.
  - Acceptance: a stored upload, a forged link and an expired link each write one line of the stated level with the
    stated details, and none of them the token.

## Scope

- In: the tool `get_file_upload_link` for Writer and Manager connections; uploading a new file or a new version of an
  image or PDF with its link; the checks, the records, the answers and the logs of such uploads; the lock version of
  files in `read_file` and `list_folder`; the instructions of the connections.
- Not in:
  - files sent inside a tool call as base64, and files that the model writes itself, such as SVG or CSV
  - the wiki fetching a file from an address that the app names
  - uploads from chat clients that cannot send the bytes of a file themselves, such as claude.ai and Claude Desktop
  - moving, renaming, reverting and deleting a single file through MCP, which stay in the browser
  - the content of files in tool results
  - new types of files
  - withdrawing a single link

## Effect on existing features

- `attachments.md`: "No tool uploads, changes, moves, renames or deletes a single file" changes: a Writer and a Manager
  connection upload new files and new versions with a link; moving, renaming and deleting a single file stay in the
  browser. The upload address also takes a token instead of a session. Its decision "Rejected for now: uploads through
  MCP" and its current limit change with it.
- `mcp.md`: a Writer connection gets ten tools and a Manager connection fourteen; the instructions of these
  connections name the new tool and no longer say that a file is uploaded only in the browser; `read_file` and
  `list_folder` give the lock version of each file.
- `signed-file-links.md`: the key and the lifetime of the links serve upload links as well, and its current limit "no
  uploads through MCP" changes.
- `optimistic-locking.md`: a new version by link is based on the lock version carried in the link, next to
  `replace=<lock version>` of the upload in the browser.
- `container-image.md`: `HIPPOWIKI_FILE_LINK_LIFETIME` sets the lifetime of upload links as well.
- `roadmap.md`: the entry "Files through MCP" keeps only the content of files in tool results.

## Decisions

- The uploads are for agents that have the bytes of a file and can send an HTTP request, such as Claude Code, Cursor
  and Codex. Rejected: files inside a tool call as base64, which a model cannot reliably write for a file it does not
  hold, costs an output token per character and fits only below the body limit of MCP (1 MiB by default); and files
  the model writes itself, which would need new types such as SVG or CSV.
- A Writer and a Manager connection upload, as a Writer, a Manager and an Owner upload in the browser. Rejected: Manager
  connections only.
- A link uploads a new file or a new version of an existing file, based on its lock version as every change through
  MCP is. Rejected: new files only.
- The feature covers uploading only. Rejected for now: moving, renaming and deleting a single file through MCP, which
  stay on the roadmap.
- The tool is named `get_file_upload_link`, next to `get_file_download_link`. Rejected: `create_file_upload_link`.
- The tool carries the hints of a tool that writes and does not destroy, like `create_page`: a new version keeps the
  old ones, and a revert in the browser undoes it. Rejected: `destructiveHint`.
- The app gets the lock version of a file from `read_file` and `list_folder` and states it for a new version, as for
  every change of a page. Rejected: the tool binding whatever lock version is current when the link is made, which
  misses a change between the read and the tool call.
- A link takes only a file of the stated size and of the type of its extension, so that a leaked link cannot store a
  larger or another file. Rejected: binding the SHA-256 of the content too, one more step for the agent that can go
  wrong; binding only the type, up to the size limit.
- The tool takes the choice of removing location and camera data, on by default, as the browser does. Rejected:
  always removing it.
- The result of the tool carries a ready `curl` command and the links the file will have, so that the agent needs no
  further call to send the file and to add it to a page. Rejected: only the link and its expiry.
- The bytes go to the upload address of the browser with the token, so that every upload takes the same path, which
  is already left out of the proxy and its cut of a body at 10 MB. Rejected: a `PUT` to the file address of the
  download links, which answers only `GET` and `HEAD` and would need the proxy to let it pass.
- With a token the upload address takes no other query, so that one link has one spelling and every choice of the
  upload is signed. Rejected: ignoring other queries.
- An upload by link from a page of another site is refused as in the browser; an agent's `curl` sends neither header.
  Rejected: accepting every origin because the token is the only credential.
- A refused upload by a valid link says why, so that the agent can act on it; a link that is no longer valid tells
  nothing, as a download link does. Rejected: the same plain answer for every failure.
- A link stores at most one upload because of what it is bound to, and handing it out stores nothing. Rejected: a
  table of links marked as used, which could withdraw a single link but needs the cleanup of expired rows.
- An upload by link counts neither against the rate limit of MCP nor as a use of the app, as a download by link; each
  link costs a tool call, and the log records the upload. Rejected: counting both.
- An upload link lives as long as a download link, set by the same variable. Rejected: a variable of its own.
- Upload links are signed with the key of the download links, and the signed data names its use, so that one step of
  the operator withdraws all links and no link passes for the other kind. Rejected: a key of its own for uploads.
- The instructions warn against writing an upload link into a page, as they do for download links. Rejected: no
  warning.
- A stored upload by link is logged at `info`, because anyone who holds the link can upload, as for downloads.
  Rejected: logging only the refusals.

## Open questions
