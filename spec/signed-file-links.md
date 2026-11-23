# HippoWiki – Signed File Links

Signed file links as built: an AI app connected through MCP gets a short-lived link to the current version of an image
or PDF of its folder with the read tool `get_file_download_link`, and downloads the file with it without a login. A
Writer or Manager connection gets a short-lived link for one upload with `get_file_upload_link`, and sends the bytes
of a file to it with a `POST`, such as with `curl`, as a new file or a new version of a file. A link carries everything
needed to check it, signed with a key only the wiki holds, and follows the access of its connected app: what the app
may no longer read, its links no longer download, and where it may no longer upload, its links store nothing. The
addresses of files for people, which open only after a login, and the upload in the browser are described in
`attachments.md`; MCP and its tools in `mcp.md`; the grants of connected apps in `connected-apps.md`.

Code:

- `src/features/files/link-token.ts`: the tokens of both kinds of link, signed and checked, and their lifetime;
- `src/features/files/link-service.ts`: the key of the links, the download link that the tool hands out, and the read
  of a file by a link;
- `src/features/files/upload-link-service.ts`: the upload link that the tool hands out, and the upload of a file by a
  link, which stores it with `uploadFile()` of `src/features/files/service.ts`;
- `src/features/files/http.ts`: the file address and the upload address, which check a request with `token` by the
  token alone;
- `src/proxy.ts`: lets a `GET` or `HEAD` of a file address with `token` pass without a session cookie; the upload
  address is left out of the proxy anyway;
- `callerOfGrant()` of `src/features/grants/service.ts`: whether the grant of a link is still accepted;
- `get_file_download_link` and `get_file_upload_link` in `src/features/mcp/server.ts`, `src/features/mcp/tools.ts`
  and `src/features/mcp/tool-schemas.ts`;
- `fileLinkPath()` and `uploadLinkPath()` of `src/lib/addresses.ts`;
- `HIPPOWIKI_FILE_LINK_LIFETIME` in `src/lib/env.ts`, the table `FileLinkKey` in `prisma/schema.prisma`, and the log
  filter of the development server in `next.config.ts`.

Tests:

- unit: `src/features/files/link-token.test.ts`, `src/features/files/link-service.test.ts`,
  `src/features/files/upload-link-service.test.ts`, `src/features/files/service.test.ts`,
  `src/features/files/http.test.ts`, `src/proxy.test.ts`, `src/lib/env.test.ts`, `src/lib/addresses.test.ts`,
  `src/features/grants/service.test.ts` and `src/features/mcp/tools.test.ts`;
- integration: `integration/file-link-key.test.ts`, `integration/file-link-service.test.ts`,
  `integration/file-upload-link-service.test.ts`, `integration/file-service.test.ts`,
  `integration/grant-service.test.ts`, `integration/oauth-service.test.ts` and the tests written from the spec alone,
  `integration/file-download-links.spec-tests.test.ts` and `integration/file-upload-links.spec-tests.test.ts`;
- end to end: `e2e/file-download-links.spec.ts`, `e2e/file-upload-links.spec.ts`, `e2e/access.spec.ts`,
  `e2e/mcp-read.spec.ts`, `e2e/mcp-write.spec.ts`, `e2e/mcp-manager.spec.ts` and the tests written from the spec alone,
  `e2e/file-download-links-spec-tests.spec.ts` and `e2e/file-upload-links-spec-tests.spec.ts`. Their tokens are signed
  by `signFileLinkToken()` and `signUploadLinkToken()` of `e2e/support/database.ts` with the key of the test database,
  as the server signs them; the scenarios of `e2e/file-upload-links.spec.ts` "through MCP" get their links from the
  tool and send the file with its `curl` command.

## The tool

- Every MCP connection, whatever its role, has the read tool `get_file_download_link` (`readOnlyHint`). It takes the
  tab, if the file is in one, and the name of an image or PDF with its extension, as `read_file` takes them, and
  returns a link to its current version. It gives no link to a page.
- It finds the file as `read_file` does: a page name, a missing file, a deleted file and a file of another folder get
  the tool error of `read_file`, which points to `list_folder`, and no link.
- While the files are off (no usable files directory, see "Storage and the operator" in `attachments.md`) it answers
  with a tool error that says the file cannot be downloaded because the server has no place to keep files, and gives
  no link.
- The link is the full address of the file below `HIPPOWIKI_PUBLIC_URL`, with the token as its only query:
  `/files/<folder>/[<tab>/]<name.ext>?token=<data>.<signature>`.
- The result holds, in the structured data and in its text, first the field `note` (see "Prompt injection" in
  `mcp.md`), then the name, the tab, the type and the size of the current version, the link in `downloadLink` and the
  time it expires in `expiresAt`, in ISO 8601 in UTC. It holds what is needed to fetch and check the file and nothing
  more; the rest is in `read_file`. The description of the tool ends with the same note.
- The call is logged like every tool call (see "What holds for all of them" in `mcp.md`), without the link or its
  token, and counts against the rate limit of MCP.
- The hint of every address field of the tools and the instructions of every connection name the tool. The
  instructions say that it gives a link that downloads one file for a few minutes, and that such a link must never be
  written into a page, because it expires and lets anyone who reads it download the file.
- Handing out a link stores nothing: no row per link, and nothing to clean up.

## What a link holds

- The token is the data of the link and its signature, `<data>.<signature>`, as a JWT writes them. The data is the JSON
  of exactly five fields: `use`, always `"file-link"`, and `v`, the format, `1`, so that a signature of this key never
  passes for another purpose or a later format; `grant`, the id of the grant of the connection; `version`, the id of
  the version of the file that was current; and `exp`, when the link expires, in whole seconds since 1970.
- The link names the grant, not only its user, so that revoking one connected app stops its links. It names the id of
  the version, which never repeats, so that it also fixes the file and with it its folder.
- The data is encoded in base64url without padding, and the signature is the HMAC-SHA256 of exactly that encoded
  string with the key of the links, also base64url without padding, so that there is only one way to write the signed
  data. The data is only encoded, not encrypted: it holds ids, never a secret.

## Downloading with a link

- `src/proxy.ts` lets a `GET` or `HEAD` of a file address with a `token` query pass without a session cookie; it only
  looks whether the query is there. A `POST` with `token`, and every request without it, go to the login page as
  before.
- A request with `token` is checked by the token alone, with or without a session cookie, and the session is not
  read; a request without it by the session, as `attachments.md` describes. With `token`, the only other query allowed
  is `download` without a value, which sends the file as an attachment; `version`, a second `token` and every other
  query are refused.
- The token is checked strictly, in this order:
  - its shape: both parts only of `A`–`Z`, `a`–`z`, `0`–`9`, `-` and `_`, the data part of at most 512 characters, the
    signature exactly 43 characters (32 bytes), so that one link has exactly one spelling;
  - its signature, computed again and compared in constant time on bytes of the same length, as the OAuth secrets are
    compared; the signature is compared as written, so that no other spelling of the same bytes passes;
  - only then its data: JSON with exactly the five fields and no other, `use` and `v` as above, `grant` and `version`
    UUIDs, and `exp` a whole number.
- The link must not have expired, and its expiry must be at most the configured lifetime away from now, so that a
  shorter lifetime also shortens the links already handed out (see "Lifetime and key").
- The grant of the link must still be accepted at its MCP address, as an access token is (see "The check of an access
  token" in `connected-apps.md`): OAuth is on, the grant exists and has not expired, its user is no admin and does not
  have the first password, and the user's role on the folder includes the role of the grant. The access token of the
  grant is not looked at: a link may outlive it, whose lifetime is an hour, by up to its own lifetime, but never the
  grant or the access of the user. So revoking the app, revoking all apps, changing the own password with the choice
  to disconnect the apps, the end of the grant, a role on the folder lowered below the role of the grant or taken away,
  connecting the same app to the same address again, and a server without `HIPPOWIKI_PUBLIC_URL` each end the links of
  the grant, although they have not expired. Deactivating or deleting a user will end them too, when it comes (see
  `roadmap.md`).
- The file is read as the connected app reads it, with the actor of MCP of the grant: the folder, the tab if the
  address has one and the file exist, the file is not deleted and is in the folder of the grant, and its current
  version is the version of the link. A rename, a move, a new version, a revert and a delete of the file each end the
  link, and so does the address of another file. A restore to the same place makes a link that has not expired work
  again, because the restore keeps the versions and their ids.
- While the files are off a link that has not expired gets the answer of a missing file.
- Every failure gets the same plain 404 as a file that does not exist, with the same status and body, so that a link
  tells nothing about why it no longer works.
- A download by link does not count as a use of the connected app: "last used" on the account page stays the last
  request of the app with its access token. It has no rate limit of its own and does not count against the rate limit
  of MCP; each link needs a tool call, which counts.

## The upload tool

- A Writer and a Manager connection have the tool `get_file_upload_link`, with the hints of a tool that writes and
  without `destructiveHint`, like `create_page`: a new version keeps the old ones, and a revert in the browser undoes
  it. A Reader connection does not have it, and a call of it changes nothing. It is registered where the role may do
  the function `editFile`, as a Writer, a Manager and an Owner upload in the browser.
- It takes the tab, if any, the name of the file with its extension, the exact size of the file in bytes, and for a
  new version the lock version of the file that `read_file` or `list_folder` gave (see "Tools" in `mcp.md`); without a
  lock version the link is for a new file. It also takes the choice "Remove location and camera data" for an image,
  on unless the app turns it off, as the browser offers it; a PDF is always stored byte for byte.
- Before it hands out a link it checks everything that can be checked without the bytes, in the order of every
  content write, and refuses with a tool error that says what to do next: the place (the folder itself, or a tab of it
  that exists), the role, the name and its extension by the rules of file names (see "Files as items" in `attachments.md`), the
  size against the size limit of the wiki, whether the files are on, for a new file that the name is free at the
  place, and for a new version that the file exists there and still has the lock version stated. While the files are
  off the error says that the server has no place to keep files.
- The link is the full address of the upload address below `HIPPOWIKI_PUBLIC_URL`, with the token as its only query:
  `/api/uploads/<folder>/[<tab>/]<name.ext>?token=<data>.<signature>`.
- The result holds, in the structured data and in its text, first the field `note` (see "Prompt injection" in
  `mcp.md`), then the name, the tab, the type and the stated size of the file, the link in `uploadLink`, the time it
  expires in `expiresAt`, in ISO 8601 in UTC, a ready `curl` command that sends a file to the link with a placeholder
  for its local path, and the wiki link and, for an image, the embed link that the file will have, the same texts as
  `read_file` gives after the upload. The description of the tool ends with the same note, and that of `uploadLink`
  says that it stores one upload and must never be written into a page.
- The call is logged like every tool call, without the link or its token, and counts against the rate limit of MCP.
- The instructions of a Writer and a Manager connection name the tool, say how a file is uploaded with it and added
  to a page with its embed or wiki link, and warn that an upload link must never be written into a page, because it
  lets anyone who reads it upload into the folder until it expires. Those of a Reader connection offer no uploading.
  No connection is told any more that a file is uploaded only in the browser; moving, renaming, reverting and deleting
  a single file still are.
- Handing out a link stores nothing.

## What an upload link holds

- The token has the shape, the alphabet, the signature and the strict check of a download token (see "What a link
  holds" and "Downloading with a link"), with a data part long enough for the longest valid name of a file.
- Its data is the JSON of exactly these fields: `use`, always `"file-upload-link"`, and `v`, the format, `1`; `grant`,
  the id of the grant of the connection, whose folder is the folder of the upload; `tab`, the id of the tab or `null`
  for the folder itself; `name`, the name of the file with its extension; `size`, the exact size in bytes that the app
  stated; `strip`, whether an image is written again without its location and camera data; `file` and `lockVersion`,
  the id and the lock version of the file that a new version is based on, both `null` for a new file; and `exp`, when
  the link expires, in whole seconds since 1970.
- Both kinds of link are signed with the same key, and each kind names its own `use`, so that a download link never
  passes as an upload link and an upload link never as a download link: each fails the data check of the other.
- The link names the tab by its id, so that a tab renamed after the link was made is noticed, and the file by its id,
  so that another file under the same name never takes the new version.

## Uploading with a link

- An app uploads the file by sending its bytes as the body of a `POST` to the link, without a login. A request to the
  upload address with `token` is checked by the token alone, with or without a session cookie, and the session is not
  read; a request without it by the session, as in the browser (see "Uploading" in `attachments.md`).
- With `token` the query has no other key: `replace`, `strip`, a second `token` and every other query are refused and
  store nothing, because every choice of the upload comes from the link.
- An upload by link from a page of another site is refused as in the browser: a foreign `Origin` or `Sec-Fetch-Site:
cross-site`. Unlike the browser, a request without `Origin`, as `curl` sends it, passes.
- The token is checked as a download token is, in the same order: its shape, signature and data, then its expiry
  against the lifetime, the grant, which must still be accepted at its MCP address, and whether the files are on. So
  every reason that ends a download link ends an upload link (see "Downloading with a link"): revoking the app,
  revoking all apps, changing the own password with the choice to disconnect the apps, the end of the grant, a role on
  the folder lowered below the role of the grant or taken away, connecting the same app to the same address again,
  OAuth off and a server without `HIPPOWIKI_PUBLIC_URL`.
- The address must name the folder of the grant and the name of the link; another address is not accepted. A tab of
  the link that was renamed or deleted is refused with that reason.
- The file is stored as an upload in the browser is, with the actor of MCP of the grant, so that it passes the same
  checks and gets the same treatment: the type detected from the content and only PNG, JPEG, GIF, WebP and PDF, an
  image that decodes within the limits of untrusted input, the size limit of the wiki, a refusal when the disk is
  full, and the same content stored once (see "Images" and "Storage and the operator" in `attachments.md`).
- The link takes only a file of exactly the stated size and of the type of its extension, so that a leaked link cannot
  store a larger or another file. The bytes are counted, whatever the request announces: a body with one byte more or
  less is refused and stores nothing, and nothing after the stated size is kept.
- The version records the user of the connection as its uploader and `mcp` as the way, on the details page, in the
  list of versions and in `list_folder` and `read_file`, like a page changed through MCP.
- A new version is stored only when the file still has the lock version of the link, which is the lock version of the
  upload in the browser's `replace=<lock version>` (see `optimistic-locking.md`); a new file only when the name is
  still free. A link for a new file never becomes a new version of a file uploaded under its name in the meantime.
- A link stores at most one upload: after it, a second upload by the same link is refused and stores nothing, for a
  new file because its name is now taken, for a new version because its lock version has changed.
- An upload by link changes no page; the app adds the file to a page with the tools of pages.
- An upload by link does not count against the rate limit of MCP and does not count as a use of the connected app:
  "last used" on the account page stays the last request of the app with its access token. The tool call that hands
  out the link counts, as every tool call does.

## The answer of an upload

- A stored upload answers `201` with JSON: the name, the tab, the type, the size and the version number of the file
  as stored, the width and height of an image, its wiki link and, for an image, its embed link, the same texts as
  `read_file` gives, so that the app can add the file to a page.
- An upload by a valid link that is refused answers JSON with the status of the upload in the browser for the same
  reason and a short message for the app that says why and what to do: the type does not match, the size is not the
  stated one, the image does not decode, the disk is full, or in the meantime the name was taken, the file was changed
  or the tab was renamed or deleted.
- A link that is broken, forged, expired or no longer accepted, and a refused query or origin, get the same plain 404
  as a download link, which tells nothing about why.

## The answer of a download

- The file is sent with the type, the name, the length, the `ETag` and the strict headers of every file address
  (`nosniff`, the sandbox CSP, `Cross-Origin-Resource-Policy: same-origin` and the others, see "Addresses and headers"
  in `attachments.md`), but with `Cache-Control: private, no-store` instead of `no-cache`, so that no cache of a browser
  or a proxy keeps a copy.
- A link is for fetching and downloading: no page of another site can show the file through it.

## Logs

- The wiki never writes a token to its log: not of a download, an upload, a refused download or upload, a tool call or
  an error.
- Every successful `GET` and `HEAD` by link is logged at `info` with the grant, the user, the folder, the tab, the file
  name and the version number, so that a download by whoever held the link can be traced like a tool call. Every
  stored upload by link is logged at `info` with the same details.
- A refused link is logged with the reason: at `warn` when its shape, signature or data fail, which only a broken or
  forged link does; at `info` when a valid link no longer passes (expired, grant, files off, file, version, tab, name)
  or the file of an upload is refused. The upload of the files service logs the refusals of an upload by link at
  `info` as well (`refusalLevel` of `UploadOptions`), and those of the browser at `warn`.
- The development server logs every incoming request with its address; it leaves out every file address and every
  upload address with a query, because the key of the query may also be written percent-encoded
  (`logging.incomingRequests` in `next.config.ts`). A production server logs no requests.

## Lifetime and key

- A link lives 10 minutes by default, a download link and an upload link alike. The operator sets another lifetime with `HIPPOWIKI_FILE_LINK_LIFETIME`, in whole
  seconds in plain decimal digits, from `60` to `3600` (`FILE_LINK_LIFETIME` in `src/lib/env.ts`, see "Configuration"
  in `container-image.md`). Any other value stops the server with an error that names the variable.
- The links are signed with a key of their own, not with the secret of the session cookies: 32 random bytes, generated
  on first use and kept in the single row of the table `FileLinkKey`, the same way as the secret of the session
  cookies, so that all processes sign with the same key, a restart keeps the links valid, and a new key logs no user
  out.
- Both kinds of link are signed with this key. Each process keeps the key in memory once read. The operator withdraws
  all download and upload links at once by deleting the row of `FileLinkKey` and restarting the server; the next link
  generates a new key.

## Decisions

- Signed links, not stored links: a stored link, a random token whose hash is kept in a table with its expiry like the
  OAuth tokens, could be withdrawn one by one and made single-use, but needs a table and the cleanup of expired rows.
  For links of a few minutes signed links are simpler and enough. A single link cannot be withdrawn, but every link
  follows the access of its connected app and its file, and the key withdraws all links.
- The link names the grant, not only the user, so that revoking one connected app stops its links and not those of the
  user's other apps.
- A link checks the grant, not the access token that the app used to get it.
- The link names the id of the version, not its number or SHA-256: the number starts at 1 again for a new file under
  the name of a deleted one, and the SHA-256 repeats with a revert or the same upload.
- A key of its own instead of the secret of the session cookies, so that a new key for the links logs nobody out.
  Whoever can read the database or a backup can sign links, as they can already sign session cookies.
- Within its lifetime anyone with the link can download the file: proxy logs, the transcript stored by the AI provider,
  an agent that follows planted instructions. The short lifetime limits this. The token is in the query, so the access
  log of a reverse proxy in front of the wiki holds it as well; the wiki itself never logs it.
- A link is for fetching only: files keep `Cross-Origin-Resource-Policy: same-origin`. Rejected: `cross-origin` for
  links, which would let any page that holds a link show the file.
- The lifetime is set in seconds, from 60 to 3600, as the other limits are set in plain digits. Rejected: minutes.
- Every successful download by link is logged at `info`, because anyone who holds the link can download. Rejected:
  only `debug`, like a download in the browser.
- Every role gets the tool, because every role may read files in the browser. Rejected: Writer and Manager only.
- When the files are off, the tool gives no link that could only answer 404. Rejected: a link anyway.
- A download by link does not update "last used" of the connected app, because whoever holds the link may download,
  not only the app; the log line of a download records it. Rejected: counting it, at most once a minute.
- Downloads by link have no rate limit of their own: each link costs a tool call, a link lives a few minutes, and
  downloads in the browser are not limited either; a reverse proxy can limit more. Rejected: counting every download
  against the MCP rate budget of the user.
- The result carries the name, tab, type and size of the file, the link and its expiry. Rejected: only the link and
  its expiry, and all the details of `read_file`.
- The instructions warn against writing a link into a page. Rejected: only naming the tool.
- The token is checked strictly, its alphabet, its lengths and the fields of its data, because the base64url decoder
  of Node.js skips characters outside its alphabet, so that a loose check would accept many spellings of one link.
  Rejected: only a bounded length and a 32-byte signature.
- The download link has no hint of the addresses, because it is no address for people: it works without a login.
- Uploads through MCP are for agents that have the bytes of a file and can send an HTTP request, such as Claude Code,
  Cursor and Codex. Rejected: files inside a tool call as base64, which a model cannot reliably write for a file it
  does not hold, costs an output token per character and fits only below the body limit of MCP; and files that the
  model writes itself, which would need new types such as SVG or CSV.
- A Writer and a Manager connection upload, as a Writer, a Manager and an Owner upload in the browser. Rejected:
  Manager connections only.
- An upload link uploads a new file or a new version of an existing file, based on its lock version as every change
  through MCP is. Rejected: new files only. Moving, renaming, reverting and deleting a single file stay in the browser
  for now.
- The tool is named `get_file_upload_link`, next to `get_file_download_link`. Rejected: `create_file_upload_link`.
- The tool carries the hints of a tool that writes and does not destroy, like `create_page`. Rejected:
  `destructiveHint`.
- The app states the lock version of a file that it read, as for every change of a page. Rejected: the tool binding
  whatever lock version is current when the link is made, which misses a change between the read and the tool call.
- A link takes only a file of the stated size and of the type of its extension. Rejected: binding the SHA-256 of the
  content too, one more step for the agent that can go wrong; binding only the type, up to the size limit.
- The tool takes the choice of removing location and camera data, on by default, as the browser does. Rejected:
  always removing it.
- The result of the tool carries a ready `curl` command and the links the file will have, so that the agent needs no
  further call to send the file and to add it to a page. Rejected: only the link and its expiry.
- The bytes go to the upload address of the browser with the token, so that every upload takes the same path, which is
  already left out of the proxy and its cut of a body at 10 MB. Rejected: a `PUT` to the file address of the download
  links, which answers only `GET` and `HEAD` and would need the proxy to let it pass.
- With a token the upload address takes no other query, so that one link has one spelling and every choice of the
  upload is signed. Rejected: ignoring other queries.
- An upload by link from a page of another site is refused as in the browser; the `curl` of an agent sends neither
  header. Rejected: accepting every origin because the token is the only credential.
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
- A stored upload by link is logged at `info`, because anyone who holds the link can upload, as for downloads; the
  refusals of its file too, so that `warn` marks only broken and forged links. Rejected: logging only the refusals;
  the `warn` of the upload in the browser for the refused file of a link.

## Current limits

- no links in the browser, and no links to pages
- no link to an earlier version of a file: a link downloads only the version that was current when it was made
- no withdrawing of a single link, and no single-use download links; only all links at once, with the key
- an upload link for a new file whose file is deleted within the lifetime of the link can store once more, because
  the name is free again
- no content of a file in a tool result (see "Files through MCP" in `roadmap.md`), no files sent inside a tool call,
  and no file that the wiki fetches from an address that the app names
- no uploads from chat clients that cannot send the bytes of a file themselves, such as claude.ai and Claude Desktop
- no moving, renaming, reverting or deleting of a single file through MCP; these stay in the browser
- no rate limit of downloads or uploads by link; a reverse proxy can limit them
- a download or an upload by link does not show as a use of the connected app
