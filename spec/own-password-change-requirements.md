# Own Password Change – Requirements

Status: approved

## Goal

Today an account can change its password only once, at the forced change of the first password, and nobody can end
the sessions of a browser that is lost or of a cookie that was stolen. A user or admin who suspects a leaked password
or a stolen session has no way to react but a change in the database. This feature lets every account change its own
password at any time and log out its other browsers, makes guessing the password with a stolen session and turning a
stolen session into app access harder, and names the user in the log lines of a login and a logout. It fixes the
Major finding of the review report on the password change and the sessions, except its admin part, and several
smaller findings next to it.

## Users and roles

- Every account, of the type user or admin, changes its own password and logs out its other browsers.
- Only an account of the type user has connected apps, so only a user can choose to disconnect them with a password
  change, and only a user approves apps on the consent page.
- Nobody changes the password or ends the sessions of another account.

## Scenarios

- A user suspects that a colleague saw the password. The user opens the own account page, clicks "Change password",
  enters the current and the new password and ticks that the connected apps are disconnected as well. All other
  browsers of the user are logged out, the current one stays logged in, and every AI app has to be connected again.
- A user left the wiki logged in on a shared computer. From another browser the user opens the own account page and
  logs out all other browsers.
- Someone with a stolen session cookie tries to guess the current password at the password change. After a few wrong
  tries every further try has to wait, as at the login, and the tries count against the same waits as guesses at the
  login.
- Someone with a stolen session cookie opens the consent page of an AI app to get access that outlives the session.
  The consent page asks for the password, which the thief does not know.

## Requirements

### Own password change

- R1: Every account must be able to change its own password at any time after the first password change, in the
  dialog "Change password" of the own account page `/account`, at `/account?action=change-password`, with the current
  password, the new password and its repetition.
  - Acceptance: a user and an admin each open the dialog from a button on `/account`, change their password and log
    in with the new one; the old one is refused. The address of the dialog opens it directly.
- R2: A new password must follow the same rules as at the forced password change.
  - Acceptance: a common password, one built only from the user name or a context word, one equal to the current
    password, one that is too short or too long, and a repetition that differs are refused with the same messages as
    at the forced change, and nothing changes.
- R3: A password change must end all other sessions of the account, and the browser that made the change must stay
  logged in.
  - Acceptance: with the account logged in in two browsers, a change in one of them logs the other out at its next
    request, and the first one goes on without a new login.
- R4: A user who has at least one connected app must be able to choose, at the change, that all connected apps are
  disconnected as well. The choice, "Also disconnect all my apps", is not ticked when the dialog opens, and it is not
  shown to an admin, to a user without apps, or while OAuth is off.
  - Acceptance: with the choice ticked, every connected app of the user is gone from the list and its tokens are
    refused; without it, every app stays and works. A user without apps and an admin see no such choice.
- R10: After a successful change the dialog closes and `/account` shows a short message that the password was changed
  and the other browsers were logged out, and, when chosen, that the apps were disconnected. The message is shown once
  and is gone after a reload.
  - Acceptance: the message names exactly what happened, and a reload of `/account` shows no message.
- R17: When the password was changed but disconnecting the apps fails, the password must stay changed and the other
  browsers logged out, and `/account` must say that the apps could not be disconnected and ask the user to revoke them
  in the list. The failure is logged.
  - Acceptance: with the disconnect made to fail, the new password works, the message asks to revoke the apps, and
    the apps are still listed.
- R13: When the password hashing is busy, the change must be answered as busy and change nothing, as the forced change
  is.
  - Acceptance: a change that gives up waiting for the hashing keeps the old password, the sessions and the apps.

### Logging out other browsers

- R5: Every account must be able to end all its other sessions without changing the password, while the current
  browser stays logged in. The button "Log out other browsers" on `/account` opens a confirmation dialog at
  `/account?action=log-out-others`; confirming ends the other sessions. No password is asked.
  - Acceptance: with the account logged in in two browsers, confirming in one of them logs the other out at its next
    request; closing the dialog without confirming ends nothing.
- R11: After the other sessions are ended the dialog closes and `/account` shows a short message that the other
  browsers were logged out.
  - Acceptance: the message is shown after confirming, also when there was no other session, and a reload of
    `/account` shows no message.
- R18: When ending the other sessions fails, the dialog must stay open with a general error that says the other
  browsers may still be logged in; nothing may claim success. The failure is logged.
  - Acceptance: with the database made to fail, the dialog shows the error and no success message.
- R14: Both dialogs must work for both account types, and `/account` must keep showing the not-found page for every
  other action, as today.
  - Acceptance: a user and an admin open both dialogs at their addresses; an unknown action is not found.

### Wrong passwords

- R6: A wrong current password at a password change, the forced one included, must count as a failed login of the
  account's user name from the client address group of the request, with the waits of "Failed logins" in
  `users-and-login.md`.
  - Acceptance: after 5 wrong current passwords from one group, the next try is refused with the wait of the login,
    without checking the password; a login of the same name from the same group has to wait as well.
- R15: A change or an approval refused because of a wait must say at the password field "Too many wrong passwords.
  Please try again in N minutes." with the wait, change and approve nothing, and keep the other values of the form
  except the passwords.
  - Acceptance: during a wait the message names the minutes, and the password is unchanged or no grant is created.
- R16: A right password at the change and on the consent page must count like a successful login: it counts in the
  hour of the name and forgets the count of its name and group.
  - Acceptance: after 4 wrong current passwords and a right one from one group, the next 5 wrong tries are needed
    before a wait.
- R9: A wrong password on the consent page must count as a failed login in the same way.
  - Acceptance: after 5 wrong passwords on the consent page from one group, the next approval is refused with the
    wait, without checking the password, and no grant is created.

### Password before approving an app

- R7: A user must enter the own password on the consent page before every approval of an AI app, whatever lifetime is
  chosen. "Deny" needs no password.
  - Acceptance: an approval without the password or with a wrong one creates no grant and no code, and says "Wrong
    password" at the password field while the chosen lifetime stays; with the right one the app is connected as
    today.

### Log lines

- R8: The log line of a successful login must name the user and the client address group, and the log line of a
  logout must name the user.
  - Acceptance: the log of a login shows the user id, the user name and the group; the log of a logout shows the user
    id.
- R12: An own password change must be logged as an info line with the user id, the user name, whether the apps were
  disconnected and how many; ending the other sessions as an info line with the user id, the user name and how many
  sessions were ended. A wrong password at the change or on the consent page is logged like a failed login. No
  password is ever logged.
  - Acceptance: the log of each action shows these fields and no password.

## Scope

- In: the own password change of every account, logging out the other browsers, disconnecting the apps at a change,
  counting wrong passwords at the change and on the consent page like failed logins, the password on the consent page,
  the user in the log lines of login and logout.
- Not in: ending the sessions or the apps of another account by an admin (this part of the Major finding stays open in
  the review report), a list of the own sessions, a password reset by an admin, a minimum password length of 15, the
  expiry of first passwords, a notification of a password change, a second factor, written decisions on the session
  lifetime.

## Effect on existing features

- Login and users (`users-and-login.md`): the limits "no change of the own password after the forced password change"
  and, in part, "a password change does not end the connected apps of the user" are lifted. Wrong current passwords at
  the forced change now count as failed logins, a right one counts like a successful login, and a wait there gets the
  wording "Too many wrong passwords". The limit that a password change is not atomic holds for the own change as well.
- Connected apps (`connected-apps.md`): `/account` gets the button and the dialog of the password change and the
  logout of other browsers, for both account types; the limits on the password change are lifted.
- OAuth (`oauth.md`): the consent page asks for the password before "Approve", and wrong passwords count as failed
  logins.
- Review report: the Major finding on the password change and the sessions is reduced to its admin part; the findings
  on wrong current passwords, on the log lines of login and logout, and the question on approving an OAuth grant
  without a new authentication are fixed.
- Roadmap: "Own password change" and "Ending all sessions at once" are covered.

## Decisions

- The own password change, the logout of other browsers, disconnecting the apps on choice, counting wrong passwords,
  the password on the consent page and the log lines are in scope; the user chose them from the related findings of
  the review report.
- A password change always ends the other sessions; disconnecting the apps is the user's choice, because a routine
  change should not force every app to be connected again.
- The password change is a dialog of `/account` at its own address, like "Revoke app", so that the page stays short
  and the dialog can be linked. Rejected: a form always shown on the page, and a page of its own.
- Wrong passwords at the change and on the consent page count against the waits of the login, so that a stolen session
  gives no more guesses than the login page already does. Rejected: also ending the session after 5 wrong passwords,
  and a count of its own.
- The consent page asks for the password before every approval, because connecting an app is rare and the rule is the
  same for every lifetime. Rejected: only for grants longer than 30 days, and skipping it when the password was entered
  a few minutes before.
- The choice to disconnect the apps is not ticked and is shown only to a user with apps, so that a routine change keeps
  the apps and nobody sees a choice that does nothing. Rejected: ticked by default, and shown to every user.
- Logging out the other browsers asks for a confirmation but not for the password, because ending sessions only
  protects the account. Rejected: ending them at one click, and asking for the password.
- After a change or a logout of the other browsers, `/account` says what happened. Rejected: leading to the start
  page like the forced change, and closing the dialog without a message.
- The password change and the logout of other browsers are logged with the user and the counts, so that an operator
  can follow what happened to an account. Rejected: lines with the user only, and no lines.
- Because wrong passwords at the change count against the waits of the login, someone who guesses a user's password at
  the login also makes the user's own password change wait, with `HIPPOWIKI_TRUSTED_PROXIES=0` from anywhere, up to 15
  minutes or the rest of the hour. This is accepted and written into the spec: the guesser does not know the password,
  the sessions of the user keep working, and logging out the other browsers needs no password. Rejected: letting a
  session pass the waits of the login, which needs a count per session.
- A wait at the change and on the consent page has its own wording, "Too many wrong passwords", because it is not a
  login. Rejected: the wording of the login.
- The dialog that logs out the other browsers is at `/account?action=log-out-others`, after the text of its button.
  Rejected: `?action=end-sessions`.
- A right password at the change and on the consent page counts like a successful login, so that the three forms
  behave alike. Rejected: only the login forgets the count.
- When disconnecting the apps fails after the password was changed, the change stays and the user is told to revoke
  the apps, because a changed password and logged-out browsers are the more urgent part. Rejected: disconnecting the
  apps first, which could lose them without a change.
- A failure to log out the other browsers is shown in the dialog, not on the error page as a failed logout: the
  current browser is still logged in and can try again, and the message does not claim that anything ended. Rejected:
  the error page.
- The admin part of the Major finding is left open. Rejected: documenting it as a decision, and adding it to this
  feature.
- Not chosen: the admin ending the sessions or the apps of another account, a list of the own sessions, written
  decisions on the session lifetime, and a password reset by an admin.

## Open questions
