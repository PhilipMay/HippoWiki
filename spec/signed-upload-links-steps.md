# Signed Upload Links – Steps

## Goal

An AI app connected through MCP with the role Writer or Manager puts an image or a PDF into its folder: the tool
`get_file_upload_link` checks everything it can and hands out a short-lived signed link for one upload, and the app
sends the bytes of the file to that link with a `POST`, such as the `curl` command of the result, without a login. The
file is stored as an upload in the browser would be, with the user of the connection as its uploader and MCP as the
way, so that the app can show it in the pages it writes. The plan is written from `spec/signed-upload-links-requirements.md`
(R1–R24) and builds on the download links of `spec/signed-file-links.md`.

## Scope

- In:
  - the lock version of each file in `read_file` and `list_folder` (R16)
  - the token of an upload link next to that of a download link, signed with the same key and lifetime, each refused
    as the other (R18, R24)
  - the link service of uploads: the checks before a link is handed out, and the upload by a link with its checks,
    records and logs (R2, R3, R5–R8, R12, R13, R20, R23)
  - the upload address with a token instead of a session: its query, its origin check, its answers and its logs (R4,
    R9, R11, R14, R15, R17, R19, R22, R23)
  - the MCP tool `get_file_upload_link` for Writer and Manager connections and the instructions of the connections
    (R1, R2, R3, R10, R13, R21)
- Not in (from the requirements):
  - files sent inside a tool call as base64, and files that the model writes itself, such as SVG or CSV
  - the wiki fetching a file from an address that the app names
  - uploads from chat clients that cannot send the bytes of a file themselves, such as claude.ai and Claude Desktop
  - moving, renaming, reverting and deleting a single file through MCP, which stay in the browser
  - the content of files in tool results
  - new types of files
  - withdrawing a single link
- Not in (of this plan): a change of the upload in the browser, of the download links or of `src/proxy.ts`, which
  already leaves the upload address out.

## Sessions

- A stop point after "Upload address with a token": the first session builds everything up to the upload by link, the
  second the MCP tool, the spec tests and the wrap-up.

## Checklist

- [ ] Lock version of files in MCP
- [ ] Token of an upload link
- [ ] Upload link service
- [ ] Upload address with a token
- [ ] MCP tool get_file_upload_link
- [ ] Spec tests
- [ ] Wrap-up

## Lock version of files in MCP

### Goal

An app can read the lock version of a file, which it states later for a new version (R16).

### Build

- Add the field `lockVersion` to `fileOutput` in `src/features/mcp/tool-schemas.ts`, described as the lock version of
  the file, counted up by every new version, move and rename, which `get_file_upload_link` takes for a new version.
  The name sets it apart from the version numbers of the file and from `versions`, the count of `read_file`.
- Fill it in `fileData()` of `src/features/mcp/tools.ts` from the lock version of the file that `read_file` and
  `list_folder` read (`FileWithPlace` and `FileSummary`/`FolderFile` of `src/features/files/service.ts`; add it to the
  summaries where they lack it). `search_pages` shares `fileOutput` and gives the field as well, which harms nothing.

### Test

- Unit, `src/features/mcp/tools.test.ts`: `read_file` and `list_folder` return the lock version of a file.
- Integration, `integration/file-service.test.ts`: the reads of the files give the lock version, one higher after a
  new version, a move and a rename.
- End to end, `e2e/mcp-read.spec.ts`: `read_file` and `list_folder` give the lock version, and after a new version
  uploaded in the browser it is one higher.

## Token of an upload link

### Goal

An upload link carries everything needed to check it, signed with the key of the download links, and neither kind of
link ever passes for the other (R24).

### Build

- Extend `src/features/files/link-token.ts`, a pure module, with the token of an upload link next to that of a
  download link: the same shape `<data>.<signature>`, the same alphabet, the same HMAC-SHA256 and the same strict
  check (shape, signature in constant time, then the data).
- The data of an upload link is a strict JSON object with its own `use`, `"file-upload-link"`, and `v` `1`, so that a
  download token fails the data check of an upload token and the other way round, and these fields:
  - `grant`: the id of the grant of the connection; the folder is the folder of the grant;
  - `tab`: the id of the tab, or `null` for the folder itself;
  - `name`: the name of the file with its extension;
  - `size`: the exact size in bytes that the app stated (R12);
  - `strip`: whether an image is written again without location and camera data (R13);
  - `file` and `lockVersion`: the id of the file and the lock version that a new version is based on, both `null`
    for a new file (R7);
  - `exp`: when the link expires, in whole seconds since 1970.
- Bound the data part so that the data of the longest valid name fits, and test that bound with the longest name;
  keep the bound of the download token as it is.
- Keep the lifetime check (`isWithinLifetime()`) and the expiry (`expiryOf()`) shared by both kinds.

### Test

- Unit, `src/features/files/link-token.test.ts`: an upload token signs and checks; every field is checked (a missing,
  an extra and a wrongly typed field each fail the data); a download token checked as an upload token and an upload
  token checked as a download token are both refused as `bad-data`; a changed signature, another spelling of the
  signature and characters outside the alphabet are refused; the data of the longest valid name fits the bound.
- No end-to-end spec: nothing that the app runs imports the new token yet.

## Upload link service

### Goal

The wiki checks a request for an upload link without the bytes, hands out a signed link, and stores an upload by such
a link only while the link is valid and its file passes every check of an upload in the browser (R2, R3, R5–R8, R12,
R13, R18, R20, R23).

### Build

- A new module `src/features/files/upload-link-service.ts`, next to `link-service.ts`, whose key (`getLinkKey()`) and
  lifetime (`HIPPOWIKI_FILE_LINK_LIFETIME`) it uses (R18, R24).
- `createUploadLink(actor, folderName, tabName, fileName, { size, lockVersion, stripMetadata })` for the actor of MCP:
  - checks, in the order of every content write and with the actor of MCP, the role `editFile`, the folder, the tab
    (it must exist in the folder), the name and its extension (`checkUploadName()` of the files service, by the names
    resolved to ids), the size (a whole number from 1 to `HIPPOWIKI_FILE_SIZE_LIMIT`), the files on (R3), then for a
    new file that the name is free at the place, and for a new version that the file exists there and has the lock
    version stated (R2);
  - returns each refusal as an error code that the tool turns into a message (step "MCP tool get_file_upload_link");
  - makes the token with the grant, the ids, the name, the size, the choice of the metadata (always `false` for a
    PDF, which is stored byte for byte), the file and the lock version, and the expiry the lifetime from now; it
    stores nothing (R20).
- `uploadByLink(token, folderName, tabName, fileName, body, contentLength)`:
  - checks the token as the download link does, in the same order and with the same log levels (R23): its shape,
    signature and data (`warn`), then its expiry against the lifetime, the grant with `callerOfGrant()` (R8), whether
    the files are on (`info`); every one of these failures is one result, "not accepted", for the plain 404 (R15);
  - checks that the address names the folder of the grant and the name of the link; another address is not accepted
    either;
  - looks up the tab of the link: a tab that is gone, or named otherwise than in the address, gets the reason that the
    tab was renamed or deleted (R15), logged at `info`;
  - uploads with `uploadFile()` of the files service as the actor of MCP of the grant (`inMcp()`), so that the version
    records the user of the connection and the channel `mcp` (R6), with the size, the choice of the metadata and the
    lock version of the link: `replace` is the lock version for a new version, and for a new file nothing, so that a
    name taken in the meantime is refused and never becomes a new version (R7, R20); for a new version it also checks
    that the file of that name at the place is the file of the link;
  - logs every refusal of a valid link at `info` with its reason, never the token.
- Extend `uploadFile()` of `src/features/files/service.ts` with an exact size in `UploadOptions` (`null` in the
  browser): the body is read up to that size, and a body with fewer or more bytes is refused with a new error code
  (`wrong-size`) and stores nothing, whatever `Content-Length` says (R12). The type, the decode of an image, the size
  limit, the full disk and the storing once of the same content stay as they are (R5). The browser maps the new code
  nowhere, because it never passes a size.
- Return with the stored file what the answer of an upload needs (R14): the size, the version number and the width
  and height of an image, from `uploadFile()` or a read after it.

### Test

- Unit, `src/features/files/upload-link-service.test.ts`, with the database and the store mocked as in
  `link-service.test.ts`: the order of the checks of both functions, a token of each kind of failure, the log levels
  and that no log line holds a token.
- Unit, `src/features/files/service.test.ts`: a body one byte shorter and one byte longer than the exact size is
  refused with `wrong-size`, and nothing is staged or stored.
- Integration, `integration/file-upload-link-service.test.ts` (new):
  - a link for a name against the rule, an extension of another type, a missing tab, a size over the limit, a taken
    name for a new file, a missing file and an old lock version for a new version each give an error and no link; the
    files off give `files-off` (R2, R3);
  - an upload by a link stores the file with the user of the connection and the channel `mcp` (R6); an image keeps
    no location data with the default choice and keeps its bytes with it turned off; a PDF keeps its bytes (R13);
  - a version uploaded in the browser after the link, and a file under the free name after the link, each make the
    upload fail and leave the file as it was (R7); a second upload by the same link is refused with the reason of a
    taken name or a changed file, and the file keeps the first upload (R20);
  - the upload is refused after its expiry and after a lowered lifetime (R18), after each way that ends a grant:
    revoked app, all apps revoked, the password changed with the choice to disconnect the apps, grant expired, role
    lowered or taken away, the same app connected again, OAuth off, no `HIPPOWIKI_PUBLIC_URL` (R8), and after the key
    is deleted and forgotten (R24);
  - HTML named `.png`, a PDF sent for a `.png` link and an image that does not decode are refused and store nothing
    (R5);
  - no page gets a new revision (R9).
- No end-to-end spec: nothing that the app runs calls the service yet.

## Upload address with a token

### Goal

An app uploads the file by a `POST` of its bytes to the upload address with the token as its only query, without a
login, and gets an answer it can act on (R4, R9, R11, R14, R15, R17, R19, R22, R23).

### Build

- In `handleUploadRequest()` of `src/features/files/http.ts`, decide by the query alone, before the session is read,
  as the file address does: a request with `token` is an upload by link, checked by the token alone, with or without
  a session cookie, and the session is not read (R4); a request without it goes on as before.
- The query of an upload by link is exactly one `token` and nothing else; `replace`, `strip`, a second `token` and
  every other query are refused with the plain 404 and store nothing (R22).
- An upload by link from another site is refused as in the browser: a foreign `Origin` or `Sec-Fetch-Site:
cross-site`; unlike the browser, a request without `Origin`, as `curl` sends it, passes (R17).
- The answers, as JSON:
  - a stored upload: `201` with the name, the tab, the type, the size, the version number, the width and height of an
    image, the wiki link and, for an image, the embed link, the same texts as `read_file` gives (R14);
  - a refused upload by a valid link: the status of the browser upload for the same reason, with a short message
    that says why and what to do, written for an app, not for the dialog of the browser: the type, the size not the
    stated one, an image that does not decode, the disk full, or in the meantime the name taken, the file changed, or
    the tab renamed or deleted (R15);
  - a link that is broken, forged, expired or no longer accepted: the same plain 404 for every reason, as a download
    link gets (R15).
- Log every stored upload by link at `info` with the grant, the user, the folder, the tab, the file name and the
  version number (R23), and never the token or the address with its query, also not in the log of an error (R11).
- Leave the upload by link out of the rate limit of MCP and out of "last used" of the connected app: it does not go
  through the MCP route, so nothing counts it; the tests show it (R19).
- Leave every upload address with a query out of `logging.incomingRequests` of `next.config.ts`, as every file address
  with a query is (R11).
- Add `uploadLinkPath()` to `src/lib/addresses.ts`, the upload address with `token` as its only query, next to
  `fileLinkPath()`.
- Add `signUploadLinkToken()` to `e2e/support/database.ts`, which signs an upload token with the key of the test
  database, as `signFileLinkToken()` does for downloads.

### Test

- Unit, `src/features/files/http.test.ts`: a request with `token` does not read the session; another query next to
  the token, a second token, a foreign `Origin` and `Sec-Fetch-Site: cross-site` are refused; a request without
  `Origin` passes; each error of the service maps to its status and message; every failure of the link gets the same
  status and body; the log of a stored upload holds the stated fields and no token.
- Unit, `src/lib/addresses.test.ts`: `uploadLinkPath()` for a file in the folder and in a tab.
- End to end, `e2e/file-upload-links.spec.ts` (new), with tokens signed by `signUploadLinkToken()` and requests
  without a session cookie:
  - an upload of a new image and of a new version of a PDF by link stores them; the details page names the user of
    the connection and MCP; the answer holds the details and links of R14 (R4, R6, R14);
  - the same upload with a session cookie of another user stores it with the user of the connection (R4);
  - `&replace=1`, `&removeMetadata=0` and a second `token` are refused and store nothing (R22);
  - a foreign `Origin` and `Sec-Fetch-Site: cross-site` are refused, the same upload without them is stored (R17);
  - one byte more and one byte less than the stated size are refused (R12);
  - an expired link, a forged link and a link of a revoked app get the same status and body (R15); a download token
    sent to the upload address and an upload token sent to the file address are refused (R24);
  - no page has a new revision after the upload (R9), and the MCP budget of the user and "last used" of the app on the
    account page are unchanged (R19).
- The complete end-to-end suite, because the step changes `next.config.ts` and `e2e/support/`; it is also the last
  step of the first session (see "Sessions").
- Manual: with the development server, an upload by link does not show its address with the token in the log of the
  server, while an upload in the browser, without a query, still shows (the filter of `next.config.ts` has no unit
  test).

## MCP tool get_file_upload_link

### Goal

A Writer and a Manager connection get the tool that hands out the link, with a result that holds everything to send
the file and to show it in a page, and the instructions say how (R1, R2, R3, R10, R11, R13, R21).

### Build

- Register `get_file_upload_link` in `src/features/mcp/server.ts` where `mayDo(role, "editFile")` holds, so a Writer
  and a Manager connection have it and a Reader connection does not, with the hints `WRITES`, like `create_page` (R1).
  The tool counts against the rate limit of MCP and is logged like every tool call, without the link or its token
  (R11, R19).
- Its input in `src/features/mcp/tool-schemas.ts`: `tab` (optional), `file`, the name with its extension, `size`, the
  exact size in bytes, `lockVersion` (optional: without it a new file, with it a new version of the file, as
  `read_file` gave it), and `removeMetadata` (optional, `true` by default; it removes location and camera data from
  an image and is ignored for a PDF) (R12, R13).
- `getFileUploadLink()` in `src/features/mcp/tools.ts` calls `createUploadLink()` and turns each refusal into a tool
  error that says what to do next: a tab that does not exist points to `list_folder`; a name against the rule names
  the rule; an extension of another type names the extensions; a size over the limit names the limit; a taken name
  says to state `lockVersion` from `read_file` for a new version; a missing file points to `list_folder`; an old lock
  version says to read the file again; the files off say that the server has no place to keep files (R2, R3).
- Its output, `fileUploadLinkOutput`, in this order: `note`, `name`, `tab`, `type`, `size` (the stated size),
  `uploadLink`, `expiresAt` in ISO 8601 in UTC, `curlCommand`, a ready `curl` command that sends a file to the link
  with a placeholder for its local path, `wikiLink` and, for an image, `embedLink`, the texts that `read_file` gives
  for the file after the upload (R21). The description of `uploadLink` says that it stores one upload, and that it
  must never be written into a page. The description of the tool ends with `USER_TEXT_NOTE`.
- The instructions in `src/features/mcp/server.ts` (R10): for a Writer and a Manager connection, name
  `get_file_upload_link`, say how a file is uploaded with it and added to a page with an embed or a wiki link, and
  warn that an upload link must never be written into a page, because it lets anyone who reads it upload into the
  folder until it expires; for a Reader connection, offer no uploading. No connection says any more that a file is
  uploaded only in the browser; moving, renaming and deleting a single file still are. Update the hint of the address
  fields (`ADDRESS_HINT`) only if it speaks of uploads.
- Update the tests and the tool counts that hold the old list of tools or the old instructions (Writer ten tools,
  Manager fourteen).

### Test

- Unit, `src/features/mcp/tools.test.ts`: each refusal of R2 and R3 gives its tool error and no link; the result holds
  the fields in the order of R21; the embed link is `null` for a PDF; `removeMetadata` defaults to `true`.
- Unit, `src/features/mcp/tools.test.ts`, where the list of tools and `instructionsFor()` are tested: a Writer and a
  Manager connection list the tool with its hints and their instructions name it and hold the warning; a Reader
  connection lists no such tool and its instructions offer no uploading (R1, R10).
- End to end, `e2e/file-upload-links.spec.ts`: the scenarios of the requirements through MCP:
  - a new screenshot: a Writer connection asks for a link for an image in a tab, runs the `curl` command of the result
    in a shell with the placeholder replaced by the path of a test image, adds the embed with `edit_page_content`, and
    the page shows the image; the details page names the user of the connection, through MCP (R21);
  - a new version: a Manager connection reads a PDF with `read_file`, asks for a link with its lock version and sends
    the file; the file has a new version and the old one stays in the list of versions;
  - a change at the same time: a version uploaded in the browser after the link makes the upload by link fail with the
    message that the file was changed, and the file stays as the browser left it.
- End to end, `e2e/mcp-write.spec.ts`, `e2e/mcp-manager.spec.ts` and `e2e/mcp-read.spec.ts` where they hold the list of
  tools or the instructions: a Reader connection that calls the tool changes nothing (R1).
- The log of a tool call, an upload and a refused upload holds no token (R11): unit tests of `run()` and of the upload
  address, and a look at the server log of the end-to-end run.

## Spec tests

### Goal

Tests written from the requirements alone check the contract of the tool and of the upload by link.

### Build

- Start the `spec-tester` agent (`.claude/agents/spec-tester.md`) with `spec/signed-upload-links-requirements.md` and
  wait for it. Keep the tests it writes, such as `integration/file-upload-links.spec-tests.test.ts` and
  `e2e/file-upload-links-spec-tests.spec.ts`.
- Fix each finding with High confidence within the scope of this plan, and add the failing test of its Evidence back
  with the fix; any other finding stops the plan (see "Step plans" in `spec/step-plan-workflow.md`).

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass, with the specs the step adds or changes.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built by extending `spec/signed-file-links.md` to the upload links: the tool
   `get_file_upload_link`, what an upload link holds, uploading with a link, its answers, its logs, and the shared key
   and lifetime, with pointers to `src/features/files/upload-link-service.ts`, the token in `link-token.ts`, the
   upload address in `http.ts` and the tests of this plan; move the rules and decisions of the requirements file that
   still hold into it, and into "Current limits" what is deliberately missing, among them that a link for a new file
   whose file is deleted within its lifetime can store once more, because the name is free again. Update the other
   specs that the requirements name under "Effect on existing features":
   - `attachments.md`: Writer and Manager connections upload new files and new versions with a link; moving,
     renaming and deleting a single file stay in the browser; the upload address takes a token instead of a session;
     its decision "Rejected for now: uploads through MCP" and its current limit change;
   - `mcp.md`: ten tools for a Writer connection and fourteen for a Manager connection, the instructions, and the lock
     version of each file in `read_file`, `list_folder` and `search_pages`;
   - `optimistic-locking.md`: a new version by link is based on the lock version carried in the link;
   - `container-image.md`: `HIPPOWIKI_FILE_LINK_LIFETIME` sets the lifetime of upload links as well;
   - `architecture.md`, `testing.md` or `tech.md` where a convention changed.
2. Remove uploading from the entry "Files through MCP" of `roadmap.md`, which keeps only the content of files in tool
   results.
3. Check that `README.md` has all the commands a developer needs, and that its summary of what the prototype can do
   covers uploads through MCP.
4. Delete this step file and `spec/signed-upload-links-requirements.md`. Replace each requirement ID (R1–R24) in the
   comments of the code and the tests by the section of `signed-file-links.md` that holds the rule now, or drop it
   with its sentence kept.
5. Update the spec catalog in `CLAUDE.md`: remove this step file and the requirements file, and change the question
   of `spec/signed-file-links.md` to cover uploading as well.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes comments in the code,
  so it runs `npm run check:all` and the complete end-to-end suite of the second session.
- `npm run docs:check` finds every file that the extended `signed-file-links.md` points to.
