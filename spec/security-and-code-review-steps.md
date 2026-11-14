# Security and Code Review – Steps

## Goal

Review the whole project for security holes and code defects, and write the findings into one report,
`spec/review-report.md`, in the format of `issue-report.md`. The review changes no code. A later step plan fixes the
findings that the user chooses.

## Scope

- In: all of `src/` (without `src/generated/`), `prisma/` with its schema and migrations, `scripts/`, `Containerfile`,
  `next.config.ts`, `.github/` with the workflows and Dependabot, `package.json` and the installed dependencies, and
  the feature specs as the rules the code is checked against. API tokens, OAuth and MCP are reviewed in the most
  depth because no review has seen them yet.
- In: evidence from reading the code, from running the existing commands (`npm run check`, `npm run test:coverage`,
  `npm run test:integration`, `npm run test:e2e`, `npm audit`), and from requests to a local server (`npm run dev`
  against the database of `npm run db:up`, or the image of `npm run image:build`) sent with `curl`. Throwaway probe
  scripts go to a temporary directory outside the repository and are never committed.
- Not in: any change to code, tests, configuration, migrations, `README.md` or a spec other than
  `spec/review-report.md`, this step file and the catalog in `CLAUDE.md`. A finding that needs a fix describes the
  fix in its Suggestion, with a snippet if useful.
- Not in: tests or requests against the deployment or any host other than `localhost`. What can only be checked
  there goes to the report section "Checks on the deployment".
- Not in: upgrading packages, and the Git history (see "Git Handling" in `CLAUDE.md`).

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
- Standards to check against, named as Reference where they apply: OWASP ASVS and the OWASP Top 10, the OAuth 2.0
  Security Best Current Practice (RFC 9700), OAuth 2.1, RFC 7636 (PKCE), RFC 8414 (authorization server metadata),
  RFC 9728 (protected resource metadata), RFC 7591 (dynamic registration), the OAuth client ID metadata document
  draft, the authorization part of the MCP specification, and the security notes of Next.js in
  `node_modules/next/dist/docs/` (Server Actions, the proxy, data security).
- Each area of the report ends with "Reviewed": the files that were read and the questions of the step that found
  nothing. This shows what the review covered, not only what it found.
- Good solutions go to "What is good", with their location.
- Each step adds only its own area to the report. The summary is written in the last review step.

## Checklist

- [ ] Report outline and threat model
- [ ] Access control and the entry points of requests
- [ ] Login, passwords, sessions and users
- [ ] API tokens
- [ ] OAuth
- [ ] MCP server
- [ ] Content: pages, folders, tabs, deletion and rendering
- [ ] Container image, scripts, CI and dependencies
- [ ] Cross-cutting: data model, architecture, error handling, logging and tests
- [ ] Summary and final check of the report
- [ ] Wrap-up

## Report outline and threat model

### Goal

The report file exists with its structure and a threat model that the later steps check the code against.

### Build

- Create `spec/review-report.md` with these sections: "Summary" (left to the last review step), "Scope and method",
  "Threat model", "Findings" with one subsection per area of the checklist, "What is good", "Checks on the
  deployment" and "Open questions".
- "Scope and method": what is reviewed, the date, how evidence was collected, the severity scale of
  `issue-report.md`.
- "Threat model":
  - Assets: page content, accounts and password hashes, sessions, API tokens, OAuth codes, access and refresh tokens,
    client registrations, the secrets in the environment.
  - Actors: someone without a login on the internet, a logged-in user, an admin, an MCP client with a token or an
    OAuth grant, a malicious OAuth client or metadata document, someone with access to the logs or the database
    backup.
  - Entry points: every public address of the `matcher` in `src/proxy.ts` (`/login`, `/api/health`, `/mcp`,
    `/.well-known/…`, `/oauth/register`, `/oauth/token`), every page, every Server Action, every route handler, the
    admin setup command and the start of the container image.
  - Trust boundaries: the reverse proxy and its forwarding headers, the public URL, the database.
- Add `spec/review-report.md` to the spec catalog in `CLAUDE.md`.

### Test

- `npm run check` passes.
- Every entry point of the app appears in the threat model: compare it with the files under `src/app/`, the
  `"use server"` files and the `matcher` in `src/proxy.ts`.

## Access control and the entry points of requests

### Goal

Every request that reads or changes data is checked for a valid login or token, and the public addresses expose
nothing more than they should.

### Build

Review `src/proxy.ts`, `src/features/auth/session.ts`, `src/lib/auth.ts`, `src/lib/addresses.ts`,
`next.config.ts`, every `actions.ts` and `queries.ts` under `src/features/`, every `page.tsx` and `route.ts` under
`src/app/`, against "Login and sessions", "Security headers" and "Addresses and actions" in `architecture.md`.
Questions:

- Does every page, query and Server Action call `requireUser()` (or the admin check) before it touches data, also
  the ones that only read? Is there a path that reaches a service without it?
- Is the `matcher` of the proxy exactly the list of public addresses, without a pattern that lets more through?
- Do the admin-only actions (users) check the admin role on the server, not only by hiding a button?
- Can a Server Action be called with arguments that the form never sends (other folder, other page, other user's
  token or grant)? Is every argument validated with Zod on the server?
- CSRF: do Server Actions and the route handlers that accept POST (`/oauth/token`, `/oauth/register`, `/mcp`) rely
  on something a browser of another site cannot send? Does the consent page resist being framed (clickjacking)?
- Do the security headers in `next.config.ts` cover every response, the error pages and the route handlers too, and
  is the Content Security Policy as strict as the app allows?
- Open redirects: can the way back after a login (`next`) or any other redirect lead to another site?
- Do error pages, the `not-found` page or error messages leak whether a folder, page, user or token exists to
  someone who may not see it?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The public addresses are tried without a cookie against a local server; a protected page, a Server Action and the
  image optimizer are tried without a cookie too, and the answers are noted as evidence.

## Login, passwords, sessions and users

### Goal

The login cannot be bypassed or guessed, sessions are safe, and the user management does what `users-and-login.md`
promises.

### Build

Review `src/features/auth/`, `src/features/users/`, `src/lib/password-hash.ts`, `src/lib/client-address.ts`,
`src/lib/client-address-probe.ts`, `src/lib/auth.ts`, `scripts/admin.ts`, `prisma/seed.ts`,
`prisma/known-users.ts`, against `users-and-login.md`. Questions:

- Hashing: Argon2id parameters, verification in constant time, a dummy check for unknown user names so that the
  answer time does not show which names exist.
- Do the login answers and the creation of users reveal which user names exist?
- Failed logins: can the wait per user name and client address group or the hour window be bypassed (other
  spelling or case of the name, forged forwarding headers with `HIPPOWIKI_TRUSTED_PROXIES`, IPv6 addresses, many
  logins at once)? Can an attacker lock out a known user on purpose, and how long?
- Sessions: cookie flags (`HttpOnly`, `Secure`, `SameSite`), lifetime, renewal, what a logout and a password change
  end; does the forced password change really block everything else?
- Better Auth: are only the endpoints switched on that the app uses? Is its secret required and long enough?
- Admin setup: can it run twice, overwrite an admin, or print a password into a log?
- Seed data and known users: can test accounts reach a production database?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The answers to a login with an unknown name and with a wrong password for a known name are compared on a local
  server (message and rough timing), and the result is noted as evidence.

## API tokens

### Goal

API tokens can only be used by their owner, only within their scope and lifetime, and cannot be read back from the
database or the logs.

### Build

Review `src/features/tokens/` (`service.ts`, `secret.ts`, `schema.ts`, `actions.ts`, `queries.ts`, the components)
and `src/app/account/page.tsx`, against `api-tokens.md`. Questions:

- Is the token random enough, stored only as a hash, compared without a timing leak, and shown exactly once?
- Is the prefix `hw_` or any other part of the token stored or logged in a way that helps an attacker?
- The check of a bearer token: are an expired, revoked, unknown and badly formed token all refused, with the codes
  the spec gives? Is the scope checked on every use, and the user (still existing, password change forced)?
- Can a user see, revoke or use a token or a grant of another user, by changing an ID in an action?
- The limit per user: does it hold when tokens are created at the same time?
- What happens to tokens and grants when a user's password changes or a user is removed?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- `/mcp` is called on a local server with a valid, an expired, a revoked and a forged token, and the answers are
  noted as evidence.

## OAuth

### Goal

The OAuth server, written without a library, follows the OAuth and MCP security rules, and no client can get a token
the user did not approve.

### Build

Review `src/features/oauth/` (`service.ts`, `http.ts`, `schema.ts`, `metadata-fetch.ts`, `public-address.ts`,
`issuer.ts`, `secret.ts`, `actions.ts`, `queries.ts`, `forms.ts`, the components), `src/app/oauth/`,
`src/app/.well-known/`, against `oauth.md` and the standards named in "Rules for the review". Questions:

- Redirect addresses: exact match against the registered ones, no partial or prefix match, only `https` or loopback,
  no fragments; is an error with a wrong redirect address shown to the user instead of sent to it?
- PKCE: required for every client, only `S256`, checked at the token endpoint against the code.
- Codes: single use, short lifetime, bound to the client, the redirect address, the user and the resource; what
  happens when a code is used twice (are the tokens issued with it revoked)?
- Refresh with rotation: is the old refresh token refused after use, and does the reuse of an old one revoke the
  grant? Is the rotation safe against two refreshes at the same time?
- Scopes and the resource (audience): can a client ask for more than the user approved, or use a token for another
  resource?
- The consent page: does it show who the client is in a way that cannot be faked (name, address of the metadata
  document, redirect address)? Is the approval bound to the request it was shown for (`state`, a CSRF check)?
- Client ID metadata documents and `metadata-fetch.ts`: SSRF (private, loopback, link-local and IPv6 addresses,
  DNS rebinding, redirects), size and time limits, content type, caching, and whether the `client_id` in the
  document must equal its address.
- Dynamic registration: its limit per client address, the fields it accepts, and whether a registered client can
  pretend to be another one.
- The token endpoint: client authentication where a secret exists, error answers (RFC 6749 codes, no stack traces),
  `Cache-Control: no-store`.
- Secrets: random enough, stored as hashes, compared without timing leaks.
- Discovery: do the metadata documents match what the endpoints really do? Is the issuer taken from
  `HIPPOWIKI_PUBLIC_URL` and never from the `Host` header of a request?
- Revoking a grant on `/account`: are all its access and refresh tokens dead at once?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The flow is run on a local server with `HIPPOWIKI_PUBLIC_URL` set: registration, authorization with PKCE, the
  token exchange, a second use of the code, a refresh and a second use of the old refresh token, a wrong redirect
  address and a wrong `code_verifier`; the answers are noted as evidence. A metadata document address that points
  to `localhost` or a private address is tried and must be refused.

## MCP server

### Goal

The MCP endpoint only answers with valid tokens, shows only what a logged-in user may read, and handles bad input
safely.

### Build

Review `src/features/mcp/` (`http.ts`, `tools.ts`) and `src/app/mcp/route.ts`, against `mcp.md` and the
authorization part of the MCP specification. Questions:

- Does every request check the token (API token or OAuth access token) before any tool runs, and is a token for
  another resource refused?
- Is the `WWW-Authenticate` answer with the address of the protected resource metadata correct for a request without
  a token or with a wrong one?
- Are the tool arguments validated by the name rule before they reach a service? Are deleted pages never listed or
  read?
- Do tool errors leak internal details (stack traces, SQL, file paths)?
- Size of answers and requests: can a large page, a large folder or a large request body tie up the server?
- Origin checks and the methods the endpoint accepts (`GET`, `DELETE` in stateless mode).

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The three tools are called on a local server with a valid token, with a name that breaks the name rule and with
  the name of a deleted page, and the answers are noted as evidence.

## Content: pages, folders, tabs, deletion and rendering

### Goal

The content features keep data consistent, cannot inject script into a page, and do what their specs promise.

### Build

Review `src/features/pages/`, `src/features/folders/`, `src/lib/names.ts`, `src/lib/addresses.ts`,
`src/lib/db-errors.ts`, `src/lib/revalidate.ts`, the pages under `src/app/folders/` and `src/app/deleted-pages/`,
against `pages.md`, `content-structure.md` and `page-deletion.md`. Questions:

- Markdown rendering (`MarkdownContent.tsx`): raw HTML, `javascript:` and `data:` links, images, and any other way
  to run script or load content from other sites.
- Names and addresses: can a name break the name rule after a rename or move, collide with a reserved address, or
  differ only in Unicode look-alikes?
- Concurrent writes: two users creating, renaming, moving, deleting or restoring the same item at once; do the
  unique constraints and transactions keep the data consistent, and are the errors shown well?
- Deleted pages: invisible everywhere (lists, page view, all pages, MCP), restore into a place that is taken now.
- Limits: content size and the number of items, and what happens when they are exceeded.
- The last editor: is it always the user of the session, never a value from the form?
- Error handling: are database errors mapped as `architecture.md` says, and do unknown errors reach the error page
  without details?

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- A page with script in raw HTML, a `javascript:` link and an image from another site is saved on a local server,
  and the rendered HTML is noted as evidence.

## Container image, scripts, CI and dependencies

### Goal

The image, the start scripts, the CI workflows and the dependencies add no weakness of their own.

### Build

Review `Containerfile`, `scripts/` (`image-start.sh`, `image-migrate.sh`, `image-admin.sh`, `image.sh`, `db.sh`),
`src/lib/env.ts`, `src/lib/logger.ts`, `.github/workflows/`, `.github/dependabot.yml`, `package.json`,
`.npmrc`, against `container-image.md` and `tech.md`. Questions:

- The image: base image pinned, runs as a user other than root, the server files owned by root and not writable,
  no secrets, dev tools or `.env` files in the layers, only the needed port.
- The start: the migration runs before the server and stops the start on failure; the scripts quote their variables
  and fail on errors.
- Configuration: does `env.ts` refuse missing or weak secrets and invalid URLs at start? Do the trusted proxies and
  the public URL have safe defaults?
- Logs: can a password, token, code, secret, session cookie or `Authorization` header end up in a log line?
- CI: the permissions of each workflow (least privilege), actions pinned to a commit or a version, how the release
  workflow uses its token, no secrets in pull requests from forks.
- Dependencies: `npm audit` findings, packages that are no longer maintained, packages in `dependencies` that only
  the build needs.

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The output of `npm audit` is summed up as evidence. If Podman is available, the image is built with
  `npm run image:build` and its user and file owners are checked; otherwise this goes to "Checks on the deployment".

## Cross-cutting: data model, architecture, error handling, logging and tests

### Goal

The code as a whole is consistent, keeps the conventions of `architecture.md` and `testing.md`, and its tests cover
the rules that matter for security.

### Build

Review `prisma/schema.prisma` and `prisma/migrations/`, `src/lib/`, the layering of all features, the tests under
`src/`, `integration/` and `e2e/`, and the feature specs. Questions:

- Data model: unique constraints and indexes for every rule that needs them, `onDelete` behaviour, secrets stored
  only as hashes, migrations that match the schema.
- Architecture: do the layers stay apart as `architecture.md` and the lint rules say? Duplicated code across
  features (for example the secret helpers of tokens and OAuth), dead code, overly long functions such as in
  `src/features/oauth/service.ts`.
- Error handling and the `Result` type: consistent use, no swallowed errors.
- Tests: run `npm run test:coverage` and name the security rules of the feature specs that no test checks (unit,
  integration or end-to-end). Note flaky or slow tests seen in the runs of this plan.
- Specs: rules in the feature specs that the code does not keep, and specs that restate code, constants or
  messages.

### Test

- `npm run check` passes.
- Each question above is answered by a finding or under "Reviewed" in this area of the report.
- The coverage summary of `npm run test:coverage` is noted as evidence.

## Summary and final check of the report

### Goal

The report is complete, consistent and ready for a fix plan.

### Build

- Write "Summary": the overall verdict, the number of findings per severity, the three to five findings to fix
  first, and what the review did not cover.
- Order the findings in each area from Blocker to Nit; merge findings that turned out to be the same problem;
  move findings that need the deployment to "Checks on the deployment" with how to check them.
- Go through the checklist in `issue-report.md` for every finding and fix the report where it fails.

### Test

- `npm run check` passes.
- Every item of the checklist in `issue-report.md` holds for the report.
- The counts in "Summary" match the findings.
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
