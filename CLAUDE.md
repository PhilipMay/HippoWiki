# CLAUDE.md

HippoWiki is a knowledge management system.

## Specification

The specification lives in the `spec/` directory. This catalog should always be kept in sync with the files.

- `spec/tech.md`: technology stack
- `spec/poc-steps.md`: step-by-step plan for the first prototype

## Document Style

Do not number headings, sections or paragraphs in documents (no `## 3. Data Model`, no `§3`). Use bullet lists for rules
and other unordered items; numbered lists only where the order itself matters, such as the steps of a procedure.

## No Git

Git must not be used in this project. Treat the documents as if they were not managed under Git:

- Do not run any Git commands. In particular, do not view the history, diffs, or status.
- Do not create commits, branches, pull requests, or pushes.
- Never ask if something should be committed or pushed, and do not offer to do so.
- Do not mention Git in your responses.
