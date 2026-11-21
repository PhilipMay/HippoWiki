# HippoWiki – Roadmap

Candidates for the next features, grouped by theme. Within a theme, the features that are likely to come first are
listed first; there is no order across themes.

- Before a feature is started, its requirements may be gathered in a file of their own (see
  `requirements-workflow.md`). Then it gets its own step plan `spec/<feature>-steps.md`, and once it is built it is
  removed from this file (see `step-plan-workflow.md`).
- Where a feature lifts a limit, the entry names the spec whose "Current limits" list it.
- "Things to Check" at the end lists checks and open questions that came up while building a feature and that are not
  features of their own.

## Content Structure

- Deleting folders: delete a folder for good after a warning, together with its tabs, its pages and its deleted
  pages, like a tab is deleted for good; there is no soft delete, no list of deleted folders and no restoring
  (`content-structure.md`, `page-deletion.md`).
- Redirects from old addresses: lead the old address of a renamed or moved item to its new one instead of the
  not-found page (`content-structure.md`, `pages.md`).

## Pages and Editing

- Slash commands in the Markdown editor: `/` at the start of a line offers blocks such as headings, lists, quotes,
  code blocks and tables (`markdown-editor.md`).
- The derived title shown while editing: the editor shows the title that the content gives the page, as it is saved
  (`markdown-editor.md`, `pages.md`).
- Import and export: move pages and folders in and out of the wiki as Markdown files.

## Links

- Broken links and orphaned pages: a list of the wiki links of a folder that lead to no page, and a list of the pages
  that no page links to (see `wiki-links.md`).

## History and Revisions

- Folder history: the changes in a folder (items created, renamed, moved, deleted and restored), each entry with
  the items it changed.
- Folder revert: set a folder back to an earlier state.
- Large folder reverts: reverts of folders with many changes, without one long blocking request.
- Merge of conflicting edits: merge two changes of the same page instead of refusing the second one.

## Search

- Semantic search: search by meaning with pgvector (`tech.md`).

## Attachments

- Attachments and images: files and images uploaded to pages, stored locally or in an S3-compatible storage
  (`tech.md`). The research into other wikis and the ideas that follow from it are in `attachments-ideas.md`.

## Users and Accounts

- Password reset by an admin: a new first password for an account that lost theirs (`users-and-login.md`).
- Admin password command: reset a lost admin password with a command of `scripts/admin.ts` instead of a change in
  the database (`users-and-login.md`).
- Deactivating and reactivating users: stop a user from logging in, and let them back in later; deactivating must
  also stop the user's connected apps, and decide what happens to a folder whose last Owner is deactivated or deleted
  (`users-and-login.md`, `connected-apps.md`, `folder-roles.md`).
- First password expiry: a generated first password stops working after some time (`users-and-login.md`).
- Breached password check: check new passwords against Have I Been Pwned by k-anonymity (only the first five
  characters of the SHA-1 hash leave the server), as an option for deployments that allow outgoing requests
  (`users-and-login.md`).
- Password reset without an admin: users reset a lost password themselves, which needs a mail provider
  (`tech.md`).

## Rights

- Public content: pages that can be read without a login, rendered on the server so that search engines see them.
  The Markdown parse is linear and its depth and table cells are limited at save; what is left is a stored or cached
  render, since anonymous visitors can then trigger renders (`pages.md`, "The cost of the Markdown parse";
  `users-and-login.md`).

## Login and Sessions

- Ending sessions on password reset and deactivation: end all sessions of a user whose password is reset or who is
  deactivated, as a change of the own password does already, and let an admin end the sessions of another account
  (`users-and-login.md`, "Current limits").
- Audit log: record logins, changes of folder roles and password changes and resets (`users-and-login.md`,
  `folder-roles.md`).
- Unlock command: a command of `scripts/admin.ts` that deletes the rows of `LoginAttempt` and `LoginWindow` of a user
  name and so ends its waits after failed logins; this does not stop a lockout, it only shortens it.
- Login limit per client address: a limit across all user names per client address group, next to the two limits per
  user name in `reserveAttempt()`, so that a stream of logins with valid-looking but unknown names cannot fill the
  hash slots of `password-hash.ts` or let `LoginAttempt` and `LoginWindow` grow. It needs `HIPPOWIKI_TRUSTED_PROXIES`
  of at least 1, as with `0` every login is in the group `shared` and the limit would hold back all users together. A
  rate limit per client address in the reverse proxy of the deployment does the same from outside
  (`users-and-login.md`, `container-image.md`).
- Login budget for known clients: a budget of its own for clients that have logged in before, so that the right
  password from such a client is not refused while the hour window of its name is full. The candidate is a signed
  device cookie that a successful login sets; see "Current limits" in `users-and-login.md`.
- TOTP: a second factor with one-time codes from an authenticator app (`users-and-login.md`).
- Passkeys (WebAuthn): login with a passkey (`users-and-login.md`).
- Sign-in with Google or GitHub: login through another provider (`users-and-login.md`).

## API and Integrations

- Access for clients without OAuth: scripts, CI jobs and AI apps that cannot do OAuth with a browser get access
  again, for example through the OAuth device flow or client credentials, or a bearer token sent in the
  `Authorization` header (`connected-apps.md`, `oauth.md`, `users-and-login.md`).
- MCP write tools for folders: create folders from AI apps; renaming a folder and its roles stay in the browser,
  because the Owner is never a role of MCP (`mcp.md`, `folder-roles.md`).
- CORS for other origins: let web applications on other origins call the API.
- Rate limits and quotas: limits on requests, writes and stored content per user.

## Operations

- Compose setup for self-hosting: a compose file that runs the image together with its database
  (`container-image.md`).
- Reverse proxy with TLS: HTTPS in front of the container, with the login rate limit per client address of "Login and
  Sessions" (`container-image.md`).
- Database backups: back up the database, at least before a new version starts (`container-image.md`).
- Backup schedule, retention and tested restore: regular backups, how long they are kept, and a restore that is
  tried out.
- NixOS deployment: run HippoWiki on NixOS.
- Prometheus metrics: metrics of the application for Prometheus (`tech.md`).
- Database monitoring: metrics of PostgreSQL through a Prometheus exporter.
- Grafana dashboards: dashboards for the metrics of the application and the database.
- License check in CI: a check that fails when a dependency, also a transitive one, has a strong copyleft license
  such as GPL or AGPL, which the MIT license of the project does not allow, for example
  `npx license-checker --production --failOn "GPL;AGPL"`. The weak copyleft licenses in use today stay allowed:
  LGPL-3.0 of libvips through `sharp` of Next.js, EPL-2.0 of `elkjs` through the Prisma CLI, and MPL-2.0 of tools
  that are not shipped. The published image then also carries the license texts of the packages it ships and points
  to the source of the copyleft ones.

## Container Image

All from "Current limits" in `container-image.md`:

- Health check: a `HEALTHCHECK` in the image, based on `/api/health`.
- Waiting for the database: the start waits for the database instead of failing when it is not reachable yet.
- Images for `linux/arm64`: publish the image for `linux/arm64` next to `linux/amd64`.
- Image signing and scans: signatures, provenance attestations and vulnerability scans of the published image.

## Things to Check

- Security fixes on the deployment, after the next release: the fixes of the security review of 2026-11-12 are live,
  so every response carries the five security headers of `next.config.ts` and no `X-Powered-By`, and
  `/_next/image?url=%2Ffolders&w=64&q=75` redirects to `/login` (`architecture.md`).
- Login limit on the deployment: with `HIPPOWIKI_TRUSTED_PROXIES=1` behind Traefik, a failed login from a known
  address outside the network of the server is logged with that address as `clientAddress`
  (`users-and-login.md`, `container-image.md`).
- Search words on the deployment: the access log of the reverse proxy does not record the words of a search, `q` of
  the address of the results `/folders/<folder>?view=search&q=<words>`, because HippoWiki itself never logs them and
  people search for names and incidents (`search.md`, "Checks on the deployment" of `review-report.md`).
- Forged headers on the deployment: the same failed login with a forged `X-Forwarded-For` and `X-Real-Ip` is logged
  with the same address as before.
- Server port on the deployment: the port of the server is reachable only through Traefik and not directly
  (`container-image.md`).
- IPv6 on the deployment: a failed login over IPv6 is logged with the /64 of the client. Not checked on 2026-11-13,
  neither for the probe nor for the login limit.
- Logins at the same time on the deployment: each counted login holds a database connection for an interactive
  transaction, and the pool of the `pg` adapter has 10 connections by default. Check that a burst of logins for one
  name is answered with waits and not with a failed login, and whether the rounds of `reserveAttempt()`
  (`MAX_RESERVE_ROUNDS` in `src/features/auth/service.ts`) are enough when many logins with the right password arrive at the same moment.
- Log volume: every login whose `X-Forwarded-For` has no usable entry logs a warning; check that a correct setup
  behind Traefik writes none, so that a warning points to a broken setup.
- OAuth on the deployment, after the checks above and only then with `HIPPOWIKI_PUBLIC_URL` set
  (`container-image.md`, `oauth.md`):
  - Add the wiki as a custom connector in claude.ai and in ChatGPT, approve it on the consent page, list and read
    pages, and revoke it on `/account`.
  - Claude Code with OAuth (`claude mcp add --transport http` with an address from "AI apps" and without a header)
    lists and reads pages, and the MCP Inspector, connected through OAuth, shows the tools of a Reader, of a Writer and
    of a Manager address (`mcp.md`).
  - A tool that is still configured with the plain `/mcp` gets 404 there, and its user connects it again through
    OAuth with an address from "AI apps" (`connected-apps.md`).
  - The connectors of claude.ai and ChatGPT send the folder address as `resource` and connect to several addresses
    of the same wiki side by side (`oauth.md`).
  - The limit on the registration of OAuth clients counts per client address behind Traefik: a registration from a
    known address is logged with that address as `clientAddress`.
  - Which redirect addresses and which way of identifying themselves (metadata document or registration) the
    connectors really use, and whether a connector that loses the answer to a refresh has to be connected again too
    often for the strict refresh rule (`oauth.md`).
- The checks on the deployment of the security and code review of 2026-11-14, each described with its area in the
  section "Checks on the deployment" of `review-report.md`:
  - The reverse proxy: TLS by BSI TR-02102-2 and a redirect to HTTPS with HSTS passed on; `Host` passed unchanged and
    unknown hosts refused; `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto` of clients replaced; body
    limits, timeouts and rate limits for `/login`, `/oauth/register`, `/oauth/token` and the MCP addresses under
    `/mcp/`; no CORS headers, no
    change of the CSP, no shared cache; no `Authorization` header and no search words, `q` of the results address, in
    its access logs; `/api/health` only for the health checker.
  - The configuration: `HIPPOWIKI_TRUSTED_PROXIES` set to the real number of proxies, `HIPPOWIKI_PUBLIC_URL` set, no
    `next dev` reachable, no `NODE_TLS_REJECT_UNAUTHORIZED=0`, no proxy for outgoing requests, no `--inspect`,
    `HIPPOWIKI_LOG_CLIENT_ADDRESS=false`, none of the `BETTER_AUTH_*` variables set.
  - Secrets: an environment file with mode 0600 or Podman secrets; `HIPPOWIKI_ADMIN_PASSWORD` chosen by the
    operator and removed once the admin exists; the admin logs in right after the first start; the operator
    knows how to replace `AuthSecret`.
  - The network and the database: the ports of the container and of the database reachable from no other host;
    outgoing connections only to DNS and `443/tcp` on the public internet; the database role no superuser, with a
    strong password; backups protected like the sessions and taken before a new version starts; a storage quota.
  - The container: rootless Podman with `--cap-drop=ALL`, `--security-opt=no-new-privileges`, SELinux,
    `--read-only` with a tmpfs for `.next/cache`, limits for memory, CPU and processes; the image pulled by digest and
    released regularly for fixes of the base image; a scan of the published image for vulnerabilities.
  - The logs: stdout and stderr collected into a separate system with limited access, a retention period and
    synchronised time; alerts on a reused refresh token, on waits after failed logins and on a failed health check.
  - The GitHub repository: rules for `main` and release tags, who may publish releases and push to the image package,
    private vulnerability reporting, alerts and security updates of Dependabot, read-only default permissions of
    workflows, approval for workflows of fork pull requests.
