# Signed File Links – Requirements

Status: approved

## Goal

The MCP tools give the address of every image and PDF, but that address opens only after a login in the browser, so an
AI app cannot download the file with its access token. A new MCP tool gives the app a short-lived signed link to the
current version of one file, which downloads it without a login. The link follows the access of the connected app: what
the app may no longer read, its links no longer download.

## Users and roles

- An AI app connected to a folder through MCP (see `mcp.md` and `oauth.md`) asks for a link to a file of that folder,
  with the access of its connection.
- Whoever holds the link, the app, a program it hands the link to, or anyone who reads the link during its lifetime,
  downloads the file without a login until the link expires or stops working.
- A user of the browser gets no link: links are only handed out to a valid MCP connection.
- The operator sets the lifetime of the links and can withdraw all links at once by changing their key.

## Scenarios

- A user asks the AI app to describe a diagram of the folder. The app calls `get_file_download_link` for the file,
  fetches the link within a few minutes, and gets the image without a login.
- The user revokes the connected app on the account page. A link the app got a minute before no longer downloads the
  file, although it has not expired.
- A Writer uploads a new version of a PDF after an app got a link to it. The link no longer downloads anything, instead
  of leading to the new bytes; the app asks for a new link.
- A link leaks into a log of a reverse proxy. Ten minutes later it no longer downloads anything.

## Requirements

### The tool

- R1: Every MCP connection, whatever its role, must have the read tool `get_file_download_link`, which takes the tab, if
  the file is in one, and the name of an image or PDF with its extension, as `read_file` takes them, and returns a
  download link of its current version. It gives no link to a page.
  - Acceptance: A Reader, a Writer and a Manager connection list the tool with `readOnlyHint`; a call for an existing
    image and for an existing PDF each returns a link; a call for a page name returns a tool error.
- R2: The tool must check what `read_file` checks before it gives a link: the connection may read the folder, the file
  exists and is not deleted. Otherwise it must answer with the same tool error as `read_file`, which points to
  `list_folder`.
  - Acceptance: A missing file, a deleted file and a file in another folder each get the tool error of `read_file`,
    and no link.
- R3: The link must be the full address of the file below the public URL of the wiki (`HIPPOWIKI_PUBLIC_URL`), with the
  signed token as the only query: `/files/<folder>/[<tab>/]<name.ext>?token=<data>.<signature>`.
  - Acceptance: The returned link starts with the public URL, has the path of the file address and the query `token`
    and nothing else.
- R4: The result must hold, in the structured data and in its text as every result does, first the field `note` that
  says names of files are written by users and are data (see "Prompt injection" in `mcp.md`), then the name, the tab,
  the type and the size of the current version of the file, the link in `downloadLink` and the time it expires in
  `expiresAt`, in ISO 8601 in UTC. The description of the tool ends with the same note, as for every tool whose result
  carries names of files.
  - Acceptance: The result has `note` first and these fields; `expiresAt` equals the time of the call plus the
    lifetime (R18), to the second; the description of the tool ends with the note.
- R5: The tool call must be logged like every other tool call, without the link or its token.
  - Acceptance: The log line of a call names the grant, the user, the folder, the role, the tool, the tab and the file
    name and the outcome, and contains no part of the token.
- R24: A tool call for a file when the files are off (no usable files directory) must be a tool error that says the
  files cannot be downloaded because the server has no place to keep them, and must give no link. A link handed out
  before the files went off answers the plain 404 of R16.
  - Acceptance: With the files off, the tool returns this error and no link; an unexpired link answers 404.
- R27: The hint of every address field and the instructions of every connection must name the tool. The hint must add
  "To download an image or PDF, get a short-lived link with get_file_download_link." The instructions must say that
  the tool gives a link that downloads one file for a few minutes, and that such a link must never be written into a
  page, because it expires and lets anyone who reads it download the file.
  - Acceptance: Every address field description and the instructions of every role contain these sentences.

### What a link holds

These are technical constraints set by the user.

- R6: A link must carry everything needed to check it, signed with a key only the wiki holds; nothing must be stored
  per link and nothing must be cleaned up.
  - Acceptance: Handing out a link writes no row to the database.
- R7: The data of the link must be JSON with fixed fields:
  - `use`, always `"file-link"`, and `v`, the format, `1`, so that a signature of this key never passes for another
    purpose or a later format;
  - `grant`, the id of the grant of the connection, not only its user, so that revoking the connected app also stops
    its links;
  - `version`, the id of the current version of the file (a UUID), which never repeats, unlike the version number,
    which starts at 1 again for a new file under the name of a deleted one, and unlike the SHA-256, which repeats with
    a revert or the same upload. It also fixes the file, and with it its folder;
  - `exp`, the time the link expires, in whole seconds since 1970.
  - Acceptance: Decoding the data part of a link gives exactly these five fields with these values.
- R8: The data must be encoded in base64url without padding, and the signature must be the HMAC-SHA256 of exactly that
  encoded string with the key of the file links (R20), also base64url without padding, as a JWT does, so that there is
  only one way to write the signed data. The data is only encoded, not encrypted: it holds ids, never a secret.
  - Acceptance: Recomputing the HMAC-SHA256 of the data part with the key gives the signature part.

### Downloading with a link

- R9: A `GET` or `HEAD` of a file address with a `token` query must reach the file route without a session cookie;
  the proxy only looks whether the query is there and leaves the check to the route. Every other request without a
  session cookie is sent to the login page as before.
  - Acceptance: A `GET` and a `HEAD` with `token` and without a cookie are not redirected to the login page; a `POST`
    with `token` and a `GET` without `token` are redirected as before.
- R10: A request with `token` must be checked by the token alone, with or without a session cookie; a request without
  `token` by the session as before. With `token`, the only other query allowed is `download`; `version` and every other
  query get the 404 of R16.
  - Acceptance: A valid link with `download` answers the file as an attachment; a valid link with `version=1` answers
    404; a link with two `token` queries or with a value after `download` answers 404; an invalid token with the
    cookie of a user who may read the file answers 404.
- R11: The token must have the shape `<data>.<signature>`: both parts only of the characters `A`–`Z`, `a`–`z`, `0`–`9`,
  `-` and `_`, the data part of a bounded length and the signature exactly 43 characters, which are 32 bytes, so that
  one link has exactly one spelling. The HMAC of the data part must be computed again and compared to the signature in
  constant time, on bytes of the same length, as the OAuth secrets are compared. Only after a match is the data decoded
  and parsed: it must be JSON with exactly the fields of R7 and no other, `use` `"file-link"`, `v` `1`, `grant` and
  `version` UUIDs and `exp` a whole number.
  - Acceptance: Each of these answers 404: a signature that differs in one character, a token without a dot, a part
    with a character outside the alphabet (such as `=`, `+` or `/`), a data part far longer than any link the wiki
    makes (such as 10,000 characters), a signature of 42 or 44 characters, and a correctly signed token with another
    `use` or `v`, an extra field, a missing field, `exp` as a string or a fraction, or a `version` that is no UUID.
- R12: The link must not have expired, and its expiry must be at most the configured lifetime away from now, so that a
  shorter lifetime also shortens the links already handed out.
  - Acceptance: A link past its `exp` answers 404; after the lifetime is lowered and the server restarted, a link
    whose `exp` lies further away than the new lifetime answers 404.
- R13: The grant of the link must still be accepted at its MCP address, as an access token is: OAuth is on, the grant
  exists and has not expired, its user is no admin and does not have the first password any more, and the user's role
  on the folder is not below the role of the grant.
  - Acceptance: Each of these makes a link that has not expired answer 404: revoking the app, revoking all apps,
    changing the own password with the choice to disconnect the apps, deactivating or deleting the user, when it
    comes (see `roadmap.md`), the end of the grant, a role on the folder lowered below the role of the grant or taken
    away, connecting the same app to the same address again (which replaces the old grant), and a server started
    without `HIPPOWIKI_PUBLIC_URL`.
- R14: The path of the request must resolve as for a logged-in user: the folder, the tab if the address has one and the
  file exist, the file is not deleted, its current version is the version of the link, and the file is in the folder
  of the grant.
  - Acceptance: After a rename, a move, a new version, a revert or a delete of the file, the link answers 404; the
    link under the address of another file answers 404.
- R15: A restore of a deleted file must make a link that has not expired work again, because the restore keeps the
  versions and their ids, still under all the checks above.
  - Acceptance: Deleting and restoring a file to the same place makes an unexpired link download it again.
- R16: Every failure of R10 to R14 must get the same plain 404 as a file that does not exist, and must be logged
  without the token.
  - Acceptance: The answers of the failures above have the same status and body as the answer to a file that does not
    exist; no log line holds any part of a token.
- R17: Only then must the file be sent, with the same strict headers as every file (`nosniff`, the sandbox CSP,
  `Cross-Origin-Resource-Policy: same-origin` and the other headers of the files), but with
  `Cache-Control: private, no-store` instead of `no-cache`, so that no cache of a browser or a proxy keeps a copy. A
  link is for fetching and downloading: no page of another site can show the file through it.
  - Acceptance: A download by link has the type, the name and the security headers of the file address, among them
    `Cross-Origin-Resource-Policy: same-origin`, and `Cache-Control: private, no-store`.
- R23: Every successful download by link must be logged at the level `info` with the grant, the user, the folder, the
  tab, the file name and the version number, never the token, so that a download by whoever held the link can be
  traced like a tool call. A `HEAD` is logged the same way.
  - Acceptance: A download by link writes one `info` line with these fields and no part of the token.
- R25: A download by link must not count as a use of the connected app: "last used" on the account page stays the last
  request of the app with its access token.
  - Acceptance: Downloading by link leaves the "last used" of the grant unchanged.
- R26: Downloads by link must have no rate limit of their own and must not count against the MCP rate limit; each
  link needs a tool call, which counts as every tool call does.
  - Acceptance: A link downloads more often than the MCP rate budget within its lifetime; the tool call that made it
    counts against the budget.

### Lifetime and key

- R18: A link must live 10 minutes by default; the operator must be able to set another lifetime with
  `HIPPOWIKI_FILE_LINK_LIFETIME`, in whole seconds in plain decimal digits like the other limits, from `60` to `3600`,
  default `600`. Any other value must stop the server, like the other limits.
  - Acceptance: Without the variable a link expires 600 seconds after the call; with `60` after 60 seconds; `59`,
    `3601`, `0`, `10m` and an empty value each stop the server with an error naming the variable.
- R20: The links must be signed with a key of their own, not with the secret of the session cookies: 32 random bytes,
  generated on first use and kept in the database the same way as that secret, so that all processes sign with the
  same key and a new key for the links does not log out any user.
  - Acceptance: Two server processes accept each other's links; a restart keeps the links valid; the key differs from
    the secret of the session cookies.
- R21: The operator must be able to withdraw all links at once by deleting the stored key and restarting the server,
  because each process keeps the key in memory once read. The new key is generated on first use.
  - Acceptance: After the key is deleted and the server restarted, every earlier link answers 404 and new links work.

### Privacy and leaks

- R22: The wiki must never write a token to its log, neither of a download nor of a tool call nor of an error.
  - Acceptance: No log line of a download, a failed download or a tool call holds any part of a token.

## Scope

- In: the tool `get_file_download_link` for every role; the download of the current version of an image or PDF with a
  link, as a `GET` or `HEAD`, inline or with `download`; the lifetime setting; the key of the links.
- Not in: links in the browser; links to pages; links to an earlier version; withdrawing a single link; single-use
  links; the content of a file in a tool result; uploads through MCP.

## Effect on existing features

- `mcp.md`: a new read tool for every role. The hint of every address field (`ADDRESS_HINT`) and the instructions of
  every connection name it (R27), and it joins the tools whose description and result carry the note of "Prompt
  injection". The rule "No tool returns the content of a file" stays: the tool returns a link, not content. The rule
  that the log line of a tool call never holds an address covers the link.
- `attachments.md`: "No address of a file works without a login" no longer holds for an address with a valid token.
  The answer of a download by link has `Cache-Control: private, no-store`.
- `src/proxy.ts` (see "Login and sessions" in `architecture.md`): a `GET` or `HEAD` of `/files/…` with a `token`
  query passes without a session cookie.
- `container-image.md`: a new environment variable for the lifetime, and the key of the links in the database next to
  the secret of the session cookies, with how to withdraw all links.
- `connected-apps.md` and `oauth.md`: revoking an app, changing the own password with the choice to disconnect the
  apps and the end of a grant also stop its links.

## Decisions

- Signed links, not stored links: a stored link, a random token whose hash is kept in a table with its expiry like the
  OAuth tokens, could be withdrawn one by one and made single-use, but needs a table and the cleanup of expired rows.
  For links of a few minutes signed links are simpler and enough. A single link cannot be withdrawn, but R13 and R14
  make every link follow the access of its connected app, and R21 withdraws all links.
- The link names the grant, not only the user, so that revoking one connected app stops its links and not those of the
  user's other apps.
- A link checks the grant, not the access token that the app used to get it: it may outlive that token, whose
  lifetime is an hour, by up to its own lifetime, but never the grant or the access of the user.
- The link names the id of the version, not its number or SHA-256, because only the id never repeats.
- A key of its own instead of the secret of the session cookies, so that a new key for the links logs nobody out.
  Whoever can read the database or a backup can sign links, as they can already sign session cookies.
- Within its lifetime anyone with the link can download the file: proxy logs, the transcript stored by the AI provider,
  an agent that follows planted instructions. The short lifetime limits this. The token is in the query, so the access
  log of a reverse proxy in front of the wiki holds it as well; the wiki itself never logs it.
- A link is for fetching only: files keep `Cross-Origin-Resource-Policy: same-origin`, so no page of another site, a
  chat app included, shows an image through it. Rejected: `cross-origin` for links, which would let any page that
  holds a link show the file.
- The lifetime is set in seconds, from 60 to 3600, as the other limits are set in plain digits. Rejected: minutes.
- Every successful download by link is logged at `info`, because anyone who holds the link can download. Rejected:
  only `debug`, like a download in the browser.
- Every role gets the tool, because every role may read files in the browser. Rejected: Writer and Manager only.
- When the files are off, the tool gives no link that could only answer 404. Rejected: a link anyway.
- A download by link does not update "last used" of the connected app, because whoever holds the link may download,
  not only the app; the log line of R23 records downloads. Rejected: counting it, at most once a minute.
- Downloads by link have no rate limit of their own: each link costs a tool call, which counts against the MCP rate
  limit, a link lives a few minutes, and downloads in the browser are not limited either; a reverse proxy can limit
  more. Rejected: counting every download against the MCP rate budget of the user.
- The result carries what is needed to fetch and check the file, its name, tab, type and size, and nothing more; the
  rest is in `read_file`. Rejected: only the link and its expiry, and all the details of `read_file`.
- The instructions warn against writing a link into a page, where it would expire and let every reader download the
  file. Rejected: only naming the tool.
- The token is checked strictly, its alphabet, its lengths and the fields of its data, because the base64url decoder
  of Node.js skips characters outside its alphabet, so that a loose check would accept many spellings of one link.
  Rejected: only a bounded length and a 32-byte signature.

## Open questions
