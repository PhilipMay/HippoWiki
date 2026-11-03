# CLAUDE.md

## Project

HippoWiki is a knowledge management system for AI and natural intelligence. It is at an early stage: a uv-managed Python
3.13 package (src layout, `src/hippowiki/`).

## Objective

The current objective is to plan and build the first version, a pure wiki: a Python backend with a REST API and a web
client whose details are planned later. MCP and OAuth come later.

## Documents

The current specification is `spec-pure-wiki/`:

- reading order and glossary: `spec-pure-wiki/README.md`
- project goals and non-goals: `spec-pure-wiki/goals.md`
- big picture, composition and transactions: `spec-pure-wiki/architecture.md`
- technology stack: `spec-pure-wiki/tech-stack.md`
- package layout and layer rules: `spec-pure-wiki/package-layout.md`
- content rules, names, deleting and restoring: `spec-pure-wiki/content.md`
- database tables and constraints: `spec-pure-wiki/database.md`
- rights on folders: `spec-pure-wiki/rights.md`
- own account, admin, admin operations, passwords and user lifecycle: `spec-pure-wiki/users.md`
- history, revisions and revert: `spec-pure-wiki/history-revisions.md`
- time rules: `spec-pure-wiki/time.md`
- fixed limits, document size and request body size: `spec-pure-wiki/limits.md`
- login, sessions, login protection, authentication middleware and public routes: `spec-pure-wiki/authentication.md`
- check order and denied requests: `spec-pure-wiki/request-checks.md`
- REST error format: `spec-pure-wiki/errors.md`
- REST routes and response fields: `spec-pure-wiki/rest.md`
- paging and list order: `spec-pure-wiki/lists.md`
- library behaviour to work around: `spec-pure-wiki/implementation-notes.md`
- testing strategy and test kinds: `spec-pure-wiki/testing.md`
- cases that are easy to miss: `spec-pure-wiki/test-cases.md`
- deployment: `spec-pure-wiki/deployment.md`
- what to configure for each component and what can go wrong: `spec-pure-wiki/configuration-and-failure-modes.md`
- next steps, web client open points and later work: `spec-pure-wiki/roadmap.md`

The earlier, full plan with MCP and OAuth is parked in `spec/`, with its open points in `doc/LOP.md`. Read it only when
that work comes back into scope.

## Commands

Use the Makefile targets; run them whenever relevant, and always run `make format`, `make check` and `make test` after
changing code, before considering the work done.

`make test` needs no Podman. `make test-podman` runs the tests marked `podman` against a real PostgreSQL and needs a
running Podman machine; also run it after changes that touch the database, the repositories or their fakes, or time
handling.

## Document Style

Do not number headings, sections or paragraphs in documents (no `## 3. Data Model`, no `§3`). Use bullet lists for rules
and other unordered items; numbered lists only where the order itself matters, such as the steps of a procedure.
Markdown files are formatted with mdformat: `make format` applies it and `make check` enforces it, so run both after
changing documents.

## Code standards

These are enforced by `make check`, so write code that passes them up front.

### Ignoring check findings

The checks are strict on purpose, but they are configurable, so a genuine edge case can be ignored instead of bending
the code around a rule:

- A single line: `# noqa: <RULE>` (ruff) or `# type: ignore[<code>]` (mypy), always with the specific code.
- Whole files or directories: `[tool.ruff.lint.per-file-ignores]` in `pyproject.toml`, with a comment saying why (see
  the existing entries).
- The whole project: `[tool.ruff.lint] ignore` or a `[[tool.mypy.overrides]]` section in `pyproject.toml`.

Fixing the code is the default; ignoring is the exception. Before adding any ignore, ask the user. If you cannot ask
(for example when running unattended), use the narrowest possible ignore with a comment saying why, and print a clear
warning in your final message: which rule, where, and why.

## Tool Usage

To use Python tools run and install them with uv. It’s important to me that all necessary tools are installed. I can use
Homebrew for this, or install them using Python (uv). If any tools are missing, let me know and ask. I can then install
them.

## No Git

Git must not be used in this project. Treat the documents as if they were not managed under Git:

- Do not run any Git commands. In particular, do not view the history, diffs, or status.
- Do not create commits, branches, pull requests, or pushes.
- Never ask if something should be committed or pushed, and do not offer to do so.
- Do not mention Git in your responses.
