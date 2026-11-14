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

### Browser security: headers, CSRF, caching and data sent to the client

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

## What is good

## Checks on the deployment

## Standards coverage

Written in the standards cross-check.

## Open questions
