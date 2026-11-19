# Own Password Change – Steps

## Goal

Every account changes its own password at any time on `/account` and logs out its other browsers there; a user can
also disconnect all connected apps with the change. Wrong passwords at a password change and on the consent page count
against the waits of the login, the consent page asks for the password before every approval, and the log lines of a
login and a logout name the user. The requirements are `spec/own-password-change-requirements.md`; their IDs are named
at the steps that build them. The comments of the code and the names of the tests name the rules, not the requirement
IDs, so that the wrap-up changes only documentation.

## Scope

- In: everything under "In" of the scope of `spec/own-password-change-requirements.md`: the own password change of
  every account (R1, R2, R3, R10, R13), disconnecting the apps at a change (R4, R17), logging out the other browsers
  (R5, R11, R18), both dialogs for both account types (R14), counting wrong and right passwords at both password
  changes and on the consent page like logins (R6, R9, R15, R16), the password on the consent page (R7), and the log
  lines (R8, R12). The findings of `review-report.md` that the requirements fix, in the step that fixes each.
- Not in: everything under "Not in" of the requirements: ending the sessions or the apps of another account by an
  admin (that part of the Major finding stays open), a list of the own sessions, a password reset by an admin, a
  minimum password length of 15, the expiry of first passwords, a notification of a password change, a second factor,
  and written decisions on the session lifetime. Also not in: the finding that a logout reports success although the
  session row could not be deleted, which the changed log line of the logout does not fix.

## Checklist

- [x] Log lines of login and logout
- [x] Counting wrong passwords at the forced password change
- [x] Own password change on the account page
- [x] Disconnecting the apps at a password change
- [x] Logging out other browsers
- [ ] Password on the consent page
- [ ] Wrap-up

## Log lines of login and logout

### Goal

The log line of a successful login names the user and the client address group, and the log line of a logout names
the user (R8). This fixes the finding "the log line of a successful login has no name or group, and the logout line
names no user" of `review-report.md`.

### Build

- `logIn()` in `src/features/auth/service.ts` logs "user logged in" with `userId`, `name` and `clientAddress`, the
  fields that its other lines use.
- `logOut()` reads the user of the session with `getSessionUser()` before `signOut()` of Better Auth, which returns no
  user, and logs "session ended" with `userId`. Without a session it logs the line without a user. A failure of that
  read is handled like a failure of the logout: `failed`, logged as an error, so that the logout does not look done.
- Fix the finding as `step-plan-workflow.md` describes in "Fixing a finding of the review report" (its Suggestion has
  the confidence High). The rule "Every log line of a login has the group next to the name" in "Failed logins" of
  `users-and-login.md` holds now; add that the line of a logout names the user.

### Test

- Unit, `src/features/auth/service.test.ts`: the line of a successful login has the user id, the name and the group,
  and no password; the line of a logout has the user id; a logout without a session logs the line without a user; a
  failed read of the session before the logout gives `failed` and ends nothing.
- Integration, `integration/auth-service.test.ts`: a logout of a real session still ends only that session.
- End-to-end: `e2e/login.spec.ts`, which covers the login and the logout; no new end-to-end test, because the tests do
  not read the log of the server.

## Counting wrong passwords at the forced password change

### Goal

A wrong current password at the forced password change counts as a failed login of the account's user name from the
client address group of the request, a right one counts like a successful login, and a wait refuses the change with
its own wording (R6, R15 and R16 for the forced change; R12 for its log line). This fixes the finding "wrong current
passwords at the password change are not limited" of `review-report.md`, as the requirements decided: counted with the
waits of the login, without ending the session after several failures.

### Build

- Auth service: turn the counting of `logIn()` into one private helper that every check of a password goes through:
  it counts the attempt with `reserveAttempt()`, runs the check, keeps the count for a wrong password, forgets the
  counts with `clearFailures()` for a right one, and takes them back with `releaseAttempt()` when the password was not
  checked (busy hashing or another error). During a wait it returns the wait and the limit without running the check.
  `logIn()` uses it and keeps its behaviour and its log lines; the comment at the top of the service describes the
  counting for all callers.
- `changeFirstPassword()` takes the client address group after the headers, like `logIn()`, and treats a group that
  `client-address.ts` would not write the same way. It validates the input first: a request that breaks a rule of the
  new password is answered with its field errors without checking the current password and is not counted. Then it
  counts with the helper, by the name of the session user, around `changePassword` of Better Auth. New error code
  `wait` with `waitMs`. A wrong current password is logged as a warning with the user id, the name and the group, like
  a failed login, and a wait with the limit, as `WAIT_LOG_MESSAGES` does for the login.
- Reading the group: move what the login action does (`clientAddressGroup()` with `HIPPOWIKI_TRUSTED_PROXIES`, the
  warning for a fallback, the client address probe) into one server-side helper of the auth feature that the login
  action, the password change actions and, in a later step, the approval of the consent page call. It is not part of
  `src/features/auth/session.ts`.
- `changeFirstPassword` action: passes the group; maps `wait` to the field error at `currentPassword` "Too many wrong
  passwords. Please try again in N minutes.", with the minutes rounded up as the login does. The message function of
  the login wait and this one share the rounding.
- `ChangePasswordForm.tsx`: after a wait or a wrong current password the three password fields are emptied, so that a
  refused password is not submitted again by mistake; the focus goes to the current password. Errors of the rules keep
  the entered values as today.
- Fix the finding as "Fixing a finding of the review report" in `step-plan-workflow.md` describes; the agreement with
  the user is the decision of the requirements file on counting wrong passwords. Bring "Failed logins" and "Forced
  password change" of `users-and-login.md` in line: the forced change counts like a login, with its own wording of a
  wait.

### Test

- Unit, `src/features/auth/service.test.ts`: the forced change during a wait returns `wait` without calling Better
  Auth; a wrong current password keeps the count and is logged with the user id, the name and the group, without a
  password; a right one clears the counts; a busy hashing and an unexpected error take the counts back; input that
  breaks a rule is not counted; an invalid group counts in `shared` and is logged. The tests of `logIn()` stay green
  unchanged, apart from the log line of the first step.
- Unit, `src/features/auth/actions.test.ts`: `wait` gives the message with the minutes at `currentPassword`; the
  action passes the group of the request.
- Integration, `integration/auth-service.test.ts`: after 5 wrong current passwords from one group the next change is
  refused with the wait without checking the password, and a login of the same name from the same group has to wait
  as well; after 4 wrong ones and a right one, 5 more wrong ones are needed before a wait (R16); wrong current
  passwords count in the hour of the name.
- End-to-end, `e2e/change-password.spec.ts`: after 5 wrong current passwords from one client address group the form
  says "Too many wrong passwords. Please try again in 1 minute." at the current password, the password is unchanged,
  and the login of the same name from the same group waits too. Also run `e2e/login.spec.ts`.

## Own password change on the account page

### Goal

Every account changes its own password at any time in the dialog "Change password" of `/account`, with the rules of
the forced change and the waits of the login; the change ends all other sessions, keeps the current browser logged in
and says so on `/account` (R1, R2, R3, R6, R10, R13, R15, R16, and R12 without the apps).

### Build

- Auth service: `changeOwnPassword(input, headers, clientAddressGroup)`. It needs a session (`not-logged-in`) whose
  user has no pending first password (a pending one is refused with a code of its own; `requireUser()` already leads
  such a user to the forced change). It validates the input with `passwordChangeInputSchema()` and counts with the
  helper of the previous step around `changePassword` of Better Auth with `revokeOtherSessions: true`, which ends all
  sessions of the user and starts a new one for the request. Codes as for the forced change: `invalid-input`,
  `wrong-password`, `wait`, `busy`, `failed`. Logs "password changed" as info with the user id and the name, never a
  password. The parts it shares with `changeFirstPassword()` live in one private function.
- Action `changeOwnPassword` in `src/features/auth/actions.ts`: `requireUser()`, the group of the request, the form
  through `readPasswordChangeFormData()`, the service, and the messages of the forced change for every code. On
  success it revalidates `/account` and redirects to `/account` with the notice of the change.
- Addresses (`src/lib/addresses.ts`): the action `change-password` of `/account`, and the notices of `/account`, read
  from `?notice=<notice>`, built by a helper and parsed by the page; a notice comes only without an action, and an
  unknown notice, a notice with an action and a repeated one are not found.
- The notice is shown once: a small Client Component shows it as an alert and, once hydrated, removes the notice from
  the address with `window.history.replaceState` (see the Next.js docs in `node_modules/next/dist/docs/` on the native
  History API), so that a reload shows no message. A notice only reports what happened and changes nothing.
- `/account` (`src/app/account/page.tsx`): a button "Change password" for every account, a user with apps, a user
  without apps, a user while OAuth is off and an admin alike, that links to `?action=change-password`. The dialog is
  rendered by the page, open from the start, as "Revoke app" is. The page keeps showing the not-found page for every
  other action, and `revoke` and `app` stay not found for an admin and while OAuth is off (R14).
- Dialog "Change password" in `src/features/auth/components/`, built from `ActionDialog`, `DialogForm` and
  `DialogFormActions`: the current password, the new one and its repetition. The fields, their help texts, their focus
  after errors and the emptying after a wait or a wrong password are shared with `ChangePasswordForm.tsx` in one
  component, so that the two forms cannot drift apart. The dialog says that the other browsers are logged out.
- `e2e/account.spec.ts`: the tests of an admin and of the not-found addresses follow the new page: an admin sees the
  name and the button, and still no list of apps.

### Test

- Unit, `src/features/auth/service.test.ts`: the own change without a session, with a pending first password, with
  input that breaks a rule (nothing counted and nothing changed), during a wait, with a wrong and with a right current
  password, busy (R13: nothing changes and the count is taken back) and failed; the info line with the user id and the
  name and without a password.
- Unit, `src/features/auth/actions.test.ts`: every code maps to its message or field error, the wait message names the
  minutes, and success redirects to `/account` with the notice.
- Unit, `src/lib/addresses.test.ts`: the notice address and the parsing of notices, unknown and repeated ones included.
- Integration, `integration/auth-service.test.ts`: through the real Better Auth, the own change with two sessions of
  the user ends the other one and returns the cookie of a new session that is valid; the old password is refused and
  the new one logs in; a wrong current password changes nothing and counts with the login.
- End-to-end, a new `e2e/own-password-change.spec.ts`, with users of its own created by `createUser()` with
  `mustChangePassword: false`, so that the saved sessions of the known users stay valid:
  - a user and an admin each open the dialog from the button, change the password and log in with the new one; the
    old one is refused (R1);
  - `/account?action=change-password` opens the dialog directly, and Cancel and Escape close it without a change;
  - a common password, one built from the user name or a context word, one equal to the current one, one too short,
    one too long and a repetition that differs are refused with the messages of the forced change, and the old
    password still works (R2);
  - with the user logged in in a second browser context (`logInElsewhere()`), the change logs the other out at its
    next request, and the first goes on without a new login (R3);
  - after the change `/account` says that the password was changed and the other browsers were logged out, and a
    reload shows no message (R10);
  - after 5 wrong current passwords from one client address group the dialog says "Too many wrong passwords. Please
    try again in 1 minute." at the current password and the password is unchanged, and a login of the same name from
    the same group waits too (R6, R15);
  - an unknown action, an unknown notice and a notice with an action are not found, for a user and an admin (R14).
- Also run `e2e/account.spec.ts` and `e2e/change-password.spec.ts`.
- Manual: a password manager offers to save the new password after the change in the dialog.

## Disconnecting the apps at a password change

### Goal

A user with connected apps can choose, at the change, that all of them are disconnected; when that fails after the
password was changed, the change stands and `/account` asks the user to revoke the apps (R4, R17, and R12 with the
apps).

### Build

- Grant service: `revokeAllGrants(actor)` deletes all grants of the actor in one write and returns their number. It
  refuses an admin and refuses while OAuth is off, like `revokeGrant()`, and logs "all grants revoked" with the actor
  id and the number.
- `changeOwnPassword()` of the auth service takes the choice. With it, once the password is changed and the sessions
  are ended, it calls `revokeAllGrants()`; the order is the decision of the requirements, so that the apps are never
  lost without a change. Its result says whether the apps were disconnected and how many, or that disconnecting them
  failed; the failure is logged as an error and the result is still a success, because the password stays changed. For
  an admin and while OAuth is off the choice is ignored and logged as a warning, since the dialog never shows it. The
  info line of the change names the user id, the name, whether the apps were disconnected and how many.
- Form and action: the checkbox "Also disconnect all my apps", not ticked when the dialog opens, read by a helper of
  `src/features/auth/forms.ts` as on or off. It is kept after an error of the form, also after a wait (R15). The action
  passes the choice and redirects with the notice that fits: changed and logged out, changed with the apps
  disconnected, or changed with the apps not disconnected and the request to revoke them in the list.
- `/account` shows the checkbox only to a user with at least one connected app, which is the list the page reads
  already; never to an admin, to a user without apps, or while OAuth is off.

### Test

- Unit, `src/features/grants/service.test.ts`: `revokeAllGrants()` refuses an admin and while OAuth is off, deletes
  only the actor's grants, returns the number, logs it, and gives `failed` for a database error.
- Unit, `src/features/auth/service.test.ts`: the change with the choice disconnects the apps after the password is
  changed; a failing disconnect leaves the change a success with the failure in the result and an error in the log
  (R17); without the choice nothing is disconnected; the choice of an admin and while OAuth is off is ignored; the info
  line names whether and how many apps were disconnected.
- Unit, `src/features/auth/actions.test.ts` and `src/features/auth/forms.test.ts`: the checkbox is read, and each
  result leads to its notice.
- Integration, `integration/grant-service.test.ts`: `revokeAllGrants()` deletes every grant of the user and none of
  another user, and their access tokens and refresh tokens are refused afterwards.
- End-to-end, `e2e/own-password-change.spec.ts`:
  - a user with two connected apps (`createGrant()`) ticks the choice: both are gone from the list, their access tokens
    are refused at the MCP address, and the notice says that the apps were disconnected; without the choice both stay
    and work (R4);
  - the choice is not ticked when the dialog opens, and a user without apps and an admin see no such choice (R4);
  - the choice stays ticked after an error of the form.
- Also run `e2e/account.spec.ts` and `e2e/mcp-access.spec.ts`.
- R17 cannot be made to fail end to end: the unit tests cover it.

## Logging out other browsers

### Goal

Every account ends all its other sessions without changing the password, after a confirmation in the dialog "Log out
other browsers"; the current browser stays logged in and `/account` says so, and a failure is shown in the dialog (R5,
R11, R18, R14, and R12 for the logout of the other browsers). With the previous steps this reduces the Major finding
"after the first password change, a user cannot change the password or end sessions, and the admin cannot end them
either" of `review-report.md` to its admin part.

### Build

- Auth service: `logOutOtherSessions(headers)` reads the session of the request with Better Auth and deletes all
  other sessions of its user with one `deleteMany` of Prisma that leaves out the current session, and returns their
  number; `not-logged-in` without a session and `failed` for a database error, logged. It logs "other sessions ended"
  as info with the user id, the name and the number. Not `revokeOtherSessions` of Better Auth: it returns no number,
  deletes the sessions one by one, and the review found that Better Auth swallows a failed delete at the logout; the
  reason goes into the comment and, at the wrap-up, into "Decisions".
- Action `logOutOtherBrowsers` in `src/features/auth/actions.ts`: `requireUser()`, the service, and on success a
  redirect to `/account` with the notice that the other browsers were logged out, also when there was no other session
  (R11). `failed` returns the message, shown in the dialog, that the other browsers could not be logged out and may
  still be logged in (R18); nothing claims success.
- `/account`: the button "Log out other browsers" for every account, which links to `?action=log-out-others`, and the
  dialog, a `ConfirmDialog` that says what happens and asks for no password.
- Bring `review-report.md` in line as "Fixing a finding of the review report" in `step-plan-workflow.md` describes,
  for a finding that is reduced and not deleted: the finding keeps only that the admin cannot end the sessions of
  another account, with its title, Problem, Impact, Evidence, Suggestion and Severity rewritten for that part; the
  "To fix first" item and the Summary follow; the requirements that the own password change and the logout of other
  browsers now meet move into the "Reviewed" list of the area. "Current limits" of `users-and-login.md` and
  `connected-apps.md` lose "no change of the own password after the forced password change" and the limits on the
  password change and the apps that no longer hold.

### Test

- Unit, `src/features/auth/service.test.ts`: without a session nothing is deleted; the delete leaves out the current
  session and returns the number; a database error gives `failed` and is logged; the info line names the user id, the
  name and the number.
- Unit, `src/features/auth/actions.test.ts`: success redirects with the notice, also with no other session; `failed`
  returns the message and no redirect.
- Integration, `integration/auth-service.test.ts`: with three sessions of the user and one of another user, the
  logout of the other browsers ends the two other sessions of the user, keeps the current one and the other user's,
  and returns 2.
- End-to-end, `e2e/own-password-change.spec.ts` (or a spec of its own if the file grows long):
  - with the account logged in in a second browser context, confirming in the first logs the second out at its next
    request, and the first goes on (R5), for a user and an admin (R14);
  - closing the dialog with Cancel or Escape ends nothing (R5);
  - `/account?action=log-out-others` opens the dialog directly, and after confirming `/account` says that the other
    browsers were logged out, also without another session, and a reload shows no message (R11).
- R18 cannot be made to fail end to end: the unit tests cover it.
- Also run `e2e/account.spec.ts`.

## Password on the consent page

### Goal

The consent page asks for the own password before every approval of an AI app; a wrong password counts as a failed
login and a right one like a successful one, and a wait refuses the approval (R7, R9, R15, R16). This answers the
question "approving an OAuth grant needs no new authentication" of `review-report.md` as the requirements decided: the
password before every approval, whatever the lifetime.

### Build

- Auth service: `verifyPassword(password, headers, clientAddressGroup)` checks the password of the user of the session
  through `verifyPassword` of Better Auth, counted with the helper of the counting step. Codes `not-logged-in`,
  `wrong-password`, `wait` with `waitMs`, `busy` and `failed`. An empty password is answered `wrong-password` without a
  hash and without a count. A wrong password and a wait are logged like a failed login, with the user id, the name and
  the group.
- A server-side function of the auth feature, next to the helper that reads the group, checks the password of the
  logged-in user of the request: it reads the headers and the group and calls the service. The OAuth action calls it,
  so that only the auth feature reads the headers of the request for the session.
- `approve()` in `src/features/oauth/actions.ts`: after `requireUser()` and the check that OAuth is on, it checks the
  password before `createCode()`; anything but a right password creates no code and no grant. `wrong-password` gives
  "Wrong password" at the password field, `wait` "Too many wrong passwords. Please try again in N minutes.", `busy`
  and `failed` a message of the form. `deny()` needs no password and stays as it is.
- `ConsentFormState` in `src/features/oauth/forms.ts` gets the field error of the password; a helper reads the
  password from the form.
- `ConsentForm.tsx`: a password field above "Approve" with `autocomplete="current-password"`, not shown while the limit
  of apps is reached. After a refusal the password is emptied and focused, and the chosen lifetime stays.
- `e2e/support/oauth.ts`, `e2e/oauth.spec.ts`, `e2e/hydration.spec.ts` and `e2e/pending-states.spec.ts`: every approval
  enters the password of its user first.
- `oauth.md`, "The authorization request and the consent page": "Approve" needs the password. Answer the question in
  `review-report.md` as "Fixing a finding of the review report" in `step-plan-workflow.md` describes, ASVS 7.5.1
  included.

### Test

- Unit, `src/features/auth/service.test.ts`: `verifyPassword()` with a right, a wrong and an empty password, during a
  wait, busy and failed, with the counts and the log lines of each.
- Unit, `src/features/oauth/actions.test.ts`: an approval without the password, with a wrong one and during a wait
  calls no `createCode()` and returns the field error; with the right one the code is created as today; `deny()`
  needs no password.
- Unit, `src/features/oauth/forms.test.ts`: the password is read from the form.
- Integration, `integration/auth-service.test.ts`: `verifyPassword()` against the real Better Auth accepts the
  password of the session user and refuses another; 5 wrong passwords make the next login of the name from the group
  wait.
- End-to-end, `e2e/oauth.spec.ts`:
  - an approval without the password and with a wrong one creates no grant and no code and says "Wrong password" at
    the password field, while the chosen lifetime stays; with the right one the app is connected as today (R7);
  - "Deny" without a password sends `access_denied` to the app (R7);
  - after 5 wrong passwords from one client address group the next approval says "Too many wrong passwords. Please try
    again in 1 minute." without checking the password, and no grant is created (R9, R15).
- This is the last step that changes more than documentation, and it changes `e2e/support/`: run the complete
  `npm run test:e2e`.
- Manual: a password manager fills the password field of the consent page.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Extend `users-and-login.md`: a section on the own password change (the dialog, the rules, the other sessions, the
   choice to disconnect the apps, the notice, the order of the change and the disconnect, the failure that leaves the
   change standing) and one on logging out other browsers; "Failed logins" names the password changes and the consent
   page as further counted checks of a password, with the wording of their wait; "Login and logout" and "Routes" name
   the new actions of `/account`; "Decisions" takes the decisions of the requirements file that still hold, among
   them the accepted wait of the own change while someone guesses the password at the login, and the reason for the
   own delete of the other sessions; "Current limits" says that a password change is not atomic for the own change as
   well, and that an admin still cannot end the sessions of another account. Update "Own account page" of
   `connected-apps.md` (the buttons and dialogs for every account, the notices, an admin and OAuth off) and its
   pointers to code and tests; check `oauth.md` against the consent page as built. Update `architecture.md` where it
   names the readers of the client address group, the exceptions of "Queries" and "Actions" for the auth actions, and
   the only code that reads the headers of the request for the session; `testing.md` where a convention of the tests
   changed, such as the e2e tests that change a password or end sessions with users of their own.
2. Remove "Own password change" and "Ending all sessions at once" from `roadmap.md`, and change "Ending sessions on
   password reset and deactivation", which names the password change as what already ends sessions, where needed.
3. Check that `README.md` has all the commands a developer needs, and that its summary of what the prototype can do
   names the own password change, the logout of other browsers and the password on the consent page.
4. Delete this step file and `spec/own-password-change-requirements.md`. Replace every requirement ID (`R1` to `R18`)
   in the comments of the code and the tests by the section of the feature spec that holds the rule now, or drop it
   with its sentence kept.
5. Update the spec catalog in `CLAUDE.md`: remove this step file and the requirements file. The questions of
   `users-and-login.md`, `connected-apps.md` and `oauth.md` stay the same, so their entries do not change.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The wrap-up changes only documentation,
  so only `npm run check` runs; if a requirement ID has to leave a comment after all, it is not documentation only and
  runs the complete end-to-end suite as the last step that changes more.
- `grep -rnE "\bR(1[0-8]|[1-9])\b" src e2e integration` finds no requirement ID of this feature, and `spec/`,
  `README.md` and `CLAUDE.md` name neither the deleted files nor the closed findings.
