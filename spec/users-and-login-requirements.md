# HippoWiki – Users and Login: Requirements

The requirements of the users and login feature, before it is built. The step plan `spec/users-and-login-steps.md` is
written from this file; once the feature is built, the wrap-up step describes it as built in `spec/users-and-login.md`
and this file is removed.

## Goal

HippoWiki can only be used after logging in. There is one admin account, created on the first start from an
environment variable, and the admin creates and lists all other accounts. Everyone who is logged in, the admin
included, can read and change all content; there are no rights yet.

## Roadmap items covered

From "Users and Accounts" and "Authentication" in `roadmap.md`:

- Multi-User Accounts, Name Rules for Users, Permanent Admin Account, Admin Initialization Command
- User Creation with One-Time Password, Forced Password Change on First Login, Password Rules, User List
- Authenticated Access Only, Login with Name and Password, Fixed Session Lifetime, Multiple Sessions per User, Logout
- Ending Sessions on Password Change (only for the forced password change), Argon2id Password Hashing
- Login Wait After Failed Attempts, Limit on Concurrent Password Hashes, Protection Against Account Enumeration

## Authenticated access only

- Every page, route and server action needs a logged-in user. Nothing can be read or changed anonymously.
- Only the login page and `/api/health` are public.
- An address that needs a login leads to the login page.

## Login and logout

- Login, sessions, the session cookie and logout are built on Better Auth with its `username` plugin.
- Users log in with a user name and a password. There is no self-sign-up, no "forgot password" link and no mail.
- The header shows the name of the logged-in user and a logout action. Logging out ends the current session.

## Sessions

- A session lasts 30 days from the login and is not extended by use.
- A user can have several sessions at the same time, one per browser.

## Failed logins

- After 5 failed attempts in a row for a user name, the next attempt for that name has to wait 1 minute. Each further
  failure doubles the wait, up to 15 minutes.
- An attempt during the wait is refused without checking the password.
- A successful login resets the count.
- The count is stored in the database, so it survives a restart of the server.
- An unknown user name gets the same answer and the same wait as a known one with a wrong password, so nobody can find
  out which names exist.

## User names

- A user name follows the name rule of pages, tabs and folders in `content-structure.md`: lowercase letters and digits
  in groups joined by single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`). It can therefore be used in an address as it is.
- Its length follows the default of the `username` plugin: 3 to 30 characters.
- The rule replaces the character check of the `username` plugin; its length limits stay as they come.
- User names are unique.

## Email

- Better Auth needs an email address for each user. Each user gets a hidden placeholder address in the reserved domain
  `.invalid`, for example `<name>@users.hippowiki.invalid`.
- The address is never shown and no mail is sent.

## Passwords

- A password is at least 8 and at most 128 characters long. The upper limit protects the password hashing from very
  long inputs.
- Any characters are allowed, spaces and non-Latin letters included. Nothing is trimmed.
- There are no composition rules such as "must contain a digit or a special character".
- A password must not be the same as the user name.
- A new password must differ from the current one and is entered twice.

## Password hashing

- Better Auth keeps handling login, sessions, the session cookie and logout. Only its password hashing is replaced,
  through its `emailAndPassword.password.hash` and `verify` hook.
- Passwords are hashed with Argon2id from `@node-rs/argon2`, with at least the minimum settings of OWASP: 19 MiB of
  memory, 2 iterations and 1 lane.
- At most 4 hashes run at the same time in one server process. Further logins, password changes and user creations wait
  for a free slot.
- A request that has not got a free slot after 10 seconds gives up and shows "Too many logins at the moment, please try
  again".
- `@node-rs/argon2` is a native package with prebuilt builds for Linux arm64 and amd64. The container smoke test checks
  that it loads in the image.

## Admin account

- There is exactly one admin account, named `admin`.
- For now the admin can see and change all content like every other user. This may change once there are rights.

## Admin setup

- The admin is created by `image-admin.sh` in the container image, and by an npm script in development.
- `image-start.sh` runs `image-admin.sh` after the migration (`image-migrate.sh`) and before it starts the server. The
  script can also run on its own, like `image-migrate.sh`.
- If the database has no admin yet, the script creates it with the password from `HIPPOWIKI_ADMIN_PASSWORD`. The admin
  has to change that password at the first login.
- If the admin has to be created and `HIPPOWIKI_ADMIN_PASSWORD` is missing or breaks the password rules, the script
  fails with a clear message and a non-zero exit code, and the server does not start.
- Once the admin exists, the script does nothing and `HIPPOWIKI_ADMIN_PASSWORD` is ignored. Changing the variable later
  does not change the admin password.
- `spec/container-image.md` documents how the admin setup works: when it runs, how to run it in a running container and
  in a one-off container, what it prints, and its exit codes.

## Creating users

- Only the admin can create users, in a dialog at `/users?action=create`, in the same way as the dialogs of pages use
  `?action=…`. No user name has to be reserved for an address of its own, so `/users/<name>` stays free for every
  valid name.
- The admin enters a user name. HippoWiki generates a first password and shows it exactly once, with a copy button.
  The admin passes it on to the new user.
- A generated password is 20 characters long and leaves out characters that are easy to confuse (`0`, `O`, `1`, `l`,
  `I`).

## Forced password change

- After logging in with a first password, the admin and every new user must set their own password before they can do
  anything else. Every other address leads to the password change; logging out stays possible.
- Setting the new password ends the other sessions of the user.

## User list

- Only the admin sees the user list, at `/users`. Other users see neither the list nor its menu entry; for them
  `/users` is not found.
- The list shows every user with the name, when the user was created, and whether the user still has to change the
  first password.

## Container image

- `HIPPOWIKI_ADMIN_PASSWORD` becomes the second variable a container needs, next to `DATABASE_URL`.
- `spec/container-image.md`, `.env.example` and the smoke test change to match.

## Tests

- The development seed and the test setup provide a known admin and a known normal user, both with the password change
  already done, so that tests can log in directly.
- Separate tests cover the admin setup, the first login, the forced password change, the login wait and the limit on
  concurrent hashes.
- The end-to-end tests log in once and reuse the session.

## Not in scope

- Rights and roles
- Resetting a lost admin password: for now the only way is a change directly in the database
- Password reset by the admin for other users
- Changing the own password after the forced password change
- Deactivating and reactivating users
- Expiry of first passwords
- A page for each user
- Pages with an author
- Sending mail
- TOTP, passkeys and sign-in with other providers
- Limits per client address
- An audit log
