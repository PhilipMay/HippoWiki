# HippoWiki – Requirements Workflow

How the requirements of a feature are gathered before its step plan is written. The rules are addressed to you, the AI
that leads the conversation with the user.

## Purpose

- The requirements of a feature are gathered in a guided conversation with the user and written into one file,
  `spec/<feature>-requirements.md`. All requirements of the feature live in this one file, not spread over other spec
  files.
- The file describes the feature from the user's point of view, in plain language, so that a person can read it
  without knowing the code. It contains no contradictions and nothing that cannot be built with the stack of the
  project.
- The approved file is what the step plan `spec/<feature>-steps.md` is written from (see "Step plans" in
  `step-plan-workflow.md`). The wrap-up step of that plan moves what lasts into the feature spec and deletes the
  requirements file.

## Starting and resuming

- A conversation is started with a prompt such as:

  ```text
  Gather the requirements for search
  ```

- The feature is an entry of `roadmap.md` or a new idea of the user. The name of the file is the short name of the
  feature in lowercase words joined by hyphens, as for step plans.
- The same prompt resumes a conversation that was interrupted: when the requirements file already exists, read it,
  present its current state, and go on with its open questions.

## What may change

- The conversation writes only the requirements file and its entry in the spec catalog of `CLAUDE.md`, which is added
  when the file is created. Nothing else changes: no code, configuration, tests, fixtures, other spec files,
  `README.md` or skills.
- Once the requirements are approved, commit the requirements file and its catalog entry in `CLAUDE.md` as one Git
  commit on the current branch, without asking first. Stage only these two files. The message is a short lowercase
  summary, for example `gather requirements for search`. Do not push. Before the approval nothing is committed, so an
  interrupted conversation leaves the file in the working tree.
- Reading is free and needed for the checks: the spec files, the code, and the documentation of the installed packages
  in `node_modules/`.
- If the conversation shows that another spec file is wrong or that an entry of `roadmap.md` should change, name it in
  the final report instead of editing it.

## The conversation

1. Prepare: read the entry of the feature in `roadmap.md`, the feature specs it touches, `tech.md` and
   `architecture.md`.
2. Open: restate the idea in two or three sentences as you understand it, and ask the first questions: what the
   feature is for, who uses it, and which problem it solves.
3. Create the requirements file from the template below right after the first answers, with the status `draft`. List
   everything that is still unknown under "Open questions".
4. Work in rounds until no question is open. In each round:
   - Present the current state in the chat: what changed since the last round, the requirements in short, and the open
     questions.
   - Run the checks (see "Checks") on what changed, and turn every problem they find into a question.
   - Ask the next questions with the question tool (see "Asking questions").
   - Update the requirements file with the answers before you present the next round, so that an interrupted
     conversation can be resumed from the file.
5. When no question is open, run all the checks once more on the whole file. Then present the whole file in the chat
   and ask the user with the question tool to approve it or to change something. A change leads back to step 4.
6. On approval, set the status to `approved` and run `npm run check:docs`; fix formatting with `npm run format`. Then
   commit (see "What may change"). Report that the requirements are approved, give the commit message, name anything
   found in other spec files or in `roadmap.md` (see "What may change"), and name the next step as information only:
   writing the step plan `spec/<feature>-steps.md`. Do not ask whether to write or implement the step plan, and do not
   offer to in the chat; offer it only as a card for the next session, as "Step plans" in `step-plan-workflow.md`
   describes.

## Asking questions

- Ask with the question tool, at most four questions per call. Ask the decisions that shape the rest first (the goal,
  the scope, the roles, the main flow), then the behaviour in detail, then the edge cases, errors and limits.
- Each question stands on its own: the user may see only the question, so it names what it is about. One topic per
  question.
- Each option says what follows from it. Put the option you recommend first and mark it as recommended. The user can
  always answer in their own words.
- Do not ask what the spec files or the code already answer; state it in the next round instead, so that the user can
  correct it.
- Never decide a requirement for the user. An assumption stays an open question until the user confirms it.

## Checks

Run the checks in every round on what changed, and on the whole file before asking for approval.

- Consistency:
  - No two requirements contradict each other, and the scope, the scenarios and the requirements agree.
  - No requirement contradicts a rule, a decision or a current limit of an existing feature spec, unless it says that
    it changes that rule. Such a change is a requirement of its own, confirmed by the user, and listed under "Effect on
    existing features".
- Feasibility:
  - Each requirement can be built with the stack in `tech.md` and the conventions in `architecture.md`, with the
    installed versions of the packages.
  - A requirement that cannot be built, or only at a cost the user should know about (a new service, a large new
    package, a slow page, a security risk), goes to the user as a question with feasible alternatives. The reason for
    the choice goes into "Decisions".
- Completeness, before approval:
  - The roles, and who may see and do what.
  - The main flows, and what the user sees when there is nothing yet.
  - Invalid input, errors, and what the user sees then.
  - The numbers a user relies on, such as limits, lengths and waits.
  - Security and privacy: who can reach what, and what is kept about whom.
  - The effect on existing features, such as pages, folders and tabs, deleted pages, login, connected apps, MCP and OAuth.
  - What is out of scope.
  - Every requirement has acceptance criteria that a test or a person can check.

## Writing the requirements

- Write from the user's point of view, in plain language: what a user or an operator can do and see, and what they can
  rely on. Addresses and texts that the user sees may be named.
- Name no models, tables, queries, libraries or files, unless the user sets one as a constraint. How the feature is
  built is decided in the step plan.
- Each requirement is one bullet: a short ID (`R1`, `R2`, …), a statement with "must", and below it its acceptance
  criteria. The IDs are labels, not numbered headings; the step plan and its tests refer to them. An ID is never
  reused for another requirement, also when a requirement is removed.
- Group the requirements under headings by topic, such as "Search field" or "Results".
- "Open questions" is empty when the file is approved.

## Changes after approval

If writing the step plan or building a step shows that a requirement has to change, follow the rule for scope changes
in "Step plans" of `step-plan-workflow.md`: ask the user first, then update the requirements file and the step file.

## Requirements template

```markdown
# <Feature> – Requirements

Status: draft

## Goal

What the feature does for the user and which problem it solves, in two or three sentences.

## Users and roles

Who uses the feature, and what each role may see and do.

## Scenarios

Short stories of how a user uses the feature, from start to end.

## Requirements

### <Topic>

- R1: The user must be able to …
  - Acceptance: …

## Scope

- In: …
- Not in: …

## Effect on existing features

What changes for existing features, and which rules of their specs change.

## Decisions

What was decided, why, and which alternatives were rejected.

## Open questions

- …
```
