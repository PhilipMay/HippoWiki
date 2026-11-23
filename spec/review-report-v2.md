# HippoWiki – Review Report

This file holds the open findings of every review, check and test of HippoWiki: issues, suggestions, nits and
questions, each written as `issue-report.md` describes. Each review has a part of its own, with its summary, scope and
method, findings and what it reviewed; the counts in the summary of a part are those of its open findings.

- A new review, check or test adds a part at the end of this file; it does not start a file of its own. A review that
  repeats an earlier one, such as a recheck, updates the part of that review.
- A fixed finding is deleted, as "Fixing a finding of the review report" in `step-plan-workflow.md` describes. A part
  whose last finding and last open question are gone is deleted, and this file with its last part.

## Security and code review

### Summary

- Verdict: no Blocker. The core holds: every page, query and Server Action checks the login, the admin rights and the
  owner of grants on the server; the session and OAuth secrets are random, stored as hashes and kept apart by kind; the OAuth server follows PKCE, exact redirect addresses, single-use codes and refresh rotation
  with reuse detection; the fetch of client metadata documents resists SSRF; Markdown cannot run script; and the
  tests cover the security rules of the specs well. The weak points are availability (a lockout per name in the default
  configuration), the password policy, the trust that the OAuth
  server gives to clients nobody verified, and documentation that ASVS Level 2 asks for.
- Findings: 95 in all, 0 Blocker, 0 Major, 60 Minor and 35 Nit (49 `issue:`, 17 `suggestion:`, 25 `nit:` and 4
  `question:`). Accepted deviations: 20. Of the 91 Suggestions with a confidence (a `question:` has none), 12 are High,
  46 Medium and 33 Low.
- To fix first: no finding, because none is a Blocker or Major.
- Not covered by this review: everything under "Checks on the deployment" (the reverse proxy and its TLS, the host,
  the network, backups, log storage and the settings of the GitHub repository); a scan of the image for
  vulnerabilities, because no scanner is installed on the review machine; the exact wording of BSI TR-03185-2 (see
  "Open questions"); a few checks that were not run on the local server and say so in their finding: the logout
  during a failed database (shown from the code), the load test of the hash queue, and the behaviour of other browser
  tabs and of password managers; and, until a security recheck, the page history (the revisions, their views, the
  comparison and the revert), the delete of a tab and the tools of a Manager connection, which came after the last
  recheck and are named in the threat model but in no "Reviewed" list.

### Scope and method

- Reviewed: all of `src/` without `src/generated/`, `prisma/` with its schema and migrations, `scripts/`,
  `Containerfile`, `.containerignore`, `next.config.ts`, `.github/` with the workflows and Dependabot, `package.json`
  and the installed dependencies, `LICENSE`, and `README.md` as far as the build and the release are concerned. The
  feature specs in `spec/` are the rules the code is checked against.
- Depth: the bearer tokens of users, OAuth and MCP in the most depth, because no review has seen them before.
- Date: 2026-11-14. The code is the state of the branch `main` on that day.
- Rechecked: 2026-11-16, after MCP per folder and role, the MCP write tools, folder roles, the view "AI apps" and
  optimistic locking. Every finding was checked again against the state of `main` on that day; none was fixed in
  between, three are fixed in part, and their Locations, Evidence and wording, the threat model and the "Reviewed"
  lists follow that state. Evidence from the local server is that of the first review unless it says otherwise.
- Rechecked again: 2026-11-17, after the Markdown parser with markdown-it, the limits of nesting and table cells, and
  the check of content after normalising line breaks. Every finding, the "Reviewed" lists and the threat model were
  checked against the state of `main` on that day. None was fixed or closed by a spec; one is fixed in part, in the
  documentation only (the admin password in the environment). The Locations, Evidence and "Reviewed" lists follow
  that state.
- Locations corrected: 2026-11-18, after the cleanup of the review of code quality. The files the Locations name and
  the passages that described code that has moved on follow the state of `main` on that day, and the threat model
  names the page history, the delete of a tab and the tools of a Manager connection.
- Rechecked: 2026-11-18, the same day. Every finding was checked again against the state of `main` on that day, each
  area by a read-only subagent, and every High confidence, every claim of changed code and a sample of the other
  reasons were checked against the code before they went into this report. None was fixed or fixed in part. Every
  Suggestion now has a confidence; a few Suggestions, Problems and Evidence quotes were brought in line with the
  code, and so were the "Reviewed" lists where a statement no longer held. Locations name the file and the function,
  constant, step or section, never line numbers, so that they do not drift. Evidence from the local server was not
  run again. The page history, the delete of a tab and the tools of a Manager connection were not reviewed in this
  recheck.
- Evidence comes from:
  - reading the code; each area was read by a read-only subagent with a fresh context, and every finding it returned
    was checked against the cited lines before it went into this report;
  - the existing commands: `npm run check`, `npm run test:coverage`, `npm run test:integration`, `npm run test:e2e`,
    `npm audit`, and the read-only commands `npm ls` and `npm audit signatures`;
  - requests sent with `curl` to a local server: `next dev` against a throwaway PostgreSQL container with the image of
    `scripts/Containerfile`, on its own port and without a volume, and the image of `npm run image:build`. No request
    went to any host other than `localhost`.
- The review changes no code. A finding that needs a fix describes the fix in its Suggestion.
- Each finding follows `issue-report.md`. Severities: Blocker (must be fixed), Major (should be fixed, real risk),
  Minor (worth improving), Nit (taste or a tiny point). When in doubt, the lower level, with the reason. Everything
  that lets someone without the right access read, change or delete data, or take over an account or a token, is at
  least Major. A claim that the review could not show is written as a `question:`. The confidence of a Suggestion is
  High, Medium or Low as `issue-report.md` defines it, and a `question:` has none.

### Standards and target level

- Target level: OWASP ASVS 5.0.0 Level 2. The ASVS IDs are those of the release tag `v5.0.0` of the ASVS repository.
  A Level 3 requirement is named only as a `suggestion:`, and only where it is cheap to meet.
- A deviation from a standard that a feature spec documents on purpose, with its reason, is not a finding: it is
  listed under "Accepted deviations" with the ID of the requirement and the place in the spec. A deviation that no
  spec documents is a finding.
- Standards and the versions that count:
  - General: OWASP Top 10:2025, OWASP ASVS 5.0.0, OWASP API Security Top 10 2023, CWE Top 25 2025, OWASP Cheat
    Sheet Series.
  - Login, passwords and sessions: NIST SP 800-63B-4 (2025).
  - OAuth: OAuth 2.0 Security Best Current Practice (RFC 9700), OAuth 2.1, RFC 7636 (PKCE), RFC 8414 (authorization
    server metadata), RFC 9728 (protected resource metadata), RFC 7591 (dynamic registration), RFC 8707 (resource
    indicators), RFC 9207 (the `iss` parameter), and the OAuth client ID metadata document draft.
  - MCP: the MCP specification, revision 2026-07-28 (authorization, security considerations, client registration,
    security best practices, Streamable HTTP transport); OWASP MCP Top 10 (2025); OWASP Top 10 for LLM Applications
    2025 (LLM01, prompt injection).
  - Next.js: the guides in `node_modules/next/dist/docs/01-app/02-guides/`, above all the data security guide, and
    the guides on Server Actions, authentication, self-hosting and the production checklist (the files
    `node_modules/next/dist/docs/01-app/02-guides/data-security.md` and its neighbours).
  - BSI: TR-02102-1 (version 2026-01) for cryptography; IT-Grundschutz modules CON.10 (development of web
    applications), APP.3.1 (web applications and web services), SYS.1.6 (containers) and OPS.1.1.5 (logging);
    TR-03183-2 (version 2.1.0) for an SBOM; TR-03185 (version 1.1.1), part 2, for open-source software.
- The Reference of a security finding names, where they apply: the OWASP Top 10:2025 category (for example A01 Broken
  Access Control), the ASVS ID, the CWE ID, and the section or requirement ID of any other standard (for example NIST
  SP 800-63B-4 3.1.1.2, RFC 9700 4.1, `CON.10.A14`).

### Threat model

#### Assets

- Page content, folders, tabs and the deleted pages.
- The revisions of a page, which keep the content, the user and the channel of every change for as long as the page
  exists.
- Accounts: user names, emails, the admin role, password hashes, the flag of a forced password change.
- Sessions and their cookies.
- OAuth: authorization codes, access and refresh tokens (stored as hashes), grants, client registrations and the cached client metadata
  documents.
- The secrets in the environment: the Better Auth secret, the database URL with its password, the initial admin
  password of the setup.
- The logs, with client addresses, user names and events.
- The build and release pipeline and the published container image.

#### Actors

- Someone without a login on the internet.
- A logged-in user, and an admin.
- An MCP client with an OAuth grant.
- A malicious OAuth client, or the host of a malicious client ID metadata document.
- A wiki author whose content reaches the agent of another user through the MCP tools (prompt injection).
- The agent or LLM client that reads the tool output.
- Someone with access to the logs or to a database backup.
- Someone who can change a dependency, a GitHub action or the base image (supply chain).

#### Entry points

- Public addresses, the exceptions in the `matcher` of `src/proxy.ts`:
  - `/login`, the login page, and its Server Action `logIn()`;
  - `/api/health`;
  - `/mcp` and every address below it, of which only the MCP addresses `/mcp/<folder-uuid>/<reader|writer|manager>`
    answer more than 404; their tools are `list_folder` and `read_page`, for a Writer also `create_page`,
    `replace_page_content`, `edit_page_content` and `move_or_rename_page`, and for a Manager also `delete_page`, `create_tab`, `rename_tab`
    and `delete_tab` (added after the review);
  - `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` with any path below it;
  - `/oauth/register` and `/oauth/token`;
  - `/_next/static/…`.
- Pages behind the login: `/`, `/folders`, `/folders/[folder]`, `/folders/[folder]/[item]`,
  `/folders/[folder]/[item]/[page]`, `/deleted-items/[folder]`, `/deleted-items/[folder]/[id]`, `/account`,
  `/users`, `/folder-roles`, `/change-password`, `/oauth/authorize` (the consent page), and the pages `not-found`,
  `error` and `global-error`; the views of a folder `?view=all`, `?view=roles` and `?view=mcp` (the view "AI apps") and
  its dialogs such as `?action=give-role`; the action `?action=delete` of a tab; the views of the history of a page
  `?view=history`, of a revision `?view=revision` and of a comparison `?view=compare`, also of a deleted page, and the
  action `?action=revert` (added after the last recheck).
- Other addresses of Next.js behind the login: the RSC payloads of the pages, and `/_next/image`, which answers 404
  because the image optimizer is switched off.
- Server Actions (`src/features/*/actions.ts`):
  - auth: `logIn()`, `changeFirstPassword()`, `logOut()`;
  - folder-roles: `giveRole()`, `changeRole()` (which also removes a role);
  - folders: `createFolder()`, `renameFolder()`, `createTab()`, `renameTab()`, `deleteTab()`;
  - pages: `createPage()`, `updatePageContent()`, `moveOrRenamePage()`, `deletePage()`, `restorePage()`,
    `revertPage()`;
  - grants: `revokeGrant()`;
  - users: `createUser()`;
  - oauth: `approve()`, `deny()`.
- Route handlers: `src/app/api/health/route.ts`, `src/app/mcp/[[...path]]/route.ts`, `src/app/oauth/register/route.ts`,
  `src/app/oauth/token/route.ts`, `src/app/.well-known/oauth-authorization-server/route.ts`,
  `src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts`.
- Outgoing requests: the fetch of client ID metadata documents in `src/features/oauth/metadata-fetch.ts`.
- Commands: the admin setup (`scripts/admin.ts`, in the image `scripts/image-admin.sh`), the start of the image with
  its migration (`scripts/image-start.sh`, `scripts/image-migrate.sh`).
- CI: the workflows in `.github/workflows/` and Dependabot (`.github/dependabot.yml`).

#### Trust boundaries

- The reverse proxy in front of the app, and its forwarding headers (`X-Forwarded-For`, `X-Forwarded-Host`,
  `X-Forwarded-Proto`), which the app trusts only from `HIPPOWIKI_TRUSTED_PROXIES`.
- The public URL `HIPPOWIKI_PUBLIC_URL`, from which the OAuth issuer and the addresses of the metadata are built.
- The database.
- The hosts that client ID metadata documents are fetched from.
- The MCP client and its model, which read the tool output.
- The package registry, GitHub Actions and the registry of the base image.

#### Threats by entry point

The letters are those of STRIDE: S spoofing, T tampering, R repudiation, I information disclosure, D denial of
service, E elevation of privilege. "Checked in" names the area of "Findings" (and the step of the plan) that checks
the threat.

##### Login page and `logIn()`

| STRIDE | Threat                                                                                              | Checked in                           |
| ------ | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| S      | Guessing passwords; bypassing the wait after failed logins with other spellings or forged addresses | Login, passwords, sessions and users |
| S      | Session fixation: an old session ID kept after the login                                            | Login, passwords, sessions and users |
| T      | CSRF of the login form (login CSRF)                                                                 | Browser security                     |
| R      | Failed and successful logins not logged with who, when and from where                               | Logging, errors and failure handling |
| I      | The answer shows whether a user name exists (message, status or timing)                             | Login, passwords, sessions and users |
| I      | An open redirect through the way back `next`                                                        | Access control                       |
| D      | Locking out a known user on purpose; tying up the server with password hashes                       | Login, passwords, sessions and users |
| E      | A login path the specs do not describe (other endpoints of Better Auth)                             | Login, passwords, sessions and users |

##### Pages behind the login and their RSC payloads

| STRIDE | Threat                                                                                        | Checked in                                           |
| ------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| S      | A page that reads data without `requireUser()`; relying on the cookie check of the proxy only | Access control                                       |
| T      | Script injected through Markdown, names or titles (stored XSS)                                | Content                                              |
| T      | Clickjacking of a page, above all the consent page                                            | Browser security                                     |
| I      | Whole records (hashes, internal fields) passed to Client Components or the RSC payload        | Browser security                                     |
| I      | Authenticated pages kept in a shared cache or the browser after a logout                      | Browser security                                     |
| I      | The `not-found` and error pages reveal whether an item exists, or internal details            | Access control; Logging, errors and failure handling |
| I      | Deleted pages visible in a list, the page view or the deleted pages of another folder         | Content                                              |
| D      | Large folders or pages, slow regular expressions in names or Markdown, Markdown that expands  | Content                                              |
| E      | `/users` without a server-side check of the admin role                                        | Access control                                       |
| E      | The forced password change does not block the other pages                                     | Login, passwords, sessions and users                 |

##### Server Actions

| STRIDE | Threat                                                                                                | Checked in                                             |
| ------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| S      | An action called without a session, or with a session whose password change is forced                 | Access control                                         |
| T      | CSRF: an action called from another site; `allowedOrigins` too wide behind the reverse proxy          | Browser security                                       |
| T      | Arguments the form never sends: other ids, extra fields (mass assignment), the last editor            | Access control; Content                                |
| T      | Two writes at the same time break a rule that is checked first and written later                      | Content; Connected apps                                |
| R      | Writes, admin actions, token and consent events not logged                                            | Logging, errors and failure handling                   |
| I      | An action returns more than the page shows; error answers with internal details                       | Browser security; Logging, errors and failure handling |
| E      | `revokeGrant()` or a grant action with the id of another user's object (IDOR)                         | Access control; Connected apps                         |
| E      | `createUser()` without the admin check on the server                                                  | Access control                                         |
| E      | A write or a role action without the check of the actor's role on the folder                          | Access control                                         |
| E      | `approve()` used to approve a request the user never saw (CSRF, a changed client or redirect address) | OAuth                                                  |

##### `/api/health`

| STRIDE | Threat                                               | Checked in                        |
| ------ | ---------------------------------------------------- | --------------------------------- |
| I      | The answer names versions or internal details        | Configuration and container image |
| D      | Each call opens a database query that can be flooded | Configuration and container image |

##### The MCP addresses `/mcp/<folder-uuid>/<reader|writer|manager>`

| STRIDE | Threat                                                                                                      | Checked in                                       |
| ------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| S      | A tool runs without a valid access token; an expired, revoked or forged one is accepted                     | Connected apps; MCP server                       |
| S      | A refresh token, a code or the access token of another folder address accepted as an access token           | Connected apps; OAuth; MCP server                |
| T      | Tool arguments that break the name rule reach a service                                                     | MCP server                                       |
| T      | Prompt injection: wiki content written by one user steers the agent of another, to read or to write         | MCP server                                       |
| T      | A write tool overwrites a change made after the version it is based on                                      | Content                                          |
| T      | A request from a browser of another site (foreign `Origin`)                                                 | MCP server; Browser security                     |
| R      | Tool calls not logged with the grant that made them                                                         | MCP server                                       |
| I      | Deleted pages listed or read; error answers with internal details; tokens in answers or logs                | MCP server; Logging, errors and failure handling |
| D      | Large request bodies, batches or large answers tie up the server                                            | MCP server                                       |
| E      | A Reader connection reaches a write tool; a connection reaches another folder or goes past the current role | Connected apps; MCP server                       |

##### OAuth endpoints and the consent page

| STRIDE | Threat                                                                                                          | Checked in                           |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| S      | A client pretends to be another (name, metadata document, redirect address); a registration takes over a client | OAuth                                |
| S      | A code stolen in transit used without PKCE or with `plain`                                                      | OAuth                                |
| T      | Redirect address not matched exactly: codes sent to an address of the attacker                                  | OAuth                                |
| T      | A code or a refresh token used twice; two refreshes at the same time                                            | OAuth                                |
| T      | The folder or the role widened between the consent and the token; a role above the user's own approved          | OAuth                                |
| R      | Registrations, consent given and revoked, reuse of a refresh token not logged                                   | Logging, errors and failure handling |
| I      | Error answers with internal details; tokens cached by a proxy (`Cache-Control`)                                 | OAuth; Browser security              |
| I      | Metadata that is built from the `Host` header and points clients elsewhere                                      | OAuth                                |
| D      | Unlimited registrations; slow or large metadata documents                                                       | OAuth                                |
| E      | SSRF: the metadata fetch reaches the local network, the loopback address or the cloud metadata service          | OAuth                                |
| E      | A revoked grant whose access or refresh tokens still work                                                       | OAuth                                |

##### Outgoing fetch of client ID metadata documents

| STRIDE | Threat                                                              | Checked in |
| ------ | ------------------------------------------------------------------- | ---------- |
| S      | DNS rebinding: the address checked is not the address fetched       | OAuth      |
| T      | Keys such as `__proto__` in the document (prototype pollution)      | OAuth      |
| I      | Redirects or numeric host forms lead the fetch to a private address | OAuth      |
| D      | A host that answers slowly or with a huge body                      | OAuth      |

##### Admin setup and the start of the image

| STRIDE | Threat                                                                                | Checked in                           |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------ |
| S      | A default account or a default password                                               | Login, passwords, sessions and users |
| T      | The setup overwrites an existing admin, or runs twice                                 | Login, passwords, sessions and users |
| I      | A password printed into a log; secrets, `.env` files or source maps in the image      | Configuration and container image    |
| D      | A failed migration that still starts the server                                       | Configuration and container image    |
| E      | The server runs as root or can write its own files; forged forwarding headers trusted | Configuration and container image    |

##### CI workflows, dependencies and the release

| STRIDE | Threat                                                                                        | Checked in   |
| ------ | --------------------------------------------------------------------------------------------- | ------------ |
| S      | An action or a dependency replaced (tags instead of commit SHAs, missing registry signatures) | Supply chain |
| T      | A pull request writes a cache that a release reads; `pull_request_target` with foreign code   | Supply chain |
| I      | Secrets reach a pull request from a fork                                                      | Supply chain |
| E      | Workflow tokens with more permissions than needed; an unsigned image without provenance       | Supply chain |
| D      | Known vulnerable dependencies that stay unpatched                                             | Supply chain |

### Findings

This section holds only open findings, and the counts in "Summary" of this part are those of the open findings. A fixed finding is
deleted, and the rest of this report and the other documents are brought in line in the same change, as "Fixing a
finding of the review report" in `step-plan-workflow.md` describes.

#### Access control and the entry points of requests

##### nit: `createUser()` and the write actions of folders check the form before the rights, so a refused caller sees form errors instead of "not found"

- Location: `src/features/users/actions.ts`, `createUser()`; `src/features/folder-roles/actions.ts`, `giveRole()` and
  `changeRole()`; `src/features/pages/actions.ts`, `createPage()`; `src/features/folders/actions.ts`, `createTab()`
- Severity: Nit. Nothing is written and nothing secret is revealed, because the form rules are public; only the answer
  differs from the one the specs promise.
- Category: correctness
- Problem: `createUser()` calls `requireUser()`, then `parseUserFormData()` and returns the field errors for an
  invalid name. Only then does it call the service, whose admin check gives `not-allowed`, which the action maps to
  `notFound()`. The service checks the admin before it parses (`src/features/users/service.ts`, `createUser()`), so
  only the parse in the action comes first. The actions of folder roles and of content follow the same order:
  `giveRole()` returns field errors, `createPage()` field errors, "tab gone" or "folder gone", and `createTab()` field
  errors or "folder gone", before the service checks the role of the actor on the folder. For `changeRole()` only a submission without a user or an
  intent is answered before the rights; a role that is no role goes to the service, which refuses a caller who is no
  Owner first.
- Impact: a logged-in user who is not the admin, or who has no role or too low a role on a folder, can tell that the
  action exists and, for a folder, that the folder id is well-formed. This breaks the comment of `createUser()` ("for a
  user, like the dialog, the action is not found"), the rule in `users-and-login.md` (section "User list and creating
  users") that "a crafted request creates nothing" next to a dialog that is not found, and the rule in `folder-roles.md`
  that "a form of such a folder shows the not-found page". It is no way past the checks.
- Evidence: called as the user `dave` on the local server with `Next-Action` of `createUser` and the name `Bad Name`:
  `200 OK` with `{"fieldErrors":{"name":["Use lowercase letters, digits and single hyphens"]}}`. With a valid name the
  answer is `404` with `NEXT_HTTP_ERROR_FALLBACK;404`, and no user is created. In the code of `giveRole()`:
  `const input = parseGiveRoleFormData(formData); if (!input.success) return { fieldErrors: input.fieldErrors };`
  before `folderRoleService.giveRole()`.
- Suggestion (optional): let the services validate the input after their checks of the rights and drop the parse from
  the actions, or check the rights in the action before the parse; in both cases answer a malformed folder id in
  `createPage()` and `createTab()` with `notFound()`, as `giveRole()` does, because the pages and folders services
  answer it with "folder gone" before they check the role.
- Confidence: Medium. Two fixes are offered and the answer a refused caller sees changes; which fix suits each action
  is still open.
- Reference: OWASP A01:2025 Broken Access Control; ASVS 8.2.1; CWE-204.

##### suggestion: `OPTIONS` on an MCP address lists `GET` and `DELETE` as allowed, though both answer 405

- Location: `src/app/mcp/[[...path]]/route.ts`, the exports `POST`, `GET` and `DELETE`; `src/features/mcp/http.ts`,
  `handleMcpRequest()`, the check of the method
- Severity: Nit. Nothing is exposed; the requirement is Level 3.
- Category: correctness
- Problem: Next.js answers `OPTIONS` itself for a route that does not export it, with an `Allow` header built from the
  exported methods. The route of the MCP addresses exports `GET` and `DELETE` only to answer them with 405 and
  `Allow: POST`, so `OPTIONS` names methods that the endpoint refuses. The comment "Anything but `POST` answers 405"
  does not hold for `OPTIONS`.
- Impact: a client or scanner gets two different lists of methods for the same endpoint.
- Evidence: in the first review, `curl -si -X OPTIONS http://localhost:3100/mcp` gave `204 No Content` with
  `allow: DELETE, GET, HEAD, OPTIONS, POST`, and a `GET` gave `405` with `allow: POST`. Since the MCP addresses per
  folder and role, the plain `/mcp` answers 404 before the method is looked at, so the same comparison now holds for
  `/mcp/<folder-uuid>/reader`; the route still exports no `OPTIONS`.
- Suggestion (optional): export `OPTIONS` from `src/app/mcp/[[...path]]/route.ts` and hand it to `handleMcpRequest()`, so that it
  answers 405 with `Allow: POST` like `GET` and `DELETE`.
- Confidence: Medium. That Next.js answers `OPTIONS` itself was checked in its docs and code, but no test calls the
  route with `OPTIONS` and the Suggestion names none.
- Reference: ASVS 4.1.4 (Level 3); RFC 9110 section 10.2.1.

##### Reviewed

- Files read: `src/proxy.ts`, `src/features/auth/session.ts`, `src/lib/auth.ts`, `src/lib/addresses.ts`, the
  `actions.ts` of all seven features (auth, folder-roles, folders, grants, oauth, pages, users), the `queries.ts` of
  folders, folder-roles, pages, oauth, grants, mcp and users, the `service.ts` of auth, users, grants and folder-roles
  in full and the writes of folders, pages and oauth, the `forms.ts` of grants, users, oauth, auth, folders,
  folder-roles and pages, `src/features/users/records.ts` and `schema.ts`, `src/features/mcp/http.ts` and `tools.ts`,
  every `page.tsx` and `route.ts` under `src/app/`, `layout.tsx`, the error pages, `src/components/AppHeader.tsx`,
  `next.config.ts`, `e2e/access.spec.ts`.
- `requireUser()` before every read and write (ASVS 8.3.1, `CON.10.A2`): every page calls it first (the login page
  uses `getCurrentUser()`, the password change `requireSession()`), every query that reads the database after
  `connection()` (`listMcpAddresses()` in `src/features/mcp/queries.ts` only builds addresses from a folder the route
  has read already), and every exported Server Action first, outside its `try` blocks. No layout, loading or template
  file reads data. An action without a cookie is answered by the proxy with `303` and
  `x-action-redirect: /login;push` (local server).
- Rights by folder role (ASVS 8.2.1, 8.3.1): the services check the role of the actor on the folder before anything
  else but the actor (`mayReadFolder()` and `mayDo()` with the functions of each role in `folder-roles.md`); giving,
  changing and removing roles is for Owners, with the last Owner kept under a row lock (`changeRole()` and
  `removeRole()` of the folder-roles service); `listAllFolderRoles()` returns `null` for a user, so `/folder-roles` is
  for admins only. The order of the form check and the role check in some actions is the first finding.
- The forced password change blocks everything else: `requireUser()` redirects to `/change-password`
  (`src/features/auth/session.ts`), `authenticateAccessToken()` refuses the access token of such a user, and the OAuth
  token exchange and refresh refuse it too.
- The `matcher` of the proxy: every exception is anchored with `$`, and `mcp(?:/.*)?$` and
  `oauth-protected-resource(?:/.*)?$` let every path below them pass; `_next/static/` is not anchored. These lead only to catch-all routes that check the bearer
  token themselves or answer 404 for other paths, and to static files. Next.js matches the raw and the decoded path and
  resolves `..` before matching. In the first review, `/MCP`, `/%6Cogin`,
  `/.well-known/oauth-protected-resource/../../users` and `/_next/static/../../users` all gave `307` to the login, and
  `/login/` and `/api/health/` `308` to the address without the slash; since the MCP addresses per folder and role, an
  address such as `/mcp/x` passes the proxy and the MCP adapter answers it with 404 (`parseMcpPath()` in
  `src/features/oauth/schema.ts`, called by `handleMcpRequest()` in `src/features/mcp/http.ts`).
- Nothing relies on the proxy alone: all pages and actions check again, and the public route handlers check bearer
  tokens or PKCE themselves.
- Admin only on the server (ASVS 8.2.1): `createUser()` returns `not-allowed` in `src/features/users/service.ts`;
  `listUsers()` serves every account, as `users-and-login.md` says, and leaves out whose password change is pending for
  a user; `listAllFolderRoles()` returns `null` for a user. On the local server, `createUser` called as `dave` with a
  valid name gives `404` and creates nothing.
- Arguments a form never sends (ASVS 2.2.1, 2.2.2): bound ids are parsed in every action (`parseFolderId`,
  `parseTabId`, `parsePageId`, `parseGrantId`) and again in the services; route segments go through `parseName` and
  `parsePageSegment`. A tab of another folder is refused by the composite foreign key in the pages service.
- Object level (ASVS 8.2.2, CWE-639): `revokeGrant()` deletes with the grant id and the user id in one condition
  (`src/features/grants/service.ts`); the revoke dialog of `/account` accepts only the caller's own grant ids;
  `listGrants()` filters by user; codes and grants are bound to the user of the session. `revokeGrant` called with
  the id of another user's grant gives the not-found page and the grant stays (`e2e/account.spec.ts`,
  `integration/grant-service.test.ts`).
- Content by folder (ASVS 8.2.2, 8.4.1): in the browser a user sees and changes only what the role on a folder allows
  (`folder-roles.md`). Through MCP a connection reaches only the folder of its address: `readableFolderWhere()` in
  `src/features/folder-roles/service.ts` adds the folder of the connection to every read, `authenticateAccessToken()`
  refuses the access token at any other address (`other-address`), and it reads the current role of the user on every
  request, so the lower of that role and the role of the connection counts (`mcp.md`, "The connections" and "The
  actor of MCP"; `folder-roles.md`, "Decisions"). Checked by `e2e/mcp-access.spec.ts` and the integration tests of the grant
  and folder-roles services.
- Mass assignment (ASVS 8.2.3, 15.3.3): every spread of parsed data comes from a `z.object` schema, which strips
  unknown keys; the last editor always comes from `requireUser()` or, for a write through MCP, from the user of the
  access token; the folder and the role of a grant come from the checked MCP address of the authorization request,
  `mustChangePassword` is only ever set to `true` for a new user, and the field is `input: false` in Better Auth.
- Missing and repeated parameters (ASVS 15.3.7, CWE-234): `parseChoice()` and `safeNextPath()` refuse arrays, the
  OAuth readers treat a repeated parameter as missing (a finding in "OAuth"), and `authenticateAccessToken()` requires
  the exact folder and role of the address.
- The image optimizer of Next.js (OWASP A02:2025, ASVS 15.2.3, CWE-1188): the app uses no `next/image`, so
  `images: { unoptimized: true }` in `next.config.ts` switches the optimizer off, and Next.js answers `/_next/image`
  with 404 before it reads the query; the server fetches and processes nothing. Without a session cookie the proxy
  sends it to the login page like every other address. Checked by `e2e/access.spec.ts`: with a session the address,
  with a page or with a static file as `url`, answers 404, also in a production build.
- HTTP methods: Next.js answers 405 for every method a route does not export; on the local server `GET`, `PUT` and
  `DELETE /oauth/token` and `POST /api/health` give `405`. `OPTIONS` on an MCP address is the exception (finding
  above).
- Open redirects (ASVS 3.7.2, `CON.10.A4`, CWE-601): `safeNextPath()` in `src/lib/addresses.ts` is used wherever
  `next` is read, and every other redirect is built from stored names. On the local server a login with `next` set to
  `//evil.example/`, `/\evil.example`, `https://evil.example`, `/\/evil.example`, ` //evil.example` and
  `javascript:alert(1)` redirects to `/folders`; `/%2F%2Fevil.example` and `/%09/evil.example` stay paths on the same
  site. A request with `Host: evil.example` gets a relative `Location`.
- Existence leaks (CWE-200): without a session, every request ends at the proxy or at `requireUser()` before any
  not-found; another user's grant, an unknown and a malformed one give the same not-found; a folder without a role
  answers like one that does not exist; the error pages show only the digest. The only difference found is the first
  finding.
- Standards cross-check: business flows keep their order (ASVS 2.3.1): the forced password change comes before every
  other page, and an OAuth code exists only after consent and is exchanged only with its verifier; combined items are
  checked together (ASVS 2.1.2, 2.2.3): a tab must belong to the folder of its page (composite foreign key), a redirect
  address to its client.

#### Browser security: headers, CSRF, caching and data sent to the client

##### issue: the Content Security Policy sends `base-uri 'self'` where ASVS asks for `'none'`, without a reason in a spec

- Location: `next.config.ts`, `SECURITY_HEADERS`; `e2e/security-headers.spec.ts`, `SECURITY_HEADERS`;
  `scripts/image.sh`, the smoke test of the security headers; `spec/architecture.md`, section "Security headers"
- Severity: Minor. Raw HTML in Markdown is not rendered, so nobody can inject a `<base>` element today; a Level 2
  requirement is still not met, and no spec gives the reason.
- Category: security
- Problem: ASVS 3.4.3 asks for a global policy with `object-src 'none'` and `base-uri 'none'`. The policy sends
  `base-uri 'self'`. Neither Next.js nor Material UI emits a `<base>` element, so `'none'` costs nothing.
- Impact: after an HTML injection, an injected `<base href="/x/">` could still move relative addresses of scripts and
  links to other paths of the site.
- Evidence: every response of the local server carries
  `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data:`.
- Suggestion (required): change it to `base-uri 'none'` in `next.config.ts`, with the comment there ("`base-uri` and
  `form-action` keep links and forms on this site"), in the expectation of `e2e/security-headers.spec.ts`, in the
  smoke test in `scripts/image.sh` and in `architecture.md` (section "Security headers", unless the nit on that
  section is fixed first).
- Confidence: High. One fix; no `<base>` element is used in `src/`, Next.js or Material UI, and the test of the
  headers with its check for CSP violations and the smoke test of the image show that it works.
- Reference: OWASP A02:2025 Security Misconfiguration; ASVS 3.4.3; `CON.10.A14`.

##### issue: the answers of the MCP addresses carry no `Cache-Control: no-store`

- Location: `src/features/mcp/http.ts`, `refusal()`, `roleTooLow()` and `handleMcpRequest()` (the answers of
  `serveLegacy()` and of the handler of `getModernHandler()`)
- Severity: Minor. Browsers and shared caches do not store the answer to a `POST` with an `Authorization` header
  without explicit freshness, so the real risk is small.
- Category: security
- Problem: the OAuth adapters set `Cache-Control: no-store` and `Pragma: no-cache` on every answer
  (`src/features/oauth/http.ts`). The MCP adapter sets nothing, the MCP SDK sets `Cache-Control` only on SSE streams,
  which are off, and Next.js adds nothing to the answer of a route handler. An MCP answer holds the content of wiki
  pages.
- Impact: a misconfigured cache in front of the app or an HTTP cache in an MCP client could keep page content that
  the server never marked as private.
- Evidence: in the first review, a `POST` with `Authorization: Bearer <token>` and a `tools/list` request gave
  `200 OK` and `content-type: application/json` with no `Cache-Control`. The adapter of the MCP addresses
  `/mcp/<folder-uuid>/<reader|writer|manager>` still sets no header on any answer, and the SDK sets `Cache-Control` only on
  `text/event-stream` answers.
- Suggestion (optional): set `Cache-Control: no-store` on every answer in `handleMcpRequest()`, on the refusals and on
  the answers of `serveLegacy()` and of the handler of the SDK alike, and add the rule to `mcp.md` next to the one in
  `oauth.md`.
- Confidence: Medium. One fix, but no test is named, and it was not tried whether the headers of the answers of the
  SDK can be changed in place.
- Reference: OWASP A02:2025 Security Misconfiguration; ASVS 14.3.2, 14.2.2; CWE-525.

##### issue: Client Components get whole `TabSummary` rows with fields they do not show

- Location: `src/features/pages/components/NewPageView.tsx`, `NewPageView()`, the view "New page" of both the folder
  and the tab route; `src/features/pages/components/PageView.tsx`, `PageView()`;
  `src/features/pages/components/DeletedPageView.tsx`, `DeletedPageView()`, which pass the rows on to
  `PageNameAndPlaceFields.tsx`; the type `TabSummary` in `src/features/folders/service.ts`
- Severity: Minor. Every user with a role on the folder can see these fields in the tab list anyway, and the forms are
  shown only to the roles that may use them, so nothing is disclosed; the rule that only the shown fields reach the
  browser is broken.
- Category: security
- Problem: `NewPageForm`, `MoveOrRenamePageDialog` and `RestorePageDialog` take `tabs: { id: string; name: string }[]`,
  but the pages pass the result of `listTabs()`, a `TabSummary` with `updatedAt` and `lastEditedBy` as well.
  TypeScript accepts the extra fields, and React serialises the whole objects into the RSC payload.
- Impact: none today. A field added to `TabSummary` later reaches the browser without anyone noticing.
- Evidence: the RSC payload of `/folders/csrf-same?action=new` on the local server, for a folder with one tab,
  contains the keys `"updatedAt"` and `"lastEditedBy"` once each.
- Suggestion (optional): map before passing, `(await listTabs(folder.id)).map(({ id, name }) => ({ id, name }))`, or
  add a query that returns only `{ id, name }`.
- Confidence: Medium. Two fixes are offered, a map in each view or a new query, and no test checks what the RSC
  payload holds.
- Reference: OWASP A01:2025 Broken Access Control; ASVS 15.3.1; CWE-213; the Next.js data security guide, "Passing data
  from server to client".

##### suggestion: the modules that read the database or hold secrets do not import `server-only`

- Location: `src/lib/db.ts`, `src/lib/auth.ts`, `src/lib/env.ts`, `src/lib/password-hash.ts`, every
  `src/features/*/service.ts` and `src/features/*/*-service.ts` and every `queries.ts` (with those of folder-roles,
  grants and mcp),
  `src/features/oauth/secret.ts` and `issuer.ts`, `src/features/mcp/http.ts` and `tools.ts`
- Severity: Minor. It is defence in depth: the lint rules in `eslint.config.mjs` already stop routes and components
  from importing `@/lib/db`, `@/lib/auth` and the values of services.
- Category: security
- Problem: the Next.js data security guide asks for a data access layer marked with `import "server-only"`, so that
  an import into a Client Component fails the build. No file in `src/` has it. The lint rules cover only `@/lib/db`
  and `@/lib/auth` (everywhere in `src/` except the services and `src/lib/`) and the values of services (only for
  files under `src/app/` and `components/`): a Client Component could import `@/lib/env`, a `secret.ts` or a
  `queries.ts` without an error.
- Impact: a later change could bundle server code into the browser. Secrets would not leak, because only
  `NEXT_PUBLIC_` variables are inlined, but the rule that keeps data access on the server would no longer be enforced.
- Evidence: `grep -rn "import ['\"]server-only['\"]" src` finds nothing.
- Suggestion (optional): add `server-only` as a dependency and `import "server-only";` to the modules above, give
  Vitest and the esbuild bundle of `scripts/admin.ts` (`npm run build:admin`) the `react-server` condition or an alias
  to its empty module, because without that condition the module throws on import, check that the tests and
  `scripts/admin.ts` still run, and say so in "Layout" in `architecture.md`.
- Confidence: Low. Without the condition the marker would make `scripts/admin.ts` throw, and how the admin script and
  Vitest resolve it was not tried.
- Reference: OWASP A06:2025 Insecure Design; the Next.js data security guide, "Preventing client-side execution of
  server-only code" and "Auditing".

##### suggestion: a logout leaves wiki pages open in other tabs and clears nothing in the browser

- Location: `src/features/auth/actions.ts`, `revalidateEverything()` and `logOut()`
- Severity: Minor. It matters only on a shared computer, and the pages are `no-store` already.
- Category: security
- Problem: `logOut()` ends the session, revalidates every route and redirects the tab that sent the form. Other open
  tabs keep the rendered pages until someone navigates in them, and the answer sends no `Clear-Site-Data`.
  `users-and-login.md` (section "Login and logout") does not mention other tabs.
- Impact: someone who uses the browser after the user logged out can read the pages still open in other tabs.
- Evidence: `revalidateEverything(); redirect(loginPath());` with no signal to other tabs and no `Clear-Site-Data`
  header. Not checked in a browser.
- Suggestion (optional): send `Clear-Site-Data: "cache"` with the answer of the logout and let other tabs follow a
  logout through a `BroadcastChannel`; otherwise name the behaviour under "Current limits" in `users-and-login.md`.
- Confidence: Low. It needs a choice between a change in the browser and naming the limit, and whether the answer of
  a Server Action can carry `Clear-Site-Data` was not checked.
- Reference: OWASP A07:2025 Authentication Failures; ASVS 14.3.1; CWE-524.

##### suggestion: the Content Security Policy has no `default-src`, `script-src` or `connect-src` at all

- Location: `next.config.ts`, `SECURITY_HEADERS`
- Severity: Minor
- Category: security
- Problem: the documented reason ("Material UI and Next.js insert inline styles and scripts") rules out a policy
  without `'unsafe-inline'`, but not an allowlist. Without `default-src`, `script-src` and `connect-src`, injected
  script could load code from any host and send data anywhere.
- Impact: no effect while no script can be injected (see the area "Content"); a weaker second line of defence if one
  ever can.
- Evidence: the policy above.
- Suggestion (optional): the cheap step is `default-src 'self'; script-src 'self' 'unsafe-inline'` (plus
  `'unsafe-eval'` only in development), `style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'`; the
  check for CSP violations in `e2e/security-headers.spec.ts` would catch a page that breaks. Nonces are possible as
  well, because every page renders per request: the proxy would have to run for `/login` too, create the nonce and set
  the policy, and the emotion cache of Material UI would take the nonce. CSP reporting (ASVS 3.4.7) and
  `Cross-Origin-Opener-Policy` (ASVS 3.4.8) are Level 3; COOP would have to leave out `/oauth/authorize`, which a
  connector may open in a popup. A new policy also changes the expected value in `e2e/security-headers.spec.ts`, the
  smoke test in `scripts/image.sh` and "Security headers" in `architecture.md`.
- Confidence: Medium. Two ways are offered, and whether Next.js, Material UI and `npm run dev` run under the
  allowlist was not tried; only the check for CSP violations would show it.
- Reference: ASVS 3.4.3, 3.4.7, 3.4.8; the Next.js guide on the Content Security Policy.

##### nit: `/oauth/register` reads a JSON body of any media type, so another site can register clients from its visitors' browsers

- Location: `src/features/oauth/http.ts`, `handleRegister()`
- Severity: Nit. The endpoint is public on purpose and needs no credentials; the only gain is spreading registrations
  over the address groups of the visitors.
- Category: security
- Problem: RFC 7591 section 3.1 has the client send `application/json`. `handleRegister()` parses any body, so a form
  of another site with `enctype="text/plain"` can send a valid JSON body as a simple request, without a CORS
  preflight. With `HIPPOWIKI_TRUSTED_PROXIES` set, a page with many visitors registers clients from many address
  groups, past the limit per group; with `0`, it fills the one shared group.
- Impact: the table of clients fills up until unused clients are removed; the shared group can be blocked for an hour.
- Evidence:
  `curl -si -X POST -H 'Content-Type: text/plain' --data '{"redirect_uris":["http://127.0.0.1:9999/cb"],"client_name":"textplain"}' http://localhost:3100/oauth/register`
  gives `201 Created` with a `client_id`.
- Suggestion (optional): answer 400 `invalid_client_metadata` unless the media type is `application/json`, with the
  helper `mediaTypeOf()` of `src/features/oauth/schema.ts` that the token endpoint uses already.
- Confidence: Medium. One fix with a helper that exists, but it rests on every AI app sending `application/json` when
  it registers, which was not checked, and no test is named.
- Reference: ASVS 3.5.2; RFC 7591 section 3.1; CWE-352.

##### nit: `architecture.md` writes out the values of the security headers instead of pointing to `next.config.ts`

- Location: `spec/architecture.md`, section "Security headers"
- Severity: Nit
- Category: docs
- Problem: the spec repeats the HSTS value and the whole CSP string, which `next.config.ts`,
  `e2e/security-headers.spec.ts` and the smoke test in `scripts/image.sh` hold already, so a change has to be made in
  four places.
- Evidence: "`Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; …`"
- Suggestion (optional): name the headers and their reasons, and point to `SECURITY_HEADERS` in `next.config.ts` for
  the values.
- Confidence: High. One fix in one section with no change of behaviour, and `npm run docs:check` checks the
  reference to `next.config.ts`.
- Reference: `issue-report.md`, last item of the checklist.

##### Reviewed

- Files read: `next.config.ts`, `src/proxy.ts`, `src/app/layout.tsx`, the error pages, every route handler,
  `src/features/oauth/http.ts`, `src/features/mcp/http.ts`, `src/features/oauth/components/`,
  `src/features/pages/components/MarkdownContent.tsx`, `src/components/AppHeader.tsx`, the return values of every
  `"use server"` file, the props of every `"use client"` file (with `FolderRoleList`, `GiveRoleDialog`, `McpAddress`
  and `RevokeAppDialog`), `eslint.config.mjs`, `e2e/security-headers.spec.ts`;
  the Next.js sources of the origin check of Server Actions and of route handlers.
- CSRF of Server Actions (ASVS 3.5.1, `CON.10.A15`, CWE-352): Next.js compares the host of the `Origin` with
  `X-Forwarded-Host` or `Host` and refuses a mismatch and `Origin: null`; `serverActions.allowedOrigins` is not set,
  which is right. On the local server `createFolder` with `Origin: http://evil.example` gives
  `500 Invalid Server Actions request` and creates nothing, and the log says the `x-forwarded-host` "does not match
  `origin`". A request without `Origin` passes, but browsers always send one with a `POST`, and the cookie is
  `SameSite=Lax`.
- Login CSRF: the login is a Server Action under the same check. On the local server, the login form sent without
  JavaScript and with `Origin: http://evil.example` gives `500` and sets no cookie. The logout and the consent buttons
  are Server Actions as well.
- `/oauth/token` uses no cookie: the code with its verifier and the refresh token are the credentials. An MCP address
  needs a bearer token and refuses a foreign `Origin` with `403` (on the local server in the first review, and in
  `src/features/mcp/http.test.ts`); other addresses below `/mcp` answer 404.
- No state-changing `GET` (ASVS 3.5.3): the `?action=` addresses only open dialogs.
- Clickjacking (ASVS 3.4.6, CWE-1021): `frame-ancestors 'none'` and `X-Frame-Options: DENY` are on every response.
- Headers on every response (ASVS 3.4.1, 3.4.4–3.4.6, `CON.10.A14`, `APP.3.1.A21`): on the local server a page, its
  RSC payload, a 404, a redirect of the proxy, a Server Action answer, `/api/health`, a `/.well-known/` document and a
  static file all carry HSTS, the CSP, `X-Frame-Options`, `nosniff` and `Referrer-Policy: same-origin`.
- JSON answers (ASVS 3.2.1, 4.1.1): `application/json` with `nosniff`; JSON takes no `charset` parameter, and 4.1.1
  asks for one only for text and XML types.
- Caching of pages and actions (ASVS 14.3.2, 14.2.2, `CON.10.A7`): every page renders per request; on the local
  server pages, RSC payloads and action answers carry `Cache-Control: no-store`, and the OAuth answers `no-store` and
  `Pragma: no-cache`. There is no `staleTimes`, `cacheComponents` or `use cache`, so nothing of one user is cached for
  another.
- CORS (ASVS 3.4.2, CWE-942): no response sends an `Access-Control-*` header, and no file in `src/` sets one. On the
  local server a preflight to the MCP endpoint and requests with a foreign `Origin` to `/oauth/token`,
  `/oauth/register` and `/.well-known/…` got none.
- Data sent to the client (ASVS 15.3.1): the actions return small form states; `createUser` returns the generated
  first password, on purpose and once. The RSC payloads of `/users` and `/account` on the local server contain no
  hash, email, `mustChangePassword` or user id; the ids of grants appear only as list keys and in the revoke
  addresses. The roles view of a folder passes the id and the name of each user with a role to `FolderRoleList`, and
  for an Owner the own id, and the give-role dialog the ids and names of the candidates: the actions need the ids, and
  only users with a role on the folder see them. The view "AI apps" passes the MCP addresses with the id of the folder,
  on purpose. The only extra fields are those of the `TabSummary` finding.
- Error answers: the error pages show only the digest; the 500 answers of MCP say only `server_error`, those of
  OAuth `server_error` with a fixed `error_description` that names no cause.
- Markdown links (CWE-1022): no link opens a new window (no `target="_blank"` in `src/`), and
  `Referrer-Policy: same-origin` keeps page addresses on the site.
- Browser storage (ASVS 14.3.3): no `localStorage` or `sessionStorage` in `src/`. The clipboard is only written, with
  the generated first password and an MCP address (`CreateUserDialog.tsx`, `McpAddress.tsx`), on a click.
- The prefix of the session cookie (ASVS 3.3.3) is part of the area "Login, passwords, sessions and users".
- Standards cross-check: no `postMessage`, `localStorage` or `innerHTML` in `src/` (ASVS 3.5.5); the client side uses
  current versions of React and Next.js and no plugins (ASVS 3.7.1); no data goes to trackers or other parties, and
  the telemetry of Next.js, Prisma and Better Auth is off (ASVS 14.2.3); separate applications on different host names
  (ASVS 3.5.4) is a question of the deployment.

#### Login, passwords, sessions and users

##### issue: the admin cannot end the sessions of another account

- Location: `src/features/users/` (no such action); `spec/users-and-login.md`, section "Current limits"
- Severity: Minor. Every account can now change its own password and log out its other browsers at any time; only
  an account that its owner can no longer use, because someone else changed its password, needs the admin, and then a
  change in the database.
- Category: security
- Problem: the admin cannot end the sessions of a user, neither those of one user nor all of them. "Current limits"
  lists it, without the steps for an operator.
- Impact: after a takeover of an account whose password was changed by the attacker, the sessions of the attacker stay
  valid for up to 30 days unless an operator deletes them in the database.
- Evidence: the actions of `/users` are the list and "New user"; no service function ends the sessions of another
  account.
- Suggestion (required): add "end all sessions of a user" for the admin on `/users`, or document the limit as a
  decision with its reason and the steps for an operator.
- Confidence: Low. It needs a product decision: a new control for the admin, or the limit documented as a decision.
- Reference: OWASP A07:2025 Authentication Failures; ASVS 7.4.5; `CON.10.A12`.

##### issue: in the default configuration a single client can lock any known user, the admin included, out of the login

- Location: `src/lib/client-address.ts`, `clientAddressGroup()`, the case of 0 trusted proxies;
  `src/features/auth/service.ts`, `reserveAttempt()`; `spec/users-and-login.md`, sections "Decisions" and "Current
  limits";
  `spec/container-image.md`, section "Configuration"
- Severity: Minor. "Current limits" already accepts that a few address groups can keep a name locked; the default
  only lowers that to one client, and existing sessions keep working. It is no takeover.
- Category: security
- Problem: with `HIPPOWIKI_TRUSTED_PROXIES=0`, the default, every login is in the group `shared`, so the wait per name
  and group becomes a wait per name alone. Five wrong passwords from anyone make the next login for the name wait 1
  minute, doubling up to 15 minutes, and the right password is refused during the wait. The decision that "the owner
  of an account does not share a wait with a stranger" does not hold in the default, and no spec says that one client
  is enough.
- Impact: anyone on the internet can keep the admin, whose name is always `admin`, or any user whose name they learned
  (every account sees every user name on `/users`), from logging in for as long as they keep sending about four
  requests an hour.
- Evidence: on the local server (no trusted proxy), after 5 wrong logins for `erin` the correct password is refused
  with "Too many failed logins. Please try again in 1 minute."; after 5 for `bob`, `bob` is refused the same way.
- Suggestion (required): say in "Current limits" and in `container-image.md` that `HIPPOWIKI_TRUSTED_PROXIES` must be
  set for every deployment that the internet reaches, and why; better, log a warning at the start of a production
  server while it is `0`. The "login budget for known clients" in `roadmap.md` would close it.
- Confidence: Medium. The finding has an Alternative, and whether a production server should warn at every start
  while the value is `0` is a trade-off that was not tried.
- Alternatives: let a client that holds a valid earlier session pass the wait per name.
- Reference: OWASP A07:2025 Authentication Failures; ASVS 6.1.1, 6.3.1; CWE-645; NIST SP 800-63B-4 3.2.2.

##### issue: the minimum password length is 8, not the 15 NIST asks for a single factor, without a documented reason

- Location: `src/features/users/limits.ts`, `PASSWORD_MIN_LENGTH`; `src/features/users/schema.ts`,
  `passwordSchema`; `spec/users-and-login.md`, section "Passwords"
- Severity: Minor. ASVS 6.2.1 is met (8, with 15 recommended); the deviation from NIST is not documented.
- Category: security
- Problem: the password is the only factor, and NIST SP 800-63B-4 then asks for at least 15 characters. The length is
  counted in UTF-16 code units, while NIST counts each code point as one character, so four emoji pass the minimum.
  "Passwords" gives the reason for counting UTF-16 code units (Better Auth counts them so), but none for 8 instead of 15.
- Impact: shorter passwords than the standard allows; the list of common passwords holds back only the 10,000 most
  common of them.
- Evidence: on the local server the forced change refuses 7 characters ("Password must be at least 8 characters") and
  accepts 8, 15, 64 and 128 characters; 129 are refused.
- Suggestion (required): raise the minimum for new passwords to 15 and count code points for it, or document 8 as a
  decision with its reason.
- Confidence: Low. The Suggestion offers two fixes, and raising the minimum to 15 is a change users see that needs a
  product decision.
- Reference: OWASP A07:2025 Authentication Failures; ASVS 6.2.1; NIST SP 800-63B-4 3.1.1.2; CWE-521.

##### issue: a login does not end the session that the request already carries

- Location: `src/features/auth/service.ts`, `logIn()`, the call of `auth.api.signInUsername()`
- Severity: Minor. It needs a login sent while already logged in (a stale tab, or another user in the same browser),
  because `/login` redirects a logged-in user.
- Category: security
- Problem: `signInUsername` of Better Auth creates a new session and sets its cookie, but does not delete the session of
  the cookie the request sent. ASVS 7.2.4 asks that the current session token is ended. The spec says a user has "one
  [session] per browser".
- Impact: after user B logs in where A was logged in, A's session and every copy of its cookie stay valid for up to 30
  days.
- Evidence: on the local server, the login action called with `dave`'s session cookie sets a new cookie, the sessions
  of `dave` go from 11 to 12, and the old cookie still gets `200` on `/account`.
- Suggestion (required): end the session of the incoming cookie in `logIn()`, for example with `auth.api.signOut()`
  before the sign-in.
- Confidence: Medium. How the cookie headers of `signOut()` and `signInUsername()` combine in one Server Action was
  not checked, nor whether a failed login should also end the old session.
- Reference: OWASP A07:2025 Authentication Failures; ASVS 7.2.4; CWE-613.

##### issue: the session cookie uses the prefix `__Secure-`, not `__Host-`, and no spec says why

- Location: `src/lib/auth.ts`, `createAuth()` (`useSecureCookies`); `spec/users-and-login.md`, section "Sessions"
- Severity: Minor
- Category: security
- Problem: in production Better Auth names the cookie `__Secure-better-auth.session_token`, with `Path=/` and no
  `Domain`. ASVS 3.3.3 asks for `__Host-` unless a cookie is meant for other hosts; nothing here is shared.
- Impact: a sibling subdomain can set a cookie of the same name for the parent domain (cookie tossing). The token is
  signed, so no session can be forged, but a user can be logged out or logged in as the attacker.
- Evidence: Better Auth builds the name as `${secureCookiePrefix}${name}` with the prefix `"__Secure-"`; on the local
  server (development) the cookie is `better-auth.session_token; HttpOnly; SameSite=lax`.
- Suggestion (required): in production, turn `useSecureCookies` off and set `secure: true` in
  `advanced.defaultCookieAttributes` and the prefix `__Host-better-auth` in `advanced.cookiePrefix`, because with
  `useSecureCookies` on Better Auth puts `__Secure-` in front of every cookie name, also a custom one; pass the same
  `cookiePrefix` to `getSessionCookie()` in `src/proxy.ts`; or document `__Secure-` as a decision.
- Confidence: Low. The Suggestion offers to document `__Secure-` as a decision, and the cookie options of Better Auth
  that a `__Host-` name needs were read in its code but not tried.
- Reference: OWASP A02:2025 Security Misconfiguration; ASVS 3.3.3; NIST SP 800-63B-4 5.1.1.

##### issue: one client can fill the queue of the password hashing and make every login "busy"

- Location: `src/lib/password-hash.ts`, `MAX_CONCURRENT_HASHES`, `MAX_HASH_WAIT_MS` and `createLimiter()`;
  `spec/container-image.md`, section "What the environment has to provide"
- Severity: Minor. The spec names a limit per client at the reverse proxy, but not that without it one client blocks
  every login.
- Category: security
- Problem: each counted login costs one hash, unknown names are hashed like known ones (against enumeration), and
  every unknown name gets 5 tries. A few hashes run at once and the others wait up to 10 seconds in an unbounded queue,
  so about 100 requests per second from one client keep it full.
- Impact: nobody can log in, change the first password or be created while the flood lasts.
- Evidence: `const waiting: (() => void)[] = [];`; the spec says only "a reverse proxy can add that limit". Not
  tried on the local server, because it is a load test.
- Suggestion (required): say in `container-image.md` that a limit per client on `POST /login` at the reverse proxy is
  needed and what happens without it; optionally refuse at once when the queue is long.
- Confidence: Medium. The rate of about 100 requests per second was estimated, not measured under load, and refusing
  at once when the queue is long is a trade-off.
- Reference: OWASP A06:2025 Insecure Design; ASVS 15.2.2, 2.4.1; CWE-770; `CON.10.A17`.

##### issue: the session rules document no inactivity timeout and no number of sessions per user

- Location: `spec/users-and-login.md`, section "Sessions"; `src/lib/auth.ts`, `createAuth()`, the `session` options
  (`SESSION_LIFETIME_SECONDS`, `disableSessionRefresh`)
- Severity: Minor
- Category: docs
- Problem: the absolute lifetime of 30 days is documented. That there is no inactivity timeout, and why, is not, and
  neither is that the number of sessions per user is unlimited (ASVS 7.1.1, 7.1.2, 7.3.1).
- Impact: an unattended browser stays logged in for 30 days, and an operator cannot see that this is a choice.
- Evidence: "A user can have several sessions at the same time, one per browser."
- Suggestion (required): add a decision: 30 days absolute, as NIST SP 800-63B-4 allows for AAL1, no inactivity timeout
  and why, no limit of sessions; or add an inactivity timeout.
- Confidence: Low. The Suggestion offers two fixes, a decision or an inactivity timeout, and either needs the choice
  and the reason of the user.
- Reference: ASVS 7.1.1, 7.1.2, 7.3.1; `CON.10.A3`.

##### issue: first passwords never expire

- Location: `src/features/users/service.ts`, `createUser()` and `ensureAdmin()`;
  `spec/users-and-login.md`, section "Current limits"
- Severity: Minor
- Category: security
- Problem: a generated first password, and `HIPPOWIKI_ADMIN_PASSWORD`, stay valid until the user changes them. ASVS
  6.4.1 asks that system-generated first passwords expire after a short time. "Current limits" lists "no expiry of
  first passwords" without a reason.
- Impact: whoever reads a first password that the admin passed on (chat, mail, a note) can log in weeks later, set a
  password and own the account.
- Evidence: the model `User` has no field for when the first password was issued, and `logIn()` checks none.
- Suggestion (required): refuse a login with a pending change some days after the account was created, or document
  the reason.
- Confidence: Low. The period, and what an expired user and the admin then do without a reset of the password, need a
  product decision, or the limit is documented.
- Reference: OWASP A07:2025 Authentication Failures; ASVS 6.4.1; NIST SP 800-63B-4 3.1.1.1.

##### issue: the missing second factor and the missing notification of a password change are limits without a reason

- Location: `spec/users-and-login.md`, section "Current limits" ("no mail, no TOTP, no passkeys, …")
- Severity: Minor
- Category: docs
- Problem: ASVS 6.3.3 (Level 2) and `CON.10.A16` ask for a second factor; `CON.10.A1` asks that a user learns of a
  change of the password (ASVS 6.3.7 is Level 3). The spec lists both as limits, without the reason, the accepted risk
  or what lowers it.
- Impact: neither can count as an accepted deviation.
- Evidence: "no mail, no TOTP, no passkeys, no sign-in with other providers", with no entry under "Decisions".
- Suggestion (required): add a decision with the reason and the risk accepted, or add TOTP (the `twoFactor` plugin of
  Better Auth; TOTP is in `roadmap.md`).
- Confidence: Low. Accepting the risk or adding TOTP is a decision for the user.
- Reference: OWASP A07:2025 Authentication Failures; ASVS 6.3.3; `CON.10.A16`, `CON.10.A1`.

##### issue: every session stores a client address from an unchecked `X-Forwarded-For`, and the user agent, which no spec mentions

- Location: `src/lib/auth.ts`, `createAuth()`, the `advanced` options (no `ipAddress`)
- Severity: Minor
- Category: security
- Problem: Better Auth fills `Session.ipAddress` from `X-Forwarded-For` when the header has a single entry, whatever
  `HIPPOWIKI_TRUSTED_PROXIES` says, so a client that reaches the server without a proxy that replaces the header
  chooses it, and stores the `User-Agent` as sent. Neither is used or shown, and no spec names them.
- Impact: personal data kept for 30 days without a purpose, and a forged address that can mislead a later look at the
  database.
- Evidence: on the local server, a login with `X-Forwarded-For: 198.51.100.7` and `User-Agent: probe-agent/1` stores
  `198.51.100.7|probe-agent/1` in the newest `Session` row; without the header the address is
  `0000:0000:0000:0000:0000:0000:0000:0000`.
- Suggestion (required): switch the tracking of the address off (`advanced.ipAddress.disableIpTracking`) and drop the
  user agent, or document both and fill the address from `clientAddressGroup()`.
- Confidence: Medium. The Suggestion offers two fixes, and Better Auth has no switch for the user agent, so dropping it
  needs a database hook of Better Auth that was not tried.
- Reference: ASVS 14.1.1; CWE-348; CWE-359.

##### suggestion: the seed resets the admin to a public password on whatever database `DATABASE_URL` names

- Location: `prisma/seed.ts`, `main()`, the upsert of the known users; `prisma/known-users.ts`, `KNOWN_ADMIN` and
  `KNOWN_USER`
- Severity: Minor. The seed is not in the image and does not run at its start, so it needs an operator's mistake.
- Category: security
- Problem: `npm run db:seed` upserts `admin` with a known password and no pending change, also over an existing admin,
  and has no guard against a production database; the known user of the seed has a public password too.
- Impact: one wrong run against production gives anyone the admin account.
- Suggestion (optional): refuse to run with `NODE_ENV=production`, or when the database has users the seed did not
  create.
- Confidence: Medium. The Suggestion offers two different guards, and it was not checked whether any setup of
  development or tests seeds with `NODE_ENV=production`.
- Reference: ASVS 6.3.2; CWE-798.

##### suggestion: session tokens are stored in plain text, next to the secret that signs them

- Location: `prisma/schema.prisma`, models `Session` and `AuthSecret`; `src/lib/auth.ts`, `readSecret()`
- Severity: Minor
- Category: security
- Problem: the tokens of OAuth are stored only as hashes, but session tokens in plain text, and the signing secret is in the
  same database.
- Impact: anyone who can read the database or a backup can build valid cookies for every session for up to 30 days.
- Suggestion (optional): say in `container-image.md` that backups and read access to the database are as sensitive as
  the sessions; optionally keep the secret outside the database.
- Confidence: Medium. The sentence for `container-image.md` is clear, but keeping the secret outside the database goes
  against the decision that a container needs only `DATABASE_URL` and `HIPPOWIKI_ADMIN_PASSWORD`.
- Reference: ASVS 13.3.2; CWE-312.

##### nit: the spec says passwords are not normalised, but not why

- Location: `spec/users-and-login.md`, section "Passwords"
- Severity: Nit
- Category: docs
- Problem: NIST SP 800-63B-4 3.1.1.2 recommends normalisation (NFKC or NFKD); ASVS 6.2.8 asks to verify the password
  exactly as received. The code follows ASVS, but the spec does not name the trade-off: a password typed in NFD on one
  device and NFC on another does not match.
- Evidence: "Nothing is trimmed or normalised".
- Suggestion (optional): add the reason as a decision.
- Confidence: Low. The reason for the decision has to come from the user.

##### question: do password managers fill the login form and save the new password at the change?

- Location: `src/features/auth/components/LoginForm.tsx`, `LoginForm`, the name and password fields;
  `src/features/auth/components/ChangePasswordForm.tsx`, `ChangePasswordForm`, the three password fields
- Severity: Nit
- Category: usability
- Problem: the fields are `readOnly` until hydration, and some browsers skip read-only fields when they fill at load;
  the change form has no `autocomplete="username"` field, so a password manager may not know the account.
- Suggestion (optional): try it in Chrome and Firefox; add a hidden user name field with `autocomplete="username"` to
  the change form.
- Reference: ASVS 6.2.7.

##### Reviewed

- Files read: `src/lib/auth.ts`, `src/lib/password-hash.ts`, `src/lib/client-address.ts`,
  `src/lib/client-address-probe.ts`, `src/lib/names.ts`, the files of `src/features/auth/` and `src/features/users/`,
  `src/app/change-password/page.tsx`, `src/proxy.ts`, `scripts/admin.ts`, `prisma/seed.ts`, `prisma/known-users.ts`,
  the auth models of `prisma/schema.prisma`; Better Auth 1.7 (the username plugin, sessions, cookies, sign-out,
  `changePassword`, ids, the address helper).
- Hashing (ASVS 11.4.2, NIST SP 800-63B-4 3.1.1.2): Argon2id with m = 19 MiB, t = 2, p = 1, exactly the minimum of the
  OWASP Password Storage Cheat Sheet, which is the source of the parameters (TR-02102-1 names Argon2id without
  parameters). A random salt of 128 bits; the parameters are in each hash, so they can be raised. Unknown names get a
  hash of the same cost.
- Enumeration (ASVS 6.3.8 is Level 3, CWE-204): an unknown name and a wrong password give the same message, status,
  count and wait. On the local server both answers are `200` with "Invalid user name or password", in about 40 ms
  each over four tries each; `Bob`, which breaks the name rule, is answered without a hash in 17 ms, but no user can
  have such a name. The login tells nobody whether a name exists; every account sees the user names on `/users` anyway
  (`users-and-login.md`, "Decisions"), and an Owner learns it in the give-role dialog too.
- The maximum (ASVS 6.2.9): 128 characters are accepted, counted the same way on every path. No composition rules
  (ASVS 6.2.5).
- Unicode (ASVS 6.2.8): the password is used exactly as typed when set and when checked.
- Common passwords and context words (ASVS 6.2.4, 6.2.12, 6.1.2, 6.2.11, NIST SP 800-63B-4 3.1.1.2, CWE-521): every
  new password, from the forced change and from `HIPPOWIKI_ADMIN_PASSWORD`, is refused when it is one of the 10,000
  most common passwords of 8 to 128 characters, in any case (`src/features/users/common-passwords.ts`, generated from
  a SecLists list of breach data pinned to one commit, which meets 6.2.12 without an outgoing request), or when it is
  built only from the user name or a context word (`hippowiki`, `hippo`, `wiki`, `admin`, documented in
  `users-and-login.md`) plus digits and symbols. Checked by the unit tests of `src/features/users/schema.ts` and
  `common-passwords.ts`, the integration tests of `ensureAdmin()` and `changeFirstPassword()`, the end-to-end spec
  `e2e/change-password.spec.ts`, and on the local server, where the forced change of a fresh user refuses
  `password123`, `qwertyuiop`, `12345678` and `hippowiki2026`. The list stays out of the bundles for the browser
  (searched in `.next/static` after a build).
- Paste and autocomplete (ASVS 6.2.7): `type="password"`, `autocomplete` `username`, `current-password` and
  `new-password`, and nothing blocks paste (see the question above for the filling). The change needs the current
  password (ASVS 6.2.3).
- The generated first password: 20 characters from 57 by `crypto.randomInt`, about 116 bits, and its change is forced.
- The wait (ASVS 6.3.1): `Dave` breaks the name rule and is refused without being counted; `dave` is trimmed and
  counted as `dave`. With 0 trusted proxies `X-Forwarded-For` is not read. Both counts are written with conditional
  writes in one transaction, so parallel logins get no more guesses; a success clears the count of its name and
  group. On the local server the wait came after the fifth failure for `bob`.
- Session ids (ASVS 7.2.3): 32 characters of `[A-Za-z0-9]` from `crypto.getRandomValues`, about 190 bits (32 characters
  in every `Session` row of the local server). A new token at every login and at the forced change, which also ends all
  sessions of the user. The cookie carries an HMAC-SHA256 of the token with a 256-bit secret, and every check reads
  the database.
- Cookie flags (ASVS 3.3.1, 3.3.2, 3.3.4): `HttpOnly`, `SameSite=Lax`, and `Secure` in production; the prefix is a
  finding above.
- Ending sessions (ASVS 7.4.1): a logout deletes the session row; on the local server the old cookie gets `307` to the
  login after the logout. Users cannot be deleted; `Session` and `OAuthGrant` cascade on a deleted user.
- The forced change blocks everything: every query and action calls `requireUser()`, only `/change-password` uses
  `requireSession()`, and access tokens and grants check `mustChangePassword`.
- Better Auth (ASVS 6.3.4): only `signInUsername`, `signOut`, `getSession`, `changePassword` and `verifyPassword` are
  called; no route
  handler is mounted, sign-up is off, and a lint rule keeps `@/lib/auth` to the auth service. No login path the specs
  do not describe.
- Admin setup (ASVS 6.3.2, CWE-798): it creates the admin only when there is none, never overwrites it, never logs the
  password, and fails without the variable, so there is no default password.
- Seed and known users: not in the image and not run at its start (see the suggestion above for a guard).
- Standards cross-check: password fields have `type="password"` (ASVS 6.2.6); passwords never expire by time (ASVS
  6.2.10); there are no password hints or secret questions (ASVS 6.4.2); every session is checked against the database
  on the server (ASVS 7.2.1) with a random reference token (ASVS 7.2.2); the absolute lifetime of 30 days is documented
  (ASVS 7.3.2); every page that needs a login shows "Log out" in the header (ASVS 7.4.4); the only change of an
  authentication attribute, the password, needs the current password, and so does the approval of an app (ASVS 7.5.1;
  see "Connected apps");
  there is no reset of a forgotten password, which `users-and-login.md` lists as a limit, so ASVS 6.4.3 has nothing to
  check.
- Own password change and the other sessions (ASVS 6.2.2, 7.4.3, 7.5.2): every account changes its own password at
  any time on `/account`, with the current password and the rules of the forced change, through `changePassword` of
  Better Auth with `revokeOtherSessions: true`, so the change ends all other sessions; a user can disconnect all
  connected apps with it. "Log out other browsers" on `/account` ends all other sessions without a change of the
  password, after a confirmation; it asks for no password, a decision of the requirements, because ending sessions
  only protects the account. A list of the own sessions is not offered, a current limit of `users-and-login.md`, so
  ASVS 7.5.2 is met for ending the sessions, not for viewing them. Fixed after the review and checked by the unit and
  integration tests of `changeOwnPassword()` and `logOutOtherSessions()` and by `e2e/own-password-change.spec.ts` and
  `e2e/log-out-other-browsers.spec.ts`. The admin part is the finding above.
- Wrong current passwords at the forced password change (ASVS 6.3.1, 2.4.1, CWE-307): counted like failed logins of
  the name of the session user from the client address group of the request, with the waits of the login; a right
  one counts like a successful login, and during a wait the change is refused without checking the password. Input
  that breaks a rule of the new password is refused before and not counted. The session is not ended after several
  failures: the requirements of the own password change decided that the waits of the login are enough. Fixed after
  the review and checked by the unit tests of `changeFirstPassword()`, the integration tests in
  `integration/auth-service.test.ts` (5 wrong current passwords make the change and the login wait) and
  `e2e/change-password.spec.ts`.
- Log lines of login and logout (ASVS 16.3.1, 16.2.1): the line of a successful login names the user id, the user
  name and the client address group, and the line of a logout the user id of the session, read before Better Auth
  ends it; a logout whose session cannot be read fails like one that cannot end it. Fixed after the review and checked
  by the unit tests of `logIn()` and `logOut()` in `src/features/auth/service.test.ts`.

#### Connected apps

##### issue: a successful use of an access token, and a bearer value that does not look like one, leave no log line, and refused access tokens are logged without the client address

- Location: `src/features/grants/service.ts`, `authenticateAccessToken()`, its check of the shape of the bearer value;
  `src/features/mcp/http.ts`, `handleMcpRequest()`
- Severity: Minor. Guessing an access token of 256 bits is not practical, so this costs the means to investigate, not
  access. A leaked token of a Writer address can change content, which makes the missing trail weigh more.
- Category: security
- Problem: a bearer value that does not look like an access token (a former API token, a refresh token, a code, a
  session cookie, garbage) returns `missing-token` without a log line; a successful authentication is not logged at
  all, only `lastUsedAt` is written at most once a minute; the line "access token refused" has `reason` and `grantId`
  (for `role-too-low` also the folder and both roles), and for an unknown access token only `reason`. None has the
  client address group. Every tool call through MCP, reads included, is logged with the grant, the user and the tool
  (`mcp.md`, "What holds for all of them"), so what a token did is traced once it reached a tool; what is left is the
  check of the token itself. `connected-apps.md` says "nothing is logged" for a missing token (section "The check of
  an access token").
- Impact: after an access token leaks, the logs cannot show from where it was used; spraying refresh tokens, codes or
  cookies at the MCP addresses stays invisible.
- Evidence: on the local server, an expired access token logs a warning with `reason: "expired"` and the id of its
  grant, a revoked one `reason: "unknown"` and nothing else; a refresh token, a code and a session cookie as bearer log
  nothing, and a successful check logs nothing beyond the line of the tool call. In the code: `if (secret === null || !looksLikeAccessToken(secret)) return { ok:
false, error: { code: "missing-token" } };` with no log call.
- Suggestion (required): log a warning for a bearer value of the wrong shape (the reason and the kind, never the
  value), an info line on success with `grantId` and `userId`, and the client address group on every line; or
  document the choice as a decision with its reason.
- Confidence: Low. The Suggestion leaves the choice between logging and a decision, and an info line on every request
  with the address group on every line is a trade-off between noise and privacy that the user has to decide.
- Reference: OWASP A09:2025 Security Logging and Alerting Failures; ASVS 16.3.1, 16.3.2, 16.2.1; CWE-778.

##### issue: the admin has no way to stop the grants of another user

- Location: `src/features/grants/service.ts`, `revokeGrant()`; `spec/connected-apps.md`, sections "The own apps only"
  and "Current limits"
- Severity: Minor. It needs a leaked refresh token and an owner who cannot act.
- Category: security
- Problem: revoking works only for the actor's own grants, users cannot be deactivated or deleted, and there is no
  admin command, so a compromised grant of a user who is not available can only be stopped by a `DELETE` in the
  database. A grant lives up to 365 days. The spec says the admin cannot see or revoke the grants of other users
  without a reason; "Current limits" now points to the roadmap ("when it comes, it must stop the user's grants as
  well"), but no decision says why the admin needs no way until then. An Owner who removes the role of the user on the
  folder stops the grant at once, because every request checks the current role, but only for that folder and only
  while an Owner is available. This is the grant side of the missing ending of sessions by the admin (area "Login,
  passwords, sessions and users").
- Impact: a leaked refresh token keeps its access, for a Writer address also write access to the pages of its folder,
  until the grant expires or is refreshed by its client, which then revokes it.
- Evidence: "Every user sees and revokes only their own apps."
- Suggestion (required): add an admin script next to `scripts/admin.ts`, which today only runs the admin setup (or
  turn it into one with commands), that deletes all grants of a user and logs it, or document the limit as a decision
  with a pointer to the roadmap entry on deactivating users.
- Confidence: Low. It changes the rule of the spec that nobody, the admin included, touches the grants of another
  user, and offers a documented decision instead, so the user has to choose.
- Reference: OWASP A07:2025 Authentication Failures; ASVS 7.4.5, 7.4.2; CWE-613.

##### nit: a bearer value of the wrong shape is answered without `error="invalid_token"`

- Location: `src/features/grants/service.ts`, `authenticateAccessToken()` and `bearerTokenOf()`;
  `src/features/mcp/http.ts`, `handleMcpRequest()`, the case `missing-token`; `spec/connected-apps.md`, section "The
  check of an access token"
- Severity: Nit. It concerns clients, not access.
- Category: correctness
- Problem: RFC 6750 section 3.1 counts a malformed token as `invalid_token` and leaves the error out only when the
  request has no authentication. `Bearer hw_…` (a former API token), `Bearer hwr_…`, `Bearer hwc_…` or `Basic …` get
  the same answer as no header.
- Evidence: on the local server, `Bearer xx_…`, a refresh token and a code gave `401` with a `WWW-Authenticate:
Bearer resource_metadata="…"` challenge without an error and `{"error":"unauthorized"}`; a well-formed unknown access
  token gives `error="invalid_token"`. At an MCP address the challenge now names the metadata of that address
  (`…/.well-known/oauth-protected-resource/mcp/<folder-uuid>/<role>`) and no scope; the missing error is the same.
- Suggestion (optional): answer `missing-token` only without an `Authorization` header with the scheme `Bearer`, and a
  value of the wrong shape with `invalid-token`, without a database lookup, and let `bearerTokenOf()` tell a missing
  Bearer header from a value of the wrong shape, for which it returns `null` alike today.
- Confidence: Medium. One fix, but it changes a rule that `connected-apps.md` sets on purpose and the answer clients
  see, and how clients react to `invalid_token` instead of a bare challenge was not tried.
- Reference: RFC 6750 section 3.1.

##### Reviewed

- Files read: `src/features/grants/` (`service.ts`, `schema.ts`, `forms.ts`, `actions.ts`, `queries.ts` and the
  components), `src/app/account/page.tsx`, `src/features/mcp/http.ts`, `src/app/mcp/[[...path]]/route.ts`,
  `src/features/oauth/secret.ts`, the access token parts of `src/features/oauth/token-service.ts`, the model `OAuthGrant` and
  its migrations, `e2e/mcp-access.spec.ts`, `integration/grant-service.test.ts`.
- Randomness and storage (ASVS 11.5.1): `randomBytes(32)` gives 256 bits; only the SHA-256 hash of an access token is
  stored, in a unique column, and found with `findUnique`, so no comparison can leak timing; the access token leaves
  only in the answer of the token endpoint, never in an address. SHA-256 is a hash function of TR-02102-1 chapter 4.
- No secret in logs: neither an access token nor its hash is logged; on the local server the log holds no token, no
  hash and no `hwa_`.
- The check (`authenticateAccessToken()`): unknown, revoked and expired access tokens and those of expired grants are
  refused with `invalid_token`; the first password, the type of the account (an admin has no grants), the folder and
  the role of the address (`other-address`) and the current role of the user on the folder (`role-too-low`, answered
  403 without a challenge) are checked on every use (`connected-apps.md`, "The check of an access token"). On the
  local server in the first review: an
  expired grant (`expiresAt` set into the past) and a revoked one give `401` with `error="invalid_token"`; the access
  token of a user whose first password is pending gives `401 invalid_token` and logs `reason: "first-password"`;
  `bearer` in lowercase is accepted. A failed lookup gives `500`; only the `lastUsedAt` write fails open, on purpose.
- Token kinds: the prefixes `hwc_`, `hwa_` and `hwr_` are matched exactly, and only a value with the prefix of an
  access token is looked up, in its own hash column; there is no bearer plugin of Better Auth. On the local server a
  refresh token, a code and the value of a session cookie were refused at the MCP endpoint with `401`, and an access
  token is refused as a refresh token with `400 invalid_grant`.
- The removed API tokens (OWASP Secrets Management Cheat Sheet, "Detection"): there are no long-lived secrets that a
  user copies by hand any more, so the format of such a secret no longer needs to let secret scanners recognise a
  leak. A former API token of the shape `hw_…` is answered at an MCP address like any other value that is no access
  token, with `401`.
  Checked by `e2e/mcp-access.spec.ts` and by `integration/grant-service.test.ts`.
- Owner checks (ASVS 8.2.2): see the area "Access control"; only the actor's own grants are listed and revoked.
- Tokens in addresses, logs and pages (ASVS 14.2.1): only the id of a grant is part of `?action=revoke&app=`; no
  logger call has a token or a hash.
- The limit per user: `exchangeCode()` locks the row of the user (`FOR UPDATE`) before it counts, and
  `integration/oauth-service.test.ts` runs exchanges past the limit at the same time.
- A removed user, folder or client: grants are deleted with each of them (`onDelete: Cascade`).
- Lifetimes: only 30, 90 or 365 days, and `expiresAt` cannot be empty, so there is no grant without an end.
- Two `Authorization` headers: Node.js keeps the first and drops the others, so the value is never ambiguous.
- A new authentication before an approval (ASVS 7.5.1, CWE-306): "Approve" on the consent page needs the password of
  the user every time, whatever lifetime is chosen; anything but the right password creates no code and no grant. A
  wrong password counts as a failed login of the name from the client address group, and during a wait the password
  is not checked. A stolen session alone can therefore not be turned into a grant that outlives it. Fixed after the
  review and checked by the unit tests of `approve()` and `verifyPassword()`, `integration/auth-service.test.ts` and
  `e2e/oauth.spec.ts`.
- Standards cross-check: the limit of grants per user is counted under a lock of the user row (ASVS 2.3.4); access
  tokens are reference tokens, not self-contained, so ASVS 9.1 does not apply; their type and purpose (ASVS 9.2.2) and
  their audience (ASVS 9.2.3) are checked by the separate prefixes and hash columns and by accepting them only at the
  one MCP address of their grant; the user of an access token is the user of its grant (ASVS 10.3.3).

#### OAuth

##### issue: custom redirect schemes are filtered with a list of forbidden schemes, so dangerous handlers of the operating system are accepted

- Location: `src/features/oauth/schema.ts`, `FORBIDDEN_SCHEMES` and `parseRedirectUri()`; `spec/oauth.md`, section
  "Clients"
- Severity: Minor. It needs the user to accept the browser's prompt to open an external application.
- Category: security
- Problem: every scheme that is not one of 19 forbidden ones is accepted, among them `search-ms:`, `ms-msdt:` and
  `intent:`. A link to the wiki leads to such a handler after a click on "Deny" or on the link back of a refused
  request.
  The MCP specification says redirect addresses must be `localhost` or HTTPS; the spec allows custom schemes without
  a reason.
- Impact: users on Windows or Android can be pushed from a trusted origin into a known malware delivery chain.
- Evidence: on the local server, registrations with `search-ms:query=x`, `ms-msdt:/id` and `intent://example.org/cb`
  give `201`; `javascript:`, `data:` and `file:` give `400`.
- Suggestion (required): accept a private scheme only in the reverse domain form that RFC 8252 section 7.1 asks for,
  and document the deviation from the MCP rule as a decision.
- Confidence: Low. It needs a decision: the reverse domain rule may refuse schemes of native clients in use today,
  such as `cursor://`, which the comment of `parseRedirectUri()` names as its example.
- Reference: OWASP A06:2025 Insecure Design; ASVS 1.2.2, 2.2.1, 10.4.7; CWE-184; RFC 8252 sections 7.1 and 8.4.

##### issue: the consent page shows no verified identity of the client and no warning for clients it cannot verify or for loopback addresses

- Location: `src/app/oauth/authorize/page.tsx`, `AuthorizePage()`; `src/features/oauth/queries.ts`, `loadConsent()`;
  `src/features/oauth/schema.ts`, `redirectTargetOf()`
- Severity: Minor. A general caution is shown, and the code goes only to the host that is shown.
- Category: security
- Problem: for a metadata document client the host of its `client_id`, the only identity the wiki verified, is not
  shown, though the metadata document draft asks for it; a registered client looks the same as a metadata document
  client; for a loopback address the page shows `127.0.0.1:9999`, which tells the user nothing, with no extra warning
  as the MCP specification asks.
- Impact: on a machine with malicious local software, a client that calls itself "Claude Code" cannot be told from the
  real one, and the user may give it the role Writer on the folder shown.
- Evidence: `An app at <strong>{consent.target}</strong> asks for access to this wiki.` and `It calls itself
“{consent.clientName}”.`
- Suggestion (required): show "Identified by <host of the client_id>" for a metadata document client, "This app
  registered itself; the wiki cannot verify who it is" for a registered one, and a warning for a loopback or custom
  scheme target.
- Confidence: Medium. The fix is clear, but it is a change users see whose wording is a choice, and the data that the
  consent page gets must grow by the metadata address of the client.
- Reference: OWASP A07:2025 Authentication Failures; ASVS 10.4.7, 10.7.2; CWE-451; the client ID metadata document
  draft, section 10.6; MCP specification 2026-07-28, "Security Considerations", "Localhost Redirect URI Risks".

##### issue: a repeated parameter of the authorization request counts as missing instead of refusing the request

- Location: `src/features/oauth/forms.ts`, `readAuthorizationParams()` and `readAuthorizationFormData()`;
  `src/features/oauth/authorization-service.ts`, `checkAuthorizationRequest()`
- Severity: Minor
- Category: correctness
- Problem: a parameter sent twice is dropped. For `state` "missing" is valid, so two values of `state` give a code
  without `state`. `resource` is required since the MCP addresses per folder and role (`checkAuthorizationRequest()`,
  the check of `resource`; `oauth.md`, "Decisions"), so a repeated `resource` is refused with `invalid_target` and that half of
  the first finding is fixed. The token endpoint refuses repeated parameters.
- Impact: a client loses its `state`, and with it the protection against CSRF on its redirect address, without an
  error.
- Evidence: `readAuthorizationParams()` reads each parameter only when it appears once, and
  `checkAuthorizationRequest()` takes a missing `state` as no `state`.
- Suggestion (required): mark a repeated parameter and answer `invalid_request` (`invalid_target` for `resource`) once
  the client and the redirect address are known; write the rule into `oauth.md`.
- Confidence: Medium. One fix, but it changes the type `AuthorizationParams` that the consent page, its form and both
  actions share, the unit tests in `forms.test.ts` state the current rule, and the Suggestion names no test.
- Reference: OWASP A01:2025 Broken Access Control; RFC 6749 section 3.1; RFC 8707 section 2; CWE-235.

##### issue: client names keep bidi, format and control characters and can fake text on the consent page

- Location: `src/features/oauth/schema.ts`, `clientNameOf()`; `src/app/oauth/authorize/page.tsx`, `AuthorizePage()`,
  the sentence with the name of the client
- Severity: Minor
- Category: security
- Problem: a name is only trimmed and cut. U+202E, zero-width and control characters stay, and the name stands in
  quotes inside the sentence of the warning, so it can reverse the rest of the paragraph or close the quote and add a
  sentence of its own ("Verified by your wiki admin"). React escaping stops script, not this.
- Impact: a client can make the consent text look like an endorsement; the same name becomes the name of the grant on
  `/account`.
- Evidence: on the local server a client registered with the name `"‮evil Claude”. Verified by admin"`
  shows U+202E in the HTML of the consent page.
- Suggestion (required): remove `\p{Cc}`, `\p{Cf}`, `\p{Zl}` and `\p{Zp}` and collapse white space in
  `clientNameOf()`, and show the name in an element of its own (`<bdi>`), not in running text, also in
  `ConnectedAppList.tsx` on `/account`.
- Confidence: Medium. Removing all of `\p{Cf}` also drops the joiners that emoji and some scripts need, and names
  already stored with clients and grants stay as they are.
- Reference: OWASP A06:2025 Insecure Design; ASVS 10.7.2; CWE-451; CWE-1007.

##### issue: the token endpoint and the registration read a body of any size into memory when it has no `Content-Length`

- Location: `src/features/oauth/http.ts`, `readBody()`, used by `handleToken()` and `handleRegister()`
- Severity: Minor. Both endpoints are public, but a reverse proxy usually caps request bodies.
- Category: security
- Problem: the limit of 64 KB is checked against `Content-Length` only. A chunked body is read whole by
  `request.text()` and measured afterwards. Both addresses bypass the proxy of Next.js, so its body limit does not
  apply either, and `oauth.md` does not name a limit.
- Impact: an anonymous caller can make the server hold large bodies in memory, up to a crash.
- Evidence: on the local server a chunked body of 400 MB to `/oauth/token` is answered `400` after 354 ms of
  application code, and the memory of `next-server` grows from about 1.7 GB to 2.9 GB; the same body with
  `Content-Length` is refused at once.
- Suggestion (required): read `request.body` with a reader, count the bytes and cancel once the limit is passed; name
  the limit in `oauth.md`.
- Confidence: Medium. One fix in one function, but it rests on how Next.js hands the stream of the request to the
  route, which was not tried, and no test sends a body without `Content-Length`.
- Reference: OWASP A06:2025 Insecure Design; ASVS 15.2.2; CWE-770.

##### issue: using a code a second time does not revoke the tokens issued with it

- Location: `src/features/oauth/token-service.ts`, `exchangeCode()`, the read and the conditional delete of the code;
  `spec/oauth.md`, sections "Codes" and "Decisions"
- Severity: Minor. It needs the code and the PKCE verifier, and the code still works only once.
- Category: security
- Problem: the code row is deleted when it is read, so a second exchange is answered like an unknown code and the
  grant of the first exchange stays. ASVS 10.4.2 asks that the second request is refused and the tokens issued for the
  code are revoked; the spec does not say that this is left out.
- Impact: an attacker who redeemed a stolen code and verifier first keeps a working grant, and the only sign of it is
  not acted on.
- Evidence: on the local server the second exchange gives `400 invalid_grant` ("The authorization code is not valid"),
  but the access token of the first still gets `200` at the MCP endpoint, and its refresh token still works. The code
  is still deleted when it is read, and no grant id is stored on it.
- Suggestion (required): mark the code as used instead of deleting it, store the id of the grant on it, and delete
  that grant when a used code comes again; or document the choice as a decision.
- Confidence: Low. It changes the decision in `oauth.md` that a code is deleted before it is checked, needs a new
  column of `OAuthCode`, and offers a documented decision instead.
- Reference: OWASP A07:2025 Authentication Failures; ASVS 10.4.2; RFC 6749 section 4.1.2; CWE-294.

##### issue: a forged refresh token that names a grant revokes that grant

- Location: `src/features/oauth/token-service.ts`, `refreshGrant()`, the revocation on reuse before the check of the
  client; `spec/oauth.md`, section "Refresh"
- Severity: Minor. The worst outcome is that a user has to connect the app again, and it needs the id of the grant.
- Category: security
- Problem: the grant is found by the id inside the token (`hwr_<grant id>.<secret>`), and any secret that is not the
  current one counts as reuse and deletes the grant, before the `client_id` is checked. The id is no secret: it is in
  log lines, in the revoke address on `/account` and in every refresh token the client held. The spec speaks only of a
  token "used a second time".
- Impact: whoever learns the id of a grant can end that connection without holding any secret.
- Evidence: on the local server, a refresh with `hwr_<grant id>.AAAA…` and a foreign `client_id` gives
  `400 invalid_grant`, and the real refresh token of that grant is refused afterwards.
- Suggestion (optional): revoke only for a token that was really issued before, for example by storing the hash of the
  previous refresh token; at least say in the spec that any unknown secret for an existing grant revokes it.
- Confidence: Low. The Suggestion offers two fixes, and keeping only the previous hash would no longer detect the
  reuse of older refresh tokens, a risk the user has to accept or reject.
- Reference: OWASP A07:2025 Authentication Failures; RFC 9700 section 4.14.2; CWE-400.

##### issue: registrations have a limit per address group but none overall

- Location: `src/features/oauth/clients-service.ts`, `reserveRegistration()` and `registerClient()`; `spec/oauth.md`,
  section "Clients"
- Severity: Minor. It concerns availability.
- Category: security
- Problem: the limit is 20 per hour and group, and an IPv6 group is a /64, so a /48 gives about 1.3 million
  registrations an hour, each up to about 20 KB. Unused clients are deleted a day later, and only when a registration
  or a code starts the cleanup. With no trusted proxy every client shares one group, so the limit then works the other
  way round: one client blocks registrations for everyone for an hour.
- Impact: the table of clients can be filled until the wiki slows down, or registrations blocked.
- Evidence: `MAX_REGISTRATIONS_PER_WINDOW = 20` and no count over all groups.
- Suggestion (required): add an overall cap on registrations per hour or on unused clients, and name it in
  `oauth.md`.
- Confidence: Low. The Suggestion offers two different caps, and the value of a cap and the trade-off that a flood
  then blocks registrations for everyone need a decision.
- Reference: OWASP A06:2025 Insecure Design; ASVS 2.4.1; CWE-770.

##### suggestion: that metadata documents may come from any host is not written down as a decision, and a failed fetch is repeated on every page load

- Location: `src/features/oauth/metadata-fetch.ts`, `fetchMetadataDocument()` and `fetchWithin()`;
  `src/features/oauth/clients-service.ts`, `findMetadataClient()`, the branch of a failed fetch; `spec/oauth.md`,
  section "Clients"
- Severity: Minor
- Category: docs
- Problem: ASVS 1.3.6 asks for an allowlist of protocols, domains and ports. The code allows only `https` on port 443
  and only public addresses, but any domain, by the nature of client ID metadata documents; the spec mentions it only
  inside the decision on open redirects ("a metadata document can be at any public address"), not as a decision of its
  own. A failed fetch is not cached, so every load of the consent page fetches again and waits up to
  5 seconds.
- Suggestion (optional): add the decision to `oauth.md`, optionally a variable with allowed metadata hosts, and cache a
  failed fetch for a short time.
- Confidence: Low. It asks for a decision to be written, an optional variable is a product choice, and caching a
  failure needs a store and makes a short outage of a client last longer.
- Reference: ASVS 1.3.6, 13.2.4, 15.1.3; CWE-918.

##### question: should dynamic registration stay switched on?

- Location: `spec/oauth.md`, sections "Clients" and "Decisions"
- Severity: Minor
- Category: security
- Problem: the MCP specification of 2026-07-28 keeps dynamic registration only for backward compatibility, and the
  spec names claude.ai, ChatGPT and Claude Code as clients with metadata documents. Open registration is the source of
  the custom schemes, the names that cannot be verified and the flood of registrations above.
- Suggestion (optional): name the clients that still need it; otherwise add a switch for the operator, off by default,
  or mark registered clients as not verified on the consent page.
- Reference: MCP specification 2026-07-28, "Client Registration"; ASVS 10.4.7.

##### nit: for a loopback address the comparison also ignores user name, password, fragment and `..`

- Location: `src/features/oauth/schema.ts`, `isRedirectUriOf()`
- Severity: Nit. The code still goes only to the loopback host.
- Category: correctness
- Problem: for loopback only host name, path and query are compared, and the requested address is not checked by
  `parseRedirectUri()`, though the spec says a redirect address has "no fragment and no user name or password".
- Evidence: on the local server, `approve` with the redirect address `http://127.0.0.1:9999/cb#frag` returns
  `http://127.0.0.1:9999/cb?code=…&state=st123&iss=…#frag`.
- Suggestion (optional): run the requested address through `parseRedirectUri()` and compare its text without the
  port to the text of each registered loopback address without the port, since the parser removes `..` from the
  path.
- Confidence: Medium. The `..` part needs a comparison of the text rather than of the parsed address, and the
  Suggestion names no test of `isRedirectUriOf()`.
- Reference: ASVS 10.4.1; RFC 9700 section 4.1.3; RFC 8252 section 7.3.

##### nit: the authorization response rewrites the query of the redirect address

- Location: `src/features/oauth/schema.ts`, `authorizationResponseUrl()`
- Severity: Nit
- Category: correctness
- Problem: `url.searchParams.set()` serialises the whole query again, so `?x=a%20b` becomes `?x=a+b`; RFC 6749 section
  3.1.2 asks to keep the query.
- Suggestion (optional): append the encoded parameters to the original query text.
- Confidence: Medium. Appending instead of setting changes what happens when the registered query already holds
  `code`, `state` or `iss` (today replaced, then repeated), which is not decided.

##### nit: the metadata has no `response_modes_supported`, and `response_mode` is ignored

- Location: `src/features/oauth/http.ts`, `authorizationServerMetadata()`
- Severity: Nit
- Category: correctness
- Problem: without the field RFC 8414 implies `["query","fragment"]`, but the server answers only in the query and
  ignores `response_mode`.
- Suggestion (optional): advertise `response_modes_supported: ["query"]`; refusing other modes also meets ASVS 10.4.12
  (Level 3) cheaply, and "Discovery" of `oauth.md` then names the field too. (The metadata names no scopes either, on
  purpose: there are none.)
- Confidence: Medium. Advertising the field is clear, but refusing other modes changes what a client gets and
  touches `AUTHORIZATION_PARAMS` and `checkAuthorizationRequest()`, which the Suggestion does not name.
- Reference: RFC 8414 section 2; ASVS 10.4.12.

##### nit: the comparison of `resource` is case-sensitive in scheme and host

- Location: `src/features/oauth/schema.ts`, `parseMcpResource()`, reached through `mcpAddressOf()` in
  `src/features/oauth/issuer.ts` at the authorization (`src/features/oauth/authorization-service.ts`,
  `checkAuthorizationRequest()`); the exchange and the refresh (`src/features/oauth/token-service.ts`, `exchangeCode()`
  and `refreshGrant()`) compare the text with `mcpResourceOf()`
- Severity: Nit
- Category: correctness
- Problem: `HTTP://LOCALHOST:3100/mcp/<folder-uuid>/reader` gets `invalid_target`, because the resource must start with
  the public URL as written, and the exchange and the refresh compare it as text; the MCP specification ("Canonical
  Server URI") says scheme and host in upper case should be accepted.
- Suggestion (optional): compare scheme and host after parsing, path and query exactly.
- Confidence: Medium. It changes the rule of `oauth.md` that `resource` must be exactly the MCP address, touches three
  comparisons, and the Suggestion names no test.

##### nit: the spec promises that the grant stays after two refreshes at the same time, which holds only if both read before the swap

- Location: `spec/oauth.md`, section "Refresh"; `src/features/oauth/token-service.ts`, `refreshGrant()`, its doc
  comment, the comparison of the hash and the conditional swap
- Severity: Nit
- Category: docs
- Problem: a refresh that reads the grant after the other one swapped the hash counts as reuse and revokes the grant.
- Evidence: "Of two refreshes at the same time only one succeeds. The other is refused, and the grant stays."
- Suggestion (optional): say that this holds for two refreshes that both read the grant before either swapped it, in
  the spec and in the doc comment of `refreshGrant()`.
- Confidence: Medium. The wording was checked against `refreshGrant()`, but the test "lets only one of two refreshes
  at the same time succeed, and the grant stays" in `integration/oauth-service.test.ts` runs six refreshes at once
  and asserts the broader promise, so it may fail now and then, which the Suggestion does not address.

##### nit: an `invalid_client` answer with 401 has no `WWW-Authenticate`, and repeated keys in a JSON body are not refused

- Location: `src/features/oauth/http.ts`, `readTokenParams()`, and `handleToken()`, the case `invalid-client`
- Severity: Nit
- Category: correctness
- Problem: RFC 6749 section 5.2 asks for `WWW-Authenticate` with a 401 `invalid_client`. A repeated parameter is
  refused in a form body, but in a JSON body the last value wins, though the error text promises "every parameter at
  most once" for both.
- Suggestion (optional): answer 400 `invalid_client` (there is no client authentication) or add the header; drop the
  claim for JSON or detect repeated keys.
- Confidence: Medium. The Suggestion offers two choices for each half, and changing 401 to 400 also changes the rule
  that `oauth.md` states in "The token endpoint".
- Reference: RFC 6749 section 5.2.

##### nit: `oauth.md` repeats constants that no operator relies on, and places the cleanup of unused clients under registration only

- Location: `spec/oauth.md`, section "Clients"
- Severity: Nit
- Category: docs
- Problem: "1 to 10 redirect addresses of at most 2048 characters each", "cut to 50 characters" and "is called
  \"Connected app\"" restate constants of `src/features/oauth/schema.ts`. The bullet on deleting unused clients stands
  under registration, but metadata document clients are deleted the same way.
- Suggestion (optional): point to the constants, and move the bullet to what holds for both kinds of client.
- Confidence: High. A change of the spec only; the constants are in `schema.ts`, `deleteStaleRows()` deletes both
  kinds of client, and `npm run docs:check` checks the reference to the file.
- Reference: `issue-report.md`, last item of the checklist.

##### Reviewed

- Files read: `src/features/oauth/` (`authorization-service.ts`, `token-service.ts`, `clients-service.ts`,
  `cleanup-service.ts`, `rows.ts`, `http.ts`, `schema.ts`, `metadata-fetch.ts`, `public-address.ts`,
  `issuer.ts`, `secret.ts`, `actions.ts`, `queries.ts`, `forms.ts`, the components), `src/app/oauth/`,
  `src/app/.well-known/`, the OAuth models of `prisma/schema.prisma`, `spec/oauth.md`; RFC 9700, the client ID metadata
  document draft and the authorization pages of the MCP specification of 2026-07-28.
- The flow on the local server (registration, consent, `approve`, exchange with PKCE, refresh) works and every answer
  to the client carries `iss`.
- Exact redirect addresses (ASVS 10.4.1): text comparison against the registered ones; only the port of an `http`
  loopback address is ignored, as `oauth.md` says (RFC 8252 section 7.3). On the local server another path
  (`/other`), `localhost` for `127.0.0.1`, an added query and an unknown client give the message "This request is no
  longer valid…" without a redirect; another loopback port is accepted as documented.
- PKCE (ASVS 10.4.6, RFC 7636): only `S256`, required for every client, no default to `plain`. On the local server a
  missing method, `plain`, a missing and a short challenge give `error=invalid_request` with `state` and `iss`; a wrong
  verifier gives `invalid_grant` and uses the code up, so the right verifier afterwards fails too. The verifier is
  compared with `timingSafeEqual`.
- Codes (ASVS 10.4.2, 10.4.3): 256 random bits, stored as SHA-256, 10 minutes, bound to client, user, redirect
  address and challenge, deleted conditionally before any check, so of two exchanges only one goes on. On the local
  server the second use gives `invalid_grant` (see the finding on revoking). A wrong redirect address at the exchange
  gives `invalid_grant`.
- Open redirect (ASVS 3.7.2, 10.4.7, `CON.10.A4`, CWE-601, RFC 9700 section 4.11.2, MCP specification "Open
  Redirection"): a request that fails a check after the client and the redirect address does not send the browser to
  the client by itself; the consent page shows the reason and a plain link "Return to <host>" that carries the error,
  and only a click on it or on "Deny" leaves the wiki. `e2e/oauth.spec.ts` checks for each refused request that the
  page stays, no request goes to the client until the link is clicked, and the click delivers `error`,
  `error_description`, `state` and `iss`.
- Grant and response types (ASVS 10.4.4): only `code`, and only `authorization_code` and `refresh_token`; on the local
  server `response_type=token` gives `unsupported_response_type`.
- Scopes and resource (RFC 8707, ASVS 10.3.1): there are no scopes; a `scope` that a client sends is not read, and the
  token answer has none. `resource` is required and must be exactly the MCP address of a folder; a missing, repeated or
  foreign `resource`, the plain `/mcp` and the role Owner give `invalid_target`, and a folder without a
  role of the user or a role of the address above the user's current role gives `access_denied`. The exchange and the
  refresh check the `resource` against the address of the grant, and an access token is accepted only at that address
  (`oauth.md`, "The authorization request and the consent page" and "Decisions"; `e2e/oauth.spec.ts`).
- Refresh with rotation (ASVS 10.4.5, 10.4.8): on the local server the old access token is refused after a refresh;
  reusing an old refresh token gives `invalid_grant` and revokes the grant, so the newest access and refresh tokens are
  refused too; the refresh token of one client with the `client_id` of another gives "The refresh token was given to
  another client" and the grant stays. The grant expires after its lifetime, and an access token never outlives it.
- Revoking a grant (ASVS 10.4.9, 10.7.3): the access and the refresh hash are in the one row that revoking deletes.
- Secrets (ASVS 11.5.1): 256 bits from `randomBytes`, stored as SHA-256; the refresh token is compared with
  `timingSafeEqual`, codes and access tokens are found by a unique hash.
- The token endpoint: RFC 6749 error codes, no stack traces, `Cache-Control: no-store` and `Pragma: no-cache` on every
  answer, only form and JSON bodies, repeated form parameters refused, no client secrets because every client is public.
- Consent (ASVS 10.7.1, 10.7.2): every request asks again; the user, the name of the folder, the role of the address,
  what that role allows through MCP and the lifetime are shown;
  the actions check the submitted request again and are protected by the origin check of Server Actions. Client names
  and targets are text, and no client address is shown as a link.
- The metadata fetch (ASVS 1.3.6, 1.5.3, 15.3.2, CWE-918): `https` on port 443 only, the address must equal its own
  WHATWG serialisation, every resolved address must be public (IPv4 without the special-purpose ranges, IPv6 only in
  `2000::/3` without Teredo, documentation and 6to4), the connection is pinned to the checked address, redirects are
  not followed, 5 seconds and 10 KB at most, only `application/json`. It runs only for a logged-in user on the consent
  page and in its actions, never at `/oauth/token` or `/oauth/register`. On the local server `https://127.0.0.1/…`,
  `https://localhost/…`, `https://[::1]/…`, `https://10.0.0.1/…`, `https://169.254.169.254/…`, `https://[fd00::1]/…`
  and `https://[::ffff:7f00:1]/…` are refused with `address-not-public`, and `https://2130706433/…`,
  `https://0x7f000001/…`, `https://127.1/…`, `https://127.0.0.1:8443/…` and `http://example.com/…` as an unknown
  client, each within about 50 ms and with "This app is not known to the wiki".
- Metadata documents: `client_id` must equal the address, `client_name` and `redirect_uris` are required, the cache
  follows `max-age` between 5 minutes and 24 hours.
- Prototype pollution (ASVS 15.3.6, CWE-1321): registrations go through a `z.object` that drops unknown keys, token
  parameters into a `Map`, authorization parameters are copied by fixed names, metadata fields are read by name.
- Registration (RFC 7591): only `redirect_uris` and `client_name` are read; the answer states `none`, `code` and the two
  grant types and has no secret. A registered client cannot replace the grant of a metadata document client.
- Discovery (RFC 8414, RFC 9728): the metadata matches the endpoints (code, the two grant types, `S256`, `none`,
  metadata documents, the `iss` flag, and no scopes); the protected resource metadata exists for every folder address
  and names that full address as the resource, and the bare `/.well-known/oauth-protected-resource` and the one for
  `/mcp` answer 404; the issuer comes only from `HIPPOWIKI_PUBLIC_URL`. On the local server a request with
  `X-Forwarded-Host: evil.example` gets the issuer `http://localhost:3100`.
- Level 3: pushed authorization requests (ASVS 10.4.13) and sender-constrained tokens (10.4.14) are not cheap and are
  not suggested.
- Standards cross-check: a client is given no more than the folder and the role of one MCP address, and never more
  than the user's current role (ASVS 10.4.11); the metadata fetch checks the
  certificate of the host with the default of Node.js (ASVS 12.3.2); the wiki is no OAuth client and no OpenID provider,
  so ASVS 10.1, 10.2, 10.5 and 10.6 do not apply; the resource server needs no particular strength of authentication
  (ASVS 10.3.4).

#### MCP server

##### suggestion: `list_folder` has no paging

- Location: `src/features/mcp/tools.ts`, `listFolder()`
- Severity: Nit
- Category: performance
- Problem: the tool returns every tab and page of the folder of the connection in one answer, and the number of pages
  of a folder has no limit.
- Suggestion (optional): name it under "Current limits" in `mcp.md`, or add a cursor later.
- Confidence: Low. Documenting the limit or adding a cursor is a product decision, and it goes with the finding on
  unlimited counts in "Content".
- Reference: ASVS 15.2.2; CWE-770.

##### nit: the server advertises `tools.listChanged: true` but can never send the notification

- Location: `src/features/mcp/server.ts`, `createWikiServer()`, the call of `new McpServer()`
- Severity: Nit
- Category: correctness
- Problem: `McpServer` sets `listChanged` to `true` by default, but the handler allows no subscription, and the list
  of tools of a connection, fixed by the role of its address, never changes.
- Suggestion (optional): pass `capabilities: { tools: { listChanged: false } }`, and check
  `capabilities.tools.listChanged` in the `initialize` test of `src/features/mcp/tools.test.ts`.
- Confidence: High. The SDK keeps an explicit `false` and uses `true` only when the value is unset, both paths build
  the server with `createWikiServer()`, and the named `initialize` test shows it.

##### Reviewed

- Files read: `src/features/mcp/http.ts`, `tools.ts` (split since into `tools.ts`, `tool-schemas.ts` and
  `server.ts`), `queries.ts`, `http.test.ts`, `src/app/mcp/[[...path]]/route.ts`, `spec/mcp.md`, the token check, the
  reads and writes of pages and folders, the actor of MCP (now in `src/features/folder-roles/actors.ts`), `src/lib/names.ts`, `src/features/pages/limits.ts`, the specs `e2e/mcp-*.spec.ts`; the
  SDK `@modelcontextprotocol/server` 2.4.0 (handler, transport, validation); the MCP specification 2026-07-28
  (transports, authorization, tools, security best practices) and the OWASP MCP Top 10.
- Revisions: the modern path of the SDK serves 2026-07-28; the legacy path 2024-10-07 to 2025-11-25. "The endpoint"
  in `mcp.md` names 2026-07-28, says that the older revisions are served as the SDK serves them and that a client is
  served as an older one when it sends no per-request `_meta` envelope, and names the body limit of the wiki; the
  comments of `getModernHandler()` and `serveLegacy()` in `src/features/mcp/http.ts` say the same.
- Page text as user data (OWASP MCP06:2025, OWASP LLM01:2025, OWASP A06:2025, CWE-1427): the instructions of every
  connection, the descriptions of the eight tools whose results carry titles or content, and the field `note`, the
  first field of their results in the structured data and in the text and named in their output schemas, say that
  titles and content of pages are written by users of the wiki and are data, never instructions; titles and content
  are passed on unchanged, and tool errors carry no page text and no note. The section "Prompt injection" of
  `mcp.md` says what the server does, which limits hold for every connection, and what is left to the client:
  confirming destructive tools, loading no images and opening no links of page text without asking, and passing no
  page text to other tools as instructions. Checked by the unit tests in `src/features/mcp/tools.test.ts` ("the
  instructions", "the descriptions", "read_page" with a page that holds `IGNORE ALL PREVIOUS INSTRUCTIONS`, `</page>`
  and `<system>`, and "every tool") and by `e2e/mcp-read.spec.ts` through the real server. Whether models and clients
  treat the marked text as data depends on them and was not checked.
- Token before any tool (OWASP MCP07, ASVS 10.3.2): `authenticateAccessToken()` runs before the body is read and before
  the SDK, on both paths, with the folder and the role of the address. Tokens are opaque, found by hash, and each is
  issued for the one MCP address of its grant; at any other address it is refused as `other-address` with 401
  `invalid_token` (ASVS 10.3.1).
- The challenge of a refused token (RFC 9728 section 5.1): there are no scopes. Every 401 names the
  `resource_metadata` of its folder address and no scope, and the 403 `{"error":"role_too_low"}` of a role that is too
  low carries no challenge on purpose, so that the client does not authorize again (see "Decisions" in `mcp.md`).
  Checked in `src/features/mcp/http.test.ts` and `e2e/mcp-access.spec.ts`.
- Tools per role (OWASP MCP02, ASVS 8.2.1): a Reader address gets `list_folder` and `read_page`, a Writer address also
  `create_page`, `replace_page_content` and `move_or_rename_page`; the services check the role of the connection and
  the user's current role again on every write, as for the browser, and every write states the version it is based
  on (`optimistic-locking.md`, "Callers other than the browser"). A Manager address, added after the review, also gets
  `delete_page`, `create_tab`, `rename_tab` and `delete_tab`, with the same checks (`mcp.md`). Nothing of an Owner and
  no deleted page is reachable through MCP.
- Transport of 2026-07-28 (done by the SDK): on the local server a request with the envelope and the right headers
  gives `200`; without `MCP-Protocol-Version`, with an `Mcp-Method` that does not match the body, and with
  `tools/call` without `Mcp-Name` it gives `400` with `-32020`; with an unsupported version in the envelope `400` with
  `-32022`; with the 2026 header but no envelope `400` with `-32602`. An unsupported legacy version gives `400` with
  the list of supported ones; `GET` and `DELETE` give `405`; `Mcp-Session-Id` is ignored and no session is created.
  A client can take the legacy path by leaving out the envelope, which skips only the header checks that protect
  intermediaries routing by `Mcp-*` headers; the token check and the tools are the same.
- `Origin`: a foreign one and `null` give `403`, a request without one passes, as the specification allows.
- DNS rebinding (CWE-350; MCP specification 2026-07-28, "Transports", "Streamable HTTP", "Security Warning"): without
  `HIPPOWIKI_PUBLIC_URL` there is no MCP server, and every address under `/mcp` answers every request with 404 before
  it looks at the method, the `Origin` or the token; with it, `hasForeignOrigin()` compares the `Origin` only with the public URL, so
  an origin that names the host the request was sent to is refused as well. Checked by the unit tests in
  `src/features/mcp/http.test.ts` and with `curl` against `npm run dev` without the variable.
- Arguments (OWASP MCP05): no tool takes a folder, which is that of the connection. Every name in the input schema
  of a tool is a plain string: the name of an existing tab or page is looked up, and a name that no item has,
  malformed or with spaces around it, gets the not-found error of the tool; the names that `create_page`,
  `move_or_rename_page`, `create_tab` and `rename_tab` give a page or a tab are checked by the services with the name
  rule, which parse every name. In the first review, when the SDK still checked the name schema, `../etc` and `A B`
  as a name gave a tool error "Input validation error: … Use lowercase letters, digits and single hyphens"; a missing
  argument still gives "expected string, received undefined".
- Deleted pages: on the local server the deleted page `gone` is missing from `list_folder`, and `read_page` answers
  "There is no page named "gone" directly in the folder …", the same as for a page that never existed.
- Tool errors: `run()` logs and answers with a general message; the SDK and the adapter answer `500` without details.
- Log line of a tool call (OWASP MCP08, ASVS 16.2.1, OWASP A09:2025): every call that reaches a tool, reads included,
  leaves one `info` line `mcp tool called` from `run()` with the grant, the user, the folder, the role, the tool, the
  tab and page names of its arguments, cut to the length limit of a name, and the outcome (`worked`, `tool-error` or
  `failed`), never the content, a title, a text of a replacement, an address or a version; a call that the SDK refuses
  before the tool runs, `initialize` and the list of tools write none (`mcp.md`, "What holds for all of them").
  Checked by the unit tests of "every tool" in `src/features/mcp/tools.test.ts`, which check the line of each of the
  ten tools, the outcomes of a tool error and of a failing database, and that no logged line holds page text.
- Body size: the adapter refuses a body over the body limit of the wiki, 1 MiB by default (`HIPPOWIKI_MCP_BODY_LIMIT`),
  with `413`, with and without `Content-Length`, and stops reading at the limit. Without a token the body is not read. The content of a page is limited to 100,000
  characters by the service (the input schema of the write tools has no limit of its own); `create_page` without a
  name leaves the name to the service, which derives it only after its checks of the role and the content, so content
  over the limit is never parsed.
- Unbounded work of one token (OWASP A06:2025, ASVS 2.4.1 and 15.2.2, CWE-770; MCP specification 2026-07-28, "Tools"
  and "Security Considerations", which ask servers to rate limit tool calls): the adapter refuses a JSON-RPC batch as a
  whole with `400` and `-32600` before the choice of the path, so for every revision and before any tool runs; it reads
  the body itself under the body limit of the wiki and hands it to the SDK parsed; and every request with a token valid
  for its address, a request refused for its role included, takes from a budget per user, 60 at once and 300 a minute
  by default, kept in memory, with `429` and `Retry-After` over it and a log line at most once per user and minute
  (`mcp.md`, "The endpoint" and "The connections"). Checked by `src/features/mcp/http.test.ts`,
  `src/features/mcp/rate-limit.test.ts`, `src/features/mcp/limits.spec-tests.test.ts`, `src/lib/env.test.ts` and
  `e2e/mcp-limits.spec.ts` against the real server: a batch of two `read_page` calls gets `400`, a write of a full page
  with every character escaped fits, a body of 1 MiB and one byte gets `413` with and without `Content-Length`, and
  the requests of one user meet the budget across addresses while those without a valid token count nothing.
- OWASP MCP Top 10: MCP01 (tokens as hashes, never logged or answered), MCP02 (the tools of the role of the address,
  the lower of the user's current role and the role of the connection, nothing of an Owner and no tool that lists or
  restores deleted pages or changes roles; the tools of a Manager are not covered until a recheck), MCP03 (names,
  descriptions and schemas are constants, and the instructions are built only from the name of the folder and the
  role), MCP05, MCP06, MCP07 and MCP08 (above) hold; MCP04 belongs to the area "Supply chain";
  MCP09 (shadow servers) does not apply to the code, since the app runs one server behind the token check; MCP10: a new
  server is built per request and nothing is shared between callers, and a grant reaches only the folder of its
  address (`folder-roles.md`, "MCP" and "Decisions").

#### Content: pages, folders, tabs, deletion and rendering

##### issue: there is no limit on the number of folders, tabs, pages and deleted pages, the lists are not paged, and no spec says so

- Location: `src/features/pages/service.ts`, `listFolderPages()`, `listTabPages()`, `listAllFolderPages()` and
  `listDeletedPages()`; `src/features/folders/service.ts`, `listFolders()` and `listTabs()`;
  `src/features/folder-roles/service.ts`, `listFolderRoles()`, `listRoleCandidates()` and `listAllFolderRoles()`;
  `src/features/users/service.ts`, `listUsers()`; the MCP tool `list_folder`; `spec/content-structure.md` and
  `spec/page-deletion.md`, sections "Current limits"
- Severity: Minor
- Category: docs
- Problem: any user can create any number of folders, and a Writer any number of pages in a folder, each page up to
  100,000 characters, with no limit on the rate of Server Actions or MCP calls; every list reads all rows without
  `take`; deleted pages are kept forever. The specs document the sizes, but not that counts are unlimited and lists
  not paged. The connected apps are the exception, with at most 50 per user, and the history of a page, which shows
  100 revisions at a time but keeps every revision for as long as the page exists.
- Impact: one user can fill the database and make folder views slow.
- Evidence: "Current limits" of `content-structure.md` names "No links between pages, no search", nothing about
  counts.
- Suggestion (required): add limits and paging, or record in the specs that there are none, as a decision with its
  reason.
- Confidence: Low. Adding limits and paging or recording their absence as a decision is a product choice.
- Reference: OWASP A06:2025 Insecure Design; ASVS 2.1.3, 2.4.1; CWE-770.

##### nit: writes read the page back in a second statement

- Location: `src/features/pages/service.ts`, `saveContentChange()` (the read after `storeContentChange()`), the end of
  `updatePageContent()` and of `revertPage()`, `moveOrRenamePage()` with `storeMoveOrRename()`, and `restorePage()`;
  `src/features/folders/service.ts`, `renameTab()`, with `writeRename()`
- Severity: Nit
- Category: correctness
- Problem: the write and the read of the stored page are two statements, so a page deleted in between is saved but
  reported as gone. A content save and a revert store the page and its revision in one transaction
  (`storeContentChange()`) and read the page after it; a move or rename and a restore are one conditional
  `updateMany` followed by a read; a rename of a tab reads the tab after its update. The version of optimistic
  locking is part of the condition of the write, which does not close the gap; a write that stores nothing reads the
  page inside its condition and is not affected, and neither is `deletePage()`, which reads and writes in one
  transaction.
- Suggestion (optional): let the write return the stored row: `updateManyAndReturn` with the state condition and
  `select`, as `deleteTab()` in the folders service already does, and for a content save return the page from inside
  the transaction of `storeContentChange()`.
- Confidence: Medium. The fix touches four writes and the retry path of `writeRename()`, and no existing test can show
  that the gap between write and read is closed.

##### Reviewed

- Files read: `MarkdownContent.tsx`, `PageView.tsx`, `DeletedPageView.tsx`, the list components, `derive.ts`,
  `schema.ts`, `forms.ts`, `limits.ts`, `actions.ts`, `service.ts` and `queries.ts` of pages and folders,
  `src/lib/names.ts`, `addresses.ts`, `db-errors.ts`, `revalidate.ts`, the routes under `src/app/folders/` and
  `src/app/deleted-items/` (then under `/deleted-pages`), the content models and migrations, `pages.md`, `content-structure.md`,
  `page-deletion.md`, `optimistic-locking.md` and `folder-roles.md`, the write tools in `src/features/mcp/tools.ts`;
  `markdown.ts` and `markdownToReact.tsx`, which replaced react-markdown after the review.
- Rendering and XSS (ASVS 1.2.2, 1.3.5, `CON.10.A8`, CWE-79): the content is parsed by markdown-it with `html: false`,
  so raw HTML stays text, and `validateLink` (`isSafeAddress()` in `src/features/pages/markdown.ts`) lets only
  relative addresses and `http`, `https`, `mailto`, `irc`, `ircs` and `xmpp` become a link or an image; any other
  address stays its Markdown text. `src/features/pages/components/markdownToReact.tsx` turns the tokens into React
  elements with text only as children; there is no `dangerouslySetInnerHTML` in `src/`. A page with `<script>`,
  `<img onerror>`, links to `javascript:`, `JaVaScRiPt:`, `&#106;avascript:`, `vbscript:` and `data:`, a reference to
  `javascript:`, an autolink `<javascript:…>` and a `data:` image renders the HTML and every such link as text and no
  `data:` image; `https:`, relative and `mailto:` links stay. Checked by `src/features/pages/markdown.test.ts` and by
  `e2e/pages.spec.ts` in the browser, with no dialog and no unsafe address on the page. An image of another host keeps
  its `src`, which the CSP `img-src 'self' data:` blocks, as `pages.md` says.
- DOM clobbering: the only ids of the page view are those of footnotes, with the prefix `user-content-`; no heading
  ids, no `name` attributes. Checked by `src/features/pages/markdown.test.ts`.
- Regular expressions (ASVS 1.3.12, CWE-1333): `NAME_PATTERN` and the other patterns are linear, and so is the
  Markdown parse (see the entry on its cost below).
- Names and addresses: names are ASCII `[a-z0-9-]` only, checked in the service on create, rename, move and restore,
  so there are no look-alikes and no dots; every address lives under `/folders` or `/deleted-pages`, so no name
  collides with a route; `parsePageSegment` refuses an upper-case or doubled `.md` suffix.
- Concurrent changes of a page (ASVS 15.4.2, CWE-362): every page has a version that every write that changes it
  counts up, while a save or a move without a change keeps it (`optimistic-locking.md`), and a
  content save, move, rename or delete is written only when the page still has the version it is based on, in the
  condition of the write itself; otherwise it is refused as `page-changed` and the editor or dialog is shown again
  with the page as stored and who changed it when (`optimistic-locking.md`). The MCP write tools follow the same rule:
  `replace_page_content` and `move_or_rename_page` state the version that `read_page` gave (`optimistic-locking.md`,
  "Callers other than the browser"). Checked by `integration/page-service.test.ts` and by two users and two tabs in
  `e2e/edit-page.spec.ts`, `e2e/move-or-rename-page.spec.ts` and `e2e/delete-page.spec.ts`.
- Concurrent writes (ASVS 2.3.3): the unique indexes (with a partial one for pages directly in a folder that are not
  deleted) and the composite foreign key of a page and its tab decide, and a taken name is shown as "Name is already
  in use". A content save and a revert are a transaction of the page and its revision followed by a read, a move or
  rename and a restore one conditional write followed by a read (the nit above), a delete is a read and a write in one
  transaction, and the role writes read their rows with
  `SELECT … FOR UPDATE` in one transaction (`architecture.md`, "Database").
- Deleted pages: `getPage` and every list except `listDeletedPages()` filter `deletedAt: null`; the deleted pages and
  restoring are for Managers and Owners only; restoring needs a place and reports a taken name; a new page may take the
  name of a deleted one, as the spec says. MCP has no tool that lists deleted pages or restores; a Manager connection
  deletes pages and tabs with `delete_page` and `delete_tab`, which are not covered until a recheck. Checked through
  MCP in the area "MCP server".
- Rights by role: every read and write of content checks the role of the actor on the folder in the service
  (`folder-roles.md`, "What a user sees and does"; area "Access control").
- Line breaks and NUL characters (ASVS 2.2.1, 16.5.3; CWE-180; CWE-20): `contentSchema` normalises CRLF and CR to LF
  first, then refuses content with U+0000 with a field error at the content, then checks the length, so the limit
  counts what the editor counts and a NUL character never reaches the database as a failed write. The MCP write tools
  reach the same schema through the service. Checked by `src/features/pages/schema.test.ts` (CRLF and CR content at
  the limit accepted, one character more refused with only the length error, NUL refused at the content field) and
  `src/features/pages/forms.test.ts`.
- Limits (ASVS 2.1.3): content 100,000 characters, lists and quotes nested 20 deep, 10,000 table cells, names 80,
  titles cut to 200, each documented by a pointer and checked in the service; counts are a finding above.
- The cost of the Markdown parse (ASVS 15.1.3, 15.2.2, 16.5.3; CWE-407; CWE-674; CWE-405; CWE-400): markdown-it,
  which replaced micromark and react-markdown after the review, parses in linear time (`src/features/pages/markdown.ts`,
  with its own one-pass rule for footnotes); the length is checked before any parse, in `create_page` as well; lists
  and quotes nested deeper than 20 and more than 10,000 table cells, rows filled up to their header counted, are
  refused at every save with a field error; `maxNesting` and a page view built without recursion over the blocks keep
  the stack flat, and a page view that fails shows the source as text, so the page stays usable. `pages.md`, "The cost
  of the Markdown parse", lists the function and its guards. Checked by `src/features/pages/markdown.cost.test.ts` (the
  inputs of the review, quadratic for micromark and react-markdown, each parsed and rendered at the content limit
  within 2 s, among them lists and quotes nested 50,000 deep and a header of 3,000 columns with 3,000 rows),
  `src/features/pages/markdown.test.ts` (depth and cells at the limits; a failing page view), `src/features/pages/schema.test.ts`, `src/features/mcp/tools.test.ts`,
  `e2e/create-page.spec.ts`, `e2e/edit-page.spec.ts` and `e2e/mcp-write.spec.ts`.
- The last editor: every write of a page, folder or tab takes the user from `requireUser()`, and a write through MCP
  from the user of the access token.
- `revalidate.ts` is called only in Server Actions after a successful write; nothing is cached per user on the
  server, so no data can pass between users.
- Standards cross-check: output is encoded by React for HTML and by `JSON.stringify` for JSON (ASVS 1.1.2, 1.2.1,
  1.2.3); no HTML input is accepted, raw HTML is shown as text (ASVS 1.3.1); there is no `eval`, `new Function`,
  template built from input, or regular expression built from input (ASVS 1.3.2, 1.3.7, 1.2.9: the three
  `new RegExp` build fixed patterns of the secrets); names are limited to `[a-z0-9-]` before any use (ASVS 1.3.3); no
  SVG from users is rendered (a `data:` image is dropped, other hosts are blocked by the CSP), so ASVS 1.3.4 does not
  apply; the limits of content and names are implemented as documented (ASVS 2.3.2).

#### Logging, errors and failure handling

##### issue: a logout reports success and logs "session ended" although the session row could not be deleted

- Location: `src/features/auth/service.ts`, `logOut()`; `src/features/auth/actions.ts`, `logOut()`
- Severity: Minor. It needs a database failure at the moment of the logout and another copy of the cookie; the
  session then stays valid for up to 30 days while the user believes it ended.
- Category: security
- Problem: `signOut` of Better Auth catches a failure of `findSession` and of `deleteSession`, logs it and still clears
  the cookie and answers success, so `logOut()` returns `ok` and logs "session ended". `users-and-login.md` says "a
  session that could not be ended must not look ended", which cannot hold for this case.
- Impact: another copy of the cookie (a stolen one, another device) keeps working.
- Evidence: Better Auth `sign-out.mjs`: `try { await ctx.context.internalAdapter.deleteSession(sessionCookieToken); }
catch (e) { ctx.context.logger.error("Failed to delete session from database", e); }`, then
  `deleteSessionCookie(ctx)`. Not shown on the local server: stopping the throwaway container would have removed it,
  and a paused database makes the logout hang instead (next finding).
- Suggestion (required): delete the session row in the auth service itself, or check afterwards that the session is
  gone, and return `failed` otherwise; add a unit test with a failing database.
- Confidence: Medium. The Suggestion offers two fixes, and both rest on internals of Better Auth, such as reading the
  signed token of the cookie, that were not tried.
- Reference: OWASP A07:2025 Authentication Failures; OWASP A10:2025 Mishandling of Exceptional Conditions; ASVS
  7.4.1, 16.5.3; CWE-613; CWE-636.

##### issue: database queries have no time limit, so a database that stops answering makes requests hang

- Location: `src/lib/db.ts`, `createClient()`; `src/app/api/health/route.ts`, `GET()`
- Severity: Minor. It concerns availability; nothing is let through.
- Category: error handling
- Problem: the adapter gets only `connectionTimeoutMillis: 5_000`, which covers opening a connection. A query on a
  pooled connection to a database that no longer answers waits without end, because `query_timeout` and
  `statement_timeout` of `pg` are off. The comment "Fail fast instead of hanging" holds only for new connections.
- Impact: when the database stalls, logins, the MCP addresses, `/oauth/token`, pages and the health check hang and
  hold pool connections; an orchestrator sees a timeout instead of 503.
- Evidence: on the local server, a logout sent right after a request, with the database paused, got no answer within
  40 seconds and finished only once the database ran again; requests after an idle pause failed after the 5 seconds of
  the connection timeout (health `503`, `/folders` `500`, `/mcp` `500 server_error`).
- Suggestion (required): set `query_timeout` and `statement_timeout` in the options of `PrismaPg`, give the health
  query a short limit of its own, and name the timeouts in `architecture.md`.
- Confidence: Medium. How `pg` behaves on a pooled connection after `query_timeout` against a paused database was not
  tried, and the values of the limits are a trade-off against long queries that are legitimate.
- Reference: OWASP A10:2025 Mishandling of Exceptional Conditions; ASVS 16.5.2; CWE-400; `CON.10.A13`.

##### issue: errors the code does not catch, and the security messages of Next.js, bypass pino and reach stderr as plain text

- Location: no `instrumentation.ts` in the project; `spec/architecture.md`, section "Validation and errors"
- Severity: Minor
- Category: error handling
- Problem: reads throw database errors by design, `getSessionUser()` throws, and `logOut()` throws "The logout
  failed."; none of this is logged by the app. Next.js prints it with `console.error` as text with a stack and the
  `digest`, and so it prints its refusal of a Server Action with a foreign `Origin`. In production JSON lines of pino on
  stdout mix with text on stderr that has no user, path field or level, and the digest that `error.tsx` shows appears
  only in the text.
- Impact: database outages during reads and CSRF refusals are visible only as unstructured text; alerting on JSON
  misses them.
- Evidence: the log of the local server shows the refusal of `createFolder` with a foreign `Origin` as the text
  "`x-forwarded-host` header with value … does not match `origin` header … Aborting the action.", not as a pino line.
- Suggestion (required): add an instrumentation file (`instrumentation.ts` under `src/`) with `onRequestError()` that
  logs through pino (error, digest, method, path, route), never the headers; say in `architecture.md` where uncaught
  errors are logged.
- Confidence: Medium. It was not checked that Next.js calls `onRequestError()` for the refusal of a Server Action with
  a foreign `Origin`, which it only prints with `console.error`, so that part of the problem may remain.
- Reference: OWASP A09:2025 Security Logging and Alerting Failures; ASVS 16.2.4, 16.3.4, 16.5.4 (Level 3); CWE-778.

##### issue: errors logged through Better Auth lose their message and stack

- Location: `src/lib/auth.ts`, the `logger` option of `createAuth()`
- Severity: Minor
- Category: error handling
- Problem: `logger[level]({ betterAuth: args }, message)` puts the arguments, often an `Error`, under `betterAuth`;
  pino serialises errors only under `err`, and JSON keeps only enumerable properties, so an `Error` becomes `{}`.
- Impact: the cause of exactly the failures above ("Failed to delete session from database") cannot be read from the
  log.
- Evidence: on the local server, with the database paused, the log shows `ERROR: INTERNAL_SERVER_ERROR` with only
  `body: { message: 'Failed to get session', code: 'FAILED_TO_GET_SESSION' }`.
- Suggestion (required): log the first `Error` of the arguments as `err` and the rest under `betterAuth`.
- Confidence: High. One fix in the `log` function of the `logger` option, no spec sets the shape of the line, pino
  serialises an `Error` under `err`, and the test of the logger option in `src/lib/auth.test.ts` shows it once its
  expectation changes.
- Reference: OWASP A09:2025 Security Logging and Alerting Failures; ASVS 16.3.4; CWE-778.

##### issue: several security events are logged without the actor or the client address, or not at all

- Location: `src/features/oauth/actions.ts`, `deny()`; the writes of `src/features/folders/service.ts`
  (`createFolder()`, `renameFolder()`, `createTab()`, `renameTab()`) and `src/features/pages/service.ts` (for example
  `deletePage()`); `src/features/mcp/http.ts`, `logRefused()` and `handleMcpRequest()`; `src/features/mcp/tools.ts`,
  `run()`; `src/features/oauth/token-service.ts`, `exchangeCode()` and `refreshGrant()`;
  `src/features/grants/service.ts`, `revokeGrant()`
- Severity: Minor
- Category: security
- Problem: a denied consent is not logged; every write of a page, folder or tab is logged with the channel, and
  through MCP with the grant, but without the actor ("folder created", "folder renamed", "tab created", "tab renamed"
  and every write of a page); only "tab deleted" carries the actor as well; "mcp request with a foreign origin
  refused" has no origin, the refusals of the SDK
  ("mcp request refused") and "mcp tool failed" no user or grant (the line "mcp tool called" next to a failed tool
  has both), and "mcp request failed" no grant; the lines of the token endpoint (a reused refresh
  token above all) have no client address group, and "unknown-grant" leaves out the grant id; "grant revoked" does not
  name the client. The role writes, the refusals by role and the revoke of a grant are logged with the actor. The refused user list of the
  first finding is gone, because every account now sees the list. The items already reported in "Login" and
  "Connected apps" are not repeated here.
- Impact: who did what from where cannot be traced for content changes in the browser, denied consents, the MCP
  adapter and the token endpoint.
- Evidence: `logger.info({ pageId, ...channelOf(actor) }, "page deleted")`, which gives `{ channel: "web" }` for a
  user in the browser; on the local server the refused foreign `Origin` at the MCP endpoint logs
  `WARN: mcp request with a foreign origin refused` with no field.
- Suggestion (required): add `actorId` to every write of content but the delete of a tab, log the denied consent, add the origin (cut) and the
  user and grant to the lines of the MCP adapter and of failed tools, and the client address group and grant id to the
  lines of the token endpoint.
- Confidence: Medium. Many places change; the client address group of the token endpoint has to be read in
  `handleToken()` of `src/features/oauth/http.ts` and passed on, which the Suggestion does not name, and how much of
  the origin and of personal data to log is a trade-off.
- Reference: OWASP A09:2025 Security Logging and Alerting Failures; ASVS 16.2.1, 16.3.2, 16.3.3; `OPS.1.1.5.A3`;
  OWASP MCP08:2025 Lack of Audit and Telemetry; CWE-778.

##### issue: rejected input at the public OAuth endpoints is never logged, and the rule not to log it has no reason

- Location: `spec/architecture.md`, section "Reads and writes" ("A malformed id and invalid input are not logged");
  `src/features/oauth/token-service.ts`, `exchangeCode()` and `refreshGrant()`; `src/features/oauth/http.ts`,
  `handleRegister()` and `handleToken()`; `src/features/oauth/clients-service.ts`, `registerClient()`
- Severity: Minor
- Category: docs
- Problem: codes and refresh tokens of the wrong shape, unreadable bodies and refused registrations leave no log line.
  In forms this is normal use; at the public OAuth endpoints it comes only from a broken or probing client.
- Impact: probing of `/oauth/token` and `/oauth/register` is invisible.
- Evidence: `if (!looksLikeCode(input.code)) return { ok: false, error: INVALID_CODE };` without a log.
- Suggestion (required): log refused requests of the wrong shape at the two public endpoints as warnings with a reason,
  never the value, and give the reason for not logging form input in `architecture.md`.
- Confidence: Medium. Logging every malformed request at endpoints anyone can call lets a client fill the log, and the
  reason for not logging form input still has to be worded as a decision.
- Reference: OWASP A09:2025 Security Logging and Alerting Failures; ASVS 16.3.3; CWE-778.

##### issue: no spec describes the logs: format, time, levels, destination, retention and access

- Location: `spec/container-image.md`, section "What the environment has to provide"; `spec/architecture.md`,
  section "Validation and errors"; `src/lib/logger.ts`, `createLogger()`
- Severity: Minor
- Category: docs
- Problem: no spec says that the server writes JSON lines to stdout and Next.js text to stderr, that `time` is in
  epoch milliseconds (UTC), that the level is fixed at `info` in production, which events are logged, that the logs
  hold personal data (user names, address groups), or that the environment has to collect, protect and keep them.
- Impact: an operator does not know what to collect, protect or keep, and for how long.
- Evidence: the specs name pino only as the logger to use (`architecture.md`, `tech.md`) and the logging of Better
  Auth (`users-and-login.md`); none says in which format and time or at which level the logs are written, or how long
  they are kept. Only the checks on the deployment in "Things to Check" of `roadmap.md` name stdout and stderr and a
  retention period, without its length.
- Suggestion (required): add a section on the logs to `container-image.md` and a matching item under "What the
  environment has to provide".
- Confidence: Medium. The format, time and level can be read from the code, but what the environment must keep and
  for how long, and how the section relates to the check of the logs in `roadmap.md`, still have to be chosen.
- Reference: OWASP A09:2025 Security Logging and Alerting Failures; ASVS 16.1.1, 16.2.2, 16.2.3, 16.4.2, 16.4.3;
  `OPS.1.1.5.A1`, `OPS.1.1.5.A3`, `OPS.1.1.5.A4`.

##### issue: a password typed into the name field is logged as the user name of a failed login

- Location: `src/features/auth/service.ts`, `logIn()`, the two warnings "login refused: unknown name or wrong password"
  and the warning "too many password hashes are running, login not checked"
- Severity: Minor. It needs a user who types the password into the wrong field and a password that fits the name rule
  (lowercase letters, digits and single hyphens, such as `summer-2024`).
- Category: security
- Problem: every refused login logs `{ name, clientAddress }`, also for an unknown name, and so does a login refused
  because too many hashes are running, so such a password stands in the log in plain text, next to the group, and the
  next successful login shows the account.
- Impact: whoever reads the logs can learn a password.
- Evidence: `logger.warn({ name, clientAddress }, "login refused: unknown name or wrong password");`
- Suggestion (optional): for a name without a user, log a keyed hash of the name and a flag; or record the trade-off as
  a decision in `users-and-login.md`.
- Confidence: Low. The Suggestion offers a keyed hash or a recorded decision, a choice between accepting the risk and
  losing the readable name in the log.
- Reference: OWASP A09:2025 Security Logging and Alerting Failures; ASVS 16.2.5; CWE-532.

##### suggestion: the logger has no redaction, so a secret inside an error object would be logged

- Location: `src/lib/logger.ts`, `createLogger()`
- Severity: Nit. No reachable path was found; it is defence in depth.
- Category: security
- Problem: pino copies every enumerable property of `err`. For a PostgreSQL error the adapter does not map, such as a
  not-null violation of `OAuthGrant`, the cause includes "Failing row contains (…)" with the hashes; a validation error of Prisma prints its arguments, for `user.create` the password hash. Both need a
  programming error first.
- Suggestion (optional): a `redact` list in pino for passwords, secrets, tokens, `authorization`, `cookie` and the
  `detail` of driver errors, with a unit test.
- Confidence: Medium. Whether the `redact` paths of pino reach the `detail` of a driver error nested under the cause of
  `err`, after its error serialiser, was not tried.
- Reference: ASVS 16.2.5; CWE-532.

##### nit: a failed fetch of a metadata document does not tell a TLS failure from a refused connection

- Location: `src/features/oauth/metadata-fetch.ts`, `fetchWithin()`, the `error` handlers of the request and the
  response
- Severity: Nit
- Category: error handling
- Problem: the error of the request is dropped and logged as `request-failed`, so an expired or wrong certificate looks
  like a refused connection.
- Suggestion (optional): add the error code (only the code) to the reason in the log.
- Confidence: High. The reason is a free string that only `findMetadataClient()` of `clients-service.ts` logs and no
  client sees, no spec lists the reasons, and the test "reports a connection that fails" in `metadata-fetch.test.ts`
  shows the code in the reason.
- Reference: ASVS 16.3.4.

##### Reviewed

- Files read: `src/lib/logger.ts`, `result.ts`, `db-errors.ts`, `db.ts`, `env.ts`, `auth.ts`, `password-hash.ts`,
  `client-address-probe.ts`, `src/proxy.ts`, the error pages, every route handler, every `catch` in `src/` and
  `scripts/`, the specs on validation, errors and the image; Better Auth (origin check, sign-out, session), the error
  mapping of the Prisma adapter and the error serialiser of pino.
- Logged events: refused logins (name and group), waits (name, group, wait), busy hashing, the first password change,
  users created and refused creations (with the actor), the admin setup, grants revoked and access tokens refused, client
  registrations and their limit, refused metadata documents (URL and reason), refused authorization requests,
  approved consent (`authorization code created` with user, client and address), a refused code because the user holds
  the most grants allowed, refused code exchanges and refreshes, grants created (with the address) and refreshed, a
  reused refresh token, refused authorization requests for an address the user may not connect
  (`address-not-allowed`), access tokens refused because the role is too low (with the folder and both roles), the
  writes of pages (created, updated, moved or renamed, deleted, restored, with the channel and, through MCP, the
  grant), refusals by role (with the actor and the role) and writes refused because the page changed after its
  version, roles given, changed and removed (with the Owner who did it) and the refusals that would leave a folder
  without an Owner, failures of tools and of MCP requests, and the health check. The gaps are the findings above and
  in "Login" and "Connected apps".
- Failing closed (ASVS 16.5.3, A10, CWE-636): every `catch` around a check of a login, a token, an address or a role,
  the wait, the metadata fetch or the `Origin` refuses or answers `failed`; an `Origin` that cannot be parsed counts as
  foreign; only the write of the last use of a grant is allowed to fail, as `connected-apps.md` documents, and the
  cleanups of old rows after a registration or a code log and go on. On the local server, with the database paused, a
  login answers "The login failed. Please try again." and logs `ERROR login failed`, the MCP endpoint answers
  `500 {"error":"server_error"}` and logs "failed to look up access token", a refresh answers `500 server_error`
  ("failed to read grant"), `/folders` the error page and `/api/health` `503 {"status":"error"}`.
- Generic error answers (ASVS 16.5.1, `CON.10.A10`, CWE-209): `error.tsx` and `global-error.tsx` show only the digest;
  the MCP addresses, the OAuth endpoints and the health check answer fixed texts; no stack, SQL or path reaches a
  client. Database errors are mapped as `architecture.md` says.
- `Result` is used by every write of every service, and every action maps every code; no `catch` is empty without
  returning a refusal.
- Log injection (ASVS 16.4.1, CWE-117): every message text of the app is a constant or built from fixed strings only
  (such as `` `${what} not found` `` with a fixed `what`); names, client names, metadata addresses and forwarded
  headers are JSON fields, and production writes JSON.
- Timestamps (ASVS 16.2.2): epoch milliseconds, which is UTC (the missing description is a finding above).
- Levels (ASVS 13.4.2): `info` in production, `NODE_ENV=production` in the image, no debug output.
- Secrets: no log call passes a password, token, code, verifier, cookie or `Authorization` header; the probe of
  forwarding headers uses an allowlist of headers.

#### Configuration and container image

##### issue: `HIPPOWIKI_ADMIN_PASSWORD` stays in the environment of the running server

- Location: `scripts/image-start.sh`, the `exec node server.js` at the end; `spec/container-image.md`, sections
  "Configuration" and "What the environment has to provide"
- Severity: Minor. Reading it needs a second flaw (a file read or code execution in the process) or access to the
  container, and the password is valid only until the first login.
- Category: security
- Problem: `image-start.sh` runs the admin setup and then `exec node server.js` without `unset`, so the server keeps
  the first admin password in its environment for its whole life. "The server never reads it" ("Configuration") is
  true, but suggests that the server never holds it. "What the environment has to provide" now says that the variable
  "can be removed once the admin exists", which is the part of the spec of the suggestion; the start script and the
  smoke test are unchanged.
- Impact: until the first login, any file read or code execution in the server reveals a valid admin password;
  `podman inspect` shows it as well, which the `unset` does not change (see the suggestion on a secret store).
- Evidence: in the image started on the local machine, `/proc/1/environ` of the server process (`next-server`)
  contains `HIPPOWIKI_ADMIN_PASSWORD` and `DATABASE_URL`.
- Suggestion (required): `unset HIPPOWIKI_ADMIN_PASSWORD` before `exec node server.js`, a check in the smoke test,
  and in "Configuration" of the spec: the server process does not keep the variable.
- Confidence: High. Nothing in `src/` reads the variable, `image-admin.sh` run with `podman exec` takes the
  environment of the container and not that of the server, and the smoke test already reads `/proc/1` with
  `podman exec`, so the named check shows it.
- Reference: OWASP A02:2025 Security Misconfiguration; ASVS 13.3.2; CWE-526; `SYS.1.6.A8`.

##### issue: the server uses the role of the migration, with rights to change the schema, in the documented setup a superuser

- Location: `spec/container-image.md`, section "Configuration"; `scripts/image-start.sh`; `src/lib/db.ts`,
  `createClient()`
- Severity: Minor. It is defence in depth: every query goes through Prisma, and there is no raw unsafe query in `src/`.
- Category: security
- Problem: one `DATABASE_URL` serves the migration and the server, so the server always runs as the owner of the
  schema. With the official `postgres` image, which the smoke test and `.env.example` use, the user of
  `POSTGRES_USER` is a superuser, who can even run commands on the database host (`COPY … TO PROGRAM`). The spec names
  only the minimum ("allowed to create tables").
- Impact: an SQL injection or code execution in the server could drop the schema or, with a superuser, run commands on
  the database container.
- Evidence: the throwaway database of the review, created like the documented one, has `rolsuper = t` for its user.
- Suggestion (required): say in "What the environment has to provide" that the role must not be a superuser and owns
  only its database; better, an optional URL of its own for the migration, so that the server can run with a role
  that may only read and write rows.
- Confidence: Low. A URL of its own for the migration goes against the decision "`DATABASE_URL` only" in "Decisions"
  of `container-image.md`, so the choice between a sentence in the spec and a second variable needs a decision.
- Reference: OWASP A02:2025 Security Misconfiguration; ASVS 13.2.2; CWE-250.

##### issue: the base image is pinned by a tag, not a digest, and its fixes reach production only with a release

- Location: `Containerfile`, the first `FROM` line (stage `base`); `spec/container-image.md`, sections "Image" and
  "Publishing"
- Severity: Minor
- Category: security
- Problem: `node:26.13-slim` is pushed again with every Node patch and Debian rebuild, so two builds of one commit can
  get different base layers, and nothing checks their integrity. Only a release publishes the image, so fixes of the
  base image reach a deployment only when someone cuts one. The spec gives no reason for either.
- Impact: builds are not reproducible, and a deployment can keep a vulnerable system or Node.js layer.
- Evidence: `FROM docker.io/library/node:26.13-slim AS base`.
- Suggestion (required): pin with `@sha256:<digest>` (Dependabot updates digests), and say when a release is cut for
  fixes of the base image; or document both as a decision.
- Confidence: Low. The Suggestion leaves open whether to pin a digest or to document both as a decision, and when a
  release is cut for fixes of the base image is a choice of the process.
- Reference: OWASP A03:2025 Software Supply Chain Failures; OWASP A08:2025 Software or Data Integrity Failures; ASVS
  15.2.1; CWE-494; `SYS.1.6.A6`, `SYS.1.6.A14`.

##### issue: an invalid value of the environment does not stop the server itself, only the admin setup stops the container

- Location: `src/lib/env.ts`, `getServerEnv()`; `spec/container-image.md`, section "Configuration"
- Severity: Minor
- Category: correctness
- Problem: the environment is validated on first use, and nothing validates it at the start of the server. In the
  image, a bad value stops the container only because the admin setup calls `getDb()` before the server starts;
  `next start`, or a start without that step, would serve and answer every request with 500. The spec says such a value
  "stops the server".
- Impact: the promise of the spec depends on an unrelated script; a change to the admin setup would quietly turn
  "refuses to start" into "starts and answers 500".
- Evidence: "Validation runs on first use, so importing this module never fails by itself" (`env.ts`).
- Suggestion (required): validate in `register()` of an instrumentation file, and add a smoke case with an invalid
  optional value.
- Confidence: Medium. Whether an error thrown in `register()` stops the standalone server, instead of being logged,
  is behaviour of Next.js that was not tried.
- Reference: OWASP A02:2025 Security Misconfiguration; OWASP A10:2025 Mishandling of Exceptional Conditions;
  CWE-1188.

##### suggestion: a read-only root file system works, but is neither documented nor tested

- Location: `Containerfile`, the stage `app`, the step that creates `.next/cache`; `spec/container-image.md`, section
  "Image"
- Severity: Minor
- Category: security
- Problem: the server writes only below `.next/cache`, but the spec does not say that the container can run with a
  read-only root file system or which directories need to be writable.
- Evidence: on the local machine the image starts with `--read-only --tmpfs /app/.next/cache --tmpfs /tmp`, and
  `/api/health` answers `200 {"status":"ok"}`.
- Suggestion (optional): document the flags in "What the environment has to provide" and use them in one smoke start.
- Confidence: Medium. Only the start and `/api/health` were tried, not pages that write the cache, and the flags were
  not tried on the older Podman of the runner.
- Reference: `SYS.1.6.A23`.

##### suggestion: the spec names no secret store for `DATABASE_URL` and the admin password

- Location: `spec/container-image.md`, section "What the environment has to provide"
- Severity: Minor
- Category: docs
- Problem: both secrets reach the container as plain variables, visible in `podman inspect` and `/proc/*/environ`.
  Podman secrets (`--secret name,type=env,target=DATABASE_URL`) work without code changes; the spec does not mention
  them.
- Suggestion (optional): recommend Podman secrets or an environment file with mode 0600, and record the choice as the
  answer to ASVS 13.3.1.
- Confidence: Low. It offers Podman secrets or an environment file and asks for the choice to be recorded, which is a
  decision.
- Reference: ASVS 13.3.1, 13.3.2; CWE-526; `SYS.1.6.A8`.

##### suggestion: the final image carries `npm`, `npx` and `apt`

- Location: `Containerfile`, the stage `app`
- Severity: Nit
- Category: security
- Problem: the runtime needs `node`, `sh` and the Prisma CLI; `npm` and `npx` can fetch and run packages as the user
  `node`.
- Evidence: in the image, `which npm npx apt` finds `/usr/local/bin/npm`, `/usr/local/bin/npx` and `/usr/bin/apt`.
- Suggestion (optional): remove npm, npx and yarn in the stage `app` before `USER node`.
- Confidence: Medium. Which of npm, npx, corepack and yarn the slim image of Node.js 26 carries, and where, was not
  checked, and `apt` stays.
- Reference: ASVS 15.2.3.

##### nit: `container-image.md` restates the tag of the base image, and does not say what several instances need

- Location: `spec/container-image.md`, sections "Image" and "What the environment has to provide"
- Severity: Nit
- Category: docs
- Problem: "pinned to a minor version (`node:26.13-slim`)" goes stale with every update by Dependabot. "One instance
  only" does not say that instances of different images do not share the key of Server Actions, and that an update
  makes open forms fail once without a `deploymentId` (Next.js guide on self-hosting).
- Suggestion (optional): point to the first `FROM` line of the `Containerfile`, and add one line on several instances
  and updates.
- Confidence: Medium. The pointer to the `FROM` line is clear, but the line on several instances rests on the guide
  of Next.js on self-hosting, which was read but not tried.
- Reference: `issue-report.md`, last item of the checklist.

##### Reviewed

- Files read: `Containerfile`, `.containerignore`, `scripts/image-start.sh`, `image-migrate.sh`, `image-admin.sh`,
  `image.sh`, `db.sh`, `scripts/Containerfile`, `scripts/admin.ts`, `src/lib/env.ts`, `client-address.ts`, `db.ts`,
  `src/app/api/health/route.ts`, `next.config.ts`, `prisma.config.ts`, `.env.example`, `spec/container-image.md`,
  `spec/tech.md`; the Next.js guides on self-hosting and data security and the origin check of Server Actions.
- The image (built on the local machine with `npm run image:build`): user `node` (uid 1000), every file in `/app`
  owned by root, only `.next/cache` writable by `node`, only port 3000, `NODE_ENV=production`, no `.git` and no `.env`
  file, no source maps under `.next/static` (the 20 under `.next/server` are not served), no dev dependencies in the
  stage `app` (only the standalone trace, the migration tools and `@node-rs`), one process, no remote access
  (`SYS.1.6.A11`, `SYS.1.6.A16`, `SYS.1.6.A17`). The missing `HEALTHCHECK` is an accepted deviation.
- `.containerignore` lists `.env*` (except `.env.example`), `.git`, `node_modules`, `.next`, `.next-e2e`, `build`,
  `coverage`, `playwright-report`, `test-results`, `e2e/.auth`, `*.tsbuildinfo` and the generated client; a second
  check in the `Containerfile` refuses a `.env` in the standalone output.
- Example admin passwords (ASVS 6.3.2, CWE-1392, CWE-1188): `.env.example` leaves `HIPPOWIKI_ADMIN_PASSWORD` empty,
  so the admin setup fails until the operator sets one, and the README writes `'<first password>'` with a hint to
  generate a password with `openssl rand -base64 24`. `adminPasswordSchema` makes `ensureAdmin()` refuse any value in
  angle brackets as a placeholder. A unit test reads every value of the variable in `.env.example` and `README.md`
  and checks that each is empty or refused, so no public value can become the password of the admin.
- The start: the migration runs first and `set -eu` stops the start on failure; the variables are quoted; `exec`
  makes the server PID 1, and Next.js ends gracefully on SIGTERM.
- Configuration: `DATABASE_URL` must be a `postgres(ql)://` URL, `HIPPOWIKI_PUBLIC_URL` an `https` origin (`http`
  only on loopback), `HIPPOWIKI_TRUSTED_PROXIES` one digit; errors do not echo values; the standalone server forces
  `NODE_ENV=production`, so secure cookies cannot be switched off. In the image the session cookie is
  `__Secure-better-auth.session_token` with `Secure`.
- Forwarding headers (ASVS 4.1.3, 15.3.4, CWE-290): the app reads only `X-Forwarded-For`, and only with trusted proxies;
  the issuer and the addresses of MCP come from `HIPPOWIKI_PUBLIC_URL`. On the local server a login with a forged
  `X-Forwarded-For` is counted in the group `shared`, a forged `X-Forwarded-Host` and `X-Forwarded-Proto` do not change
  the `Location` of the proxy, and the issuer stays `http://localhost:3100`. Next.js accepts a Server Action whose
  `Origin` matches a forged `X-Forwarded-Host`, but a browser cannot add that header across sites, so a directly
  reachable port opens no CSRF.
- Several instances: the key of Server Actions is part of the build, so all containers of one image share it; all
  actions are module-level, so the key protects no closures.
- `/api/health` (ASVS 13.4.5): `{"status":"ok"}` or `{"status":"error"}`, no version, no `X-Powered-By`; `POST` gives
  `405`. Pages answer `TRACE`, `PUT` and `DELETE` with the page (`200` in the image) and echo nothing, so there is no
  cross-site tracing; only OPTIONS is refused.
- Standards cross-check: no `.git` in the image (ASVS 13.4.1); Next.js lists no directories (ASVS 13.4.3); `TRACE`
  is not echoed (ASVS 13.4.4); the database is reached with a password of its own (ASVS 13.2.1), whose strength and
  defaults are deployment checks (ASVS 13.2.3); `child_process` is used only in `scripts/check-doc-references.ts` and
  `scripts/check.ts`, development tools, and in the test helpers `e2e/support/database.ts` and
  `e2e/support/container.ts`, all with fixed arguments or a fixed list of commands (ASVS 1.2.5).

#### Supply chain: dependencies, CI and release

##### issue: no security contact and no private way to report vulnerabilities

- Location: the root of the repository (no SECURITY.md); `README.md`, all sections
- Severity: Minor. It is documentation only, but the project publishes an image that others run.
- Category: docs
- Problem: nothing in the repository says where to report a vulnerability, through which private channel, or what
  answer to expect. Private vulnerability reporting of GitHub is a setting that cannot be seen from the repository.
- Impact: someone who finds a flaw in the OAuth server or the MCP endpoint can only open a public issue.
- Evidence: there is no SECURITY.md, CONTRIBUTING.md or CHANGELOG.md, and `README.md` does not mention security. On
  2026-11-22, private vulnerability reporting is off:
  `gh api repos/PhilipMay/HippoWiki/private-vulnerability-reporting` gives `{"enabled":false}`.
- Suggestion (required): add SECURITY.md with the supported versions, the private channel, the expected time to
  answer and how fixes are released.
- Confidence: Low. The private channel, the supported versions and the time to answer are choices of the maintainer.
- Reference: OWASP A03:2025 Software Supply Chain Failures; BSI TR-03185-2 VM.01; ISO/IEC 29147.

##### issue: no rule for how fast vulnerable dependencies are fixed, and nothing in CI detects them

- Location: `spec/step-plan-workflow.md`, section "Rules for every step"; `.github/dependabot.yml`; `.github/workflows/`
- Severity: Minor. It is a gap in the documentation, and the alerts of Dependabot may be switched on in the settings.
- Category: security
- Problem: the only rule is that upgrading packages is "a task of its own", with no time frame by severity. No workflow
  runs `npm audit`, a dependency review or a scan of the image.
- Impact: a vulnerable `next` or `better-auth` can stay in the published image for an unbounded time, and nobody can
  tell.
- Evidence: "Upgrading existing packages is a task of its own, not part of a feature step." On 2026-11-14,
  `npm audit` reports 7 moderate vulnerabilities, all in development tools (`minimatch` below
  `@typescript-eslint/typescript-estree`, GHSA-g3hv-75wg-m249), and `npm audit --omit=dev` reports none; no check
  would have failed either way. On 2026-11-22, the alerts and the security updates of Dependabot are on, and the alert
  of that advisory has been open since 2026-11-11: `@typescript-eslint/typescript-estree` asks for
  `minimatch@^10.2.2`, and the fix is 11.0.1, so a security update of Dependabot cannot reach it.
- Suggestion (required): add a rule with time frames (for example critical and high in production within 7 days,
  moderate within 30) that makes a security fix not wait; make sure alerts and security updates of Dependabot are on;
  optionally `npm audit --omit=dev --audit-level=high` in CI.
- Confidence: Low. The time frames are a decision of the process.
- Reference: OWASP A03:2025 Software Supply Chain Failures; ASVS 15.1.1, 15.2.1; CWE-1395.

##### issue: users cannot check that a published image is the one CI built, and "no signing" has no reason

- Location: `spec/container-image.md`, section "Current limits"; `spec/roadmap.md`, section "Container Image";
  `README.md`, section "Publishing"; `.github/workflows/container_image.yml`, the step "Write the pushed image to the
  job summary"
- Severity: Minor. Changing the image needs write access to the package or the repository.
- Category: security
- Problem: "no image signing, provenance attestations or vulnerability scans" is listed as a limit without a reason.
  The only check is the digest in the job summary, and `README.md` tells users to pull by tag, which can change.
- Impact: an image pushed or replaced under a release tag cannot be told from the one CI built.
- Evidence: "- no image signing, provenance attestations or vulnerability scans"; `README.md` pulls
  `ghcr.io/<owner>/hippowiki:<tag>`.
- Suggestion (required): give the reason as a decision, or add a provenance attestation
  (`actions/attest-build-provenance` with the digest); in any case put the digest into the release notes and tell
  users to pin it.
- Confidence: Low. The Suggestion leaves open whether to give a reason as a decision or to add an attestation, and
  the release job has not run on GitHub yet.
- Reference: OWASP A03:2025 Software Supply Chain Failures; OWASP A08:2025 Software or Data Integrity Failures; BSI
  TR-03185-2 BR.03; `SYS.1.6.A12`; CWE-494.

##### issue: the release job holds `packages: write` for every trigger, and the spec overstates how the token is kept from the code

- Location: `.github/workflows/container_image.yml`, job `container_image`, its `permissions` and the comment above
  them; `spec/container-image.md`, section "Publishing"
- Severity: Minor. Fork pull requests and Dependabot get a read-only token, and the dependencies run inside
  `podman build`, not on the runner.
- Category: security
- Problem: the job gets `packages: write` for pushes, pull requests, manual runs and releases, though only a release
  pushes. The comment says "the token is kept away from that code: the checkout does not store it, and only the login
  step gets it", but the token is in
  the memory of the runner process from the start of the job, and `scripts/image.sh` of the commit runs on the runner
  before the login.
- Impact: someone who can push a branch to the repository, or a malicious change merged to `main`, could push images
  to the package without a release.
- Evidence: `permissions: contents: read / packages: write` with the comment above.
- Suggestion (required): split into a job that builds and tests without write rights and a job that only pushes, for
  releases; at least correct the comment and the spec.
- Confidence: Medium. The Suggestion offers a split into two jobs or only a corrected comment and spec, and a split
  has to carry the checked image from one job to the next without a rebuild, which was not tried.
- Reference: OWASP A03:2025 Software Supply Chain Failures; CWE-272.

##### issue: GitHub actions are pinned to tags, not commit SHAs

- Location: `.github/workflows/*.yml`, every `uses:` line (`actions/checkout@v7`, `actions/setup-node@v7`,
  `actions/upload-artifact@v7`)
- Severity: Minor. All actions are GitHub's own.
- Category: security
- Problem: a tag can be moved by the owner of the action, and in the release job `actions/checkout@v7` runs where
  `packages: write` is available.
- Impact: a compromised or moved tag runs foreign code in every workflow, the release included.
- Evidence: all 16 `uses:` lines name a `@v7` tag. On 2026-11-22, the settings of Actions allow every action
  (`allowed_actions: all`) and do not require pinning by SHA (`sha_pinning_required: false`).
- Suggestion (required): pin each action to its commit SHA with the version as a comment; Dependabot keeps both up to
  date.
- Confidence: Medium. That Dependabot keeps both the SHA and the version comment up to date is from its documentation
  and was not tried here.
- Reference: OWASP A03:2025 Software Supply Chain Failures; OWASP A08:2025 Software or Data Integrity Failures;
  CWE-829.

##### issue: no list of the third-party components of the published image

- Location: the repository and the releases; `Containerfile`, the stage `migrate-tools`
- Severity: Minor
- Category: security
- Problem: `package-lock.json` lists the npm tree of the repository, but not the image: the migration tools are
  resolved anew at every build without a lockfile, and the Debian packages of the base image and the schema engine of
  Prisma are listed nowhere.
- Impact: when a vulnerability is announced, nobody can tell whether a release is affected.
- Evidence: `npm install --no-audit --no-fund "prisma@${PRISMA_VERSION}" "dotenv@${DOTENV_VERSION}"`.
- Suggestion (required): create an SBOM of the image for every release and attach it; an SBOM by TR-03183-2
  (CycloneDX 1.6 or SPDX 3.0.1 with transitive dependencies) is a suggestion only.
- Confidence: Low. The tool and the format of the SBOM are open, and it cannot be shown to work before the release
  job has run on GitHub.
- Reference: OWASP A03:2025 Software Supply Chain Failures; ASVS 15.1.2; BSI TR-03185-2 QA.01; BSI TR-03183-2.

##### issue: no changelog, and the release version is not tied to the version of the project

- Location: the repository (no CHANGELOG.md); `package.json`, `version`; `spec/container-image.md`, section
  "Publishing"
- Severity: Minor
- Category: docs
- Problem: the image tag is the free-form release tag, checked only for its syntax; no file or rule says that a
  release lists its changes and its security fixes. `roadmap.md` already expects the fixes of a security review on
  the deployment "after the next release" ("Things to Check").
- Impact: operators cannot tell whether they need to update, or which release fixes what.
- Evidence: `"version": "0.1.0"` and no changelog.
- Suggestion (required): a changelog, or a rule that every release names its changes with a section "Security", and
  version tags compared with `package.json`.
- Confidence: Low. The Suggestion offers a changelog or a rule for release notes, a choice of the process.
- Reference: BSI TR-03185-2 BR.02, BR.04.

##### issue: changes reach `main` without a second review, and this is not documented as a decision

- Location: `CLAUDE.md`, section "Git Handling"; `spec/step-plan-workflow.md`, section "Step plans"
- Severity: Minor. It describes the process of a single maintainer.
- Category: docs
- Problem: the documented process commits to the current branch and pushes it; any review comes afterwards. Whether
  rules of the repository require reviews or checks on `main` or protect release tags cannot be seen from the
  repository.
- Impact: one compromised developer account or machine can put code into `main` and publish a release.
- Evidence: "push the current branch with `git push`, without asking first". On 2026-11-22, neither `main` nor any
  tag has a rule: `gh api repos/PhilipMay/HippoWiki/branches/main/protection` answers "Branch not protected", and the
  repository has no rulesets.
- Suggestion (required): document it as a decision (single maintainer, CI as the gate, periodic reviews), or require
  pull requests with passing checks and protect `v*` tags.
- Confidence: Low. Documenting it as a decision or requiring pull requests is a choice of the maintainer's process.
- Reference: BSI TR-03185-2 QA.06; OWASP A03:2025 Software Supply Chain Failures.

##### suggestion: new versions of dependencies arrive without a waiting period, and all install scripts run

- Location: `.github/dependabot.yml` (no `cooldown`); `.npmrc`
- Severity: Minor
- Category: security
- Problem: Dependabot proposes the newest versions every week however fresh they are, and every `npm ci` runs the
  install scripts of the whole tree (today the root `postinstall`, `prisma`, `@prisma/engines`, `esbuild` and the
  optional `fsevents`). A malicious new version with an install script would run on the next install.
- Suggestion (optional): `cooldown` of about 7 days for `npm` and `docker` (security updates are not delayed), and
  consider `ignore-scripts=true` with an explicit rebuild of the packages that need it, or write down why scripts
  stay on.
- Confidence: Low. Turning scripts off or writing down why they stay on is a decision, and the rebuild of the
  packages that need scripts was not tried.
- Reference: OWASP A03:2025 Software Supply Chain Failures; CWE-829.

##### suggestion: a release can publish an image of any commit, and the migration tools are resolved at release time

- Location: `.github/workflows/container_image.yml`, the trigger `release` and the checkout step of the job
  `container_image`; `Containerfile`, the stage `migrate-tools`; `spec/container-image.md`, section "Decisions"
- Severity: Minor
- Category: security
- Problem: a published release builds the commit its tag points to, which need not be on `main` or have passed the
  other workflows. The migration tools come outside the lockfile, Dependabot and `npm audit`; the decision weighs
  reproducibility and cost, not this exposure.
- Suggestion (optional): check in the release job that the commit is on `main`, protect `v*` tags, and lock the
  migration tools with a lockfile of their own that Dependabot maintains.
- Confidence: Low. A lockfile for the migration tools goes against the decision in "Decisions" of
  `container-image.md`, and protecting `v*` tags is a setting of the repository.
- Reference: OWASP A03:2025 Software Supply Chain Failures; CWE-829.

##### nit: six workflows keep the default `persist-credentials: true` while `npm ci` runs install scripts

- Location: `.github/workflows/end_to_end_tests.yml`, `end_to_end_tests_production.yml`, `format_check.yml`,
  `integration_tests.yml`, `lint.yml`, `unit_tests.yml`, the step `actions/checkout@v7` of each
- Severity: Nit. The token can only read and expires with the job.
- Category: security
- Problem: the checkout writes the token into `.git/config` before install scripts and tests run.
- Suggestion (optional): `persist-credentials: false` on every checkout, as `container_image.yml` has.
- Confidence: High. No step of the six workflows runs `git` after the checkout, `container_image.yml` already uses the
  same setting, and the runs of the six workflows show that it works.
- Reference: CWE-522.

##### nit: the licence is missing in `package.json`, and the licence sentence of the README is not MIT's

- Location: `package.json`; `README.md`, section "Licensing"
- Severity: Nit
- Category: docs
- Problem: `LICENSE` is MIT, but `package.json` has no `license` field, so SBOM tools report the project as
  unlicensed; "you may not use this file except in compliance with the License" is wording of Apache 2.0.
- Suggestion (optional): add `"license": "MIT"` and shorten the sentence.
- Confidence: High. One fix with no effect on the code, and `npm run check` shows that both files stay valid.
- Reference: BSI TR-03185-2 LE.01, LE.02.

##### nit: no guide for contributions

- Location: the repository (no CONTRIBUTING.md); `README.md`
- Severity: Nit
- Category: docs
- Problem: nothing says whether and how outside contributions are accepted and which checks they must pass.
- Suggestion (optional): a short CONTRIBUTING.md or a section in `README.md`.
- Confidence: Low. Whether outside contributions are accepted is a decision of the maintainer.
- Reference: BSI TR-03185-2 GV.01.

##### nit: ESLint 9 is marked as no longer supported, and the hold-back is not written down

- Location: `package.json`, `eslint`; the entry `node_modules/eslint` in `package-lock.json`
- Severity: Nit. It is a development tool.
- Category: security
- Problem: the lockfile marks ESLint 9.39.5 deprecated; the plugins of `eslint-config-next` do not accept ESLint 10
  yet. The comment in `.npmrc` names this as an example of an incompatible upgrade, but no spec says that ESLint is
  held back.
- Suggestion (optional): note the hold-back and its cause in `tech.md`.
- Confidence: High. The cause was checked in the ranges of ESLint that the plugins accept in `package-lock.json`, the
  fix is one note in `tech.md`, and `npm run docs:check` covers it.
- Reference: CWE-1104.

##### question: does Dependabot find the files named `Containerfile`?

- Location: `.github/dependabot.yml`, the two `docker` entries
- Severity: Nit
- Category: correctness
- Problem: both entries rely on Dependabot recognising the name `Containerfile` instead of `Dockerfile`, and
  `container-image.md` says the first runs on GitHub are still to come. If it does not, neither image is ever updated,
  though three specs say it is.
- Suggestion (optional): check in the dependency graph of the repository that both files are listed.

##### question: does the image carry the licence notices of the third-party code, including the LGPL `libvips` of `sharp`?

- Location: `Containerfile`, the stage `app`, the `COPY` of `.next/standalone`
- Severity: Nit
- Category: docs
- Problem: the standalone output copies only the files that are imported, in minified bundles, so licence texts may be
  missing; `sharp`, an optional dependency of `next`, brings `@img/sharp-libvips-*` under LGPL-3.0-or-later. The image
  holds `@img` in `/app/node_modules`.
- Suggestion (optional): count the licence files in the image against the packages and, if they are missing, add a
  file of third-party notices from the SBOM.
- Reference: BSI TR-03185-2 LE.02.

##### Reviewed

- Files read: the seven workflows, `.github/dependabot.yml`, `package.json`, `.npmrc`, `.nvmrc`, `LICENSE`,
  `README.md`, `Containerfile`, `scripts/Containerfile`, `scripts/image.sh`, `.containerignore`, the CI and image
  sections of the specs, and `package-lock.json` entry by entry (install scripts, deprecations, sources, integrity,
  licences).
- Evidence from commands on 2026-11-14: `npm audit` 7 moderate (development tools only), `npm audit --omit=dev` 0;
  `npm audit signatures`: 727 packages with verified registry signatures, 197 with verified attestations; `npm ls`
  reports no invalid, extraneous or missing package apart from optional packages of other platforms.
- Permissions: every workflow sets `permissions: contents: read` at the top; only the job of the image widens it
  (finding above). No workflow uses `pull_request_target`; the only secret is `GITHUB_TOKEN`, used in the login step
  of a release only.
- Caches: `setup-node` caches npm only in the six test workflows, scoped to the ref; the release job uses no cache, and
  `npm ci` checks the integrity of every package anyway.
- Script injection (CWE-94): the release tag, the actor and the commit reach the shell only through `env`, and the tag
  is checked by `check_tag()` before the build; no other workflow uses `${{ github.event.* }}`.
- The release pushes the image that passed the smoke test, without a rebuild, with the token on stdin and
  `persist-credentials: false`; `latest` is never pushed, with the reason documented.
- Installs: `npm ci` from the lockfile in CI and in the image; all 807 entries come from `registry.npmjs.org` with an
  integrity hash; no private scopes. `.npmrc` holds only `strict-peer-deps=true`.
- Versions: `next`, `react` and `react-dom` are pinned exactly; no runtime package is in `devDependencies` or the other
  way round.
- Dependabot covers npm, both container images and the actions, weekly, as the specs say (see the question on the
  file name).
- Build instructions (BSI TR-03185-2 BR.01): `README.md` covers the local build, the tests and the image.
- The IDs of BSI TR-03185-2 are taken from the plan of this review; their exact wording could not be checked (see
  "Open questions").

#### Cross-cutting: data model, architecture, documentation and tests

##### issue: no inventory of the cryptography, and no documented way to replace the cookie secret

- Location: `spec/users-and-login.md`, sections "Passwords" and "Sessions"; `spec/connected-apps.md`; `spec/oauth.md`,
  section "Secrets"; `src/lib/auth.ts`, `readSecret()` and `getAuth()`
- Severity: Minor. The algorithms are sound; the documentation and a safe replacement of the one key are missing.
- Category: docs
- Problem: the facts are spread over three specs, and some are written nowhere: the HMAC-SHA256 signature of the
  session cookie, the session token of about 190 bits, the 256-bit secret in `AuthSecret`, where each key is used and
  how it is replaced. `getAuth()` keeps the secret for the life of the process, so deleting the row changes nothing
  until every process restarts. Argon2 hashes carry their parameters, but no password is rehashed at a login.
- Impact: after a leak of a backup, an operator cannot rotate the cookie secret without guessing the procedure, and a
  later change of an algorithm has no path.
- Evidence: `users-and-login.md`: "There is no variable for the secret." No spec names HMAC or a rotation.
- Suggestion (required): a section on cryptography in `architecture.md` with algorithm, key size, purpose and storage
  of each item (Argon2id, SHA-256 for tokens, codes, access and refresh tokens, HMAC-SHA256 with `AuthSecret`, the
  session token, `randomBytes`, `randomInt`, PKCE S256, TLS at the proxy) and the procedure to replace `AuthSecret`.
- Confidence: Low. The procedure to replace `AuthSecret` depends on the open choice in the finding on
  `BETTER_AUTH_SECRETS` (versioned secrets, or delete the row and restart, which ends every session), and neither was
  tried.
- Reference: OWASP A04:2025 Cryptographic Failures; ASVS 11.1.1, 11.1.2, 11.2.2; CWE-320; BSI TR-02102-1.

##### issue: no security overview places the security mechanisms, the outgoing connections and the sensitive data, and no spec mentions CSRF

- Location: `spec/architecture.md`; `spec/container-image.md`, section "What the environment has to provide"
- Severity: Minor
- Category: docs
- Problem: `architecture.md` describes the layers, the two login layers and the headers, but not where each mechanism
  lives (authentication, authorisation in the services, CSRF by the origin check of Server Actions and
  `SameSite=Lax`, XSS by React, the link check of the Markdown parser and the CSP, limits, the SSRF guard, logging). No spec lists the
  outgoing connections (PostgreSQL, and DNS and `https` to any public host for metadata documents while
  `HIPPOWIKI_PUBLIC_URL` is set) or says which feature needs them, except one check of the deployment in `roadmap.md`
  ("outgoing connections only to DNS and `443/tcp`"), and none classifies the sensitive data. `roadmap.md` ("Things to Check") lists "`Host`
  passed unchanged" for the reverse proxy, but that the CSRF check depends on it stands only in this report.
- Impact: someone who changes the deployment or adds a route cannot see which control they rely on.
- Evidence: `grep -i "csrf\|cross-site" spec/*.md` finds only `review-report-v2.md`.
- Suggestion (required): a section "Security overview" in `architecture.md` with one line per mechanism, the outgoing
  connections, and the classes of data with their protection and retention; in `container-image.md`, that the proxy
  passes `Host` unchanged and that DNS and port 443 are needed when OAuth is on. The threat model of this report can
  be the base.
- Confidence: Low. The classes of data need a retention that no spec has decided yet (see the suggestion on expired
  sessions), and which content goes into the overview is a choice.
- Reference: OWASP A06:2025 Insecure Design; `CON.10.A11`; ASVS 13.1.1, 13.2.4, 14.1.1, 14.1.2; CWE-1059.

##### issue: no spec lists the costly functions and how each is protected

- Location: `spec/pages.md`, section "The cost of the Markdown parse"; `spec/users-and-login.md`, section
  "Passwords"; `spec/oauth.md`, section "Clients"; `spec/mcp.md`, section "The endpoint"
- Severity: Minor
- Category: docs
- Problem: this ties together the findings on the queue of the password hashing, the unbounded bodies of the OAuth
  endpoints and the unpaged lists. ASVS 15.1.3 asks for one place that names each function that needs much time or
  memory and its guard; today the parts are scattered (the Argon2 limiter in `users-and-login.md`, the limits of the
  metadata fetch in `oauth.md`, the body limit and the rate limit of the MCP addresses in `mcp.md`).
- Impact: there is no single list to check a new costly path against, and no statement of what the timeout of the
  proxy has to cover.
- Evidence: no spec file holds a list of the costly functions; each limit is named only in the spec of its feature.
- Suggestion (required): one table, for example in the security overview, with each costly function, its limit, or
  "none, a task of the proxy", and a link to its finding. Its first entry is the Markdown parse, whose guards
  `pages.md` lists in "The cost of the Markdown parse".
- Confidence: Medium. The change of the docs is clear, but the limit in each row depends on how the linked findings
  are fixed, and those are still open.
- Reference: OWASP A06:2025 Insecure Design; ASVS 15.1.3, 15.2.2; CWE-400.

##### issue: the protections that come from Next.js, the MCP SDK and Better Auth have no regression test

- Location: `e2e/security-headers.spec.ts`, `e2e/access.spec.ts`, `src/features/mcp/http.test.ts`
- Severity: Minor
- Category: tests
- Problem: the rules of the features are tested thoroughly, but these were checked only by hand in this review: a
  Server Action with a foreign `Origin` is refused; pages, RSC payloads and action answers carry `no-store`; no answer
  carries `Access-Control-*`; and there is no `/api/auth/*`. The body limit of the MCP addresses is the wiki's own now
  and has its tests (`e2e/mcp-limits.spec.ts`).
- Impact: an upgrade of Next.js or the SDK, a setting such as `serverActions.allowedOrigins`, a `use cache` or a new
  route under `api/auth` could weaken CSRF or caching protection unnoticed.
- Evidence: no test file under `e2e/` or `src/` sends a Server Action with a foreign `Origin`, asserts
  `Cache-Control` on a page, or calls `/api/auth/`.
- Suggestion (required): end-to-end tests for each of these (the CSRF test can rewrite the `Origin` with `page.route`).
- Confidence: Medium. How Next.js answers a Server Action whose `Origin` was rewritten with `page.route` was read in
  the code but not tried in a test.
- Reference: OWASP A01:2025 Broken Access Control; ASVS 3.5.1, 3.4.2, 14.3.2; CWE-352; `CON.10.A15`.

##### issue: Better Auth takes `BETTER_AUTH_SECRETS` from the environment, which replaces the cookie secret of `AuthSecret`

- Location: `src/lib/auth.ts`, `createAuth()`; `spec/users-and-login.md`, section "Sessions"
- Severity: Minor. It needs an operator who sets the variable; the session token is still looked up in the database.
- Category: security
- Problem: `createAuth()` passes `secret` but not `secrets`, and Better Auth then uses
  `options.secrets ?? parseSecretsEnv(env.BETTER_AUTH_SECRETS)` and, when it is set, takes its first value instead.
  A weak value only gives a warning. The variable bypasses `getServerEnv()` and contradicts the spec ("There is no
  variable for the secret"); Better Auth also reads `BETTER_AUTH_URL` and `BETTER_AUTH_TRUSTED_ORIGINS` by itself.
- Impact: an operator who follows the documentation of Better Auth silently replaces the secret, and every session
  ends when the variable appears or disappears.
- Evidence: in `node_modules/better-auth/dist/context/create-context.mjs`: `const secretsArray = options.secrets ??
parseSecretsEnv(env.BETTER_AUTH_SECRETS);` … `secret = secretsArray[0].value;`.
- Suggestion (required): pass `secrets: [{ version: 1, value: secret }]` from `AuthSecret` (which also allows a
  versioned rotation), or document the variable as the way to rotate.
- Confidence: Medium. The Suggestion offers two fixes, and passing `secrets` also changes the configuration of the
  secrets that Better Auth builds, so it was not tried that existing cookies stay valid.
- Reference: OWASP A02:2025 Security Misconfiguration; ASVS 11.1.1; CWE-15.

##### nit: the generated first password has about 116.7 bits, below 128 (ASVS) and 120 (TR-02102-1)

- Location: `src/features/users/password.ts`, `FIRST_PASSWORD_LENGTH` and `FIRST_PASSWORD_ALPHABET`
- Severity: Nit. It is guessed online behind the login wait and must be changed at the first login.
- Category: security
- Problem: 20 characters from an alphabet of 57 give 20 × log2(57) ≈ 116.7 bits.
- Suggestion (optional): 22 characters give about 128.3 bits; the length of 20 is also stated in "User list and
  creating users" of `users-and-login.md`, in the comments of `password.ts`, in `password.test.ts` and in
  `e2e/users.spec.ts`.
- Confidence: Medium. Users see the change, since the admin passes on a longer password, and the length is a stated
  rule of `users-and-login.md`.
- Reference: ASVS 11.5.1; BSI TR-02102-1.

##### nit: the database does not hold every invariant that the comments of the schema state

- Location: `prisma/schema.prisma`, model `Account`
- Severity: Nit. Only a broken caller can break it.
- Category: correctness
- Problem: "Every user has exactly one" `Account` has no unique constraint behind it.
- Suggestion (optional): add a unique key on `Account`.
- Confidence: Medium. The Suggestion does not say which key (on `userId`, or on `providerId` and `accountId`), and it
  was not checked whether the adapter of Better Auth minds a unique key there.
- Reference: CWE-20.

##### nit: no index serves the lists of all pages and of the deleted pages of a folder

- Location: `src/features/pages/service.ts`, `listAllFolderPages()` and `listDeletedPages()`; `prisma/schema.prisma`,
  model `Page`
- Severity: Nit. It matters only together with the unlimited number of pages.
- Category: performance
- Problem: both filter by `folderId`, but the only index that starts with it is the partial unique one of pages
  directly in a folder.
- Suggestion (optional): `@@index([folderId, deletedAt])` on `Page`.
- Confidence: Medium. The index needs a migration that is not named, and no test or plan shows that PostgreSQL would
  use it.

##### nit: `architecture.md` describes ids that do not exist

- Location: `spec/architecture.md`, section "Database"
- Severity: Nit
- Category: docs
- Problem: "Every model has a UUID id generated by PostgreSQL (`gen_random_uuid()`)" is not true for every model with
  a UUID: the app creates the ids of users and grants with `randomUUID()`. The search that `architecture.md` and
  `tech.md` described is fixed: `architecture.md` says now that there is no search, `tech.md` no longer names one,
  and `roadmap.md` holds it.
- Suggestion (required): correct the sentence on ids (users and grants get their ids from `randomUUID()` in
  `newUserData()` and `exchangeCode()`), and the comment on `generateId` in `createAuth()` of `src/lib/auth.ts`,
  which makes the same claim.
- Confidence: High. One sentence and one comment, no change of behaviour, and a search for `randomUUID` shows that
  `newUserData()` and `exchangeCode()` are the only places that set an id.

##### nit: the longest functions of the services mix several steps, and small helpers are repeated

- Location: `src/features/oauth/token-service.ts`, `exchangeCode()` (124 lines) and `refreshGrant()` (89 lines);
  `src/features/auth/service.ts`, `reserveAttempt()` (82 lines); six identical `parse*Id()` wrappers of `z.guid()` in
  the `schema.ts` of folders, pages, users, grants and oauth; three copies of `currentTime()`, in
  `src/features/auth/service.ts`, `src/features/grants/service.ts` and `src/features/oauth/rows.ts`
- Severity: Nit
- Category: readability
- Problem: `exchangeCode()` reads and deletes the code, makes six checks with their log reasons, builds the tokens
  and runs the transaction with two errors of its own in one body; small helpers are repeated.
- Suggestion (optional): split `exchangeCode()` and `refreshGrant()` into reading the code or grant, the checks and
  the transaction; share one id parser and one `currentTime()`. The unused exports are gone: `npm run knip` reports
  every export that nothing imports.
- Confidence: Medium. The unit tests of the services would keep the behaviour, but where to split the functions is a
  judgement of readability.
- Reference: CWE-561.

##### suggestion: CI does not check that the migrations produce the schema

- Location: `.github/workflows/integration_tests.yml`; `e2e/support/database.ts`, `migrateTestDatabase()`;
  `integration/global-setup.ts`, `globalSetup()`
- Severity: Nit
- Category: tests
- Problem: an index or constraint in `schema.prisma` but not in a migration, or the other way round, would go
  unnoticed; a comparison by hand found no drift today.
- Suggestion (optional): run `prisma migrate diff … --exit-code` against the migrated test database right after
  `prisma migrate deploy` in `migrateTestDatabase()`, since the container of the test database lives only while
  `globalSetup()` runs and no later step of the job can reach it.
- Confidence: Medium. The exact options of `prisma migrate diff` against the test database were not tried, and
  `migrateTestDatabase()` also runs before the end-to-end tests.

##### suggestion: expired sessions and old login counts stay in the database

- Location: `prisma/schema.prisma`, models `Session`, `LoginAttempt` and `LoginWindow`; the cleanup in
  `src/features/auth/service.ts`, `deleteOldCounts()`, called from `logIn()`
- Severity: Nit
- Category: security
- Problem: Better Auth deletes an expired session only when its cookie comes back, so sessions of browsers that never
  return keep their token, address and user agent for good; login counts are deleted only by a later login, and their
  name may be a password typed into the wrong field (see the area "Logging"). No spec states a retention.
- Suggestion (optional): delete expired sessions in the same cleanup, and state the retention.
- Confidence: Medium. Deleting expired sessions in the same cleanup changes nothing users see, but a cleanup that runs
  only at a later login may not be enough, and the retention to state is still a choice.
- Reference: ASVS 14.2.7 (Level 3); CWE-359.

##### suggestion: no lint rule keeps comparisons strict

- Location: `eslint.config.mjs`
- Severity: Nit
- Category: style
- Problem: the code has no `as any`, `@ts-ignore` or `eslint-disable`, and `==` and `!=` only as comparisons with
  `null` (`mayDo()` and `mcpRolesFor()` in `src/features/folder-roles/roles.ts`), but nothing would stop the first
  loose comparison of two values.
- Suggestion (optional): `eqeqeq: ["error", "always", { null: "ignore" }]`, so that the two comparisons with `null`
  stay; `@typescript-eslint/no-explicit-any` is already an error through `eslint-config-next/typescript`.
- Confidence: High. One rule and no change of the code, the only loose comparisons are the two with `null` that the
  option allows, and `npm run lint` shows it.
- Reference: ASVS 15.3.5.

##### Reviewed

- Files read: `prisma/schema.prisma` and its migrations, `eslint.config.mjs`, `tsconfig.json`, `src/lib/`, the
  secrets, services and queries of every feature, `src/features/services.test.ts`, the titles of every test in
  `integration/` and `e2e/`, the feature specs, `architecture.md`, `testing.md` and `tech.md`; Better Auth (context,
  adapter, session, cookies) and the signing of better-call.
- Unique constraints: every rule has its index or key (folder name, one role per folder and user, tab per folder,
  page per tab, page directly in a folder and not deleted, user name and email, session token, access token and code
  hashes, metadata URL, login counts); `integration/db-errors.test.ts` pins the index names.
- `onDelete` matches `architecture.md`: Restrict within content, for the last editor and for the roles of a folder and
  a user, Cascade for the sessions, accounts, grants and codes of a user and for the codes and grants of a client and of
  a folder.
- Migrations against the schema: compared table by table in the first review, no drift (not compared again for the
  recheck); the hand-written SQL (the partial index, the check
  constraints of `AuthSecret` and of the MCP roles, the triggers that keep the type of an account and keep admins
  without a role, and the deletion of the old grants and codes) is commented.
- Layers: only services, `src/lib/` and the health route call `getDb()`; only the auth service imports `@/lib/auth`;
  no service imports `next`, `react`, `revalidate` or a `forms.ts`. Raw SQL is four tagged templates, three
  with parameters and the `SELECT 1` of the health route; no `include`.
- Type juggling (ASVS 15.3.5): none in `src/`, where the only loose comparisons are the two with `null` in
  `src/features/folder-roles/roles.ts`; `strict` and `noUncheckedIndexedAccess` are on.
- BSI TR-02102-1: SHA-256, HMAC-SHA256 with a 256-bit key, 256-bit secrets from `randomBytes`, session tokens of about
  190 bits, Argon2id with the parameters of OWASP, PKCE S256 compared in constant time; all at least 120 bits except
  the first password (nit above).
- Documentation of ASVS Level 2: the waits after failed logins (6.1.1), the ways of authentication (6.1.3), the
  authorisation rules (8.1.1, 8.1.2) and the input rules (2.1.1) are documented; session lifetimes (7.1.1, 7.1.2),
  limits (2.1.3) and logging (16.1.1) are findings of earlier areas; the architecture (`CON.10.A11`), the outgoing
  connections (13.1.1) and the costly functions (15.1.3) are findings above.
- Tests: the security rules of the specs have tests, among them another user's token, the reuse of a code and of a
  refresh token, PKCE `plain`, private addresses and redirects of the metadata fetch, deleted pages over MCP, a foreign
  `Origin` at an MCP address, a connection of another folder or with too low a role, the security headers, the login wait under concurrency, raw HTML and `javascript:` links, and no
  secret in the logs. The gaps are the finding above.
- Test runs of this review on 2026-11-14: `npm run test:coverage`: 1,737 unit tests passed; statements 77.16 %
  (2,048 of 2,654), branches 72.81 %, functions 66.73 %, lines 77.53 %, with the components covered by the end-to-end
  tests instead; `npm run test:integration`: 301 tests passed in 19 s; `npm run test:e2e`: 485 tests passed in 3.3
  minutes. No test failed or needed a retry, so no flaky test was seen.
- Standards cross-check: every query goes through Prisma or a tagged template with parameters (ASVS 1.2.4); JSON is
  parsed without revivers or class types (ASVS 1.5.2); the cryptography uses Node.js `crypto` and `@node-rs/argon2`,
  established implementations (ASVS 11.2.1); the hash functions are SHA-256 and Argon2id (ASVS 11.4.1, 11.4.3); the app
  encrypts nothing itself and creates no key pairs, so ASVS 11.3, 11.4.4 and 11.6.1 do not apply; ASVS 11.2.3 (128
  bits) is met except for the first password (nit above).

### Accepted deviations

- NIST SP 800-63B-4 3.2.2, disabling an account after 100 failures in a row (Login): `users-and-login.md`,
  "Decisions": "An account is never disabled after many failures … with no mail and no password reset there would be
  no way back in." The hour window per name caps the guesses at 20 per hour instead.
- ASVS 6.1.1 and CWE-645, a name locked by about 10 to 20 cooperating address groups when proxies are trusted (Login):
  `users-and-login.md`, "Current limits", with the "login budget for known clients" in `roadmap.md`. It does not
  cover the default of no trusted proxy (see the finding).
- ASVS 2.4.1, no limit per client across user names (Login): `users-and-login.md`, "Current limits", and
  `container-image.md`, "What the environment has to provide": a task of the reverse proxy.
- ASVS 6.3.2 and CWE-1392, the fixed admin name `admin` (Login): `users-and-login.md`, "Decisions": there is no
  default password, the first password must be changed at the first login, and every account sees the user list
  anyway.
- ASVS 13.3.1, no secrets management solution for the cookie secret (Login): `users-and-login.md`, "Decisions": the
  secret is kept in the database so that a container needs only two variables.
- ASVS 11.4.2 for access tokens (Connected apps): an access token of 256 random bits is stored as SHA-256, not with a
  password hash function; `connected-apps.md`, "Decisions", gives the reason.
- ASVS 7.2 and 7.4 for access tokens (Connected apps): a grant is not a session of Better Auth; `connected-apps.md`,
  "Decisions".
- ASVS 10.4.10 and 10.4.16, authentication of confidential clients (OAuth): every client is public; `oauth.md`,
  "Decisions" and "Current limits".
- ASVS 2.4.1, no limit on token requests (OAuth): `oauth.md`, "Current limits"; every secret has 256 bits.
- Refresh rotation instead of sender-constrained tokens, without a grace period (OAuth, ASVS 10.4.5): `oauth.md`,
  "Decisions".
- No revocation endpoint (RFC 7009) and no introspection (OAuth): `oauth.md`, "Current limits"; revoking on `/account`
  meets ASVS 10.4.9.
- There are no scopes, and a `scope` that a client sends is ignored (OAuth): the MCP address of a grant says what a
  connection may do; `oauth.md`, "The authorization request and the consent page" and "Decisions"; RFC 6749 section
  3.3 allows the server to ignore the requested scope.
- Deleted pages are kept for good, without automatic cleanup (Content): `page-deletion.md`, "Current limits".
- Images of other hosts are blocked by the CSP instead of being removed (Content): `pages.md`, "Rendering" and
  "Current limits".
- A save in the browser parses the content twice, once in the form and once in the service, instead of once
  (Content, ASVS 15.2.2): the parse is linear and takes at most about 0.1 s at the content limit, which costs less
  than giving up the second validation; `pages.md`, "Decisions".
- ASVS 16.5.3, the write of the last use of a token may fail and the request is still allowed after every check
  (Logging): `connected-apps.md`, "The check of an access token".
- ASVS 12.3.1, no TLS to the database (Configuration): `container-image.md`, "Configuration" and "Current limits":
  `DATABASE_URL` takes no parameters such as `sslmode`, so the database must stay on a network inside the host.
- No `HEALTHCHECK` in the image and one instance only (Configuration): `container-image.md`, "Health", "What the
  environment has to provide" and "Current limits", with `roadmap.md`. The missing signing, provenance and scan of the
  image has no reason and is a finding in "Supply chain".
- `/api/health` is public (Configuration, ASVS 13.4.5): `container-image.md`, "Health".
- Expired grants are not deleted by themselves (Cross-cutting, ASVS 14.2.7, Level 3): `connected-apps.md`,
  "Current limits".

### What is good

- Access control: two layers of the login check, with the check that protects the data in `requireUser()`
  (`src/features/auth/session.ts`), and an answer of the proxy that the client of Next.js understands for an action
  without a cookie (`src/proxy.ts`).
- Access control: the decisions of who may do what live in the services (`listUsers()` and `createUser()` in
  `src/features/users/service.ts`, `revokeGrant()`, `listGrants()` and `authenticateAccessToken()` in
  `src/features/grants/service.ts`), so that the MCP and OAuth adapters cannot skip them.
- Access control: the owner of a grant is part of the condition of the delete itself (`revokeGrant()` in
  `src/features/grants/service.ts`), with no gap between a read and a check.
- Access control: `safeNextPath()` in `src/lib/addresses.ts` combines a prefix check, a check for control characters
  and a check of the origin with the WHATWG `URL`.
- Access control: `e2e/access.spec.ts` covers the protected addresses with the edge cases of the matcher, stale
  cookies and actions without a session; `integration/grant-service.test.ts` covers revoking another user's grant.
- Browser security: one rule with the source `/:path*` in `next.config.ts` puts the security headers on every
  response, the redirects of the proxy included; `e2e/security-headers.spec.ts` checks them and collects CSP
  violations in a real browser.
- Browser security: `hasForeignOrigin()` in `src/features/mcp/http.ts` compares the `Origin` exactly with
  `HIPPOWIKI_PUBLIC_URL`, against DNS rebinding, as the MCP specification asks.
- Browser security: the consent form (`src/features/oauth/components/ConsentForm.tsx`) opens the redirect address
  with JavaScript instead of loosening `form-action 'self'`.
- Browser security: the services name their columns and return their own types, such as the last editor with the
  name only, and lists are Server Components that render only what they show.
- Login: `reserveAttempt()` and `releaseAttempt()` in `src/features/auth/service.ts` count a login in both limits or
  in neither, with conditional writes in one transaction, before the hash, and take the count back when the password
  was not checked.
- Login: `logIn()` counts and hashes unknown names like known ones, so neither the answer nor the wait tells which
  names exist.
- Login: `createLimiter()` in `src/lib/password-hash.ts` hands slots on in order with a bounded wait, and the Argon2id
  parameters are explicit.
- Login: `clientAddressGroup()` in `src/lib/client-address.ts` counts the trusted proxies from the right, never uses
  the leftmost entry, groups IPv6 by /64 and is checked again in the service.
- Login: `generateFirstPassword()` in `src/features/users/password.ts` uses `randomInt` without modulo bias and an
  alphabet without look-alike characters.
- Login: `ensureAdmin()` never overwrites an admin, is safe with two containers and never logs the password.
- Login: the cookie cache of Better Auth is off and sessions are not refreshed, so an ended session is refused at once
  (`src/lib/auth.ts`).
- Connected apps: `looksLikeAccessToken()` in `src/features/oauth/secret.ts` checks the exact shape, so malformed values
  never reach the database, and one generator with a prefix per kind serves all three kinds of secret.
- Connected apps: `exchangeCode()` locks the row of the user, so the limit of grants holds without a race;
  `revokeGrant()` has the owner in the delete itself.
- Connected apps: a unique hash column per kind of token keeps the kinds apart.
- OAuth: `requireUser()` runs before any redirect and before any fetch of a metadata document
  (`src/app/oauth/authorize/page.tsx`, `loadConsent()`), as RFC 9700 asks.
- OAuth: `parseMetadataUrl()` requires the address to equal its own WHATWG serialisation, which removes all numeric and
  odd host forms before any DNS lookup; `public-address.ts` allows IPv6 only in `2000::/3`; `metadata-fetch.ts` pins
  the connection to the checked address and follows no redirect.
- OAuth: `exchangeCode()` deletes the code conditionally before any check and locks the row of the user, and
  `refreshGrant()` swaps the hash conditionally, with the grant id in the refresh token so that reuse can be found.
- OAuth: a prefix and a hash column per kind of secret, and comparisons in constant time
  (`src/features/oauth/secret.ts`).
- OAuth: revoking deletes one row, so the access and the refresh token end together.
- MCP server: `handleMcpRequest()` checks the token before it reads the body or calls the SDK, so a caller without a
  token costs one header parse and at most one lookup; answers are JSON only, without sessions or subscriptions.
- MCP server: `run()` in `src/features/mcp/tools.ts` catches every unexpected error and answers with a general tool
  error; not found, deleted and malformed names get the same kind of error, with a hint what to do next.
- MCP server: the read tools carry `readOnlyHint`, the write tools `readOnlyHint: false` and, for
  `replace_page_content`, `destructiveHint`; all carry `openWorldHint: false` and output schemas that match the data.
- MCP server: the actor of MCP carries its connection, so that `readableFolderWhere()` in
  `src/features/folder-roles/service.ts` confines every read to the folder of the address and the services take the
  lower of the user's current role and the role of the connection for every write.
- Content: the page view is converted from the tokens of markdown-it by code of its own, with text only as React
  children and no `dangerouslySetInnerHTML`, and a link or image with an unsafe address is never made a link or image
  at all, so no element with an emptied address is rendered.
- Content: the composite foreign key of a page and its tab keeps a page's tab in its folder, and the partial unique
  index frees the name of a deleted page at once.
- Content: the services parse ids and names again, write with a condition on the state (`deletedAt`), check the key of
  the last editor first and redirect only to stored addresses.
- Logging: every refusal of `authenticateAccessToken()`, `exchangeCode()` and `refreshGrant()` is logged with a
  machine-readable `reason`, and never with the token, the code or a hash.
- Logging: `logIn()` counts an attempt before the password is checked and refuses when the database or the hash fails;
  `refreshGrant()` answers `failed`, not a token, when revoking after a reuse fails.
- Logging: `client-address-probe.ts` logs only an allowlist of headers, cut to a fixed length, and is off by default.
- Configuration: the `Containerfile` has a minimal final stage, server files owned by root with only `.next/cache`
  writable, and a second guard against a `.env` file in the standalone output.
- Configuration: `scripts/image-start.sh` runs the migration and the admin setup before the server with `set -eu`, uses
  `exec` for signals and sets `HOSTNAME` after Podman's override.
- Configuration: the smoke test in `scripts/image.sh` checks the user, the write protection, the absence of `.env`
  files, the security headers and that failed starts do not serve.
- Configuration: `parsePublicUrl()` in `src/lib/env.ts` accepts only a bare origin.
- Supply chain: every workflow defaults to `permissions: contents: read`, untrusted values reach the shell only
  through `env`, and the release tag is checked against an allowlist before the build (`check_tag()` in
  `scripts/image.sh`).
- Supply chain: the release pushes exactly the image that passed the smoke test, and its digest and OCI labels are
  recorded.
- Supply chain: `npm ci` from a lockfile with integrity hashes in CI and in the image, and `strict-peer-deps`.
- Cross-cutting: `src/features/services.test.ts` loads every service and the MCP tools with `next` and `react` mocked to
  throw, which catches indirect imports that lint cannot see.
- Cross-cutting: concurrency is tested against a real database for every limit (logins, grants, registrations, code
  exchange, refresh), and tests assert that no password, token, hash or address reaches the logs.
- Cross-cutting: hand-written migrations explain themselves, and `integration/db-errors.test.ts` pins the index names the services
  rely on.

### Checks on the deployment

- The reverse proxy passes a `Host` and an `X-Forwarded-Host` that a client cannot choose: the origin check of
  Server Actions compares the `Origin` with them, and `serverActions.allowedOrigins` is not set (Access control).
- No `next dev` server is reachable from an untrusted network: the development server speaks plain HTTP and serves the
  endpoints of the development tools (Access control).
- Whether the reverse proxy exposes `/api/health` to the internet or only to the orchestrator (Access control).
- The reverse proxy refuses a foreign `Origin` for a Server Action as well (repeat the CSRF probe through it),
  redirects plain HTTP to HTTPS and passes the HSTS header (Browser security).
- No shared cache or CDN stores answers, and the reverse proxy adds no CORS headers and does not change the CSP or
  `X-Frame-Options` (Browser security).
- The reverse proxy refuses requests for unknown `Host` values (Browser security).
- `HIPPOWIKI_TRUSTED_PROXIES` is set to the real number of proxies, the port of the container is reachable only through
  the proxy, and the proxy appends to or replaces `X-Forwarded-For` (Login).
- A limit per client on `POST /login`, `/oauth/register` and `/oauth/token` at the reverse proxy (Login).
- Backups and read access to the database are protected like the sessions, because they hold the session tokens and
  the cookie secret (Login).
- Retention of and access to the logs, which hold user names and client address groups (Login).
- `HIPPOWIKI_ADMIN_PASSWORD` is removed from the environment once the admin exists, and `npm run db:seed` is never run
  against a production database (Login).
- The reverse proxy and its access logs do not record the `Authorization` header (Connected apps).
- The reverse proxy and its access logs do not record the words of a search, `q` of the address of the results
  `/folders/<folder>?view=search&q=<words>`, which HippoWiki itself never logs (see "Limits" in `search.md`).
- The reverse proxy caps the request bodies of `/oauth/token` and `/oauth/register` (OAuth).
- Outgoing connections of the container are allowed only to `443/tcp` on the public internet, so that no cloud
  metadata service or internal network is reachable behind `public-address.ts` (OAuth).
- The runtime does not set `NODE_TLS_REJECT_UNAUTHORIZED=0` or a proxy for outgoing requests, which would switch off
  the certificate check or the pinned address of the metadata fetch (OAuth).
- The issuer is the public `https` address, and the reverse proxy serves the `/.well-known/` documents under no other
  host (OAuth).
- Production sets `HIPPOWIKI_PUBLIC_URL` where MCP is wanted (without it every address under `/mcp` answers 404), and
  the reverse proxy passes `Host` unchanged for the addresses under `/mcp/`; the wiki has a body limit and a rate limit
  per user of its own there (`mcp.md`), so the proxy may limit more strictly, must still let one write of a full page
  through (100,000 characters as JSON, about 600 KB with every character escaped), and limits the requests without a
  valid token (MCP server).
- No intermediary routes or applies policy by `Mcp-*` headers, or it trusts them only for requests of the 2026-07-28
  revision (MCP server).
- How many processes serve the app, and whether the reverse proxy has a request timeout; with one process a slow page
  stops the whole wiki (Content).
- A storage quota and alerts for the database, since the number of items is not limited (Content).
- stdout and stderr of the container are collected into a separate log system with access limited to operators, a
  retention period and synchronised time on the host; it parses the JSON of pino and the text of Next.js (Logging).
- Alerts on "refresh token used again", on waits after failed logins and on "health check failed" (Logging).
- The reverse proxy uses TLS 1.2 and 1.3 only with the cipher suites of BSI TR-02102-2, a certificate of at least RSA
  3000 or EC 256 bits, and redirects HTTP to HTTPS (Configuration).
- The reverse proxy replaces `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto` of clients, and sets body
  sizes, timeouts and rate limits; `/api/health` is ideally routed only to the health checker (Configuration).
- Port 3000 of the container and the port of the database are reachable from no other host (Configuration).
- The database role is not a superuser and has a strong password of its own (Configuration).
- The environment file has mode 0600 or Podman secrets are used; `HIPPOWIKI_ADMIN_PASSWORD` is chosen by the
  operator, and the admin logs in right after the first start (Configuration).
- Rootless Podman with `--cap-drop=ALL`, `--security-opt=no-new-privileges`, SELinux confinement, `--read-only` with a
  tmpfs for `.next/cache`, and limits for memory, CPU and processes (Configuration, `SYS.1.6.A15`, `SYS.1.6.A17`,
  `SYS.1.6.A21`, `SYS.1.6.A23`).
- The image is pulled by digest, a release is cut regularly for fixes of the base image, and a backup of the database
  is taken before a new version starts (Configuration).
- `NODE_OPTIONS` has no `--inspect`, and `HIPPOWIKI_LOG_CLIENT_ADDRESS` is `false` outside a deliberate check
  (Configuration).
- In the settings of the repository: who may push to the image package (Supply chain). The other settings were read
  on 2026-11-22; what they lack is in the findings of "Supply chain" and in the part "Manual checks of the app and of the repository".
- The deployment pulls the image by digest, not by tag (Supply chain).
- No vulnerability scanner is installed on the review machine, so the image was not scanned; a scan of the published
  image (for example with Trivy or Grype) is left to the deployment (Supply chain).
- The operator knows how to replace `AuthSecret` (stop every instance, delete the row, start; all sessions end), and
  `BETTER_AUTH_SECRETS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `BETTER_AUTH_TRUSTED_ORIGINS` are not set in the
  container (Cross-cutting).

### Standards coverage

Every requirement of the named standards that applies to HippoWiki has a result in this report: a finding, an entry
under "Reviewed" of an area, an entry in "Accepted deviations", or an entry in "Checks on the deployment". The
requirements that the area steps did not name were checked in the standards cross-check and added to the "Reviewed"
list of their area, marked "Standards cross-check".

#### OWASP ASVS 5.0.0, Levels 1 and 2

| Chapter                                 | Covered in                                                                          | Not applicable, with the reason                                                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 Encoding and Sanitization            | Content; OAuth (1.3.6, 1.5.3); Configuration (1.2.5); Cross-cutting (1.2.4, 1.5.2)  | 1.2.6–1.2.8, 1.3.8, 1.3.9, 1.3.11 (no LDAP, XPath, LaTeX, JNDI, memcache or mail); 1.3.10 (no format strings in JavaScript); 1.4 (memory-safe runtime); 1.5.1 (no XML)                    |
| V2 Validation and Business Logic        | Access control; Content; Login; MCP server; OAuth                                   | none                                                                                                                                                                                      |
| V3 Web Frontend Security                | Browser security; Access control (3.7.2); OAuth (3.7.2); Login (3.3.3)              | 3.5.4 is a deployment check                                                                                                                                                               |
| V4 API and Web Service                  | Access control (4.1.4); Browser security (4.1.1); Configuration (4.1.3)             | 4.2.1 is a deployment check (message boundaries at the proxy); 4.3 (no GraphQL); 4.4 (no WebSockets: MCP answers JSON only, and the server of development is not reachable in production) |
| V5 File Handling                        | none                                                                                | the app has no upload, no download of user files and no file path built from input                                                                                                        |
| V6 Authentication                       | Login; Configuration (6.3.2); Connected apps                                        | 6.4.3 (no reset of a forgotten password, a documented limit); 6.4.4, 6.5, 6.6 (no second factor, no out-of-band codes, no PSTN); 6.8 (no identity provider)                               |
| V7 Session Management                   | Login; Browser security (7.4.1 and 14.3.1); Logging (7.4.1); Connected apps (7.5.1) | 7.1.3, 7.6 (no federation)                                                                                                                                                                |
| V8 Authorization                        | Access control; Connected apps; MCP server                                          | none; content is checked by folder role in the browser and through MCP                                                                                                                    |
| V9 Self-contained Tokens                | Connected apps (9.2.2, 9.2.3)                                                       | 9.1, 9.2.1, 9.2.4 (no self-contained tokens such as JWT; all tokens are reference tokens)                                                                                                 |
| V10 OAuth and OIDC                      | OAuth; Connected apps (10.3.3); MCP server (10.3.1, 10.3.2)                         | 10.1, 10.2 (the wiki is no OAuth client); 10.3.4 (no step-up); 10.5, 10.6 (no OpenID Connect)                                                                                             |
| V11 Cryptography                        | Cross-cutting; Login (11.4.2); Connected apps (11.5.1)                              | 11.3 (the app encrypts nothing), 11.4.4 (no keys derived from passwords), 11.6.1 (no key pairs or signatures of its own)                                                                  |
| V12 Secure Communication                | Configuration (12.3.1, accepted deviation); OAuth (12.3.2)                          | 12.1.1, 12.1.2, 12.2.1, 12.2.2 are deployment checks (TLS at the reverse proxy); 12.1.3 (no mTLS); 12.3.3, 12.3.4 (no internal HTTP services)                                             |
| V13 Configuration                       | Configuration; Cross-cutting (13.1.1); Logging (13.4.2); OAuth (13.2.4, 13.2.5)     | none                                                                                                                                                                                      |
| V14 Data Protection                     | Browser security; Login (14.1.1); Cross-cutting (14.1.2, 14.2.4)                    | none                                                                                                                                                                                      |
| V15 Secure Coding and Architecture      | every area; Supply chain (15.1.1, 15.1.2, 15.2.1); Cross-cutting (15.1.3, 15.3.5)   | none                                                                                                                                                                                      |
| V16 Security Logging and Error Handling | Logging; Login; Connected apps; Cross-cutting                                       | none                                                                                                                                                                                      |
| V17 WebRTC                              | none                                                                                | the app has no WebRTC                                                                                                                                                                     |

Level 3 requirements are named only where they were cheap to meet: 3.4.7, 3.4.8, 4.1.4, 6.3.7, 6.3.8, 10.4.12, 13.4.7,
14.2.7, 15.4.2 and 16.5.4.

#### BSI IT-Grundschutz: CON.10 and APP.3.1

The requirements are those of the module texts on bsi.bund.de as fetched on 2026-11-14. Requirements marked
"ENTFALLEN" there are left out.

| Requirement                                                       | Covered in                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `CON.10.A1` authentication, limits on failed logins, notification | Login (common passwords reviewed; findings on the notification and the lockout)      |
| `CON.10.A2` access control                                        | Access control                                                                       |
| `CON.10.A3` session management                                    | Login                                                                                |
| `CON.10.A4` controlled inclusion of content, redirects            | Access control; OAuth (redirects to the client); Content                             |
| `CON.10.A5` upload functions                                      | not applicable: no uploads                                                           |
| `CON.10.A6` protection against automated use                      | Login; OAuth; MCP server                                                             |
| `CON.10.A7` protection of confidential data                       | Browser security; Login; Cross-cutting                                               |
| `CON.10.A8` input validation and output encoding                  | Content; Access control                                                              |
| `CON.10.A9` protection against SQL injection                      | Cross-cutting (parameterised queries)                                                |
| `CON.10.A10` restrictive release of security information          | Logging; Browser security; Configuration                                             |
| `CON.10.A11` software architecture                                | Cross-cutting (finding on the security overview)                                     |
| `CON.10.A12` verification of essential changes                    | Login (current password at the change); Connected apps (password before an approval) |
| `CON.10.A13` error handling                                       | Logging                                                                              |
| `CON.10.A14` secure HTTP configuration                            | Browser security                                                                     |
| `CON.10.A15` prevention of CSRF                                   | Browser security; Cross-cutting (tests)                                              |
| `CON.10.A16` multi-factor authentication                          | Login (finding on the missing reason)                                                |
| `CON.10.A17` prevention of resource blocking (high)               | Login; Content; MCP server; OAuth                                                    |
| `CON.10.A18` cryptographic protection of confidential data (high) | Cross-cutting; Configuration (no TLS to the database)                                |
| `APP.3.1.A1` authentication                                       | Login; Connected apps; OAuth                                                         |
| `APP.3.1.A4` controlled inclusion of files and content            | Content; OAuth (metadata fetch)                                                      |
| `APP.3.1.A7` protection against automated use                     | Login; OAuth; MCP server                                                             |
| `APP.3.1.A8` system architecture                                  | Cross-cutting                                                                        |
| `APP.3.1.A9` procurement                                          | not applicable: the app is developed, not procured                                   |
| `APP.3.1.A11` secure connection of backend systems                | Configuration (database role, no TLS to the database)                                |
| `APP.3.1.A12` secure configuration                                | Configuration                                                                        |
| `APP.3.1.A14` protection of confidential data                     | Browser security; Login; Cross-cutting                                               |
| `APP.3.1.A21` secure HTTP configuration                           | Browser security                                                                     |
| `APP.3.1.A22` penetration test and revision                       | this review; a penetration test of the deployment is a deployment check              |
| `APP.3.1.A20` web application firewall (high)                     | a deployment decision; not required by the target level                              |

#### BSI IT-Grundschutz: SYS.1.6 and OPS.1.1.5, as far as they concern the code or the repository

- `SYS.1.6.A6` secure images, `SYS.1.6.A12` distribution of secure images, `SYS.1.6.A14` updating images:
  Configuration and Supply chain (findings on the digest, signing and releases).
- `SYS.1.6.A8` secure storage of credentials, `SYS.1.6.A20` protection of configuration data: Configuration
  (admin password in the environment, secret store).
- `SYS.1.6.A11` one service per container, `SYS.1.6.A16` no remote access, `SYS.1.6.A17` no privileges, `SYS.1.6.A18`
  accounts of application services: Configuration ("Reviewed").
- `SYS.1.6.A7` persistence of logs, `SYS.1.6.A15` resource limits, `SYS.1.6.A21` extended security policies,
  `SYS.1.6.A23` immutable containers: "Checks on the deployment", with `SYS.1.6.A23` also a suggestion in
  Configuration.
- Operational requirements (`SYS.1.6.A1`–`A5`, `A9`, `A10`, `A13`, `A19`, `A22`, `A24`–`A26`) concern the planning
  and running of the container platform, not the code; they are left to the deployment.
- `OPS.1.1.5.A1` policy for logging, `OPS.1.1.5.A3` configuration of logging, `OPS.1.1.5.A4` time synchronisation:
  Logging (findings on the events and the missing description of the logs) and "Checks on the deployment".
- `OPS.1.1.5.A5`, `A6`, `A8`–`A13` (legal framework, central infrastructure, archiving, evaluation, access protection,
  encryption and availability of logs) are operational; they are covered by the deployment checks on log collection,
  access and retention.

#### OWASP Top 10:2025

| Category                                   | Covered in                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| A01 Broken Access Control                  | Access control; OAuth (redirects to the client, repeated parameters); MCP server |
| A02 Security Misconfiguration              | Browser security; Configuration; Login (cookie prefix)                           |
| A03 Software Supply Chain Failures         | Supply chain; Configuration (base image)                                         |
| A04 Cryptographic Failures                 | Cross-cutting (inventory); Login (hashing)                                       |
| A05 Injection                              | Content (XSS); Cross-cutting (SQL); MCP server (arguments)                       |
| A06 Insecure Design                        | Content (Markdown); MCP server (prompt injection, limits); Login; OAuth          |
| A07 Authentication Failures                | Login; Connected apps; OAuth                                                     |
| A08 Software or Data Integrity Failures    | Supply chain                                                                     |
| A09 Security Logging and Alerting Failures | Logging; Login; Connected apps; MCP server (tool calls)                          |
| A10 Mishandling of Exceptional Conditions  | Logging; Content (page view fallback); Configuration (validation at start)       |

The OWASP API Security Top 10 2023 is covered by the same areas: object and function level authorisation (API1, API5) in
Access control and Connected apps, authentication (API2) in Connected apps and OAuth, property level authorisation
(API3) in Access control (mass assignment) and Browser security, resource consumption (API4) in Content, MCP server and
OAuth, business flows (API6) in Login and OAuth, SSRF (API7) in OAuth, misconfiguration (API8) in Configuration,
inventory (API9) in Cross-cutting, and unsafe use of other APIs (API10) in OAuth (metadata documents).

#### CWE Top 25 2025

- Covered: CWE-79 (Content), CWE-89 (Cross-cutting), CWE-352 (Browser security), CWE-862, CWE-863, CWE-284 and CWE-639
  (Access control, Connected apps), CWE-22 (Content: names are `[a-z0-9-]` only, no file paths from input), CWE-78 and
  CWE-77 (Configuration: no command built from input), CWE-94 (Content: no `eval`), CWE-20 (Access control, Content),
  CWE-200 (Access control, Logging), CWE-306 (Connected apps, password before an approval), CWE-918 (OAuth), CWE-770
  (Content, Login, MCP server, OAuth), CWE-502 (Cross-cutting: JSON only, no revivers).
- Not applicable: CWE-787, CWE-416, CWE-125, CWE-120, CWE-476, CWE-121 and CWE-122 (memory safety; the app runs in a
  managed runtime), CWE-434 (no uploads).

#### OWASP MCP Top 10 (2025)

MCP01 Token Mismanagement and Secret Exposure, MCP02 Privilege Escalation via Scope Creep, MCP03 Tool Poisoning,
MCP05 Command Injection and Execution, MCP06 Prompt Injection via Contextual Payloads, MCP07 Insufficient
Authentication and Authorization, MCP08 Lack of Audit and Telemetry and MCP10 Context Injection and Over-Sharing are
reviewed in "MCP server" and "Connected apps"; MCP04 Software Supply Chain Attacks is covered by "Supply chain"; MCP09 Shadow MCP Servers does not apply to the code (one server, behind the token check).

#### Other standards

- NIST SP 800-63B-4: Login (length, blocklist, normalisation, failures, sessions, lifetime, cookies).
- OAuth (RFC 9700, OAuth 2.1, RFC 7636, RFC 8414, RFC 9728, RFC 7591, RFC 8707, RFC 9207, the client ID metadata
  document draft) and the MCP specification 2026-07-28: OAuth and MCP server.
- OWASP Top 10 for LLM Applications 2025, LLM01, and CWE-1427: MCP server (prompt injection).
- Next.js guides (data security, Server Actions, authentication, self-hosting, production checklist): Access control,
  Browser security, Configuration.
- BSI TR-02102-1: Login (Argon2id) and Cross-cutting (inventory); TR-02102-2: "Checks on the deployment"; TR-03183-2
  and TR-03185-2: Supply chain.

### Open questions

- The exact wording of BSI TR-03185-2 could not be checked during the review; the requirement IDs (VM.01, LE.01,
  LE.02, GV.01, BR.01–BR.04, QA.01, QA.06) are those of the plan of the review. Check them against the document before
  a fix plan relies on them.

## Review of the code around the Markdown parser

### Summary

- Verdict: one Major and no Blocker.
  - The Major: the footnote reference rule of markdown-it-footnote, which `markdown.ts` keeps, takes quadratic time as
    soon as the page defines a footnote. One parse of 100,000 characters then takes about 7 s, and every save or view
    of the page parses it two to four times.
  - The replaced footnote tail rule is correct and linear for every input without nested definitions. Nested
    definitions leak unbalanced tokens, which also defeats the depth limit.
- Findings: 9 in all, 0 Blocker, 1 Major, 4 Minor and 4 Nit (4 `issue:`, 1 `suggestion:`, 4 `nit:`). Of the 9
  Suggestions, 3 are High, 3 Medium and 3 Low.
- To fix first: the footnote reference rule and its input of the cost test.
- Not covered by this review: see "Not covered" at the end of this part.

### Scope and method

- The review answers three questions: how closely the consumers depend on the tokens of markdown-it, the footnote rule
  that replaces the one of markdown-it-footnote, and the parses that are repeated for the same content.
- Reviewed: `src/features/pages/markdown.ts` and its consumers:
  - `components/markdownToReact.tsx`, `components/MarkdownContent.tsx`, `derive.ts`, `wiki-links.ts`, `schema.ts`,
    `forms.ts`, `links-service.ts` and the parse paths of `service.ts`
  - `src/features/search/text.ts` and `index-data.ts`
  - the editor modules `link-address.ts`, `safe-address.ts`, `live-preview.ts` and `wiki-links.ts`
  - `src/test/slow-markdown.ts` and the cost tests
- Compared with `node_modules/markdown-it-footnote/index.mjs` 4.0.0 and markdown-it 15.0.3. Specs read: `pages.md`,
  `wiki-links.md`, `search.md`, `markdown-editor.md`, `architecture.md`, `testing.md`, and the related sections of the parts
  "Security and code review" and "Review of the list layout in the page view" of this file.
- Date: 2026-11-22. The code is the state of the branch `main` after the commit
  `add the ci times of the faster end-to-end tests`.
- Rechecked: 2026-11-23, the state of `main` after the commit `wrap up the order of the wiki link rewrite`. Every
  finding is still open:
  - The Major again: 419 against 1,576 ms for 12,500 and 25,000 `[^` with a definition (26 and 42 ms without one).
  - The quote and depth examples of the nested definitions, the parse of an unused definition and the image with a
    footnote reference give the tokens and values the findings cite.
  - The parse paths, the cited passages of the specs and the untyped footnote metas are unchanged.
  - A rename leaves the link of an unused definition and of the earlier of two definitions with the same label as it
    was, which `wiki-links.md` now contradicts (the issue on footnote definitions that are not shown).
- Evidence comes from scratch scripts, not kept, that ran the functions of the repository with `npx tsx`: differences
  against the plugin over random inputs, the balance of the token stream, the depth limit, the rewrite of wiki links,
  and timings.
  - Timings are the best of 3 to 7 runs on an Apple M4 Pro with Node 26.13.
  - The unit tests of `markdown.test.ts`, `wiki-links.test.ts`, `text.test.ts`, `derive.test.ts` and
    `link-address.test.ts` pass (130 tests).
  - The quadratic time of the Major was reproduced a second time, on its own: 435 ms against 1,549 ms for 12,500 and
    25,000 `[^` with a definition (24 and 46 ms without one).

### Findings

#### issue: footnote references take quadratic time as soon as the content defines a footnote, so one page can block the server for seconds per view

- Location:
  - `node_modules/markdown-it-footnote/index.mjs`, `footnote_ref()`, used unchanged by `src/features/pages/markdown.ts`.
  - `src/test/slow-markdown.ts`, the input `"[^a]"`.
  - `spec/pages.md`, "The cost of the Markdown parse" ("The parse is linear in the length of the content"), and
    "Decisions", the items on the cost of the parse ("parses in time linear", "With a linear parse", "the parse is
    linear on every input measured").
  - The part "Security and code review", the Reviewed item "The cost of the Markdown parse" ("parses in linear time").
  - `spec/roadmap.md`, "Rights", the item "Public content" ("The Markdown parse is linear").
- Severity: Major. Any Writer, in the browser or through MCP, can make every view of a page block the event loop of
  Node.js for many seconds. No data is lost.
- Category: security, performance
- Problem:
  - Once `env.footnotes.refs` exists (any definition `[^x]: …`), `footnote_ref()` scans from every `[^` to the next
    space, line break or `]`.
  - A line of `[^` without such a stop makes every scan run to the end of the line, which is quadratic. The replaced
    `footnote_tail` is not involved.
  - The cost input `"[^a]"` defines no footnote, so the rule returns at its first check and the quadratic path is
    never measured.
- Impact:
  - About 7 s per parse at the content limit.
  - A save in the browser parses 4 times (about 28 s), a save through MCP 3 times. A view, a revision view, a view of
    a deleted page and the delete dialog parse 2 times (about 14 s).
  - A rename parses such a linking page 4 times inside the exclusive lock of the links, whose transaction ends after
    60 s.
  - The event loop is blocked for all users meanwhile.
  - A bump of `SEARCH_INDEX_VERSION` or `LINK_INDEX_VERSION` derives such a page again at the start.
  - The author's own browser freezes in `titleFromContent()` when "Save" opens the dialog.
- Evidence:
  - `"[^".repeat(n) + "\n\n[^a]: x\n"`: n = 12,500 takes 465 ms, n = 25,000 takes 1,789 ms, n = 50,000 (100,010
    characters) takes 7,124 ms. Each doubling costs 4 times as much.
  - The same without the definition takes 95 ms. markdown-it with the plugin alone takes the same 7,116 ms.
  - `"[^a".repeat(33_330)` with a definition takes 4,224 ms.
  - Rendering adds the same again (6,346 ms).
- Suggestion (required):
  - Bound the scan with the technique already used for wiki links: wrap the rule of the plugin and refuse a reference
    when the next `[` comes before the next `]`, with `nextMark()` of `markdown.ts`:
    ```ts
    const footnoteRefRule = markdown.inline.ruler.__rules__.find(({ name }) => name === "footnote_ref")!;
    function footnoteRef(state: StateInline, silent: boolean): boolean {
      const src = state.src;
      if (src.charCodeAt(state.pos) !== 0x5b || src.charCodeAt(state.pos + 1) !== 0x5e) return false;
      const close = nextMark(state, "]", state.pos + 2);
      if (close === -1) return false;
      const open = nextMark(state, "[", state.pos + 2);
      if (open !== -1 && open < close) return false;
      return footnoteRefRule.fn(state, silent);
    }
    markdown.inline.ruler.at("footnote_ref", footnoteRef);
    ```
  - Every scan then ends before the next `[`. The three inputs above then take 102, 89 and 103 ms instead of 6,811,
    4,588 and 7,241 ms.
  - Across 100,000 random inputs it renders the same HTML as the plugin, except for labels that contain `[`, such as
    `[^[^b]`, which no longer resolve.
  - Add two inputs to `SLOW_INPUTS`:
    - `"[^ with a definition"`: `` `${repeated("[^")}`.slice(0, CONTENT_MAX_LENGTH - 10) + "\n\n[^a]: x" ``.
    - `"[^a] with a definition"`: about 25,000 references to one footnote. Its page view renders 50,000 links and
      took 926 ms, half the budget, and is not measured today.
  - Correct "linear" in `pages.md`, the part "Security and code review" and `roadmap.md` once it is fixed.
- Confidence: Medium. Measured and compared with the plugin. Still open: labels with `[` no longer resolve, which
  GitHub probably does not allow either but which was not checked there, and the fix relies on the private
  `__rules__`, as `tableRule` already does.
- Alternatives: a footnote reference rule of its own (a copy of the plugin's, about 40 lines, with the bounded scan),
  without the private API but with more code to keep in step with the plugin.
- Reference: CWE-407 (Inefficient Algorithmic Complexity); ASVS 15.2.2.

#### issue: nested footnote definitions leak closing tokens into the content, which breaks the page view and the depth limit

- Location:
  - `src/features/pages/markdown.ts`, `footnoteTail()` and `analyseMarkdown()`.
  - The comment of `footnoteTail()` ("It makes the same tokens").
  - `spec/pages.md`, "Decisions" ("makes the same tokens in one pass").
- Severity: Minor. Only content that indents a footnote definition inside another one is affected, and `maxNesting`
  still bounds the nesting.
- Category: correctness
- Problem:
  - markdown-it-footnote allows a definition inside a definition, for example `[^a]: x\n    - [^b]: y`.
  - On the inner `footnote_reference_close`, `footnoteTail()` sets `definition = null`. So the rest of the outer
    definition, such as `list_item_close` and `bullet_list_close`, goes to the main tokens, while its opening tokens
    stay in the definition or are dropped with it.
  - The plugin leaks the same way. The two also differ in what the outer definition keeps, so "the same tokens" holds
    only without nesting.
- Impact:
  - In a quote, `> [^a]: x\n>     - [^b]: y\n>\n> after` gives
    `blockquote_open list_item_close bullet_list_close paragraph_open …`. The page view closes the quote early and
    shows "after" outside it.
  - `analyseMarkdown()` counts each stray `bullet_list_close` as one level less, so content with lists nested 25 deep
    passes the limit of 20.
- Evidence:
  - `# T\n\n` and a list nested 25 deep is refused with "Lists and quotes must be nested at most 20 levels deep". With
    `"[^a]: def a\n    - [^b]: def b\n\n".repeat(10)` before it, `analyseMarkdown().depth` is 15 and
    `pageContentInputSchema` accepts it.
  - Across 200,000 random inputs, `footnoteTail()` and the tail of the plugin differ in 1,821, and every one of them
    has a nested definition.
  - 419 of 100,000 random inputs give an unbalanced token stream.
- Suggestion (required):
  - Keep a stack in `footnoteTail()`. On `footnote_reference_open`, push the current `definition` before starting a
    new one. On `footnote_reference_close`, restore it with `definition = outer.pop() ?? null`.
  - This leaves 0 of the 100,000 inputs unbalanced, and the quote example keeps "after" inside the quote.
  - Add a unit test: nested definitions give a balanced token stream, and the depth example above is refused.
  - Reword the comment and `pages.md` to "the same tokens, except that a nested definition no longer leaks the end of
    the outer one".
- Confidence: Medium. The balance was checked on random inputs. The output for nested definitions changes from the
  plugin's, and what GitHub does with them was not checked.
- Alternatives: refuse nested definitions by wrapping `footnote_def` so that it returns `false` while
  `state.parentType === "footnote"`. Simpler, but a definition indented in another then shows as text of the outer
  one.

#### suggestion: the same content is parsed up to four times per save and per linking page of a rename

- Location:
  - The save in the browser: `src/features/pages/forms.ts` `parsePageContentFormData()`, then `service.ts`
    `updatePageContent()`, then `storeContentChange()` → `searchIndexData()` → `pageText()`, then `storeLinks()` →
    `linkRowsOf()` → `wikiLinksOf()`.
  - `createPage()`: `newPageInput()`, `searchIndexData()`, `linkRowsOf()`.
  - The rename: `links-service.ts`, with `rewriteWikiLinks()`, `titleFromContent()`, `pageText()` and `storeLinks()`.
  - The page view: `PageView.tsx`, `resolveWikiLinks()` → `wikiLinksOf()` and `markdownToReact()`.
- Severity: Minor. A few tens of milliseconds for realistic content at the limit; it matters mainly inside the
  exclusive lock of the links during a rename.
- Category: performance
- Problem: each consumer calls `parseMarkdown()` itself, so one content is parsed this many times:

  | Path                          | Parses                                  |
  | ----------------------------- | --------------------------------------- |
  | Save in the browser           | 4                                       |
  | Save through MCP              | 3                                       |
  | New page in the browser       | 4                                       |
  | Page view                     | 2                                       |
  | Each linking page of a rename | 4 (the last 3 on the rewritten content) |
  | Opening the editor            | 0 (only Lezer runs)                     |
  | Search indexing               | 1 per write                             |

  `pages.md` gives a reason only for the double validation.

- Impact:
  - Realistic content of 100,000 characters (headings, links, lists, tables, code) parses in 12 ms. A save in the
    browser costs 50 ms, about 37 ms of them repeats, and a linking page of a rename 51 ms.
  - With the slowest input that is still linear (`"!["`, 160–185 ms per parse), a save costs 690 ms and a linking
    page of a rename 691 ms. About 87 such pages at the limit would pass the 60 s timeout of `LINKS_TRANSACTION`, and
    the rename would fail.
  - Until the footnote finding above is fixed, a single such page needs only 28 s.
- Evidence: the call sites listed under Location, and the timings above.
- Suggestion (optional):
  - Let the derivations take tokens: `pageText(content, tokens)` and `wikiLinksOf(content, tokens)`, with the existing
    signatures parsing for themselves.
  - Parse once per stored content in `storeContentChange()`, `createPage()` and `updateLinkingPages()`. That gives 2
    parses per save and 2 per linking page instead of 4, and keeps the double validation that `pages.md` decided on.
  - Cover the rename with a linking page at the content limit in `integration/wiki-link-update.cost.test.ts`, whose
    pages today hold about 2,000 characters.
- Confidence: Low. It changes the interfaces of `text.ts` and `wiki-links.ts` across the pages and search features,
  and the gain was measured for the pure functions only, not end to end.
- Alternatives: share the tokens of the page view between `resolveWikiLinks()` and `markdownToReact()` (one parse less
  per view, about 12 ms); or a small memo of the last tokens per content (simple, but it holds the tokens of up to
  100,000 characters per entry).

#### issue: `pages.md` understates how often the content is parsed and how long a parse can take

- Location: `spec/pages.md`, "The cost of the Markdown parse" (the paragraph before the list, and the item "The length
  of the content is checked before any parse …"); the part "Security and code review", the Reviewed item "A save in the browser
  parses the content twice".
- Severity: Minor
- Category: docs
- Problem:
  - `pages.md` says that the parse "runs on the server at every save (twice in the browser …)" and that "the content
    of a new page is parsed once on the server". On the server, a save parses 3 times (4 in the browser), a new page 3
    times (4 in the browser), and a view 2 times.
  - The part "Security and code review" says that a parse "takes at most about 0.1 s at the content limit". `"!["` takes 160–185 ms,
    and footnote references 7 s until they are fixed.
- Impact: whoever weighs a limit or a change of the parse reads a cost of a half to a quarter of the real one.
- Evidence: the call sites and timings of the suggestion above.
- Suggestion (required):
  - Describe the parses without counts that drift: "at every save, once for each validation and once each for the
    search text and the index of links".
  - Replace "0.1 s" by a pointer to the budget of `markdown.cost.test.ts`.
- Confidence: Medium. The wording depends on whether the suggestion above is taken.

#### issue: the wiki links of footnote definitions that are not shown are not changed on a rename, although `wiki-links.md` says every link is

- Location:
  - `src/features/pages/markdown.ts`, `footnoteTail()`.
  - `src/features/pages/wiki-links.ts`, `wikiLinksOf()` and `rewriteWikiLinks()`.
  - `spec/wiki-links.md`, "Updates on a move or rename" ("every wiki link to it in the pages of the folder … is
    changed", "inside a footnote definition included").
- Severity: Minor
- Category: correctness
- Problem:
  - A definition that no reference uses, and the earlier of two definitions with the same label, leave no tokens.
    Their wiki links are not counted, indexed, shown as backlinks or rewritten on a rename.
  - `wiki-links.md` says that every wiki link to the page is changed, inside a footnote definition included, and does
    not except these definitions.
- Impact: once the footnote is referenced later, or the later definition is removed, the link points to the old name
  and shows as missing. The "Move or rename page" dialog does not count a page whose only link to the page stands
  there.
- Evidence:
  - `"# T\n\n[^a]: unused [[x]]\n"` parses to `heading_open inline heading_close` only.
  - A rename of `x` to `y` with `rewriteWikiLinks()` leaves `"# T\n\n[^a]: unused [[x]]\n"` unchanged, and changes
    only the second link of `"# T\n\nText[^a]\n\n[^a]: first [[x]]\n\n[^a]: second [[x]]\n"`.
- Suggestion (required): collect the wiki links of every definition before `footnoteTail()` drops its tokens, for
  example in a list of the environment of the parse that `wikiLinksOf()` reads as well, so that the rewrite, the index
  of links and the count of the limit see them. Add a unit test of `rewriteWikiLinks()` with the two inputs above.
- Confidence: Low. It needs a decision between changing the code and narrowing the spec, and it changes what the index
  of links and the limit of wiki links count.
- Alternatives: narrow "Updates on a move or rename" in `wiki-links.md` to the links that the page view shows, and
  name the unused and the overridden definitions as a current limit. No code change, but the links in them break on a
  rename.

#### nit: `pages.md` names `markdown.ts` for `SAFE_PROTOCOLS` and for the prefix of the footnote ids

- Location: `spec/pages.md`, "Rendering", the items on safe addresses and on footnotes.
- Severity: Nit
- Category: docs
- Problem:
  - `pages.md` says "(`SAFE_PROTOCOLS` in `markdown.ts`)", but the set is in `src/features/pages/safe-address.ts`.
  - It says "their ids carry a prefix of their own (`markdown.ts`)", but the prefix is `ID_PREFIX` in
    `src/features/pages/components/markdownToReact.tsx`.
  - `npm run docs:check` checks only that the files exist, not where a symbol lives.
- Impact: a reader looking for the list of protocols or for the prefix opens the wrong module.
- Evidence: `grep -rn "SAFE_PROTOCOLS\|ID_PREFIX" src` finds only these two files.
- Suggestion (required): point to `safe-address.ts` and to `ID_PREFIX` in `components/markdownToReact.tsx`.
- Confidence: High. Both pointers were checked with grep, and `npm run docs:check` covers the file names.

#### nit: `wiki-links.md` restates the limit of 5,000 wiki links in "Decisions" without a pointer

- Location: `spec/wiki-links.md`, "Decisions" ("A page holds at most 5,000 wiki links, a guard for …").
- Severity: Nit
- Category: docs
- Problem: "The limit" in the same file states the value with its pointer (`CONTENT_MAX_WIKI_LINKS` in
  `src/features/pages/limits.ts`). The decision repeats the number without one, as does `pages.md`, which points only
  to the file.
- Impact: a change of the constant leaves a stale number in the decision.
- Evidence: `wiki-links.md`, "The limit" against "Decisions".
- Suggestion (optional): write "A page holds a limited number of wiki links (see "The limit")" in the decision.
- Confidence: High. A change of the document only, with one target, checked by reading both sections.

#### nit: the meta of the footnote tokens is read through untyped casts, unlike that of tasks, lists and wiki links

- Location: `src/features/pages/components/markdownToReact.tsx`, `footnoteNumber()` and `footnoteReferenceId()`;
  `src/features/pages/markdown.ts`, `footnoteTail()` (`open.meta` and `anchor.meta`).
- Severity: Nit
- Category: readability
- Problem:
  - `markdown.ts` exports `TaskMeta`, `ListMeta` and `WikiLinkMeta`. The metas of the footnotes, which it builds
    itself for `footnote_open` and `footnote_anchor` and which the plugin builds for `footnote_ref`, are read as
    `(token.meta as { id: number })` and `as { subId?: number }`.
  - The shape of the plugin's tokens reaches the renderer without a type.
- Impact: a change of the shape shows only in the render test of footnotes, not in the type check.
- Evidence: the cited functions.
- Suggestion (optional): export `type FootnoteMeta = { id: number; subId?: number; label?: string }` from
  `markdown.ts`, use `satisfies FootnoteMeta` in `footnoteTail()`, and cast to it in the two helpers.
- Confidence: High. Types only, no change of behaviour. `npm run typecheck` and "renders footnotes at the end with ids
  of the prefix user-content-" cover it.

#### nit: a footnote reference in the alt text of an image counts as a reference but shows nowhere

- Location: `src/features/pages/components/markdownToReact.tsx`, `leafElement()`, the case `"image"` (`plainText()` of
  the children); `src/features/pages/markdown.ts`, `plainText()`.
- Severity: Nit
- Category: correctness
- Problem: markdown-it parses the alt text of an image with the inline rules, so `![alt [^a]](/x.png)` creates a
  `footnote_ref` inside the image and counts it. The alt text becomes plain text without it, but the footnote still
  gets a back link `↩` to `#user-content-fnref-1`, and no element has that id.
- Impact: a dead back link, and a footnote listed without a visible reference.
- Evidence: `"![alt [^a]](/x.png)\n\n[^a]: note"` gives `inline(image(text footnote_ref))` and a `footnote_anchor` in
  the footnote block.
- Suggestion (optional): accept it as a current limit in `pages.md`, or skip a `footnote_ref` inside the label of an
  image in the footnote reference rule of the Major finding.
- Confidence: Low. It needs a decision on whether this is worth a rule, and the plugin behaves the same way.

### Reviewed

- The replaced footnote tail:
  - Without nested definitions, `footnoteTail()` makes exactly the tokens of `footnote_tail` of the plugin: type, tag,
    nesting, level, content, markup, info, meta, map, hidden, block and children were the same for 200,000 random
    inputs. The inputs mixed references, duplicate and empty definitions, definitions of several paragraphs, lists,
    quotes, code, tables, headings, and references in links and images.
  - The last of duplicate labels wins, as in the plugin. The anchors go into the last paragraph, or after a closing
    list or code block. An empty definition gets its anchor alone.
  - With inline footnotes off, every entry has a label, which avoids the stale `tokens` variable of the plugin.
  - Its cost: one pass. "many footnotes" (3,291 footnotes) parses in 44 ms with it and in 235 ms with the tail of the
    plugin.
  - Its safety: the ids of footnotes come from their number only, never from the label, and carry `user-content-`.
    Labels reach the page only as React text. `footnote_def` scans only its own line, and `maxNesting` bounds the
    nesting.
- The shape of the tokens: the consumers depend on the token types, `nesting`, `hidden`, `info`,
  `attrGet("href"|"src"|"title"|"start"|"style")`, `markup === "linkify"` (the prose of search) and the metas. Each
  dependency either fails loudly or is covered:
  - `tableRule` throws at load if markdown-it has no table rule.
  - The parse of `style="text-align:…"` is covered by "renders a table with alignment".
  - `markup === "linkify"` is covered by "holds a file name in running text but no `www.` address" in `text.test.ts`.
  - The internals of linkify-it have the named test "links `www.` addresses only at the start of a word".
  - The positions of wiki links are checked against the source (`src.startsWith`), and the corpus tests cover every
    kind of block.
  - The default branches of the renderer show unknown tokens as text and unknown containers as fragments, so an
    upgrade that adds a token type stays safe, though silently.
  - The lockfile pins markdown-it 15.0.3 and markdown-it-footnote 4.0.0.
  - The editor imports no markdown-it. `link-address.ts` is tested against `parseMarkdown()` (`link-address.test.ts`),
    and `safe-address.ts` is shared.
  - The order of the tokens, which puts the footnote definitions last, no longer matters for the rewrite of wiki
    links: `rewriteWikiLinks()` sorts the links by their positions in the source, which unit tests and integration
    tests of a page, tab and file rename with a footnote definition before another link check.
  - The remaining gap is the untyped footnote metas (finding above).
- The parse paths: traced as in the suggestion above. Opening the editor parses nothing with markdown-it on the
  server, and its list of pages comes from the database.
- Escaped task markers: already open in the part "Review of the list layout in the page view" ("an escaped task marker `\[ ]` still makes a task
  item"). More evidence for it:
  - `- &#91; ] entity` is taken as a task too.
  - The editor (Lezer with GFM) shows neither as a task, so the editor and the page view disagree.
  - The cause is the order of the rules: `task_lists` runs after `text_join`, which merges the `text_special` of `\[`
    and `&#91;` into the text. Registered with `markdown.core.ruler.before("text_join", …)`, the first child of an
    escaped item is `text_special` and no longer matches, while `- [ ] real` stays one `text` token `"[ ] real"`. This
    is an alternative to the fix suggested there.
- Specs that restate values: the protocols in `pages.md` are the security rule itself, and the code points to the
  spec. The limits in `pages.md` name `limits.ts`. The budget of 2 s in `pages.md` and `testing.md` is a requirement
  that the cost tests implement. No message of `schema.ts` is restated in a spec.

### Not covered

- The real server under load. The blocking of the event loop of the footnote finding is inferred from measured times
  of the parse and the render of the pure functions, not observed end to end.
- What GitHub does with nested footnote definitions, footnote labels that contain `[`, and the task marker `\[ ]`.
- Timings on the CI runner. All numbers are from an Apple M4 Pro, so the margins of the cost budgets in CI may be
  smaller.
- The cost tests (`npm run test:cost`), the end-to-end and the integration tests. Only the unit tests named above ran.
- The cost of the editor (Lezer) when it opens large pages.

## Manual checks of the app and of the repository

### Summary

- Verdict: no Blocker and no Major. Every rule of the app that a manual check could reach locally holds: the security
  headers, CSRF, caching, CORS, the client address of a login, the waits of logins at the same time, the tools of MCP
  per role, and the speed of the editor. The weak points are settings of the GitHub repository and the limit of logins
  with the right password at the same moment.
- Findings: 3 in all, 0 Blocker, 0 Major, 3 Minor and 0 Nit (2 `issue:`, 1 `suggestion:`). Of the 3 Suggestions,
  1 is High, 1 Medium and 1 Low.
- To fix first: the approval of workflows from fork pull requests, the one High suggestion.
- The settings of the repository that open findings of the part "Security and code review" could not see are added to those findings
  as Evidence: private vulnerability reporting, the alerts and security updates of Dependabot, the rules for `main`
  and release tags, and the pinning of actions.
- Not covered: see "Not covered" at the end of this part.

### Scope and method

- Checked: the manual checks of `markdown-editor.md`, of "Things to Check" in `roadmap.md` and of "Checks on the
  deployment" in the part "Security and code review" that need neither the deployment nor a decision of the user, and the protections
  of the finding "the protections that come from Next.js, the MCP SDK and Better Auth have no regression test" in
  the part "Security and code review".
- Date: 2026-11-22. The code is the state of the branch `main` after the commit
  `add the review of the code around the markdown parser`.
- The app ran as a production build (`next build`, `next start` on port 3100) against a throwaway database in the
  container of the development database, migrated and seeded, and dropped afterwards. The server had
  `HIPPOWIKI_TRUSTED_PROXIES=1` and `HIPPOWIKI_PUBLIC_URL=http://localhost:3100`.
- The requests came from scratch scripts, not kept: Playwright for the browser, plain `fetch` for replays of the login
  Server Action and for MCP, and Prisma for the access tokens of MCP. The results come from the answers and from the
  log lines of the server.
- The settings of the repository were read with `gh api` and not changed.
- All timings are from an Apple M4 Pro with a display of 120 Hz.

### Findings

#### issue: workflows from fork pull requests need an approval only for first-time contributors

- Location: the settings of the repository, Actions → General → "Approval for running fork pull request workflows
  from contributors"; the part "Security and code review", "Checks on the deployment", the item on the settings of the repository
- Severity: Minor. A fork pull request gets a read-only token and no secrets, and the release job runs only for a
  release.
- Category: security
- Problem: the setting is `first_time_contributors`. A contributor whose earlier pull request was merged runs the
  workflows of every later fork pull request without an approval, `npm ci` with its install scripts included.
  "Checks on the deployment" asks for an approval of workflows from fork pull requests.
- Impact: an account that once contributed, and is compromised later, runs code on the runners of the repository
  without anyone looking first.
- Evidence: `gh api repos/PhilipMay/HippoWiki/actions/permissions/fork-pr-contributor-approval` gives
  `{"approval_policy":"first_time_contributors"}`.
- Suggestion (required): set "Require approval for all external contributors"
  (`approval_policy: all_external_contributors`).
- Confidence: High. One setting with one value that matches the check, no change to the workflows, and the same `gh
api` call shows it afterwards.
- Reference: OWASP A03:2025 Software Supply Chain Failures; CWE-829.

#### issue: secret scanning and push protection are off

- Location: the settings of the repository, "Advanced Security"
- Severity: Minor. The repository holds no secret of production today: the passwords in the seed and in `.env.example`
  are values for development.
- Category: security
- Problem: `secret_scanning`, `secret_scanning_push_protection`, `secret_scanning_non_provider_patterns` and
  `secret_scanning_validity_checks` are all `disabled`, although both are free for a public repository.
- Impact: a token or key committed by mistake, such as a real `.env`, is public at once and nobody is told.
- Evidence: `gh api repos/PhilipMay/HippoWiki --jq .security_and_analysis`.
- Suggestion (required): turn on secret scanning and push protection.
- Confidence: Medium. Whether the seed passwords, the test values of the tests and the format of the secrets of
  HippoWiki raise alerts that have to be closed by hand was not tried.
- Reference: OWASP A02:2025 Security Misconfiguration; CWE-798.

#### suggestion: about 50 logins with the right password at the same moment for one name start to fail with the general error

- Location: `src/features/auth/service.ts`, `reserveAttempt()` and `MAX_RESERVE_ROUNDS`; `spec/users-and-login.md`,
  "Failed logins"; `spec/roadmap.md`, "Things to Check", the item "Logins at the same time on the deployment"
- Severity: Minor. The spec allows the answer, and no attacker reaches it without the password.
- Category: performance
- Problem:
  - Each successful login deletes the counts of its name and group, so the other logins of the same moment see changed
    counts and count again. After 50 rounds a login gives up with the general error "The login failed".
  - Up to 40 logins at once all succeed. From about 50 at once, some fail, and more the more there are.
  - `users-and-login.md` says that such a login "is answered with the general error", but not from how many logins on.
- Impact: only a script or very many browsers of the same user log in so many times at the same moment. The user sees
  "The login failed. Please try again." and the next try works.
- Evidence: logins replayed with `fetch` at the same moment for `alice` from one client address group:

  | Logins at once | Logged in | General error |
  | -------------- | --------- | ------------- |
  | 30             | 30        | 0             |
  | 40             | 40, 40    | 0, 0          |
  | 50             | 50, 46    | 0, 4          |
  | 60             | 55, 51    | 5, 9          |
  | 70             | 61, 58    | 9, 12         |
  | 80             | 59, 55    | 21, 25        |
  | 100            | 68        | 32            |

  Each failure logged "the counts of the logins kept changing, the login attempt was not counted". Bursts with the
  wrong password, and a mix of 50 right and 50 wrong logins for `admin`, gave no general error.

- Suggestion (optional): write the measured limit into "Failed logins" of `users-and-login.md` as what an operator can
  expect, and keep `MAX_RESERVE_ROUNDS`.
- Confidence: Low. Whether the limit is enough is a decision, and on the deployment the latency of the database, the
  pool of 10 connections and Traefik change the numbers, which "Things to Check" still asks to measure there.
- Alternatives: more rounds, which moves the limit but lets a burst hold more connections for longer; or a short
  random pause between the rounds, which spreads the logins of the same moment at the cost of a slower answer.

### Reviewed

- Security headers: `/login`, the redirect from `/folders` without a login, `/api/health` and the pages with a
  session carry the five headers of `next.config.ts` and no `X-Powered-By`.
- `/_next/image?url=%2Ffolders&w=64&q=75` redirects to `/login` without a session and answers 404 with one.
- CSRF: the Server Actions of the login and of "New folder" answer 500 when the browser sends them with a foreign
  `Origin`. Nobody was logged in and no folder was created; with the right `Origin`, "New folder" works.
- Caching: every page, RSC payload and answer of an action that the browser fetched carries
  `private, no-cache, no-store, max-age=0, must-revalidate`. Only the 307 redirects from `/` and from `/login` with a
  session carry no `Cache-Control`; they have no body and are not cached without one.
- CORS: no answer carried an `Access-Control-*` header, also not to an `OPTIONS` request with a foreign `Origin`.
- `/api/auth/*`: `session`, `get-session`, `ok`, `sign-in/email`, `sign-up/email` and `list-sessions` answer 404 to
  `GET` and `POST` with a session, and redirect to `/login` without one, like every other address.
- The speed of the editor (see "Speed" in `markdown-editor.md`), measured with `EDITOR_PAGE` in a visible Chromium:
  - The editor was ready 105 to 178 ms after the start of the navigation.
  - Typing at the top, in the middle and in tables, Enter and Backspace, the arrow keys, Page Down, scrolling with the
    wheel and four switches of the mode gave no frame over 17 ms and no long task.
  - The slowest time from an input to the next paint was 40 ms, at a switch of the mode; typing and moving stayed at
    16 to 32 ms.
- The client address group of a login, with `HIPPOWIKI_TRUSTED_PROXIES=1`, as `users-and-login.md` describes it:

  | `X-Forwarded-For` and other headers               | Logged `clientAddress`                       |
  | ------------------------------------------------- | -------------------------------------------- |
  | `203.0.113.7`                                     | `203.0.113.7`                                |
  | `1.2.3.4, 203.0.113.8`                            | `203.0.113.8`, the leftmost entry is ignored |
  | `203.0.113.9` with `X-Real-Ip: 9.9.9.9`           | `203.0.113.9`                                |
  | `203.0.113.11` with `Forwarded: for=198.51.100.1` | `203.0.113.11`                               |
  | `2001:db8:1:2:aaaa:bbbb:cccc:1`                   | `2001:db8:1:2::/64`                          |
  | `::ffff:203.0.113.10`                             | `203.0.113.10`                               |
  | none, also over `[::1]`                           | `0:0:0:0::/64`, no warning                   |
  | `not-an-address`                                  | `shared`, and one warning without the value  |

- Logins at the same time with the wrong password: 30 at once for one name from one group gave 5 checked logins and 25
  waits; 30 at once from 30 groups gave 20 checked logins and 10 waits of the hour. No login got the general error.
- MCP per role, through access tokens of grants of `alice`, an Owner of the folder:
  - The Reader, Writer and Manager addresses list exactly the 4, 8 and 12 tools of "Tools" in `mcp.md`. The read
    tools carry `readOnlyHint`; `replace_page_content`, `edit_page_content`, `delete_page` and `delete_tab` carry
    `destructiveHint`.
  - `create_page` through the Reader address is an unknown tool and creates no page.
  - A Reader token at the Writer address and a request without a token get 401 with `resource_metadata`; a foreign
    `Origin` gets 403, `GET` 405 and the plain `/mcp` 404.
  - With the role of `alice` lowered to Writer, the Manager address answers 403 `role_too_low` and the Writer address
    still works; with the role back, the Manager address works again.
- The connection of this review's AI app to the deployment, folder "philip", Manager: `list_folder`, `read_page` and
  `search_pages` work against `https://hippowiki.maysprot.ddnss.eu`, and the app gets the 12 tools of a Manager.
- The settings of the repository that hold: the default permissions of workflows are read-only and may not approve
  pull requests; the alerts and security updates of Dependabot are on; the only collaborator is the owner, who
  published the last releases; the default setup of CodeQL is `configured` for `actions` and
  `javascript-typescript` (`gh api repos/PhilipMay/HippoWiki/code-scanning/default-setup`, 2026-11-23), and its first
  run passed.

### Not covered

- Everything that needs the deployment or Traefik: the address that Traefik passes on, IPv6 from outside, the pool and
  the latency of the database under a burst of logins, and the warnings of a correct setup.
- Who may push to the image package: the token of `gh` lacks the scope `read:packages`.
- Whether the connection of the AI app to the deployment was made through OAuth; the app was not asked.
- The speed of the editor on a slower laptop, and in Safari and Firefox.
- A scan of the published image for vulnerabilities, which needs a scanner to be downloaded.

## Review of the list layout in the page view

### Summary

- Verdict: no Blocker. Bullet lists and task lists of bullet lists hold every rule of the layout in all cases, nested
  to six levels, mixed with plain items, inside a quote and at phone width. The weak point is a task item of an
  ordered list, whose wrapped lines and nested lists start under its checkbox instead of under its text. The task list
  rule also takes an escaped marker for a task, and one current limit of `spec/pages.md` is easier to hit than its
  wording says.
- Findings: 3 in all, 0 Blocker, 0 Major, 2 Minor and 1 Nit (2 `issue:`, 1 `suggestion:`). Of the 3 Suggestions,
  0 are High, 3 Medium and 0 Low.
- To fix first: the indent of a task item of an ordered list.
- Not covered by this review: Safari and Firefox (only the Chromium of the browser pane was used), a dark theme (the
  app has none), and the user's page `tech/scheidung/todo`, which is not in the local dev database.

### Scope and method

- Reviewed: the layout of lists in the page view, `MarkdownContent` in
  `src/features/pages/components/MarkdownContent.tsx`, and the task list rule in `src/features/pages/markdown.ts`, as
  far as it decides which list item is a task. The rules checked against are "Rendering" and "Current limits" in
  `spec/pages.md`.
- Date: 2026-11-19. The code is the state of the branch `main` after the commit `wrap up task list layout`.
- Evidence comes from three test pages in the local dev database (`next dev`, logged in as the seed user `alice`),
  measured with a script in the browser pane at 1024 px and at 375 px width, and from screenshots. For every list
  item the script read the left of its checkbox, of its text and of the item, its list marker, its height and the
  left of a wrapped second line, and checked these rules:
  - R1: in a bullet list, task items and plain items start their text at the same place.
  - R2: the checkbox of a task item of a bullet list lies in the indent of the list, where the bullet would be, and
    never left of the title heading.
  - R3: a nested list moves 24 px to the right.
  - R4: a task item of a bullet list has no marker, a plain item has its bullet, an ordered list keeps its numbers.
  - R5: an item of one line is 24 px high, task or plain.
  - R6: a wrapped line starts under the text of its item.
  - R7: the page does not scroll sideways.
- The cases, each under its own heading of a test page: task > task > task; task > bullet; bullet > task;
  task > numbered; task > numbered task; numbered > task; numbered task > task; numbered task > numbered task;
  numbered > numbered task; six levels of bullets, numbers and tasks; a bullet list of tasks and plain items with
  nested mixed lists; a numbered list of tasks and plain items; a numbered task list from 3 to 12; long wrapping text
  in bullet, numbered, task and plain items; bold, code, a link and strikethrough in task text; the markers `*`, `+`
  and `1)`; nesting by two spaces; a task list in a quote; markers that are not tasks (`[ ]text`, `[y]`, `\[ ]`, an
  empty `[ ]`); lists next to each other; a loose task list.
- The view of a revision was compared with the page view of the same page: every item has the same position and
  marker. The test pages were deleted afterwards; they can be restored from the deleted pages of the folder
  `getting-started02`.

### Findings

#### issue: a task item of an ordered list has no hanging indent, so its wrapped lines and nested lists start under the checkbox

- Location: `src/features/pages/components/MarkdownContent.tsx`, the `sx` rules for `li.task-list-item` of
  `MarkdownContent`
- Severity: Minor. Nothing is lost or wrong in the content; the nesting of a list is hard to see.
- Category: correctness
- Problem: in an ordered list, the checkbox of a task item is an inline element at the start of the item, so the text
  of the item starts 28 px right of the start of the item (the default left margin of the checkbox, its width and its
  right margin). A wrapped line and a nested list start at the start of the item, under the checkbox. "Rendering" in
  `spec/pages.md` says that task lists are indented and nested like other lists; under a task item of an ordered
  list, a nested list starts 4 px left of the text of its parent, where under every other item it starts 24 px right
  of it.
- Impact: a reader of a numbered task list with nested tasks or long items does not see which items belong to which
  parent: the checkbox of a nested task sits right under the checkbox of its parent. It shows most at phone width,
  where long items wrap.
- Evidence: measured at 1024 px:
  - `1. [ ] C7 parent numbered task` with `    - [x] C7 child task`: parent checkbox at 147, parent text at 171; child
    checkbox at 143, child text at 167.
  - Six levels: `1. [x] C10 d4 numbered task` has its text at 243, its nested `- [ ] C10 d5 task` at 239.
  - `1. [ ] C14 numbered task with a long text …`: first line at 171, second line at 143; at 375 px first line at 85,
    the other lines at 57. A plain numbered item and a bullet task item wrap under their text.
- Suggestion (required): give a task item of an ordered list a left padding as wide as its checkbox and the space in
  front of it, and move the checkbox back into that padding, as a bullet task item does with the indent of its list:

  ```ts
  "& ol > li.task-list-item": { pl: 3.5 },
  "& ol > li.task-list-item > input": { ml: -3 },
  ```

  The first line stays where it is (checkbox at 147, text at 171), and wrapped lines and nested lists start at the
  text. Extend the end-to-end test "task lists are indented and nested like other lists" in `e2e/pages.spec.ts` with a
  bullet task under a numbered task, whose checkbox lies at or right of the text of its parent, and with a numbered
  task that wraps, whose lines start at the same x.

- Confidence: Medium. The two rules were tried by injecting them into the page in the browser pane, and the
  measurements above came out as described, but only in Chromium, without the test the Suggestion names, and the
  change is one users see.
- Alternatives: leave the layout as it is and add it to "Current limits" in `spec/pages.md`; this keeps the code
  simpler, but a nested list under a numbered task stays hard to read.

#### issue: an escaped task marker `\[ ]` still makes a task item

- Location: `src/features/pages/markdown.ts`, `taskLists()` and `TASK_MARKER`
- Severity: Minor. Only content that escapes the marker on purpose is affected.
- Category: correctness
- Problem: `taskLists()` matches `TASK_MARKER` against the first text token of the item, after the inline parse has
  turned `\[` into `[`. The escape is then gone, and `- \[ ] text` becomes a task with an unticked checkbox. The
  comment of `TASK_MARKER` says that a list item whose text starts with `[ ] ` is a task "as in GitHub Flavored
  Markdown"; in the source, the text of this item starts with a backslash, which in CommonMark makes the bracket a
  plain character.
- Impact: an author who writes `\[ ]` to show the brackets as text, for example to describe the syntax of task lists,
  gets a checkbox instead, and has no way to write a list item that starts with `[ ] ` as text.
- Evidence: the test page held `- \[ ] C19 escaped marker` next to `- [ ]C19 no space after marker` and
  `- [y] C19 wrong letter`. The two others render as plain items with their brackets; the escaped one renders as a
  task item with a checkbox, no bullet and the text `C19 escaped marker`.
- Suggestion (required): match `TASK_MARKER` also against the source of the paragraph, the `content` of the `inline`
  token (`tokens[index + 2].content`), which keeps the backslash, and mark the item as a task only when both match.
  Add a unit test to "GitHub Flavored Markdown" in `src/features/pages/markdown.test.ts`: `- \[ ] escaped` renders
  `<li>[ ] escaped</li>` and no checkbox.
- Confidence: Medium. That the `content` of an `inline` token holds the source with its escapes is how markdown-it
  builds it, but the fix was not run, and that GitHub shows `\[ ]` as text was not checked on GitHub itself.

#### suggestion: "Current limits" does not say that a blank line before another list makes a task list loose

- Location: `spec/pages.md`, "Current limits", the item on loose task lists
- Severity: Nit. The behaviour is documented; only how easily it happens is not.
- Category: docs
- Problem: the limit says that "in a loose task list (blank lines between its items), the checkbox shows on a line
  above the text of its item". It reads as if an author has to write blank lines between the tasks. A task list
  followed by a blank line and another list with the same marker is one loose list in CommonMark, so its tasks show
  the checkbox above the text as well.
- Impact: an author who writes a task list, a blank line and a plain list with `-` sees all checkboxes jump above
  their text and finds no hint in the spec why.
- Evidence: `- [ ] C20 task after paragraph`, `- [x] C20 task after paragraph two`, a blank line, `- C20 plain list`,
  `- C20 plain list two` render as one list of four items; each task item is 48 px high, its checkbox on a line of
  its own above the text.
- Suggestion (optional): add to the item in "Current limits": "a task list and a list with the same marker after a
  blank line are one loose list, as in CommonMark".
- Confidence: Medium. The wording is clear and the behaviour was shown, but lifting the limit instead is a product
  choice.
- Alternatives: lift the limit in the page view, by putting the checkbox of a task item into its first paragraph, and
  add it to `roadmap.md` until then; this removes the cause, but changes the code and its tests.

### Reviewed

These cases hold every rule above, at 1024 px and at 375 px, without a finding:

- Nesting of bullet lists, task lists and numbered lists under a bullet or task item, to six levels: every level moves
  24 px, task and plain items of one list start their text at the same place, and the checkbox of a task item lies in
  the indent of its list, never left of the title heading.
- A bullet list of task items and plain items: the plain items keep `disc`, and `circle` or `square` when nested, as
  in a list without tasks; the task items show no bullet.
- Numbered lists keep their numbers with tasks in them, from a start number other than 1 and with two-digit numbers,
  and a plain item of a numbered task list keeps its number without a checkbox.
- Every item of one line is 24 px high, task or plain, so a mixed list keeps one rhythm.
- Long text in a bullet task item wraps under its text.
- Bold, code, links and strikethrough in the text of a task item, the markers `*`, `+` and `1)`, nesting by two
  spaces, and a task list inside a quote.
- `[ ]text`, `[y] text` and an empty `[ ]` are not tasks.
- The page does not scroll sideways at 375 px, and the view of a revision lays the lists out like the page view.

## Explorative test of the web application

### Summary

- Verdict: no Blocker. The app holds together well: rights are enforced on the server, rendered Markdown is safe, wiki
  links follow every move and rename, and OAuth and MCP behave as an AI app expects. The two Major findings both lose
  text that a user typed in the editor. Most other findings are about forms and dialogs that give stale or missing
  feedback, and about layout on narrow screens.
- Findings: 25 in all, 0 Blocker, 2 Major, 10 Minor and 13 Nit (`issue:` 12, `suggestion:` 1, `nit:` 12), plus 6
  questions. Of the 25 Suggestions, 0 are High, 17 Medium and 8 Low.
- To fix first: the two Major findings, "browser Back leaves the editor without asking" and "saving over a newer
  version throws away the own changes".
- Not covered: see "Not covered" at the end of this part.

### Scope and method

- Explorative test of the web application as a user sees it, without reading the specs or the code before the test.
  Only `issue-report.md` (for this format) and, after the test, the part "Manual checks of the app and of the repository" (to drop duplicates; none
  were found) were read.
- Date: 2026-11-22. The code is the state of the branch `main` after the commit `add the report of the manual checks`.
- The app ran as a production build (`next build` into its own build directory, `next start` on port 3100) against a
  throwaway PostgreSQL container on port 5433, migrated, with the admin created by the admin setup. The server had
  `HIPPOWIKI_PUBLIC_URL=http://localhost:3100` and a files directory of its own.
- The browser was the Chromium of the Claude desktop app at 1024 × 768, with the mobile preset 375 × 812 for the
  layout of a phone. A second user worked in parallel through `http://127.0.0.1:3100`, which keeps its own cookies.
- Users: `admin`, `alice` (Owner of the folder `team-wiki`) and `bob` (Reader, then Writer, then without a role).
  OAuth and MCP were driven with `curl` and a test client registered through `/oauth/register`.

### Findings

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

### Reviewed

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

### Not covered

- Tabs deleted with their pages, files moved, a new version of a file uploaded, PDFs, files in tabs.
- The MCP tools beyond `list_folder` and `create_page`, the Manager address and OAuth through a real AI app.
- "Log out other browsers" and the password change from the account page.
- Screen readers, Safari and Firefox, and the speed of the app.
- The settings of the repository and anything that needs the deployment.
