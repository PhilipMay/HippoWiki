# Password Blocklist – Steps

## Goal

Every new password, from the forced password change and from `HIPPOWIKI_ADMIN_PASSWORD`, is refused when it is one of
the 10,000 most common passwords that meet the length rule, or when it is built only from the user name or a context
word (`hippowiki`, `hippo`, `wiki`, `admin`) plus digits and symbols. This fixes the finding "new passwords are not
checked against common or breached passwords or context words" of `review-report.md`.

## Scope

- In: a bundled list of the 10,000 most common passwords and the script that makes it; a documented list of context
  words; both rules in `passwordSchemaFor()` in `src/features/users/schema.ts`, so that the password change and the
  admin setup apply them; unit, integration and end-to-end tests; `users-and-login.md` and `review-report.md` brought
  in line.
- Not in: a check against Have I Been Pwned or any other outgoing request (see "Breached password check" in
  `roadmap.md`); a longer minimum length or counting code points (a finding of its own); normalisation of passwords;
  a strength meter or any check in the browser; checking the passwords of existing users or of the seed.

## Checklist

- [ ] Common password list
- [ ] Refuse common passwords and context words
- [ ] Wrap-up

## Common password list

### Goal

A pure module with the list of common passwords, reproducible from a pinned source. Nothing imports it yet.

### Build

- `scripts/common-passwords.ts`: reads a downloaded copy of the SecLists file
  `Passwords/Common-Credentials/10-million-password-list-top-100000.txt` (MIT licence), pinned to one commit of
  SecLists that the script names. It keeps the entries whose string length is 8 to 128 (the measure of
  `passwordSchema`), lowercases them, drops duplicates, keeps the first 10,000 in the order of the source, and writes
  `src/features/users/common-passwords.ts`, each entry written with `JSON.stringify` and the file formatted with
  Prettier. It runs as `npx tsx scripts/common-passwords.ts <downloaded file>`.
- The source file is downloaded into a scratch directory outside the repository and is not committed. A file download
  needs the user's OK: ask for it in the session, naming the file, its source and its size.
- `src/features/users/common-passwords.ts`: a header comment (generated, the source with its commit, the licence, the
  filter, how to regenerate it) and `isCommonPassword(password)`, which compares the lowercased password with a `Set`
  of the entries. No server-only imports, like `schema.ts`.
- `README.md`: the command that regenerates the list, under "Commands".

### Test

- Unit `src/features/users/common-passwords.test.ts`: exactly 10,000 entries, all distinct, lowercase and 8 to 128
  characters long; `password1234`, `qwertyuiop`, `12345678` and `Password1234` are common; a password from
  `generateFirstPassword()` is not.
- End-to-end: no spec, because nothing that the app runs imports the module yet.

## Refuse common passwords and context words

### Goal

The forced password change and the admin setup refuse common passwords and passwords built from context words, and
the specs and the review report say so.

### Build

- `src/features/users/schema.ts`:
  - `PASSWORD_CONTEXT_WORDS`: `hippowiki`, `hippo`, `wiki` and `admin`.
  - The context rule of `passwordSchemaFor(userName)`: lowercase the password and remove every occurrence of the user
    name and of the context words, longest first. The password is refused when something was removed and what is left
    contains no letter (`\p{L}`). So `hippowiki2026`, `Alexander1` for the user `alexander` and `admin-admin!` are
    refused, while `admin-password` and `wikipedia1` are accepted. A password of digits only is left to the list, so
    that there is still no composition rule. The context rule replaces the rule "not the same as the user name" and its
    message.
  - A second refinement refuses a password for which `isCommonPassword()` holds.
  - Both rules report together with the length errors, as the rules do now. `adminPasswordSchema` builds on
    `passwordSchemaFor(ADMIN_NAME)` and so gets both.
- After `npm run build`, check that no file under `.next/static` contains a distinctive entry of the list, so that the
  list does not reach the browser. If one does, change the plan before going on (see `workflow.md`).
- `spec/users-and-login.md`:
  - "Passwords": the two rules, the context words, and a pointer to `src/features/users/common-passwords.ts` and its
    source.
  - "Admin account and setup": the password from `HIPPOWIKI_ADMIN_PASSWORD` follows the same rules.
  - "Decisions": why a bundled list (no outgoing request, works offline, drawn from breach data), and why "built only
    from a context word" instead of "contains a context word".
  - "Current limits": no online check against breached passwords (see `roadmap.md`).
- `spec/review-report.md`, as "Fixing a finding of the review report" in `workflow.md` describes:
  - Delete the finding.
  - "Summary": the counts (112 findings, 2 Major, 58 `issue:`); remove item 2 of "To fix first" and renumber the
    others.
  - Move ASVS 6.2.4, 6.2.12, 6.1.2 and 6.2.11, NIST SP 800-63B-4 3.1.1.2 (blocklist) and CWE-521 into "Reviewed" of
    "Login, passwords, sessions and users", with what the fix does and how it was checked. 6.2.12 is met by the
    bundled list, which comes from breach data.
  - Reword "together with the missing blocklist" in the finding on the minimum password length, and the `CON.10.A1`
    row of "Standards coverage".
  - Search `spec/`, `README.md` and `CLAUDE.md` for "blocklist", "common passwords", "breached" and "context word".

### Test

- Unit `src/features/users/schema.test.ts`: the context rule with the refused and accepted examples above, upper and
  lower case, and the user name as part of a longer word; common passwords; both errors together;
  `adminPasswordSchema` refuses `admin2026` and a common password. The test "accepts a password that only contains or
  resembles the user name" is reversed: `alexander1` and `Alexander` are now refused.
- Unit: the expected messages in `src/features/auth/schema.test.ts` and `src/features/auth/service.test.ts` follow the
  new message. `src/features/users/example-passwords.test.ts` and `src/features/users/password.test.ts` keep passing.
- Integration `integration/user-service.test.ts`: `ensureAdmin()` with a common password creates nothing and answers
  `invalid-input`. `integration/auth-service.test.ts`: a password change to a common password and to a password built
  from a context word changes nothing.
- End-to-end `e2e/change-password.spec.ts`: the forced change refuses `password1234` and `hippowiki2026` with their
  messages and stays on `/change-password`; the case of the user name gets the new message. The specs this step
  affects: `e2e/change-password.spec.ts`, and `e2e/login.spec.ts`, `e2e/users.spec.ts`, `e2e/hydration.spec.ts` and
  `e2e/oauth.spec.ts`, which go through the forced change.
- Manual: on the dev server, the forced change of a fresh user refuses `password1234`, `qwertyuiop`, `12345678` and
  `hippowiki2026`.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/<feature>.md` (see "Feature specs" in `workflow.md`), or extend an existing
   feature spec; update `architecture.md`, `testing.md` or `tech.md` where conventions changed. `users-and-login.md`
   was updated in the step before, so here it is checked against the code.
2. Remove the feature from `roadmap.md`: the item "Common password list".
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: add new spec files, remove this step file.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
