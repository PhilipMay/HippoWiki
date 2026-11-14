# HippoWiki – Security and Code Review Report

## Summary

Written in the last review step.

## Scope and method

- Reviewed: all of `src/` without `src/generated/`, `prisma/` with its schema and migrations, `scripts/`,
  `Containerfile`, `.containerignore`, `next.config.ts`, `.github/` with the workflows and Dependabot, `package.json`
  and the installed dependencies, `LICENSE`, and `README.md` as far as the build and the release are concerned. The
  feature specs in `spec/` are the rules the code is checked against.
- Depth: API tokens, OAuth and MCP in the most depth, because no review has seen them before.
- Date: 2026-11-14. The code is the state of the branch `main` on that day.
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
  least Major. A claim that the review could not show is written as a `question:`.

## Standards and target level

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

## Threat model

### Assets

- Page content, folders, tabs and the deleted pages.
- Accounts: user names, emails, the admin role, password hashes, the flag of a forced password change.
- Sessions and their cookies.
- API tokens (stored as hashes) and the secret shown once at creation.
- OAuth: authorization codes, access and refresh tokens, grants, client registrations and the cached client metadata
  documents.
- The secrets in the environment: the Better Auth secret, the database URL with its password, the initial admin
  password of the setup.
- The logs, with client addresses, user names and events.
- The build and release pipeline and the published container image.

### Actors

- Someone without a login on the internet.
- A logged-in user, and an admin.
- An MCP client with an API token or an OAuth grant.
- A malicious OAuth client, or the host of a malicious client ID metadata document.
- A wiki author whose content reaches the agent of another user through the MCP tools (prompt injection).
- The agent or LLM client that reads the tool output.
- Someone with access to the logs or to a database backup.
- Someone who can change a dependency, a GitHub action or the base image (supply chain).

### Entry points

- Public addresses, the exceptions in the `matcher` of `src/proxy.ts`:
  - `/login`, the login page, and its Server Action `logIn()`;
  - `/api/health`;
  - `/mcp`;
  - `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` with any path below it;
  - `/oauth/register` and `/oauth/token`;
  - `/_next/static/…`.
- Pages behind the login: `/`, `/folders`, `/folders/[folder]`, `/folders/[folder]/[item]`,
  `/folders/[folder]/[item]/[page]`, `/deleted-pages/[folder]`, `/deleted-pages/[folder]/[id]`, `/account`,
  `/users`, `/change-password`, `/oauth/authorize` (the consent page), and the pages `not-found`, `error` and
  `global-error`.
- Other addresses of Next.js behind the login: the image optimizer `/_next/image` and the RSC payloads of the pages.
- Server Actions (`src/features/*/actions.ts`):
  - auth: `logIn()`, `changeFirstPassword()`, `logOut()`;
  - folders: `createFolder()`, `renameFolder()`, `createTab()`, `renameTab()`;
  - pages: `createPage()`, `updatePageContent()`, `moveOrRenamePage()`, `deletePage()`, `restorePage()`;
  - tokens: `createToken()`, `revokeToken()`;
  - users: `createUser()`;
  - oauth: `approve()`, `deny()`.
- Route handlers: `src/app/api/health/route.ts`, `src/app/mcp/route.ts`, `src/app/oauth/register/route.ts`,
  `src/app/oauth/token/route.ts`, `src/app/.well-known/oauth-authorization-server/route.ts`,
  `src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts`.
- Outgoing requests: the fetch of client ID metadata documents in `src/features/oauth/metadata-fetch.ts`.
- Commands: the admin setup (`scripts/admin.ts`, in the image `scripts/image-admin.sh`), the start of the image with
  its migration (`scripts/image-start.sh`, `scripts/image-migrate.sh`).
- CI: the workflows in `.github/workflows/` and Dependabot (`.github/dependabot.yml`).

### Trust boundaries

- The reverse proxy in front of the app, and its forwarding headers (`X-Forwarded-For`, `X-Forwarded-Host`,
  `X-Forwarded-Proto`), which the app trusts only from `HIPPOWIKI_TRUSTED_PROXIES`.
- The public URL `HIPPOWIKI_PUBLIC_URL`, from which the OAuth issuer and the addresses of the metadata are built.
- The database.
- The hosts that client ID metadata documents are fetched from.
- The MCP client and its model, which read the tool output.
- The package registry, GitHub Actions and the registry of the base image.

### Threats by entry point

The letters are those of STRIDE: S spoofing, T tampering, R repudiation, I information disclosure, D denial of
service, E elevation of privilege. "Checked in" names the area of "Findings" (and the step of the plan) that checks
the threat.

#### Login page and `logIn()`

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

#### Pages behind the login and their RSC payloads

| STRIDE | Threat                                                                                        | Checked in                                           |
| ------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| S      | A page that reads data without `requireUser()`; relying on the cookie check of the proxy only | Access control                                       |
| T      | Script injected through Markdown, names or titles (stored XSS)                                | Content                                              |
| T      | Clickjacking of a page, above all the consent page                                            | Browser security                                     |
| I      | Whole records (hashes, internal fields) passed to Client Components or the RSC payload        | Browser security                                     |
| I      | Authenticated pages kept in a shared cache or the browser after a logout                      | Browser security                                     |
| I      | The `not-found` and error pages reveal whether an item exists, or internal details            | Access control; Logging, errors and failure handling |
| I      | Deleted pages visible in a list, the page view or the deleted pages of another folder         | Content                                              |
| D      | Large folders or pages, slow regular expressions in names or Markdown                         | Content                                              |
| E      | `/users` without a server-side check of the admin role                                        | Access control                                       |
| E      | The forced password change does not block the other pages                                     | Login, passwords, sessions and users                 |

#### Server Actions

| STRIDE | Threat                                                                                                | Checked in                                             |
| ------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| S      | An action called without a session, or with a session whose password change is forced                 | Access control                                         |
| T      | CSRF: an action called from another site; `allowedOrigins` too wide behind the reverse proxy          | Browser security                                       |
| T      | Arguments the form never sends: other ids, extra fields (mass assignment), the last editor            | Access control; Content                                |
| T      | Two writes at the same time break a rule that is checked first and written later                      | Content; API tokens                                    |
| R      | Writes, admin actions, token and consent events not logged                                            | Logging, errors and failure handling                   |
| I      | An action returns more than the page shows; error answers with internal details                       | Browser security; Logging, errors and failure handling |
| E      | `revokeToken()` or a grant action with the id of another user's object (IDOR)                         | Access control; API tokens                             |
| E      | `createUser()` without the admin check on the server                                                  | Access control                                         |
| E      | `approve()` used to approve a request the user never saw (CSRF, a changed client or redirect address) | OAuth                                                  |

#### `/api/health`

| STRIDE | Threat                                               | Checked in                        |
| ------ | ---------------------------------------------------- | --------------------------------- |
| I      | The answer names versions or internal details        | Configuration and container image |
| D      | Each call opens a database query that can be flooded | Configuration and container image |

#### `/mcp`

| STRIDE | Threat                                                                                       | Checked in                                       |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| S      | A tool runs without a valid token; an expired, revoked or forged token is accepted           | API tokens; MCP server                           |
| S      | A refresh token, a code or a token for another resource accepted as an access token          | API tokens; OAuth; MCP server                    |
| T      | Tool arguments that break the name rule reach a service                                      | MCP server                                       |
| T      | Prompt injection: wiki content written by one user steers the agent of another               | MCP server                                       |
| T      | A request from a browser of another site (foreign `Origin`)                                  | MCP server; Browser security                     |
| R      | Tool calls not logged with the token that made them                                          | Logging, errors and failure handling             |
| I      | Deleted pages listed or read; error answers with internal details; tokens in answers or logs | MCP server; Logging, errors and failure handling |
| D      | Large request bodies or large answers tie up the server                                      | MCP server                                       |
| E      | A token with too few scopes reaches a tool; missing scope counts as all scopes               | API tokens; MCP server                           |

#### OAuth endpoints and the consent page

| STRIDE | Threat                                                                                                          | Checked in                           |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| S      | A client pretends to be another (name, metadata document, redirect address); a registration takes over a client | OAuth                                |
| S      | A code stolen in transit used without PKCE or with `plain`                                                      | OAuth                                |
| T      | Redirect address not matched exactly: codes sent to an address of the attacker                                  | OAuth                                |
| T      | A code or a refresh token used twice; two refreshes at the same time                                            | OAuth                                |
| T      | Scopes or the resource widened between the consent and the token                                                | OAuth                                |
| R      | Registrations, consent given and revoked, reuse of a refresh token not logged                                   | Logging, errors and failure handling |
| I      | Error answers with internal details; tokens cached by a proxy (`Cache-Control`)                                 | OAuth; Browser security              |
| I      | Metadata that is built from the `Host` header and points clients elsewhere                                      | OAuth                                |
| D      | Unlimited registrations; slow or large metadata documents                                                       | OAuth                                |
| E      | SSRF: the metadata fetch reaches the local network, the loopback address or the cloud metadata service          | OAuth                                |
| E      | A revoked grant whose access or refresh tokens still work                                                       | OAuth                                |

#### Outgoing fetch of client ID metadata documents

| STRIDE | Threat                                                              | Checked in |
| ------ | ------------------------------------------------------------------- | ---------- |
| S      | DNS rebinding: the address checked is not the address fetched       | OAuth      |
| T      | Keys such as `__proto__` in the document (prototype pollution)      | OAuth      |
| I      | Redirects or numeric host forms lead the fetch to a private address | OAuth      |
| D      | A host that answers slowly or with a huge body                      | OAuth      |

#### Admin setup and the start of the image

| STRIDE | Threat                                                                                | Checked in                           |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------ |
| S      | A default account or a default password                                               | Login, passwords, sessions and users |
| T      | The setup overwrites an existing admin, or runs twice                                 | Login, passwords, sessions and users |
| I      | A password printed into a log; secrets, `.env` files or source maps in the image      | Configuration and container image    |
| D      | A failed migration that still starts the server                                       | Configuration and container image    |
| E      | The server runs as root or can write its own files; forged forwarding headers trusted | Configuration and container image    |

#### CI workflows, dependencies and the release

| STRIDE | Threat                                                                                        | Checked in   |
| ------ | --------------------------------------------------------------------------------------------- | ------------ |
| S      | An action or a dependency replaced (tags instead of commit SHAs, missing registry signatures) | Supply chain |
| T      | A pull request writes a cache that a release reads; `pull_request_target` with foreign code   | Supply chain |
| I      | Secrets reach a pull request from a fork                                                      | Supply chain |
| E      | Workflow tokens with more permissions than needed; an unsigned image without provenance       | Supply chain |
| D      | Known vulnerable dependencies that stay unpatched                                             | Supply chain |

## Findings

### Access control and the entry points of requests

#### nit: `createUser()` checks the name before the admin check, so a non-admin sees form errors instead of "not found"

- Location: `src/features/users/actions.ts`, lines 25–36, `createUser()`
- Severity: Nit. Nothing is created and nothing secret is revealed, because the name rule is public; only the answer
  differs from the one the spec promises.
- Category: correctness
- Problem: the action calls `requireUser()`, then `parseUserFormData()` and returns the field errors for an invalid
  name. Only then does it call the service, whose admin check gives `not-allowed`, which the action maps to
  `notFound()`.
- Impact: a logged-in user who is not the admin can tell that the action exists. This breaks the rule in
  `users-and-login.md` (section "User list and creating users") that the user list is not found for everyone else,
  "with and without an action". It is no way past the admin check.
- Evidence: called as the user `dave` on the local server with `Next-Action` of `createUser` and the name `Bad Name`:
  `200 OK` with `{"fieldErrors":{"name":["Use lowercase letters, digits and single hyphens"]}}`. With a valid name the
  answer is `404` with `NEXT_HTTP_ERROR_FALLBACK;404`, and no user is created.
- Suggestion (optional): let the service validate the name after its admin check and drop the parse from the action,
  or check the admin in the action before the parse.
- Reference: OWASP A01:2025 Broken Access Control; ASVS 8.2.1; CWE-204.

#### suggestion: `OPTIONS /mcp` lists `GET` and `DELETE` as allowed, though both answer 405

- Location: `src/app/mcp/route.ts`, lines 6–19 (the exports `POST`, `GET`, `DELETE`); `src/features/mcp/http.ts`,
  lines 94–102, `handleMcpRequest()`
- Severity: Nit. Nothing is exposed; the requirement is Level 3.
- Category: correctness
- Problem: Next.js answers `OPTIONS` itself for a route that does not export it, with an `Allow` header built from the
  exported methods. `/mcp` exports `GET` and `DELETE` only to answer them with 405 and `Allow: POST`, so `OPTIONS`
  names methods that the endpoint refuses. The comment "Anything but `POST` answers 405" does not hold for `OPTIONS`.
- Impact: a client or scanner gets two different lists of methods for the same endpoint.
- Evidence: `curl -si -X OPTIONS http://localhost:3100/mcp` gives `204 No Content` with
  `allow: DELETE, GET, HEAD, OPTIONS, POST`; `curl -si http://localhost:3100/mcp` gives `405` with `allow: POST`.
- Suggestion (optional): export `OPTIONS` from `src/app/mcp/route.ts` and hand it to `handleMcpRequest()`, so that it
  answers 405 with `Allow: POST` like `GET` and `DELETE`.
- Reference: ASVS 4.1.4 (Level 3); RFC 9110 section 10.2.1.

#### nit: the image optimizer of Next.js stays switched on although the app uses no `next/image`

- Location: `next.config.ts`, `nextConfig` (no `images` option)
- Severity: Nit. Only logged-in users reach it, and it fetches only addresses of the app itself; it is unused attack
  surface, not a hole.
- Category: security
- Problem: `/_next/image` is served with the default settings. With a session it fetches the given local address
  from the server itself, without the cookie, and fails with a 500 when the answer is not an image.
- Impact: a logged-in user can make the server fetch and resize images on request, a function the app does not need.
  `architecture.md` (section "Login and sessions") already says the app does not use it.
- Evidence: with a session cookie, `curl -s -o /dev/null -w '%{http_code}' -b <jar>
'http://localhost:3100/_next/image?url=%2Ffolders&w=64&q=75'` gives `500`, and the server logs
  `internal image response failed for /folders 307`. An external address gives `400`. Without a cookie the proxy
  answers `307` to the login.
- Suggestion (optional): switch the optimizer off with `images: { unoptimized: true }` in `next.config.ts`.
- Reference: OWASP A02:2025 Security Misconfiguration; CWE-1188.

#### Reviewed

- Files read: `src/proxy.ts`, `src/features/auth/session.ts`, `src/lib/auth.ts`, `src/lib/addresses.ts`, the
  `actions.ts` of all six features, the `queries.ts` of folders, pages, oauth, tokens and users, the `service.ts` of
  auth, users and tokens in full and the writes of folders, pages and oauth, the `forms.ts` of tokens, users, oauth
  and auth, `src/features/users/records.ts` and `schema.ts`, every `page.tsx` and `route.ts` under `src/app/`,
  `layout.tsx`, the error pages, `src/components/AppHeader.tsx`, `next.config.ts`, `e2e/access.spec.ts`.
- `requireUser()` before every read and write (ASVS 8.3.1, `CON.10.A2`): every page calls it first (the login page
  uses `getCurrentUser()`, the password change `requireSession()`), every query after `connection()`, and every
  exported Server Action first, outside its `try` blocks. No layout, loading or template file reads data. An action
  without a cookie is answered by the proxy with `303` and `x-action-redirect: /login;push` (local server).
- The forced password change blocks everything else: `requireUser()` redirects to `/change-password`
  (`src/features/auth/session.ts`), `authenticateToken()` refuses the token of such a user, and the OAuth token
  exchange and refresh refuse it too.
- The `matcher` of the proxy: every exception is anchored with `$` except `oauth-protected-resource(?:/.*)?` and
  `_next/static/`, which lead only to a catch-all route that answers 404 for other paths and to static files. Next.js
  matches the raw and the decoded path and resolves `..` before matching. On the local server, `/mcp/x`, `/MCP`,
  `/%6Cogin`, `/.well-known/oauth-protected-resource/../../users` and `/_next/static/../../users` all give `307` to
  the login; `/login/`, `/mcp/` and `/api/health/` give `308` to the address without the slash.
- Nothing relies on the proxy alone: all pages and actions check again, and the public route handlers check bearer
  tokens or PKCE themselves.
- Admin only on the server (ASVS 8.2.1): `listUsers()` returns `null` and `createUser()` returns `not-allowed` in
  `src/features/users/service.ts`. On the local server, `createUser` called as `dave` with a valid name gives `404`
  and creates nothing.
- Arguments a form never sends (ASVS 2.2.1, 2.2.2): bound ids are parsed in every action (`parseFolderId`,
  `parseTabId`, `parsePageId`, `parseTokenId`) and again in the services; route segments go through `parseName` and
  `parsePageSegment`. A tab of another folder is refused by the composite foreign key in the pages service.
- Object level (ASVS 8.2.2, CWE-639): `revokeToken()` deletes with the token id and the user id in one condition
  (`src/features/tokens/service.ts`); the revoke dialog of `/account` accepts only the caller's own token ids;
  `listTokens()` filters by user; codes and grants are bound to the user of the session. On the local server,
  `revokeToken` called as `dave` with the id of `erin`'s token gives `404` with `NEXT_HTTP_ERROR_FALLBACK;404`, and the
  token stays. Content has no owner on purpose (see "Accepted deviations").
- Mass assignment (ASVS 8.2.3, 15.3.3): every spread of parsed data comes from a `z.object` schema, which strips
  unknown keys; the last editor always comes from `requireUser()`, the scopes from the token schema or the fixed
  scopes of a grant, `mustChangePassword` is only ever set to `true` for a new user, and the field is `input: false` in
  Better Auth.
- Missing and repeated parameters (ASVS 15.3.7, CWE-234): `parseChoice()` and `safeNextPath()` refuse arrays, the
  OAuth readers treat a repeated parameter as missing, a token needs at least one scope and `authenticateToken()`
  requires the exact scope.
- HTTP methods: Next.js answers 405 for every method a route does not export; on the local server `GET`, `PUT` and
  `DELETE /oauth/token` and `POST /api/health` give `405`. `OPTIONS /mcp` is the exception (finding above).
- Open redirects (ASVS 3.7.2, `CON.10.A4`, CWE-601): `safeNextPath()` in `src/lib/addresses.ts` is used wherever
  `next` is read, and every other redirect is built from stored names. On the local server a login with `next` set to
  `//evil.example/`, `/\evil.example`, `https://evil.example`, `/\/evil.example`, ` //evil.example` and
  `javascript:alert(1)` redirects to `/folders`; `/%2F%2Fevil.example` and `/%09/evil.example` stay paths on the same
  site. A request with `Host: evil.example` gets a relative `Location`.
- Existence leaks (CWE-200): without a session, every request ends at the proxy or at `requireUser()` before any
  not-found; another user's token, an unknown and a malformed one give the same not-found; the error pages show only
  the digest. The only difference found is the first finding.

### Browser security: headers, CSRF, caching and data sent to the client

#### issue: the Content Security Policy sends `base-uri 'self'` where ASVS asks for `'none'`, without a reason in a spec

- Location: `next.config.ts`, lines 8–15, `SECURITY_HEADERS`; `e2e/security-headers.spec.ts`, line 12
- Severity: Minor. Raw HTML in Markdown is not rendered, so nobody can inject a `<base>` element today; a Level 2
  requirement is still not met, and no spec gives the reason.
- Category: security
- Problem: ASVS 3.4.3 asks for a global policy with `object-src 'none'` and `base-uri 'none'`. The policy sends
  `base-uri 'self'`. Neither Next.js nor Material UI emits a `<base>` element, so `'none'` costs nothing.
- Impact: after an HTML injection, an injected `<base href="/x/">` could still move relative addresses of scripts and
  links to other paths of the site.
- Evidence: every response of the local server carries
  `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data:`.
- Suggestion (required): change it to `base-uri 'none'` in `next.config.ts` and in the expectation of
  `e2e/security-headers.spec.ts`.
- Reference: OWASP A02:2025 Security Misconfiguration; ASVS 3.4.3; `CON.10.A14`.

#### issue: the answers of `/mcp` carry no `Cache-Control: no-store`

- Location: `src/features/mcp/http.ts`, lines 25–27, `refusal()`, and lines 134–135, `handleMcpRequest()`
- Severity: Minor. Browsers and shared caches do not store the answer to a `POST` with an `Authorization` header
  without explicit freshness, so the real risk is small.
- Category: security
- Problem: the OAuth adapters set `Cache-Control: no-store` and `Pragma: no-cache` on every answer
  (`src/features/oauth/http.ts`). The MCP adapter sets nothing, the MCP SDK sets `Cache-Control` only on SSE streams,
  which are off, and Next.js adds nothing to the answer of a route handler. An MCP answer holds the content of wiki
  pages.
- Impact: a misconfigured cache in front of the app or an HTTP cache in an MCP client could keep page content that
  the server never marked as private.
- Evidence: `curl -si -X POST http://localhost:3100/mcp -H "Authorization: Bearer <token>" …` with a `tools/list`
  request gives `200 OK` and `content-type: application/json` with no `Cache-Control`.
- Suggestion (optional): set `Cache-Control: no-store` on every answer in `handleMcpRequest()`, on the refusals and on
  the `Response` of the SDK alike, and add the rule to `mcp.md` next to the one in `oauth.md`.
- Reference: OWASP A02:2025 Security Misconfiguration; ASVS 14.3.2, 14.2.2; CWE-525.

#### issue: Client Components get whole `TabSummary` rows with fields they do not show

- Location: `src/app/folders/[folder]/page.tsx`, lines 66–72; `src/app/folders/[folder]/[item]/page.tsx`, lines
  82–88; `src/features/pages/components/PageView.tsx`, lines 60 and 91–98;
  `src/features/pages/components/DeletedPageView.tsx`, lines 41 and 62–68; the type `TabSummary` in
  `src/features/folders/service.ts`, line 27
- Severity: Minor. Every logged-in user can see these fields in the tab list anyway, so nothing is disclosed; the rule
  that only the shown fields reach the browser is broken.
- Category: security
- Problem: `NewPageForm`, `MoveOrRenamePageDialog` and `RestorePageDialog` take `tabs: { id: string; name: string }[]`,
  but the pages pass the result of `listTabs()`, a `TabSummary` with `updatedAt` and `lastEditedBy` as well.
  TypeScript accepts the extra fields, and React serialises the whole objects into the RSC payload.
- Impact: none today. A field added to `TabSummary` later reaches the browser without anyone noticing.
- Evidence: the RSC payload of `/folders/csrf-same?action=new` on the local server, for a folder with one tab,
  contains the keys `"updatedAt"` and `"lastEditedBy"` once each.
- Suggestion (optional): map before passing, `(await listTabs(folder.id)).map(({ id, name }) => ({ id, name }))`, or
  add a query that returns only `{ id, name }`.
- Reference: OWASP A01:2025 Broken Access Control; ASVS 15.3.1; CWE-213; the Next.js data security guide, "Passing data
  from server to client".

#### suggestion: the modules that read the database or hold secrets do not import `server-only`

- Location: `src/lib/db.ts`, `src/lib/auth.ts`, `src/lib/env.ts`, `src/lib/password-hash.ts`, every
  `src/features/*/service.ts` and `queries.ts`, `src/features/tokens/secret.ts`, `src/features/oauth/secret.ts`
- Severity: Minor. It is defence in depth: the lint rules in `eslint.config.mjs` already stop routes and components
  from importing `@/lib/db`, `@/lib/auth` and the values of services.
- Category: security
- Problem: the Next.js data security guide asks for a data access layer marked with `import "server-only"`, so that
  an import into a Client Component fails the build. No file in `src/` has it. The lint rules cover only `@/lib/db`,
  `@/lib/auth` and services, and only for files under `src/app/` and `components/`: a Client Component could import
  `@/lib/env`, a `secret.ts` or a `queries.ts` without an error.
- Impact: a later change could bundle server code into the browser. Secrets would not leak, because only
  `NEXT_PUBLIC_` variables are inlined, but the rule that keeps data access on the server would no longer be enforced.
- Evidence: `grep -rn "import ['\"]server-only['\"]" src` finds nothing.
- Suggestion (optional): add `import "server-only";` to the modules above, check that Vitest resolves it, and say so
  in "Layout" in `architecture.md`.
- Reference: OWASP A06:2025 Insecure Design; the Next.js data security guide, "Preventing client-side execution of
  server-only code" and "Auditing".

#### suggestion: a logout leaves wiki pages open in other tabs and clears nothing in the browser

- Location: `src/features/auth/actions.ts`, lines 43–45, `revalidateEverything()`, and lines 125–134, `logOut()`
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
- Reference: OWASP A07:2025 Authentication Failures; ASVS 14.3.1; CWE-524.

#### suggestion: the Content Security Policy has no `default-src`, `script-src` or `connect-src` at all

- Location: `next.config.ts`, lines 8–15, `SECURITY_HEADERS`
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
  connector may open in a popup.
- Reference: ASVS 3.4.3, 3.4.7, 3.4.8; the Next.js guide on the Content Security Policy.

#### nit: `/oauth/register` reads a JSON body of any media type, so another site can register clients from its visitors' browsers

- Location: `src/features/oauth/http.ts`, lines 100–110, `handleRegister()`
- Severity: Nit. The endpoint is public on purpose and needs no credentials; the only gain is spreading registrations
  over the address groups of the visitors.
- Category: security
- Problem: RFC 7591 section 3.1 has the client send `application/json`. `handleRegister()` parses any body, so a form
  of another site with `enctype="text/plain"` can send a valid JSON body as a simple request, without a CORS
  preflight. With `HIPPOWIKI_TRUSTED_PROXIES` set, a page with many visitors registers clients from many address
  groups, past the limit per group; with `0`, it fills the one shared group.
- Impact: the table of clients fills up until unused clients are removed; the shared group can be blocked for an hour.
- Evidence: `curl -si -X POST -H 'Content-Type: text/plain' --data '{"redirect_uris":["http://127.0.0.1:9999/cb"],"client_name":"textplain"}' http://localhost:3100/oauth/register`
  gives `201 Created` with a `client_id`.
- Suggestion (optional): answer 400 `invalid_client_metadata` unless the media type is `application/json`, with the
  helper `mediaTypeOf()` that the token endpoint uses already.
- Reference: ASVS 3.5.2; RFC 7591 section 3.1; CWE-352.

#### nit: `architecture.md` writes out the values of the security headers instead of pointing to `next.config.ts`

- Location: `spec/architecture.md`, section "Security headers"
- Severity: Nit
- Category: docs
- Problem: the spec repeats the HSTS value and the whole CSP string, which `next.config.ts` and
  `e2e/security-headers.spec.ts` hold already, so a change has to be made in three places.
- Evidence: "`Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; …`"
- Suggestion (optional): name the headers and their reasons, and point to `SECURITY_HEADERS` in `next.config.ts` for
  the values.
- Reference: `issue-report.md`, last item of the checklist.

#### Reviewed

- Files read: `next.config.ts`, `src/proxy.ts`, `src/app/layout.tsx`, the error pages, every route handler,
  `src/features/oauth/http.ts`, `src/features/mcp/http.ts`, `src/features/oauth/components/`,
  `src/features/pages/components/MarkdownContent.tsx`, `src/components/AppHeader.tsx`, the return values of every
  `"use server"` file, the props of every `"use client"` file, `eslint.config.mjs`, `e2e/security-headers.spec.ts`;
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
- `/oauth/token` uses no cookie: the code with its verifier and the refresh token are the credentials. `/mcp` needs a
  bearer token and refuses a foreign `Origin`: on the local server it gives `403`.
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
- CORS (ASVS 3.4.2, CWE-942): no response sends an `Access-Control-*` header. On the local server a preflight to
  `/mcp` and requests with a foreign `Origin` to `/oauth/token`, `/oauth/register` and `/.well-known/…` get none.
- Data sent to the client (ASVS 15.3.1): the actions return small form states; `createUser` returns the generated
  first password and `createToken` the secret, both on purpose and once. The RSC payloads of `/users` and `/account`
  on the local server contain no hash, email, `mustChangePassword` or user id; the ids of tokens appear only as list
  keys. The only extra fields are those of the `TabSummary` finding.
- Error answers: the error pages show only the digest; the 500 answers of MCP and OAuth say only `server_error`.
- Markdown links (CWE-1022): no link opens a new window (no `target="_blank"` in `src/`), and
  `Referrer-Policy: same-origin` keeps page addresses on the site.
- Browser storage (ASVS 14.3.3): no `localStorage` or `sessionStorage` in `src/`.
- The prefix of the session cookie (ASVS 3.3.3) is part of the area "Login, passwords, sessions and users".

### Login, passwords, sessions and users

### API tokens

### OAuth

### MCP server

### Content: pages, folders, tabs, deletion and rendering

### Logging, errors and failure handling

### Configuration and container image

### Supply chain: dependencies, CI and release

### Cross-cutting: data model, architecture, documentation and tests

## Accepted deviations

- ASVS 8.2.2 and 8.4.1 for content (Access control): every logged-in user may read and change all folders, tabs and
  pages, so content has no owner to check. Documented in `users-and-login.md` ("Current limits": no rights and roles)
  and `mcp.md` (a caller reads everything, like every logged-in user).
- ASVS 6.3.2, a default account named `admin` (Access control): the admin is the user named `admin`, with a password
  that the setup takes from the environment and that must be changed at the first login. Documented in
  `users-and-login.md` ("Admin account and setup", "Decisions"). There is no default password.

## What is good

- Access control: two layers of the login check, with the check that protects the data in `requireUser()`
  (`src/features/auth/session.ts`), and an answer of the proxy that the client of Next.js understands for an action
  without a cookie (`src/proxy.ts`).
- Access control: the decisions of who may do what live in the services (`listUsers()` and `createUser()` in
  `src/features/users/service.ts`, `revokeToken()`, `listTokens()` and `authenticateToken()` in
  `src/features/tokens/service.ts`), so that the MCP and OAuth adapters cannot skip them.
- Access control: the owner of a token is part of the condition of the delete itself (`revokeToken()` in
  `src/features/tokens/service.ts`), with no gap between a read and a check.
- Access control: `safeNextPath()` in `src/lib/addresses.ts` combines a prefix check, a check for control characters
  and a check of the origin with the WHATWG `URL`.
- Access control: `e2e/access.spec.ts` covers the protected addresses with the edge cases of the matcher, stale
  cookies and actions without a session; `integration/token-service.test.ts` covers revoking another user's token.
- Browser security: one rule with the source `/:path*` in `next.config.ts` puts the security headers on every
  response, the redirects of the proxy included; `e2e/security-headers.spec.ts` checks them and collects CSP
  violations in a real browser.
- Browser security: `hasForeignOrigin()` in `src/features/mcp/http.ts` compares the `Origin` exactly with
  `HIPPOWIKI_PUBLIC_URL`, against DNS rebinding, as the MCP specification asks.
- Browser security: the consent form (`src/features/oauth/components/ConsentForm.tsx`) opens the redirect address
  with JavaScript instead of loosening `form-action 'self'`.
- Browser security: the services name their columns and return their own types, such as the last editor with the
  name only, and lists are Server Components that render only what they show.

## Checks on the deployment

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

## Standards coverage

Written in the standards cross-check.

## Open questions
