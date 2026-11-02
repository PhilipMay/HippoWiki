# CLAUDE.md

## Project

HippoWiki is a knowledge management system for AI and natural intelligence. It is at an early stage: a uv-managed Python
3.13 package (src layout, `src/hippowiki/`).

## Objective

The current objective is to document a clear initial plan for the project and to plan the first steps of the actual
implementation.

## Documents

- reading order and glossary: `spec/README.md`
- project goals and non-goals: `spec/goals.md`
- architecture, technology stack, package layout and layer rules: `spec/architecture.md`
- content rules, database tables and constraints: `spec/entities.md`
- rights, admin operations, user linking and user lifecycle: `spec/users-and-rights.md`
- history, revisions and revert: `spec/history-revisions.md`
- time rules: `spec/time.md`
- login method, tokens, authentication middleware and public routes: `spec/authentication.md`
- check order, denied requests and errors: `spec/request-checks.md`
- MCP adapter: `spec/mcp.md`
- testing strategy and required test cases: `spec/testing.md`
- deployment: `spec/deployment.md`
- next steps and open points: `spec/roadmap.md`

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
