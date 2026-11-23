# HippoWiki – Report of the Manual Checks

## Summary

- Verdict: no Blocker and no Major. Every rule of the app that a manual check could reach locally holds: the security
  headers, CSRF, caching, CORS, the client address of a login, the waits of logins at the same time, the tools of MCP
  per role, and the speed of the editor. The weak points are settings of the GitHub repository and the limit of logins
  with the right password at the same moment.
- Findings: 3 in all, 0 Blocker, 0 Major, 3 Minor and 0 Nit (2 `issue:`, 1 `suggestion:`). Of the 3 Suggestions,
  1 is High, 1 Medium and 1 Low.
- To fix first: the approval of workflows from fork pull requests, the one High suggestion.
- The settings of the repository that open findings of `review-report.md` could not see are added to those findings
  as Evidence: private vulnerability reporting, the alerts and security updates of Dependabot, the rules for `main`
  and release tags, and the pinning of actions.
- Not covered: see "Not covered" at the end.

## Scope and method

- Checked: the manual checks of `markdown-editor.md`, of "Things to Check" in `roadmap.md` and of "Checks on the
  deployment" in `review-report.md` that need neither the deployment nor a decision of the user, and the protections
  of the finding "the protections that come from Next.js, the MCP SDK and Better Auth have no regression test" in
  `review-report.md`.
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

## Findings

#### issue: workflows from fork pull requests need an approval only for first-time contributors

- Location: the settings of the repository, Actions → General → "Approval for running fork pull request workflows
  from contributors"; `review-report.md`, "Checks on the deployment", the item on the settings of the repository
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

## Reviewed

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

## Not covered

- Everything that needs the deployment or Traefik: the address that Traefik passes on, IPv6 from outside, the pool and
  the latency of the database under a burst of logins, and the warnings of a correct setup.
- Who may push to the image package: the token of `gh` lacks the scope `read:packages`.
- Whether the connection of the AI app to the deployment was made through OAuth; the app was not asked.
- The speed of the editor on a slower laptop, and in Safari and Firefox.
- A scan of the published image for vulnerabilities, which needs a scanner to be downloaded.
