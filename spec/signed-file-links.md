# HippoWiki – Signed File Links

Signed file links as built: an AI app connected through MCP gets a short-lived link to the current version of an image
or PDF of its folder with the read tool `get_file_download_link`, and downloads the file with it without a login. The
link carries everything needed to check it, signed with a key only the wiki holds, and follows the access of its
connected app: what the app may no longer read, its links no longer download. The addresses of files for people, which
open only after a login, are described in `attachments.md`; MCP and its tools in `mcp.md`; the grants of connected
apps in `connected-apps.md`.

Code:

- `src/features/files/link-token.ts`: the token of a link, signed and checked, and its lifetime;
- `src/features/files/link-service.ts`: the key of the links, the link that the tool hands out, and the read of a file
  by a link;
- `src/features/files/http.ts`: the file address, which checks a request with `token` by the token alone;
- `src/proxy.ts`: lets a `GET` or `HEAD` of a file address with `token` pass without a session cookie;
- `callerOfGrant()` of `src/features/grants/service.ts`: whether the grant of a link is still accepted;
- `get_file_download_link` in `src/features/mcp/server.ts`, `src/features/mcp/tools.ts` and
  `src/features/mcp/tool-schemas.ts`;
- `HIPPOWIKI_FILE_LINK_LIFETIME` in `src/lib/env.ts`, the table `FileLinkKey` in `prisma/schema.prisma`, and the log
  filter of the development server in `next.config.ts`.

Tests:

- unit: `src/features/files/link-token.test.ts`, `src/features/files/link-service.test.ts`,
  `src/features/files/http.test.ts`, `src/proxy.test.ts`, `src/lib/env.test.ts`, `src/lib/addresses.test.ts`,
  `src/features/grants/service.test.ts` and `src/features/mcp/tools.test.ts`;
- integration: `integration/file-link-key.test.ts`, `integration/file-link-service.test.ts`,
  `integration/grant-service.test.ts`, `integration/oauth-service.test.ts` and the tests written from the spec alone,
  `integration/file-download-links.spec-tests.test.ts`;
- end to end: `e2e/file-download-links.spec.ts`, `e2e/access.spec.ts`, `e2e/mcp-read.spec.ts` and the tests written from
  the spec alone, `e2e/file-download-links-spec-tests.spec.ts`. Their tokens are signed by `signFileLinkToken()` of
  `e2e/support/database.ts` with the key of the test database, as the server signs them.

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

## The answer of a download

- The file is sent with the type, the name, the length, the `ETag` and the strict headers of every file address
  (`nosniff`, the sandbox CSP, `Cross-Origin-Resource-Policy: same-origin` and the others, see "Addresses and headers"
  in `attachments.md`), but with `Cache-Control: private, no-store` instead of `no-cache`, so that no cache of a browser
  or a proxy keeps a copy.
- A link is for fetching and downloading: no page of another site can show the file through it.

## Logs

- The wiki never writes a token to its log: not of a download, of a failed download, of a tool call or of an error.
- Every successful `GET` and `HEAD` by link is logged at `info` with the grant, the user, the folder, the tab, the file
  name and the version number, so that a download by whoever held the link can be traced like a tool call.
- A refused link is logged with the reason: at `warn` when its shape, signature or data fail, which only a broken or
  forged link does; at `info` when a valid link no longer passes (expired, grant, files off, file, version).
- The development server logs every incoming request with its address; it leaves out every file address with a query,
  because the key of the query may also be written percent-encoded (`logging.incomingRequests` in `next.config.ts`). A
  production server logs no requests.

## Lifetime and key

- A link lives 10 minutes by default. The operator sets another lifetime with `HIPPOWIKI_FILE_LINK_LIFETIME`, in whole
  seconds in plain decimal digits, from `60` to `3600` (`FILE_LINK_LIFETIME` in `src/lib/env.ts`, see "Configuration"
  in `container-image.md`). Any other value stops the server with an error that names the variable.
- The links are signed with a key of their own, not with the secret of the session cookies: 32 random bytes, generated
  on first use and kept in the single row of the table `FileLinkKey`, the same way as the secret of the session
  cookies, so that all processes sign with the same key, a restart keeps the links valid, and a new key logs no user
  out.
- Each process keeps the key in memory once read. The operator withdraws all links at once by deleting the row of
  `FileLinkKey` and restarting the server; the next link generates a new key.

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

## Current limits

- no links in the browser, and no links to pages
- no link to an earlier version of a file: a link downloads only the version that was current when it was made
- no withdrawing of a single link, and no single-use links; only all links at once, with the key
- no content of a file in a tool result, and no uploads through MCP (see "Files through MCP" in `roadmap.md`)
- no rate limit of downloads by link; a reverse proxy can limit them
- a download by link does not show as a use of the connected app
