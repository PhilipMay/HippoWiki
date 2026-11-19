# CLAUDE.md

HippoWiki is a knowledge management system.

## Specification

The specification lives in the `spec/` directory. This catalog should always be kept in sync with the files. Each
entry is one line: the file and the question it answers, without behaviour, numbers or lists of sections, which the
file itself holds.

- `spec/tech.md`: Which technologies does the project use?
- `spec/requirements-workflow.md`: How are the requirements of a feature gathered before its step plan? A feature in
  this workflow has a file `spec/<feature>-requirements.md`, listed here while it exists.
- `spec/step-plan-workflow.md`: How is a feature planned in steps, built, finished and specified, and how is a finding
  of a review report fixed?
- `spec/architecture.md`: How is the code organised, and which conventions does new code follow?
- `spec/testing.md`: How is the code tested and checked, locally and in CI?
- `spec/pages.md`: What is a page, its content, title, name and rendering?
- `spec/content-structure.md`: How are folders, tabs and pages structured and addressed, and who changed them last?
- `spec/page-history.md`: How are the revisions of a page kept, compared and reverted?
- `spec/page-deletion.md`: How are pages deleted, found and restored?
- `spec/container-image.md`: How is the container image built, started, configured and published?
- `spec/users-and-login.md`: How do accounts, passwords, the login and sessions work?
- `spec/connected-apps.md`: Which AI apps has a user connected, and how is an access token checked?
- `spec/mcp.md`: How do AI apps work with a folder through MCP?
- `spec/mcp-untrusted-content-requirements.md`: What must change so that AI apps treat page text as user data, and
  how are their tool calls traced?
- `spec/oauth.md`: How does an AI app get access through OAuth?
- `spec/optimistic-locking.md`: How are changes of the same page at the same time told apart?
- `spec/folder-roles.md`: Who may see and do what with a folder?
- `spec/roadmap.md`: Which features may come later, and what is still to check?
- `spec/issue-report.md`: How is an issue of a review of code or documents reported?
- `spec/review-report.md`: Which findings of the security and code review are open? A fixed finding is deleted, and
  the file with its last finding.
- `spec/list-layout-review.md`: Which findings of the review of the list layout in the page view are open? A fixed
  finding is deleted, and the file with its last finding.

## Running the Checks

Node.js is managed with nvm; every shell session needs `nvm use` first (it reads `.nvmrc`):

```bash
source ~/.nvm/nvm.sh && nvm use
npm install
npm run check   # format:check, docs:check, knip, lint, typecheck, test, side by side
npm run check:all  # check, test:integration and build side by side
npm run test:coverage  # unit test coverage, report in coverage/
npm run test:cost  # tests with a time budget, on their own and without coverage
npm run build
npm run test:integration  # integration tests against a throwaway database container, needs only Podman
npm run test:e2e  # end-to-end tests in a throwaway database container, needs only Podman
npm run test:e2e:production  # the same end-to-end tests against a production build (next build, next start)
```

Run `npm run format` to fix formatting issues reported by `format:check`.

Which of these commands a change runs, in which order, which end-to-end specs, when the complete `npm run test:e2e`
runs, what a change that touches only documentation runs, and what follows a failure, is stated in "When a step is
done" in `spec/step-plan-workflow.md`. It holds for every change, inside a step plan or not.

## Next.js Agent Rules

`AGENTS.md` is managed by Next.js (`next dev` rewrites it) and points to the version-matched Next.js docs in
`node_modules/next/dist/docs/`.

@AGENTS.md

## Document Style

Do not number headings, sections or paragraphs in documents (no `## 3. Data Model`, no `§3`). Use bullet lists for rules
and other unordered items; numbered lists only where the order itself matters, such as the steps of a procedure.

## Reporting Review Issues

Report every issue found in a review of code or of documents, such as the files in `spec/`, as `spec/issue-report.md`
describes. When a finding of a review report is fixed, follow "Fixing a finding of the review report" in
`spec/step-plan-workflow.md`.

## Git Handling

- Do not look at the Git history, and do not mention how something used to be in an earlier commit.
- Do not create branches or pull requests.
- Do not ask whether something should be committed or pushed, and do not offer to do so.
- After a new step plan is written, commit as described in `spec/step-plan-workflow.md`; do not push.
- After each finished step of a step plan, commit as described in `spec/step-plan-workflow.md`.
- After the last step of a step plan, push as described in `spec/step-plan-workflow.md`.
- After the requirements of a feature are approved, commit as described in `spec/requirements-workflow.md`; do not
  push.
- A change outside a step plan, a finding of a review report fixed on its own included, is not committed: it stays in
  the working tree for the user.
