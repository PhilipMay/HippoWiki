# Signed File Links – Steps

## Goal

An AI app connected through MCP gets a short-lived signed link to the current version of an image or PDF of its
folder with the new read tool `get_file_download_link`, and downloads the file with it without a login. The link
carries everything needed to check it, signed with a key only the wiki holds, and follows the access of the connected
app: what the app may no longer read, its links no longer download. The plan is written from
`spec/signed-file-links-requirements.md`, whose requirement IDs the steps name.

## Scope

- In: the tool `get_file_download_link` for every role, with the hint of every address field and the instructions of
  every connection naming it; the download of the current version of an image or PDF with a link, as a `GET` or
  `HEAD`, inline or with `download`; the check of the token, its grant, its file and its version; the lifetime setting
  `HIPPOWIKI_FILE_LINK_LIFETIME`; the key of the links, generated on first use and stored in the database; the logs of
  the tool call and of every download by link, never with a token.
- Not in: links in the browser; links to pages; links to an earlier version; withdrawing a single link; single-use
  links; the content of a file in a tool result; uploads through MCP; a rate limit of downloads by link; a change of
  "last used" of a connected app by a download.

## Checklist

- [ ] Token and key of file links
- [ ] Check of a grant without an access token
- [ ] Download by link
- [ ] The tool get_file_download_link
- [ ] Spec tests
- [ ] Wrap-up

## Token and key of file links

### Goal

The parts a link is made of, before anything uses them: the lifetime setting, the key of the links in the database,
and the pure module that signs a token and checks it strictly. Requirements: R6, R7, R8, R11, R12 (the check of the
expiry against the lifetime), R18, R20, R21.

### Build

- `src/lib/env.ts`: `HIPPOWIKI_FILE_LINK_LIFETIME` with the bounds `FILE_LINK_LIFETIME` (`min` 60, `max` 3600,
  `default` 600), read with `wholeNumber()` like the other limits, so that any other value stops the server with an
  error naming the variable (R18). Add it to `.env.example` with its default and to the mocked environment of
  `integration/setup.ts`.
- `prisma/schema.prisma`: a model `FileLinkKey` with a single row, shaped like `AuthSecret` (`id` always 1, `secret`,
  `createdAt`), and a migration that creates it and adds by hand the check constraint that keeps it to one row, as
  `AuthSecret_single_row` does (R20). Deleting its row is how the operator withdraws all links (R21).
- `src/features/files/link-token.ts`, a pure module with `node:crypto` and Zod and no database:
  - signs the data of a link: the JSON of exactly `use` (`"file-link"`), `v` (`1`), `grant`, `version` and `exp`
    (R7), encoded in base64url without padding, and the HMAC-SHA256 of exactly that encoded string with the key, also
    base64url without padding, joined with a dot (R8);
  - checks a token in this order and gives the data or the reason of a failure, for the log: the shape (both parts
    only of `A`–`Z`, `a`–`z`, `0`–`9`, `-` and `_`, the data part at most 512 characters, the signature exactly 43),
    the HMAC of the data part compared with `timingSafeEqual` on bytes of the same length, and only after a match the
    decoded data, parsed with a strict Zod object: exactly the five fields, `use` and `v` as literals, `grant` and
    `version` UUIDs, `exp` a whole number (R11);
  - checks the expiry against a given time and lifetime: `exp` must lie after now and at most the lifetime away from
    now (R12).
- `src/features/files/link-service.ts`, a service module of the files feature: the key of the links, read from
  `FileLinkKey` or, when there is no row yet, generated as 32 random bytes and stored with `createMany` and
  `skipDuplicates`, then read again, as `readSecret()` of `src/lib/auth.ts` does, so that all processes sign with the
  same key (R20). Each process keeps the key in memory once read, on `globalThis` like the store of the files, so that
  only a restart reads a new key (R21); a test can clear it as a restart does. Handing out a link stores nothing (R6).
- Nothing in the app uses the module or the service yet.

### Test

- Unit, `src/features/files/link-token.test.ts`: a signed token decodes to exactly the five fields with their values
  (R7); the HMAC-SHA256 of the data part recomputed with the key gives the signature part (R8); each case of the
  acceptance of R11 is refused: a signature that differs in one character, a token without a dot, a part with `=`,
  `+` or `/`, a data part of 10,000 characters, a signature of 42 and of 44 characters, and correctly signed data with
  another `use` or `v`, an extra field, a missing field, `exp` as a string or a fraction, or a `version` that is no
  UUID; a token past its `exp` and one whose `exp` lies further away than the lifetime are refused, also with a
  lifetime lowered after the token was signed (R12).
- Unit, `src/lib/env.test.ts`: without the variable the lifetime is 600, `60` and `3600` are accepted, and `59`,
  `3601`, `0`, `10m` and an empty value each fail with an error naming the variable (R18).
- Integration, `integration/file-link-key.test.ts`: the first read generates and stores a key of 32 bytes, a second
  read after clearing the key in memory, as a second process or a restart would, gives the same key (R20); the key
  differs from the secret of `AuthSecret` (R20); after the row is deleted and the key in memory cleared, a new key is
  generated, and a token signed with the old key no longer passes the check (R21).
- End-to-end: `npm run test:e2e -- e2e/smoke.spec.ts`, because the migration only adds a table (see "When a step is
  done" in `spec/step-plan-workflow.md`).

## Check of a grant without an access token

### Goal

The grants service tells whether a grant is still accepted at its MCP address without its access token, with the same
checks as `authenticateAccessToken()`, so that a link follows the access of its connected app. Requirements: R13,
R25.

### Build

- `src/features/grants/service.ts`: a function that takes the id of a grant and gives the caller of the grant, the
  actor of its user and its connection (`McpCaller`), or `null`, logged with the reason and the grant, never a token.
  It accepts the grant only when OAuth is on (`isOAuthOn()`), the grant exists and has not expired, its user does not
  have the first password and is no admin, and the user's current role on the folder includes the role of the grant
  (R13). It does not look at the access token of the grant, whose shorter lifetime a link may outlive, and it writes
  no last use (R25).
- `authenticateAccessToken()` and the new function share these checks in one helper of the service, so that the two
  never disagree; the refusals of `authenticateAccessToken()`, its codes and its log lines stay as they are.

### Test

- Unit, `src/features/grants/service.test.ts`: with OAuth off the function gives `null` without asking the database;
  an unknown grant, an expired grant, a user with the first password, an admin, a role on the folder below the role of
  the grant and no role on it each give `null` with a log line that names the reason; a valid grant gives the caller
  and writes no last use (R13, R25); the tests of `authenticateAccessToken()` pass unchanged.
- Integration, `integration/grant-service.test.ts`: a valid grant is accepted; after revoking the app, revoking all
  apps, changing the own password, deleting the user, the end of the grant, lowering the role on the folder below the
  role of the grant, taking it away, and connecting the same app to the same address again, the old grant is no longer
  accepted (R13); `lastUsedAt` of the grant is unchanged after an accepted check (R25).
- End-to-end: `e2e/mcp-access.spec.ts` and `e2e/oauth.spec.ts`, because the check of the access token was reworked.

## Download by link

### Goal

A `GET` or `HEAD` of a file address with a `token` query downloads the current version of the file without a login,
checked by the token alone, and every failure answers the plain 404 of a file that does not exist. Requirements: R9,
R10, R12, R13, R14, R15, R16, R17, R22, R23, R24 (a link while the files are off), R25, R26.

### Build

- `src/proxy.ts`: a `GET` or `HEAD` of `/files/…` whose query has `token` passes without a session cookie; the proxy
  only looks whether the query is there. A `POST` with `token` and every request without it are sent to the login page
  as before (R9). The comment of the matcher and of the function says why.
- `src/features/files/link-service.ts`: the read of the content of a file by link: it checks the token with
  `link-token.ts`, the key and the lifetime of `getServerEnv()` (R11, R12), then the grant with the function of the
  previous step (R13), and reads the file at the folder, tab and name of the address with the actor of MCP of the grant
  (`inMcp()`), so that only the folder of the grant is readable and the lower of the two roles counts. The file must
  exist at that place and not be deleted, and the id of its current version must be the `version` of the token (R14).
  While the files are off, a link that has not expired gets the same `null` as a missing file (R24). A restore that puts the file back with its versions makes the link work again (R15). It gives the content, as
  `getFileContent()` of the files service does, and what the log of the download names, or `null` with the reason of
  the failure, logged without the token: a token that fails its shape or signature at `warn`, a token that is valid
  but no longer passes (expired, grant, file, version) at `info` (R16, R22). The files service gives the id of the
  current version to it in a read of its own or an option of `getFileContent()`, without changing what the browser
  gets.
- `src/features/files/http.ts`: `handleFileRequest()` decides by the query: with a `token` key the request is checked
  by the token alone, with or without a session cookie, and the session is not read; without it, by the session as
  before (R10). With `token` the query may hold exactly one `token` and at most one `download` without a value;
  `version` and every other key give the 404 (R10). Every failure answers with `notFound()`, the same plain 404 as a
  file that does not exist (R16). A file sent by link has the type, the name, the length, the `ETag` and the headers of
  `next.config.ts` of the file address, with `Cache-Control: private, no-store` in place of `private, no-cache` (R17).
  Every successful `GET` and `HEAD` by link writes one `info` line with the grant, the user, the folder, the tab, the
  file name and the version number, never the token (R23). Neither the last use of the grant (R25) nor the rate limit
  of MCP (R26) is touched.
- `next.config.ts`: the development server of Next.js logs every incoming request with its address; it ignores the
  file addresses whose query holds `token` (`logging.incomingRequests.ignore`), so that no log of the wiki holds a
  token (R22). A production server logs no requests.
- `e2e/support/database.ts`: `emptyTestDatabase()` keeps `FileLinkKey` like `AuthSecret`, because a server of the
  tests keeps the key in memory; a helper signs a token for the tests with the stored key, generating it as the
  service does when there is none, from a grant, a version, an `exp` and optional fields to break.
- `src/lib/addresses.ts`: the address of a file with a token (`filePath()` with the query), for the tool of the next
  step and the tests.

### Test

- Unit, `src/proxy.test.ts`: a `GET` and a `HEAD` of a file address with `token` and without a cookie pass; a `POST`
  with `token`, a `GET` without `token` and a `GET` of another address with `token` are redirected to the login page
  as before (R9).
- Unit, `src/features/files/http.test.ts`, with the link service mocked: a valid token with `download` answers the file
  as an attachment (R10); `version=1`, two `token` queries, a value after `download` and another query answer 404
  (R10); an invalid token with the session of a user who may read the file answers 404 and does not read the session
  (R10); every refusal of the service answers the same status and body as a file that does not exist (R16); the
  answer has `Cache-Control: private, no-store`, `ETag`, the type and the name of the file (R17); a `GET` and a `HEAD`
  each write one `info` line with the fields of R23 and no part of the token (R22, R23).
- Unit, `src/features/files/link-service.test.ts`: each reason of a refusal is logged at its level without the token
  (R16, R22); a version id other than the current one gives `null` (R14); with the files off a valid token gives
  `null` (R24).
- Integration, `integration/file-link-service.test.ts`: a valid token gives the content of the current version; after
  a rename, a move, a new version, a revert and a delete of the file the token gives `null`, and so does the token of
  one file under the address of another and the token of a file of another folder (R14); after a delete and a restore
  to the same place it works again (R15); a revoked grant, a role lowered below the role of the grant and an expired
  token give `null` (R12, R13); no row is written for a download and `lastUsedAt` is unchanged (R6, R25).
- End-to-end, a new spec `e2e/file-download-links.spec.ts`, with users from `setUpProjects()` and tokens signed by the
  helper: a `GET` and a `HEAD` with a valid token and without a cookie download the image and the PDF with the type,
  the name, the security headers of the file address, among them `Cross-Origin-Resource-Policy: same-origin`, and
  `Cache-Control: private, no-store` (R9, R17); with `download` the file comes as an attachment (R10); an expired
  token, a token with a changed signature, a revoked grant, a new version of the file and a deleted file each answer
  the plain 404 of a missing file (R12, R13, R14, R16); a file downloads more often by link than the burst of the MCP
  rate limit (R26).
- End-to-end, `e2e/access.spec.ts`: a `GET` of a file address with `token` and without a cookie is not sent to the
  login page; a `POST` with `token` and a `GET` without it still are (R9).
- End-to-end: the complete `npm run test:e2e`, because the step changes `src/proxy.ts`, `next.config.ts` and
  `e2e/support/` (see "When a step is done" in `spec/step-plan-workflow.md`).
- Manual: run `npm run dev`, download a file with a signed link, and check that the output of the development server
  holds no part of the token (R22).

## The tool get_file_download_link

### Goal

Every MCP connection gets the read tool `get_file_download_link`, which returns a signed link to the current version
of an image or PDF of its folder, and the hint of every address field and the instructions of every connection name
it. Requirements: R1, R2, R3, R4, R5, R24, R26, R27.

### Build

- `src/features/files/link-service.ts`: the link of a file for the actor of MCP: it reads the file at the place as
  `read_file` does, so that a missing file, a deleted file and a file of another folder are not found (R2), answers
  `files-off` when the files directory cannot be used (R24), and otherwise signs a token with the grant of the
  connection, the id of the current version and `exp` set to now plus the lifetime, in whole seconds (R7, R18). It
  returns the name, the tab, the type and the size of the current version, the token and the time of expiry, as a
  `Result` with the codes `file-not-found` and `files-off`, and stores nothing (R6).
- `src/features/mcp/tool-schemas.ts`: the input of the tool is the input of `read_file` (R1); the output has `note`
  first, then the name, the tab, the type, the size, `downloadLink` and `expiresAt` in ISO 8601 in UTC (R4).
  `ADDRESS_HINT` adds "To download an image or PDF, get a short-lived link with get_file_download_link." (R27).
- `src/features/mcp/tools.ts`: the handler, run through `run()` like every tool, so that the call is logged with the
  grant, the user, the folder, the role, the tool, the tab, the file name and the outcome, and without the link (R5,
  R22). A missing file answers the tool error of `read_file` that points to `list_folder` (R2); `files-off` answers a
  tool error that says the files cannot be downloaded because the server has no place to keep them (R24). The link is
  the public URL of the wiki with the address of the file and `token` as its only query (R3).
- `src/features/mcp/server.ts`: the tool is registered for every role that may read, with `READ_ONLY` (R1); its
  description says that it gives a link that downloads the current version of one file without a login for a few
  minutes, and ends with `USER_TEXT_NOTE` (R4). `instructionsFor()` says that the tool gives a link that downloads one
  file for a few minutes, and that such a link must never be written into a page, because it expires and lets anyone
  who reads it download the file (R27).
- The call counts against the rate limit of MCP like every tool call; nothing else is needed for R26.

### Test

- Unit, `src/features/mcp/tools.test.ts` and the tests of the server: a Reader, a Writer and a Manager connection list
  the tool with `readOnlyHint` (R1); a call for an image and for a PDF each returns a link that starts with the public
  URL, has the path of the file address and `token` as its only query (R3); the result has `note` first and the fields
  of R4, and `expiresAt` equals the time of the call plus the lifetime to the second (R4); a page name, a missing file,
  a deleted file and a file of another folder each get the tool error of `read_file` and no link (R1, R2); with the
  files off the tool answers the error of R24 and no link; the log line of the call has the fields of R5 and no part
  of the token (R5, R22); the description ends with the note (R4); every address field description and the
  instructions of every role hold the sentences of R27.
- Unit, `src/features/files/link-service.test.ts`: the token of a link carries the grant of the connection, the id of
  the current version and `exp` of now plus the lifetime (R7); no row is written (R6).
- End-to-end, `e2e/file-download-links.spec.ts`: a Reader connection calls the tool and downloads the image with the
  link without a cookie (R1, R3); after the app is revoked on the account page the link answers 404 although it has
  not expired (R13); after a Writer uploads a new version of the PDF the link answers 404 and a new call gives a link
  that downloads the new bytes (R14); the tool call counts against the rate budget of the user (R26).
- End-to-end, `e2e/mcp-read.spec.ts`, the spec of the read tools: the tool is listed with the read tools, and the
  instructions hold its sentences (R1, R27); the other MCP specs that check the instructions or the address hint run as
  well.

## Spec tests

### Goal

Tests written from `spec/signed-file-links-requirements.md` alone, by an agent that does not read how the code is
built, find where the code and the requirements disagree.

### Build

- Start the `spec-tester` agent (`.claude/agents/spec-tester.md`) with `spec/signed-file-links-requirements.md` and
  wait for it, as "Step plans" in `spec/step-plan-workflow.md` says. Do not write these tests yourself.
- Keep the tests the agent keeps, such as `e2e/file-download-links-spec-tests.spec.ts` and unit or integration tests
  ending in `.spec-tests.test.ts`.
- Fix every finding with High confidence within the scope of this plan, and add back the failing test of its Evidence
  with the fix; any other finding stops the plan, as "When a step cannot be finished" says.

### Test

- The tests the agent keeps pass, together with the commands of "When a step is done".
- End-to-end: the specs the agent adds, and the specs of the code a fix changes.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in a new feature spec `spec/signed-file-links.md`, with the parts of "Feature specs"
   in `spec/step-plan-workflow.md`: the tool and its result, the link and its token, the checks of a download, the
   answer and its headers, the logs, the lifetime and the key, with pointers to `src/features/files/link-token.ts`,
   `src/features/files/link-service.ts`, `src/features/files/http.ts`, `src/proxy.ts`, the grants service and the
   tests. Move into it the rules and decisions of `spec/signed-file-links-requirements.md` that still hold, among them
   the lifetime bounds of `HIPPOWIKI_FILE_LINK_LIFETIME` as a number an operator relies on. Bring the other specs in
   line, each pointing to the new spec instead of repeating it:
   - `mcp.md`: the tool in "Tools" for every role, the sentence of the address hint and of the instructions, the tool
     among those whose description and result carry the note of "Prompt injection", and "no link that works without a
     login" of "Current limits" reworded for the signed links.
   - `attachments.md`: "Addresses and headers" says that an address with a valid token works without a login and
     answers with `Cache-Control: private, no-store`; the decision that rejected short-lived links and the current
     limit "no links to files that work without a login" are reworded.
   - `connected-apps.md` and `oauth.md`: revoking an app, revoking all apps, changing the password and the end of a
     grant also stop its links.
   - `container-image.md`: the variable `HIPPOWIKI_FILE_LINK_LIFETIME` under "Configuration", and the key of the links
     in the table `FileLinkKey` next to `AuthSecret`, with how to withdraw all links (delete its row and restart the
     server).
   - `architecture.md`: the proxy passes a `GET` or `HEAD` of a file address with `token` ("Login and sessions"), the
     file address checks a token instead of the session, the new modules of the files feature in the table of
     "Layout", `Cache-Control: private, no-store` of a download by link in "Security headers", and `FileLinkKey` among
     the single rows in "Database".
   - `testing.md`: the new end-to-end specs in the list of the specs of files and MCP, the helper that signs a token,
     and `FileLinkKey` among the tables that `emptyTestDatabase()` keeps.
2. Reword the item "Files through MCP" of `roadmap.md`, so that it keeps only what is still to come (uploads through
   MCP, and the content of files in tool results), now that an app can download a file with a link.
3. Check that `README.md` has all the commands a developer needs, and that its summary of what the prototype can do
   covers the download of files by AI apps with a signed link.
4. Delete this step file and `spec/signed-file-links-requirements.md`. Replace every requirement ID of that file in
   the comments of the code and the tests with the section of `spec/signed-file-links.md` that holds the rule now, or
   drop it with its sentence kept.
5. Update the spec catalog in `CLAUDE.md`: add `spec/signed-file-links.md` with the question it answers, and remove
   `spec/signed-file-links-steps.md` and `spec/signed-file-links-requirements.md`; change the entries of `mcp.md` and
   `attachments.md` only if their questions change.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes the comments of
  code and tests, so it is not documentation only: it runs `npm run check:all` and the complete `npm run test:e2e`,
  as the last step of the plan that changes anything but documentation.
- No requirement ID of `spec/signed-file-links-requirements.md` is left in `src/`, `integration/`, `e2e/` or `spec/`.
