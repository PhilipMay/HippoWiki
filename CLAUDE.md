# CLAUDE.md

HippoWiki is a knowledge management system.

## Specification

The specification lives in the `spec/` directory. This catalog should always be kept in sync with the files.

- `spec/tech.md`: technology stack
- `spec/requirements-workflow.md`: how the requirements of a feature are gathered in a guided conversation before its
  step plan (starting and resuming, what may change, the rounds of questions, the checks for contradictions and
  feasibility, how requirements are written, the template); the result is one file `spec/<feature>-requirements.md`,
  listed here while it exists
- `spec/step-plan-workflow.md`: how features are planned in step files, when a step is done, what to do when it
  cannot be finished, how a feature is wrapped up, what a feature spec holds, and how a finding of the review report is
  fixed and deleted
- `spec/architecture.md`: code layout and conventions (layers and services, reads, writes, the adapters of callers
  other than the GUI, login and sessions, the public addresses, security headers, validation, addresses, database, UI)
- `spec/testing.md`: the check of doc references, and unit, integration and end-to-end test conventions
- `spec/pages.md`: the page feature as built (content and title with the limits of length, nesting and table cells,
  suggested name, routes, rendering with markdown-it, the cost of the Markdown parse, decisions, limits)
- `spec/content-structure.md`: the content structure as built (folders, tabs and pages under `/folders`: overview,
  names, addresses, actions and views with the view "AI apps", routes, changing the structure, only users see content, the last editor,
  lists, decisions, limits)
- `spec/page-deletion.md`: the soft delete of pages as built (deleting, deleted pages are invisible, the deleted pages
  of a folder under `/deleted-pages` with who deleted them, restoring, decisions, limits)
- `spec/container-image.md`: the container image as built (image and build stages, start with the migration, the
  command that only migrates, the admin setup, configuration including the trusted reverse proxies and the public
  URL, health, smoke test, publishing on a release, what the environment has to provide, including the client address
  of a login, decisions, limits)
- `spec/users-and-login.md`: the users and login feature as built (user names and email, passwords and hashing, the
  list of common passwords and the context words, the account types admin and user, the admin setup, login and
  logout, sessions, the way back after a login and where it leads each type, failed logins with the wait per user
  name and client address group and the hour window per user name, authenticated access only, forced password change,
  the user list for every account and creating accounts of either type, routes, decisions, limits)
- `spec/connected-apps.md`: the connected apps as built (the grants of users to OAuth clients at an MCP address of a
  folder, with folder and role, the limit of 50 per user, the own apps only, no apps for admins, the account page
  without a public URL, the check of an access token by address and current role with its codes, the own account page
  `/account`, decisions, limits)
- `spec/mcp.md`: the MCP server as built (the addresses `/mcp/<folder-uuid>/<reader|writer>` per folder and role, off
  without the public URL, stateless with JSON answers, connections bound to one address and checked against the
  current role with the answers 404, 401 and 403, the actor of MCP, the read tools and the write tools of a Writer,
  the version, the instructions per connection, decisions, limits)
- `spec/oauth.md`: OAuth for MCP clients as built (switching it on with the public URL, discovery with the metadata per
  folder address, clients by metadata document and by registration with its limit, the safe fetch of metadata
  documents, the authorization request with the folder address as `resource` and the consent page with folder and
  role, no scopes, codes, grants and their replacement per address, refresh with rotation, the token endpoint,
  secrets, routes, decisions, limits)
- `spec/optimistic-locking.md`: optimistic locking for pages as built (the version of a page and what counts it up,
  which content saves, moves, renames and deletes are refused, what the browser shows then, the rule for callers
  other than the browser and the MCP write tools, restoring unchecked, editors and dialogs open over a deployment, decisions, limits)
- `spec/folder-roles.md`: folder roles as built (the roles Reader, Writer, Manager and Owner per user and folder and
  what each may do in the browser, admins never have a role, what a user sees and does, creating folders, the roles
  view, giving, changing and removing roles with the last Owner kept, the admin overview `/folder-roles`, the view "AI
  apps", MCP with the lower of the user's role and the role of the connection, decisions, limits)
- `spec/tab-deletion-requirements.md`: the approved requirements of deleting a tab (a Manager or Owner deletes
  a tab for good, its pages are soft deleted)
- `spec/tab-deletion-steps.md`: the step plan of deleting a tab (the service write with its lock and transaction, the
  "Delete tab" dialog at the tab address, wrap-up)
- `spec/roadmap.md`: backlog of candidate features, grouped by theme, and things still to check
- `spec/issue-report.md`: how to report issues found in code and document reviews
- `spec/review-report.md`: the report of the security and code review (scope and method, standards and target level,
  threat model, findings per area, accepted deviations, what is good, checks on the deployment, standards coverage,
  open questions); it holds only open findings: a fixed finding is deleted, and the file is deleted with its last
  finding

## Running the Checks

Node.js is managed with nvm; every shell session needs `nvm use` first (it reads `.nvmrc`):

```bash
source ~/.nvm/nvm.sh && nvm use
npm install
npm run check   # format:check, docs:check, lint, typecheck, test
npm run test:coverage  # unit test coverage, report in coverage/
npm run build
npm run test:integration  # integration tests against a throwaway database container, needs only Podman
npm run test:e2e  # end-to-end tests in a throwaway database container, needs only Podman
npm run test:e2e:production  # the same end-to-end tests against a production build (next build, next start)
```

Run `npm run format` to fix formatting issues reported by `format:check`.

For every change, inside a step plan or not, the end-to-end tests run in two stages, as "When a step is done" in
`spec/step-plan-workflow.md` describes:

- While working, run only the specs the change affects: `npm run test:e2e -- e2e/<name>.spec.ts`, one path per spec.
  Which specs count as affected, and when the complete suite is needed right away, is listed there.
- Before the work is finished, committed or pushed, run the complete `npm run test:e2e` once.

A change that touches only documentation (the files in `spec/`, `README.md`, `CLAUDE.md`, `AGENTS.md` and the skills in
`.claude/skills/`) runs only `npm run check`: no integration tests, no end-to-end tests and no build. This also holds
for the wrap-up step of a step plan; see "Changes to documentation only" in `spec/step-plan-workflow.md`.

## Next.js Agent Rules

`AGENTS.md` is managed by Next.js (`next dev` rewrites it) and points to the version-matched Next.js docs in
`node_modules/next/dist/docs/`.

@AGENTS.md

## Document Style

Do not number headings, sections or paragraphs in documents (no `## 3. Data Model`, no `§3`). Use bullet lists for rules
and other unordered items; numbered lists only where the order itself matters, such as the steps of a procedure.

## Reporting Review Issues

Report every issue found in a review using the structure, severity levels and checklist in `spec/issue-report.md`.
This applies to code reviews and to reviews of documents such as the files in `spec/`.

- For code, Location is the file, line range and function.
- For documents, Location is the file and the heading of the section; Evidence is a short quote of the passage.
- Start the review with a short summary: the overall verdict and how many issues there are at each severity level.
- When a finding of `spec/review-report.md` is fixed, delete it from the report and update the other documents in the
  same change, as "Fixing a finding of the review report" in `spec/step-plan-workflow.md` describes.

## Git Handling

- Do not look at the Git history, and do not mention how something used to be in an earlier commit.
- Do not create branches or pull requests.
- Do not ask whether something should be committed or pushed, and do not offer to do so.
- After each finished step of a step plan, commit as described in `spec/step-plan-workflow.md`.
- After the last step of a step plan, push as described in `spec/step-plan-workflow.md`.
