# Security and Code Review – Steps

## Goal

Review the whole project for security holes and code defects, and write the findings into one report,
`spec/review-report.md`, in the format of `issue-report.md`. The review checks the code against named security
standards at the target level of OWASP ASVS 5.0.0 Level 2, and every requirement of these standards that applies to
the project ends with a result in the report. The review changes no code. A later step plan fixes the findings that the
user chooses.

## Scope

- In: all of `src/` (without `src/generated/`), `prisma/` with its schema and migrations, `scripts/`, `Containerfile`,
  `.containerignore`, `next.config.ts`, `.github/` with the workflows and Dependabot, `package.json` and the installed
  dependencies, `LICENSE`, `README.md` as far as the build and the release are concerned, and the feature specs as the
  rules the code is checked against. API tokens, OAuth and MCP are reviewed in the most depth because no review has
  seen them yet.
- In: evidence from reading the code, from running the existing commands (`npm run check`, `npm run test:coverage`,
  `npm run test:integration`, `npm run test:e2e`, `npm audit`), from the read-only commands `npm ls` and
  `npm audit signatures`, and from requests to a local server sent with `curl`. The server is `next dev` (or the
  image of `npm run image:build`) against a throwaway PostgreSQL container of its own, with the image of
  `scripts/Containerfile`, another port and no volume, so that the probe users, pages, tokens and clients never reach
  the development database of `npm run db:up`. The container is removed when the review ends. Throwaway probe scripts
  go to a temporary directory outside the repository and are never committed.
- In: a vulnerability scan of the image, but only with a scanner that is already installed on the machine.
- Not in: any change to code, tests, configuration, migrations, `README.md` or a spec other than
  `spec/review-report.md`, this step file and the catalog in `CLAUDE.md`. A finding that needs a fix describes the
  fix in its Suggestion, with a snippet if useful.
- Not in: tests or requests against the deployment or any host other than `localhost`. What can only be checked
  there goes to the report section "Checks on the deployment": the reverse proxy and its TLS configuration, the host,
  the network, the backups and the log storage.
- Not in: installing tools, scanners or packages, upgrading packages, and the Git history (see "Git Handling" in
  `CLAUDE.md`).

## How the review is run

- The plan runs in one session, step by step in checklist order, as "Step plans" in `spec/workflow.md` describes. No
  two steps run at the same time, and no step runs in a session or agent of its own in parallel with another.
- Only the session writes `spec/review-report.md`, ticks the checklist and commits. It also alone starts and stops the
  local server and its throwaway database (see "Scope"), runs the test commands and sends the `curl` requests,
  so that no two runs compete for ports or containers.
- The steps "Report outline, threat model and standards", "Standards cross-check", "Summary and final check of the
  report" and "Wrap-up" are done by the session itself, because they need the whole report.
- For each area step in between, from "Access control and the entry points of requests" to "Cross-cutting: data model,
  architecture, documentation and tests", the session hands the reading of the code to a read-only subagent with a
  fresh context. Its brief names:
  - the files in scope of the step and the feature specs they are checked against,
  - the questions of the step's "Build" section and the threats of the threat model that the step checks,
  - the standards of "Rules for the review" that the step concerns,
  - the format of a finding (`issue-report.md` and "Rules for the review") and what to return: the findings, the
    "Reviewed" list and the good solutions with their location.
- The subagent changes nothing: no file edits, no commands that write, no server or container of its own. What it can
  only show with a running server or a test, it returns as a probe for the session to run.
- Where an area splits cleanly, the session may run two such subagents of the same step in parallel, for example the
  authorization request and consent next to the token endpoint and refresh, or the dependencies next to the CI
  workflows.
- The session checks the evidence of every returned finding before it goes into the report: it opens the cited lines,
  runs the probes, and writes a finding it cannot confirm as a `question:`. It merges findings that an earlier area
  already reported (the same problem in several places is one finding) and keeps the severities consistent across
  areas.

## Rules for the review

- Every finding follows `issue-report.md`: Title, Location, Severity, Category, Problem, Impact, Evidence,
  Suggestion (marked as required or optional), and Alternatives and Reference where they help. The fields are a
  bullet list under a heading with the title of the finding; the title starts with its Conventional Comments label
  (`issue:`, `suggestion:`, `question:`, `nit:`). No numbers on headings or findings (see "Document Style" in
  `CLAUDE.md`).
- Location names the file as a code span of its own (so that `npm run docs:check` finds it), then the line range and
  the function in plain text, for example: `src/features/oauth/service.ts`, lines 120–140, `exchangeCode()`. For a
  spec: the file and the heading of the section, with a short quote as Evidence.
- Severity uses only Blocker, Major, Minor and Nit. When in doubt, the lower one, with the reason. Everything that
  lets someone without the right access read, change or delete data, or take over an account or a token, is at least
  Major.
- A claim without evidence is written as a `question:`. A finding that a local request or test shows says how to
  repeat it.
- The same problem in several places is one finding with all locations.
- The code is checked against its feature spec: a spec rule that the code breaks is a finding, and so is a spec that
  restates code, a constant or a message instead of pointing to it (last item of the checklist in `issue-report.md`).
- The target level is OWASP ASVS 5.0.0 Level 2. A Level 3 requirement is reported only as a `suggestion:`, and only
  where it is cheap to meet. ASVS IDs are taken from the release tag `v5.0.0` of the ASVS repository, not from its
  `master` branch, whose numbering can change.
- A deviation from a standard that a feature spec documents on purpose, with its reason (for example a login without
  a second factor), is not a finding: it goes to the report section "Accepted deviations" with the ID of the
  requirement and the place in the spec. A deviation that no spec documents is a finding; its Suggestion says whether
  to fix it or to document it as a decision.
- The Reference of a security finding names the category of the OWASP Top 10:2025 (for example A01 Broken Access
  Control), the ASVS ID, the CWE ID, and the section or requirement ID of any other standard below (for example NIST
  SP 800-63B-4 3.1.1.2, RFC 9700 4.1, `CON.10.A14`).
- Standards to check against, with the version that counts:
  - General: the OWASP Top 10:2025, OWASP ASVS 5.0.0, the OWASP API Security Top 10 2023, the CWE Top 25 2025 and the
    OWASP Cheat Sheet Series.
  - Login, passwords and sessions: NIST SP 800-63B-4 (2025).
  - OAuth: the OAuth 2.0 Security Best Current Practice (RFC 9700), OAuth 2.1, RFC 7636 (PKCE), RFC 8414
    (authorization server metadata), RFC 9728 (protected resource metadata), RFC 7591 (dynamic registration), RFC 8707
    (resource indicators), RFC 9207 (the `iss` parameter) and the OAuth client ID metadata document draft.
  - MCP: the MCP specification, revision 2026-07-28, with its pages on authorization, its security considerations,
    client registration, security best practices and the Streamable HTTP transport; the OWASP MCP Top 10 (2025); and
    the OWASP Top 10 for LLM Applications 2025 for prompt injection (LLM01).
  - Next.js: the guides in `node_modules/next/dist/docs/01-app/02-guides/`, above all `data-security.md`, and
    `server-actions.md`, `authentication.md`, `self-hosting.md` and `production-checklist.md` there.
  - BSI: TR-02102-1 (version 2026-01) for cryptography; the IT-Grundschutz modules CON.10 (development of web
    applications), APP.3.1 (web applications and web services), SYS.1.6 (containers) and OPS.1.1.5 (logging);
    TR-03183-2 (version 2.1.0) for an SBOM; TR-03185 (version 1.1.1), part 2 for open-source software.
- Each area of the report ends with "Reviewed": the files that were read and the questions of the step that found
  nothing. This shows what the review covered, not only what it found.
- Good solutions go to "What is good", with their location.
- Each step adds only its own area to the report. The summary is written in the last review step.

## Checklist

- [x] Report outline, threat model and standards
- [x] Access control and the entry points of requests
- [x] Browser security: headers, CSRF, caching and data sent to the client
- [x] Login, passwords, sessions and users
- [x] API tokens
- [x] OAuth
- [x] MCP server
- [x] Content: pages, folders, tabs, deletion and rendering
- [ ] Logging, errors and failure handling
- [ ] Configuration and container image
- [ ] Supply chain: dependencies, CI and release
- [ ] Cross-cutting: data model, architecture, documentation and tests
- [ ] Standards cross-check
- [ ] Summary and final check of the report
- [ ] Wrap-up

## Report outline, threat model and standards

### Goal

The report file exists with its structure, the standards and the target level it uses, and a threat model that the
later steps check the code against.

### Build

- Create `spec/review-report.md` with these sections: "Summary" (left to the last review step), "Scope and method",
  "Standards and target level", "Threat model", "Findings" with one subsection per area of the checklist, "Accepted
  deviations", "What is good", "Checks on the deployment", "Standards coverage" (left to the standards cross-check)
  and "Open questions".
- "Scope and method": what is reviewed, the date, how evidence was collected, the severity scale of
  `issue-report.md`.
- "Standards and target level": the standards of "Rules for the review" with their versions, the target level ASVS
  5.0.0 Level 2, how Level 3 requirements and documented deviations are handled, and the form of a Reference.
- "Threat model":
  - Assets: page content, accounts and password hashes, sessions, API tokens, OAuth codes, access and refresh tokens,
    client registrations, the secrets in the environment, the logs, and the build and release pipeline with the
    published image.
  - Actors: someone without a login on the internet, a logged-in user, an admin, an MCP client with a token or an
    OAuth grant, a malicious OAuth client or metadata document, a wiki author whose content reaches the agent of
    another user through the MCP tools (prompt injection), the agent or LLM client that reads the tool output, someone
    with access to the logs or the database backup, and someone who can change a dependency, an action or the base
    image (supply chain).
  - Entry points: every public address of the `matcher` in `src/proxy.ts` (`/login`, `/api/health`, `/mcp`,
    `/.well-known/…`, `/oauth/register`, `/oauth/token`), every page, every Server Action, every route handler, the
    outgoing fetch of client ID metadata documents, the admin setup command, the start of the container image and the
    CI workflows.
  - Trust boundaries: the reverse proxy and its forwarding headers, the public URL, the database, the hosts that
    metadata documents are fetched from, the MCP client and its model, the package registry and GitHub Actions.
  - Method: for every entry point, the threats by STRIDE (spoofing, tampering, repudiation, information disclosure,
    denial of service, elevation of privilege), each with the step of this plan that checks it.
- Add `spec/review-report.md` to the spec catalog in `CLAUDE.md`.

### Test

- `npm run check` passes.
- Every entry point of the app appears in the threat model: compare it with the files under `src/app/`, the
  `"use server"` files, the `matcher` in `src/proxy.ts` and the outgoing requests in `src/features/oauth/`.
- Every threat of the STRIDE table names the step that checks it.

## Access control and the entry points of requests

### Goal

Every request that reads or changes data is checked for a valid login or token and for the right to the object it
names, and the public addresses expose nothing more than they should.

### Build

Review `src/proxy.ts`, `src/features/auth/session.ts`, `src/lib/auth.ts`, `src/lib/addresses.ts`, every
`actions.ts`, `queries.ts` and `service.ts` under `src/features/`, every `page.tsx` and `route.ts` under `src/app/`,
against "Login and sessions" and "Addresses and actions" in `architecture.md` and the audit list at the end of the
Next.js guide `data-security.md`. Questions:

- Does every page, query and Server Action call `requireUser()` (or the admin check) before it touches data, also
  the ones that only read? Is there a path that reaches a service without it? A login check of a page does not cover
  the Server Actions it renders: does each action check again (ASVS 8.3.1, `CON.10.A2`, CWE-862)?
- Is the `matcher` of the proxy exactly the list of public addresses, without a pattern that lets more through? Does
  nothing rely on the proxy alone for access control?
- Do the admin-only actions (users) check the admin role on the server, not only by hiding a button (ASVS 8.2.1)?
- Can a Server Action be called with arguments that the form never sends (other folder, other page, other user's
  token or grant)? Is every argument validated with Zod on the server, and are the `[param]` segments of the routes
  validated before use (ASVS 2.2.1, 2.2.2)?
- Object level: is the owner checked for every token, grant and session that an ID names, so that one user cannot
  read, revoke or use the object of another by changing the ID (ASVS 8.2.2, CWE-639)?
- Mass assignment: is any request object spread into the `data` of a Prisma write, so that a field the form never
  shows (role, `mustChangePassword`, scope, last editor) can be set (ASVS 8.2.3, 15.3.3, CWE-915)?
- Does a missing, empty or repeated parameter ever widen access, for example a missing scope that counts as all
  scopes or a repeated query parameter whose second value wins (A10, CWE-234, ASVS 15.3.7)?
- Does every route handler answer only the HTTP methods it needs, and the others with 405 (ASVS 4.1.4,
  `APP.3.1.A12`)?
- Open redirects: can the way back after a login (`next`) or any other redirect lead to another site (ASVS 3.7.2,
  `CON.10.A4`, CWE-601)?
- Do error pages, the `not-found` page or error messages leak whether a folder, page, user or token exists to
  someone who may not see it (CWE-200)?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The public addresses are tried without a cookie against a local server; a protected page, a Server Action and the
  image optimizer are tried without a cookie too, and the answers are noted as evidence.
- A Server Action that takes the ID of a token or grant is called with the ID of another user's object on a local
  server, and the answer is noted as evidence.

## Browser security: headers, CSRF, caching and data sent to the client

### Goal

A browser cannot be made to act for a logged-in user, every response carries the security headers it needs, no
sensitive answer is cached where it should not be, and no private data reaches the browser that the page does not
show.

### Build

Review `next.config.ts`, `src/proxy.ts`, `src/app/layout.tsx`, the error pages `src/app/error.tsx`,
`src/app/global-error.tsx` and `src/app/not-found.tsx`, every `"use client"` file, every `"use server"` file, the
route handlers, `src/features/oauth/components/` and `src/features/pages/components/MarkdownContent.tsx`, against
"Security headers" in `architecture.md` and the Next.js guides `data-security.md` and `self-hosting.md`. Questions:

- CSRF: Server Actions compare the `Origin` with the `Host` or `X-Forwarded-Host`. Does this hold behind the reverse
  proxy, and is `serverActions.allowedOrigins` needed or set too wide? Do the consent form and the POST route
  handlers (`/oauth/token`, `/oauth/register`, `/mcp`) rely on something a page of another site cannot send (ASVS
  3.5.1–3.5.3, `CON.10.A15`, NIST SP 800-63B-4 5.1, CWE-352)?
- Clickjacking: does the consent page resist being framed (`frame-ancestors`, ASVS 3.4.6, CWE-1021)?
- Do the security headers reach every response: pages, redirects of the proxy, RSC payloads, Server Action answers,
  route handlers, error pages and static files (ASVS 3.4.1, 3.4.4–3.4.6, `CON.10.A14`, `APP.3.1.A21`)?
- Content Security Policy: is it as strict as the app allows? ASVS 3.4.3 asks for a rule for scripts (nonces or
  hashes) and `base-uri 'none'`; the policy has neither now. What would nonces cost with Material UI and Next.js? CSP
  reporting and `Cross-Origin-Opener-Policy` are Level 3 (ASVS 3.4.7, 3.4.8) and only a suggestion.
- Do the JSON answers (`/api/health`, `/mcp`, `/oauth/*`, `/.well-known/*`) have a `Content-Type` with charset and
  `nosniff`, so that a browser never renders them as a page (ASVS 3.2.1, 4.1.1)?
- Caching: do authenticated pages, Server Action answers, the token endpoint and MCP answers send
  `Cache-Control: no-store` (ASVS 14.3.2, `CON.10.A7`, `CON.10.A14`)? Can data of one user end up in the Next.js
  cache or a shared cache and be served to another (ASVS 14.2.2, 14.2.5)? What stays in the client router cache and
  the page after a logout (ASVS 14.3.1)?
- CORS: do `/mcp`, `/oauth/*` and `/.well-known/*` answer without CORS headers or with a fixed list, never with the
  `Origin` of the request reflected (ASVS 3.4.2, CWE-942)?
- Data sent to the client: what do pages pass to Client Components, and what do Server Actions return? Only the
  fields the page shows (a DTO), never a whole record with a password hash, token hash, `mustChangePassword` or
  internal IDs (ASVS 15.3.1, Next.js `data-security.md`)? Do the modules that read the database or secrets import
  `server-only`?
- Do links from Markdown that open a new window carry `rel="noopener noreferrer"` (CWE-1022), and does the
  `Referrer-Policy` keep page addresses on this site?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- A protected page, a JSON route, an error page, a redirect of the proxy and a Server Action answer are fetched with
  `curl -i` from a local server, and their headers are noted as evidence.
- The RSC payload of a page that shows users or tokens is read on a local server and checked for fields the page does
  not show; the result is noted as evidence.
- A Server Action is called with a foreign `Origin` on a local server, and the answer is noted as evidence.

## Login, passwords, sessions and users

### Goal

The login cannot be bypassed or guessed, the password rules follow NIST SP 800-63B-4 and ASVS, sessions are safe, and
the user management does what `users-and-login.md` promises.

### Build

Review `src/features/auth/`, `src/features/users/`, `src/lib/password-hash.ts`, `src/lib/client-address.ts`,
`src/lib/client-address-probe.ts`, `src/lib/auth.ts`, `scripts/admin.ts`, `prisma/seed.ts`,
`prisma/known-users.ts`, against `users-and-login.md`. Questions:

- Hashing: are the Argon2id parameters at least the minimum of the OWASP Password Storage Cheat Sheet? TR-02102-1
  (appendix B.1.2) names Argon2id but sets no parameters, so the report says which source the parameters are justified
  by. Is the salt random and at least 32 bits, and are the parameters stored in each hash so that they can be raised
  later (NIST SP 800-63B-4 3.1.1.2, ASVS 11.4.2)? Is the verification done in constant time, with a dummy check for
  unknown user names so that the answer time does not show which names exist?
- Do the login answers and the creation of users reveal which user names exist, in message, status or timing (ASVS
  6.3.8, CWE-204)?
- Password length: NIST SP 800-63B-4 (3.1.1.2) requires at least 15 characters when the password is the only
  factor, ASVS 6.2.1 at least 8. Which minimum does the code use, and does a spec give the reason? Are at least 64
  characters accepted (ASVS 6.2.9), and is the length counted the same way on every path?
- Blocklist: is every new password, also the initial one and the forced change, checked against a list of common and
  breached passwords and against context words such as the user name and the name of the wiki (ASVS 6.2.4, 6.2.11,
  6.2.12, NIST 3.1.1.2)? No composition rules (ASVS 6.2.5)?
- Unicode: is the password used exactly as typed, the same way when it is set and when it is checked, and does a spec
  say whether NFC normalization is applied (NIST 3.1.1.2, ASVS 6.2.8)?
- Do the password fields allow paste and password managers, with the right `autocomplete` values (ASVS 6.2.7)? Does
  every change of a password require the current one (ASVS 6.2.3, `CON.10.A12`)?
- Initial passwords: does the admin choose the password of a new user, or does the system generate it? NIST
  (3.1.1.1) allows only a password the user chose or a random one, and ASVS 6.4.1 and 6.4.6 ask that the admin does
  not know the final password.
- Failed logins: can the wait per user name and client address group or the hour window be bypassed (other spelling
  or case of the name, forged forwarding headers with `HIPPOWIKI_TRUSTED_PROXIES`, IPv6 addresses, many logins at
  once)? Is there a limit of at most 100 consecutive failures per account across all addresses (NIST 3.2.2), and is
  the count reset after a successful login? Can an attacker lock out a known user on purpose, and how long (ASVS
  6.1.1, 6.3.1, CWE-307)?
- Sessions: is the session ID random with at least 128 bits (ASVS 7.2.3), and is a new one issued at the login and at
  the forced password change (ASVS 7.2.4, `CON.10.A3`)? Cookie flags `Secure`, `HttpOnly`, `SameSite` and the
  `__Host-` prefix (ASVS 3.3.1–3.3.4, NIST 5.1.1)?
- Lifetime: is the absolute lifetime at most 30 days (NIST 2.1.3)? Is there an inactivity timeout (ASVS 7.3.1,
  `CON.10.A3`)? Is the number of sessions per user and what happens at the limit documented (ASVS 7.1.2)?
- Ending sessions: what do a logout, a password change and the removal of a user end (sessions, API tokens, grants;
  ASVS 7.4.1, 7.4.2)? Can a user see their sessions and end them, and end all other sessions after a password change
  (ASVS 7.5.2, 7.4.3)? Can an admin end the sessions of a user (ASVS 7.4.5)? Does the forced password change really
  block everything else?
- Better Auth: are only the endpoints switched on that the app uses? Is its secret required and long enough? Is
  there a login path the specs do not describe (ASVS 6.3.4)?
- Admin setup: can it run twice, overwrite an admin, or print a password into a log? Is there any default account or
  default password (ASVS 6.3.2, CWE-798)?
- Seed data and known users: can test accounts reach a production database?
- Second factor and notifications: the app has no second factor (ASVS 6.3.3, `CON.10.A16`) and does not tell a user
  that their password was reset (`CON.10.A1`, ASVS 6.3.7). Does a spec document both as decisions? If so, they go to
  "Accepted deviations"; if not, they are findings.
- The password hash limiter: does it protect the server from a burst of logins without letting an attacker block all
  logins (`CON.10.A17`, ASVS 15.2.2, CWE-770)?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The answers to a login with an unknown name and with a wrong password for a known name are compared on a local
  server (message and rough timing), and the result is noted as evidence.
- Passwords of 8, 15, 64 and 129 characters, a common password and the user name are tried as a new password on a
  local server, and the answers are noted as evidence.

## API tokens

### Goal

API tokens can only be used by their owner, only within their scope and lifetime, and cannot be read back from the
database or the logs.

### Build

Review `src/features/tokens/` (`service.ts`, `secret.ts`, `schema.ts`, `actions.ts`, `queries.ts`, the components)
and `src/app/account/page.tsx`, against `api-tokens.md`. Questions:

- Is the token random enough, stored only as a hash, compared without a timing leak, and shown exactly once (ASVS
  7.2.3, 11.5.1, TR-02102-1 chapter 4 for SHA-256)?
- Is the prefix `hw_` or any other part of the token stored or logged in a way that helps an attacker? Does the prefix
  let secret scanners find leaked tokens?
- The check of a bearer token: are an expired, revoked, unknown and badly formed token all refused, with the codes
  the spec gives? Is the expiry checked on every use (ASVS 9.2.1)? Is the scope checked on every use, and the user
  (still existing, password change forced)?
- Token types: can a refresh token, an authorization code or a session cookie ever be used where an access token or
  an API token is expected, or the other way round (ASVS 9.2.2)?
- Can a user see, revoke or use a token or a grant of another user, by changing an ID in an action (ASVS 8.2.2)?
- Can a token appear in a URL, a log line, an error message or a page after its creation (ASVS 14.2.1, OWASP MCP01)?
- The limit per user: does it hold when tokens are created at the same time?
- What happens to tokens and grants when a user's password changes or a user is removed (ASVS 7.4.2)?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- `/mcp` is called on a local server with a valid, an expired, a revoked and a forged token, and with a refresh token
  in place of an access token, and the answers are noted as evidence.

## OAuth

### Goal

The OAuth server, written without a library, follows the OAuth and MCP security rules and ASVS chapter 10, and no
client can get a token the user did not approve.

### Build

Review `src/features/oauth/` (`service.ts`, `http.ts`, `schema.ts`, `metadata-fetch.ts`, `public-address.ts`,
`issuer.ts`, `secret.ts`, `actions.ts`, `queries.ts`, `forms.ts`, the components), `src/app/oauth/`,
`src/app/.well-known/`, against `oauth.md` and the standards named in "Rules for the review". Questions:

- Redirect addresses: exact match against the registered ones, no partial or prefix match, only `https` or loopback,
  no fragments; is an error with a wrong redirect address shown to the user instead of sent to it (ASVS 10.4.1)?
- PKCE: required for every client, only `S256`, no default to `plain` when the method is missing, checked at the
  token endpoint against the code (ASVS 10.4.6, RFC 7636).
- Codes: single use, a lifetime of at most 10 minutes, bound to the client, the redirect address, the user and the
  resource; are the tokens issued with a code revoked when the code is used twice (ASVS 10.4.2, 10.4.3)?
- Grant types: are only `authorization_code` and `refresh_token` accepted and advertised (ASVS 10.4.4)?
- Refresh with rotation: is the old refresh token refused after use, and does the reuse of an old one revoke the
  grant? Is the rotation safe against two refreshes at the same time? Do refresh tokens have an absolute expiry
  (ASVS 10.4.5, 10.4.8)?
- Scopes and the resource (audience): can a client ask for more than the user approved, or use a token for another
  resource? Is the `resource` parameter of the authorization and the token request checked, and the token bound to it
  (RFC 8707, ASVS 10.4.11)?
- The `iss` parameter: the metadata advertises it; is it sent in every authorization response, also in error
  responses (RFC 9207)?
- The consent page: is consent asked for every request, with no silent approval for clients whose identity is not
  verified (ASVS 10.7.1)? Does it show who the client is in a way that cannot be faked (name, address of the metadata
  document, the host of the redirect address), the scopes, the resource and the lifetime (ASVS 10.7.2)? Does it warn
  for a redirect address only on `localhost` and for clients that are not verified? Are client names and addresses
  shown as text, with links only to `http` and `https`? Is the approval bound to the request it was shown for
  (`state`, a CSRF check)?
- Client ID metadata documents and `metadata-fetch.ts`:
  - Does the `client_id` in the document equal its address exactly, and are `client_name` and `redirect_uris`
    required? Is the document cached by its HTTP cache headers, with an upper limit?
  - SSRF: private, loopback, link-local and IPv6 addresses, IPv4-mapped IPv6 addresses and numeric host forms, DNS
    rebinding, redirects (not followed, or each hop checked again; ASVS 15.3.2), size and time limits, content type.
    Is the check an allowlist of scheme, port and address kind rather than only a list of blocked ranges (ASVS 1.3.6,
    CWE-918)? Do the check and the fetch parse the address the same way (ASVS 1.5.3)?
  - Prototype pollution: are keys such as `__proto__` and `constructor` in a document or a registration harmless
    (ASVS 15.3.6, CWE-1321)?
- Dynamic registration: its limit per client address, the fields it accepts, and whether a registered client can
  pretend to be another one. The MCP specification of 2026-07-28 keeps it only for backward compatibility: should it
  stay switched on (a `question:`)?
- The token endpoint: client authentication where a secret exists, error answers (RFC 6749 codes, no stack traces),
  `Cache-Control: no-store`.
- Secrets: random enough, stored as hashes, compared without timing leaks (ASVS 11.2.4, 11.5.1).
- Discovery: do the metadata documents match what the endpoints really do? Is the issuer taken from
  `HIPPOWIKI_PUBLIC_URL` and never from the `Host` header of a request?
- Revoking a grant on `/account`: are all its access and refresh tokens dead at once (ASVS 10.4.9, 10.7.3)?
- Pushed authorization requests and sender-constrained tokens (ASVS 10.4.13, 10.4.14) are Level 3: they are named
  only as a suggestion or an accepted deviation.

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The flow is run on a local server with `HIPPOWIKI_PUBLIC_URL` set: registration, authorization with PKCE, the
  token exchange, a second use of the code, a refresh and a second use of the old refresh token, a wrong redirect
  address, a wrong `code_verifier`, a missing `code_challenge_method` and a wrong `resource`; the answers, including
  the `iss` parameter, are noted as evidence. A metadata document address that points to `localhost`, a private
  address, an IPv4-mapped IPv6 address and an address that redirects is tried and must be refused.

## MCP server

### Goal

The MCP endpoint only answers with valid tokens, follows the transport and authorization rules of the MCP
specification, shows only what a logged-in user may read, handles bad input safely, and the review says what wiki
content can do to an agent that reads it.

### Build

Review `src/features/mcp/` (`http.ts`, `tools.ts`) and `src/app/mcp/route.ts`, against `mcp.md`, the MCP
specification of 2026-07-28 and the OWASP MCP Top 10. Questions:

- Which revision of the MCP specification does `mcp.md` target, and what does the installed MCP package support?
- Does every request check the token (API token or OAuth access token) before any tool runs, and is a token for
  another resource refused (OWASP MCP07, ASVS 10.3.1, 10.3.2)? Are the status codes those of the specification (401
  for a missing or invalid token, 403 for a missing scope, 400 for a bad request)?
- Is the `WWW-Authenticate` answer correct for a request without a token, with a wrong one and with too few scopes:
  `resource_metadata` with the address of the protected resource metadata, and `scope`? Does `scopes_supported` leave
  out `offline_access`?
- Transport of the 2026-07-28 revision: are `MCP-Protocol-Version` and `Mcp-Method` required on every request, and
  `Mcp-Name` on `tools/call`, with 400 and code `-32020` when a header is missing or does not match the body? Is an
  unsupported version answered with the list of supported ones? Are `GET` and `DELETE` answered with 405, and is
  `Mcp-Session-Id` ignored?
- Origin checks: is a request with a foreign `Origin` refused with 403?
- Are the tool arguments validated by the name rule before they reach a service (OWASP MCP05)? Are deleted pages never
  listed or read?
- Do tool errors leak internal details (stack traces, SQL, file paths)?
- Size of answers and requests: can a large page, a large folder or a large request body tie up the server (ASVS
  15.2.2, CWE-770)?
- OWASP MCP Top 10, item by item: secrets in answers and logs (MCP01), minimal scopes (MCP02), tool names and
  descriptions fixed in the code and never built from wiki content (MCP03), audit of tool calls by token ID (MCP08),
  and that a grant reaches every folder the user can read (MCP10). Items that do not apply (for example shadow
  servers, MCP09) are named under "Reviewed" with the reason.
- Prompt injection (OWASP MCP06, LLM01): page content, titles and names are written by any user and reach the model
  of another user's client. How does `read_page` return content: is the text of the user kept apart from the text of
  the server, so that a client can tell them apart? What can the server do, and what is left to the client?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The three tools are called on a local server with a valid token, with a name that breaks the name rule and with
  the name of a deleted page, and the answers are noted as evidence.
- Requests without the MCP headers, with a header that does not match the body, with an unsupported protocol version,
  with `GET` and with `DELETE` are sent to a local server, and the answers are noted as evidence.
- A page with instructions aimed at a model is read through `read_page` on a local server, and the shape of the answer
  is noted as evidence.

## Content: pages, folders, tabs, deletion and rendering

### Goal

The content features keep data consistent, cannot inject script into a page, and do what their specs promise.

### Build

Review `src/features/pages/`, `src/features/folders/`, `src/lib/names.ts`, `src/lib/addresses.ts`,
`src/lib/db-errors.ts`, `src/lib/revalidate.ts`, the pages under `src/app/folders/` and `src/app/deleted-pages/`,
against `pages.md`, `content-structure.md` and `page-deletion.md`. Questions:

- Markdown rendering (`MarkdownContent.tsx`): raw HTML, `javascript:` and `data:` links, images, and any other way
  to run script or load content from other sites. Is the URL transform of `react-markdown` left on, and is no plugin
  added that passes raw HTML through (ASVS 1.2.2, 1.3.5, `CON.10.A8`, CWE-79)?
- Regular expressions: can a name, a Markdown text or an address make a pattern run for a long time (ASVS 1.3.12,
  CWE-1333)?
- Names and addresses: can a name break the name rule after a rename or move, collide with a reserved address, or
  differ only in Unicode look-alikes?
- Concurrent writes: two users creating, renaming, moving, deleting or restoring the same item at once; do the
  unique constraints and transactions keep the data consistent, is no rule checked first and written later without a
  constraint, and are the errors shown well (ASVS 2.3.3, 2.3.4, 15.4.2)?
- Deleted pages: invisible everywhere (lists, page view, all pages, MCP), restore into a place that is taken now.
- Limits: content size and the number of items, whether a spec documents them, and what happens when they are
  exceeded (ASVS 2.1.3, 2.3.2).
- The last editor: is it always the user of the session, never a value from the form?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- A page with script in raw HTML, a `javascript:` link, a `data:` link and an image from another site is saved on a
  local server, and the rendered HTML is noted as evidence.

## Logging, errors and failure handling

### Goal

Security events are logged without secrets, errors reveal nothing and leave the data consistent, and no failure lets a
request through that a check should stop.

### Build

Review `src/lib/logger.ts`, `src/lib/result.ts`, `src/lib/db-errors.ts`, the error pages, the error answers of
`src/features/oauth/http.ts`, `src/features/mcp/http.ts` and the route handlers, and every `catch` in `src/` and
`scripts/`, against "Validation and errors" in `architecture.md`, the BSI module OPS.1.1.5 and ASVS chapter 16.
Questions:

- Which security events are logged, each with who, what, when and where: logins and failed logins, waits after failed
  logins, failed authorization, rejected input, rejected metadata fetches, client registrations, consent given and
  revoked, tokens created and revoked, the reuse of an old refresh token, admin actions, MCP tool calls by token ID
  (ASVS 16.2.1, 16.3.1–16.3.4, A09, `OPS.1.1.5.A3`, OWASP MCP08, CWE-778)?
- Can a password, token, code, `code_verifier`, cookie or `Authorization` header end up in a log line, also through
  an error object or a request that is logged as a whole? Does `src/lib/logger.ts` need a redaction list (ASVS
  16.2.5, CWE-532)?
- Log injection: are user names, client names, page names and forwarded headers written as JSON fields, never into
  the message text (ASVS 16.4.1, CWE-117)?
- Do the timestamps carry UTC or an offset (ASVS 16.2.2, `OPS.1.1.5.A4`)?
- Failing closed: does any `catch` around a check of a login, a token, a scope, the metadata fetch guard or the wait
  after failed logins end in "allow"? Does an error of the database or of the hash function count as a failed check
  (ASVS 16.5.3, A10, CWE-636)?
- Do error answers of pages, Server Actions, JSON-RPC and OAuth stay generic, without stack traces, SQL, Prisma
  messages or file paths (ASVS 16.5.1, `CON.10.A10`, CWE-209)? Are database errors mapped as `architecture.md`
  says, and do unknown errors reach the error page without details?
- When the database or a host of a metadata document fails, does the app stay consistent and answer clearly (ASVS
  16.5.2, `CON.10.A13`)? Is the `Result` type used consistently, with no swallowed errors?
- Is there a last resort for unhandled errors and rejected promises, so that details reach the log and not the client
  (ASVS 16.5.4, CWE-248)?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- A failed login, a forged token and a refused metadata document address are tried on a local server, and the log
  lines they write are noted as evidence. A database that is stopped during a request is tried if it is simple with the
  throwaway database container; otherwise this is noted as not checked.

## Configuration and container image

### Goal

The configuration refuses unsafe values, the trust in the reverse proxy cannot be abused, and the image adds no
weakness of its own.

### Build

Review `Containerfile`, `.containerignore`, `scripts/` (`image-start.sh`, `image-migrate.sh`, `image-admin.sh`,
`image.sh`, `db.sh`), `src/lib/env.ts`, `src/lib/client-address.ts`, `src/app/api/health/route.ts`,
`next.config.ts`, against `container-image.md`, `tech.md`, the BSI module SYS.1.6 and the Next.js guides
`self-hosting.md` and `production-checklist.md`. Questions:

- The image: base image pinned and trusted (`SYS.1.6.A6`), runs as a user other than root (`SYS.1.6.A17`), the server
  files owned by root and not writable, no secrets, dev tools, `.git`, source maps or `.env` files in the layers
  (ASVS 13.3.1, 13.4.1, 13.4.7, `SYS.1.6.A8`), one service and no remote access (`SYS.1.6.A11`, `SYS.1.6.A16`),
  only the needed port. Could the server run on a read-only root file system (`SYS.1.6.A23`)?
- The start: the migration runs before the server and stops the start on failure; the scripts quote their variables
  and fail on errors.
- Configuration: does `env.ts` refuse missing or weak secrets and invalid URLs at start? Do the trusted proxies and
  the public URL have safe defaults?
- Trusted proxies: can a client set a forwarding header that the app takes for the client address or the scheme, when
  the request does not come through a trusted proxy (ASVS 4.1.3, 15.3.4, CWE-290, CWE-291)?
- Several instances: does the app need `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` or other shared values when it runs more
  than once behind the proxy, and does `container-image.md` say so?
- Does `/api/health` reveal nothing beyond up or down, and do the answers name no versions (ASVS 13.4.5, 13.4.6)?
- The database: does the server run with a role that cannot change the schema, separate from the migration, and can
  the connection use TLS (ASVS 13.2.2, 12.3.1, `APP.3.1.A11`)?
- What only the deployment can show (the reverse proxy and its TLS settings by TR-02102-2, the host, the network,
  resource limits of the container) goes to "Checks on the deployment".

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- A request with a forged `X-Forwarded-For` is sent to a local server that trusts no proxy, and the client address the
  app uses is noted as evidence.
- If Podman is available, the image is built with `npm run image:build` and its user, file owners and contents (no
  `.git`, `.env` or source maps) are checked; otherwise this goes to "Checks on the deployment".

## Supply chain: dependencies, CI and release

### Goal

The dependencies, the CI workflows and the release add no weakness of their own, and the project meets the
repository-level rules for open-source software of BSI TR-03185.

### Build

Review `.github/workflows/`, `.github/dependabot.yml`, `package.json`, `package-lock.json`, `.npmrc`, `LICENSE`,
`README.md` and the installed dependencies, against `container-image.md`, `tech.md`, the OWASP Top 10:2025 category
A03 and BSI TR-03185 part 2. Questions:

- CI: the permissions of each workflow and job (least privilege), actions pinned to a full commit SHA instead of a
  tag, no `pull_request_target` with code of the pull request, no caches that a pull request can write and a release
  then reads, no secrets in pull requests from forks, how the release workflow uses its token (A03, A08, CWE-829).
- Installs: does CI and the image install with `npm ci` from the lockfile? Which dependencies run install scripts?
  Do the signatures of the registry check out (`npm audit signatures`)?
- Dependencies: `npm audit` findings, packages that are no longer maintained, packages in `dependencies` that only
  the build needs. Is there a rule for how fast vulnerable dependencies are fixed (ASVS 15.1.1, 15.2.1)? How does
  Dependabot cover npm, the actions and the base image?
- The release: is the published image signed, does it carry provenance, can a user check its integrity
  (`SYS.1.6.A12`, TR-03185 BR.03)?
- SBOM: is there a list of the third-party components (ASVS 15.1.2, TR-03185 QA.01)? An SBOM by TR-03183-2 would be
  CycloneDX 1.6 or SPDX 3.0.1 with the transitive dependencies; this is a suggestion, not a requirement for this
  project.
- BSI TR-03185 part 2: a security contact and a private way to report vulnerabilities (VM.01; there is no
  `SECURITY.md`), licences (LE.01, LE.02), how to contribute (GV.01), build instructions (BR.01), release versions
  and a changelog with the security changes of each release (BR.02, BR.04), review of every change (QA.06).

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The output of `npm audit` and `npm audit signatures` is summed up as evidence. If a vulnerability scanner is already
  installed, the image is scanned and the result summed up; otherwise this goes to "Checks on the deployment".

## Cross-cutting: data model, architecture, documentation and tests

### Goal

The code as a whole is consistent, keeps the conventions of `architecture.md` and `testing.md`, its tests cover the
rules that matter for security, and the specs document what ASVS Level 2 asks to be documented.

### Build

Review `prisma/schema.prisma` and `prisma/migrations/`, `src/lib/`, the layering of all features, the tests under
`src/`, `integration/` and `e2e/`, and the feature specs. Questions:

- Data model: unique constraints and indexes for every rule that needs them, `onDelete` behaviour, secrets stored
  only as hashes, migrations that match the schema.
- Architecture: do the layers stay apart as `architecture.md` and the lint rules say? Duplicated code across
  features (for example the secret helpers of tokens and OAuth), dead code, overly long functions such as in
  `src/features/oauth/service.ts`. Strict comparisons and types, no type juggling (ASVS 15.3.5).
- Cryptography: is there an inventory of the algorithms, secrets and keys the app uses, and of how the secrets are
  set, rotated and replaced (ASVS 11.1.1, 11.1.2, 13.1.4)? Do they meet TR-02102-1 (at least 120 bits of security,
  hash functions from its table 4.1)? A missing inventory is a candidate for a spec.
- Documentation that ASVS Level 2 asks for: the waits after failed logins and why they cannot lock out a user (6.1.1),
  the session lifetimes and limits (7.1.1, 7.1.2), the limits of content and actions (2.1.3), the functions that need
  much time or memory and how they are protected (15.1.3), every outgoing connection including the metadata fetch
  (13.1.1), the logging (16.1.1), and the architecture with the place of each security mechanism (`CON.10.A11`).
  Which of these do the specs miss?
- Tests: run `npm run test:coverage` and name the security rules of the feature specs that no test checks (unit,
  integration or end-to-end). Note flaky or slow tests seen in the runs of this plan.
- Specs: rules in the feature specs that the code does not keep, and specs that restate code, constants or
  messages.

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The coverage summary of `npm run test:coverage` is noted as evidence.

## Standards cross-check

### Goal

Every requirement of the named standards that applies to the project has a result in the report, and the report says
which parts of the standards do not apply and why.

### Build

- Go through ASVS 5.0.0 Level 2 chapter by chapter, the BSI modules CON.10 and APP.3.1, the requirements of SYS.1.6
  and OPS.1.1.5 that concern the code or the repository, the OWASP Top 10:2025, the entries of the CWE Top 25 2025
  that apply, and the OWASP MCP Top 10.
- Map each applicable requirement to one result: a finding, an entry under "Reviewed" of an area, an entry in
  "Accepted deviations", or an entry in "Checks on the deployment". A requirement without a result is checked now and
  added to the area it belongs to.
- Write "Standards coverage": for each standard, its chapters or groups with the area of the report that covers them,
  and the groups that do not apply, each with a one-line reason (for example OpenID Connect and ID tokens, signed
  tokens such as JWT, GraphQL, WebSockets, file uploads, XML, the memory-safety entries of the CWE Top 25, and the
  operational requirements of the BSI modules).

### Test

- `npm run check` passes.
- No applicable ASVS 5.0.0 Level 2 requirement and no applicable requirement of CON.10 and APP.3.1 is without a
  result.
- Every finding added in this step has its standard IDs in its Reference.

## Summary and final check of the report

### Goal

The report is complete, consistent and ready for a fix plan.

### Build

- Write "Summary": the overall verdict, the number of findings per severity and the number of accepted deviations,
  the three to five findings to fix first with their standard IDs, and what the review did not cover.
- Order the findings in each area from Blocker to Nit; merge findings that turned out to be the same problem;
  move findings that need the deployment to "Checks on the deployment" with how to check them.
- Go through the checklist in `issue-report.md` for every finding and fix the report where it fails.

### Test

- `npm run check` passes.
- Every item of the checklist in `issue-report.md` holds for the report.
- The counts in "Summary" match the findings and the accepted deviations.
- `git status` shows changes only in `spec/` and `CLAUDE.md` for the whole plan.

## Wrap-up

### Goal

Remove the plan; the report stays.

### Build

1. No feature spec is written: the report `spec/review-report.md` is the lasting result. It stays in the spec
   catalog in `CLAUDE.md` with a short description until a fix plan works its findings off.
2. Nothing is removed from `roadmap.md`, because the review is not on it. Add the items of "Checks on the
   deployment" of the report to "Things to Check" in `roadmap.md`, with a pointer to the report.
3. `README.md` needs no new command.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: remove this step file.

### Test

- `npm run check` passes (documentation only, see "Changes to documentation only" in `spec/workflow.md`).
