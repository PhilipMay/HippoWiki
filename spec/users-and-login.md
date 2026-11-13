# HippoWiki – Users and Login

The users and login feature as built: HippoWiki can only be used after logging in with a user name and a password.
One admin account is created on the first start; the admin creates and lists all other accounts, and every account
sets its own password at the first login. Everyone who is logged in can read and change all content; there are no
rights yet.

Code: `src/features/users/` (the accounts), `src/features/auth/` (login, logout, the session, the login wait and the
forced password change), `src/lib/auth.ts` (the Better Auth instance), `src/lib/client-address.ts`,
`src/lib/password-hash.ts`, `src/proxy.ts`, `scripts/admin.ts` and the routes `src/app/login/`,
`src/app/change-password/` and `src/app/users/`. The models are `User`, `Account`, `Session`, `Verification`,
`AuthSecret`, `LoginAttempt` and `LoginWindow` in `prisma/schema.prisma`; the first four have the shape that Better
Auth and its `username` plugin expect. The admin setup in the container image is described in `container-image.md`.

Tests: `e2e/login.spec.ts`, `e2e/change-password.spec.ts`, `e2e/users.spec.ts`, `e2e/access.spec.ts`,
`integration/auth-service.test.ts`, `integration/user-service.test.ts`, and the unit tests next to the code, such as
`src/features/auth/service.test.ts`, `src/features/auth/wait.test.ts` and `src/lib/client-address.test.ts`.

## User names and email

- A user name follows the name rule of folders, tabs and pages (`src/lib/names.ts`), so it can be part of an address
  as it is. It is 3 to 30 characters long and unique. Surrounding spaces are removed. The rules are in
  `src/features/users/schema.ts`.
- The admin is the user named `admin`. There is no role column.
- Each user gets a hidden placeholder email in the reserved domain `.invalid`, because Better Auth needs an email
  address. It is never shown and no mail is sent.
- Users are written with Prisma, not through the sign-up of Better Auth, which stays disabled.
  `src/features/users/records.ts` is the one place that knows the shape of the rows of a user; an integration test logs
  in through Better Auth with such a user, so a change of the shape in a later Better Auth version is noticed.

## Passwords

- A password is 8 to 128 characters long, counted as the length of the string, as Better Auth counts it. The upper
  limit protects the password hashing from very long inputs.
- Any characters are allowed, spaces and non-Latin letters included. Nothing is trimmed or normalised, and there are no
  composition rules such as "must contain a digit".
- A password must not be the same as the user name. A new password must differ from the current one and is entered
  twice.
- A password is never logged, and only its hash is stored.
- Passwords are hashed with Argon2id at the minimum settings of OWASP (`src/lib/password-hash.ts`). Better Auth handles
  the login, the sessions and the logout; only its password hashing is replaced.
- One server process runs only a few hashes at the same time; further callers wait in the order they came and give up
  after a while. A login, password change or user creation that gives up is answered as busy and writes nothing.

## Admin account and setup

- There is exactly one admin account, named `admin`. The admin can see and change all content like every other user,
  and is the only one who lists and creates users.
- The admin setup (`scripts/admin.ts`, `ensureAdmin()` in `src/features/users/service.ts`) creates the admin with the
  password from `HIPPOWIKI_ADMIN_PASSWORD` when there is none, as a first password that must be changed at the first
  login. When the admin exists, it does nothing and does not look at the password; changing the variable later does
  not change the password.
- A missing or invalid password creates nothing, and the setup fails. Two setups at the same time create one admin.
- Only the admin setup reads `HIPPOWIKI_ADMIN_PASSWORD`; the server never does.
- In development it runs as `npm run admin:setup`; in the container image on every start (see `container-image.md`).

## Login and logout

- Users log in at `/login` with a user name and a password. There is no self-sign-up, no "forgot password" link and
  no mail.
- A login leads to `/folders`, or to the password change when it is pending. A user who is logged in and opens
  `/login` is led there as well.
- An unknown user name and a wrong password get the same answer, and both compute one hash, so nobody can find out
  which names exist. A name that breaks the name rule and a password of more than 128 characters cannot belong to a
  user; they are answered like a wrong password, without a hash.
- The header shows the name of the logged-in user and "Log out", a plain form that works without JavaScript. Logging
  out ends the session of the browser and leads to the login page; the other sessions of the user stay.
- After a login and a logout every route is revalidated, so that the header and cached pages follow the new session.
- Better Auth is called only on the server. Its route handler is not mounted, so there is no `/api/auth/...` and no
  public endpoint to sign up or to sign in past the login wait.

## Sessions

- A session lasts 30 days from the login and is not extended by use. Every check of a session reads the database, so
  an ended session is refused at once.
- A user can have several sessions at the same time, one per browser.
- The session cookie cannot be read by scripts (`HttpOnly`), is sent with same-site requests and top-level navigations
  only (`SameSite=Lax`) and is `Secure` when `NODE_ENV` is `production`. Browsers keep `Secure` cookies on `localhost`
  as well.
- The secret that signs the cookies is generated on first use and stored in `AuthSecret`; processes that start
  together sign with the same one. There is no variable for the secret and none for the public address of the wiki.

## Failed logins

Two limits hold back the guessing of passwords; their numbers are defined in `src/features/auth/wait.ts`. A login is
refused while either of them asks for a wait:

- Per user name and client address group: after 5 failed logins in a row for a name from one group, the next login
  for that name from that group has to wait 1 minute. Each further failure doubles the wait, up to 15 minutes.
  Failures more than 24 hours apart are not in a row.
- Per user name alone: at most 20 logins are counted per name and hour, from all groups together. The hour starts with
  the first login that is counted; a further login waits until the hour is over, and the login after that starts a new
  hour.

What a user and an operator can rely on:

- A login during a wait is refused with the longer of the two waits, without checking the password and without being
  counted. The log line says which limit asked for the wait.
- Every other login is counted in both limits before its password is checked, or in neither. Logins at the same time
  therefore get no more guesses than logins one after another: 5 per group, one more after each wait, and 20 per name
  and hour. The others are refused with the wait, whatever their password.
- A login that cannot be counted, because the database fails, is answered with the general error, without checking the
  password.
- A successful login forgets the count of its name and group and the hour of its name. The counts of the name from
  other groups stay.
- A login whose password was not checked, because the hashing was busy or something failed, takes its counts back, so
  that a wait that was over does not start again.
- An unknown name is counted and has to wait like a known one. A name that breaks the name rule is not counted,
  because it cannot belong to a user and the tables would otherwise take any text.
- A password of more than 128 characters for a valid name counts as a failure.
- The counts are stored in the database, so they survive a restart of the server. Counts that no wait needs any more
  are deleted by later logins.
- How the counting works (conditional writes, the retries, taking a count back, the deleting) is described in
  `src/features/auth/service.ts`.

The client address group (`clientAddressGroup()` in `src/lib/client-address.ts`):

- The login action reads it from the headers of the request, because `/login` does not pass `src/proxy.ts`, and passes
  it to the auth service as a plain argument.
- With `HIPPOWIKI_TRUSTED_PROXIES=0`, the default, no header is read and every login is in the group `shared`: the
  wait then counts per user name alone.
- With `HIPPOWIKI_TRUSTED_PROXIES=n`, the group comes from the n-th entry from the right of `X-Forwarded-For`, the
  address that the outermost trusted reverse proxy saw. The leftmost entry is never used, because a client can write
  it. `X-Real-Ip` and `Forwarded` are never read. What the environment has to provide for this is described in
  `container-image.md`.
- An entry that is missing or not an address puts the login into `shared`, and the action logs a warning with the
  reason, without the value of the header. A login never goes uncounted because its address is unknown.
- An IPv4 address is its own group. An IPv6 address is in the group of its /64, because one customer controls at least
  that many addresses; an IPv4-mapped IPv6 address counts as its IPv4 address.
- The service trusts no caller: a value that is not a group as `client-address.ts` writes them counts in `shared`, and
  an error is logged.
- Every log line of a login has the group next to the name.

## Authenticated access only

Nothing can be read or changed without a login. Only the login page and `/api/health` are public. The login is checked
in two layers, as the authentication guide of Next.js describes:

- `src/proxy.ts` sends every request without a session cookie to the login page, without asking the database. Only the
  login page, `/api/health` and the static files of Next.js (`/_next/static/`) pass it; the image optimizer of Next.js
  is behind the login like every other address. A Server Action called without the cookie leads to the login page as
  well, with a full page load instead of the error page.
- `requireUser()` in `src/features/auth/session.ts` checks the session in the database. Every page, every query and
  every Server Action calls it first; it is the layer that protects the data. Without a session it leads to the login
  page, and while the first password is pending, to the password change. Pages call it before they read the query
  string, so that an invalid address also leads to the login page.
- An address that does not exist stays "not found" for everyone who has a session cookie.
- `not-found.tsx`, `error.tsx` and `global-error.tsx` show no data and have no check. Without a user the header shows
  no menu.

## Forced password change

- Whoever logs in with a first password, the admin after the admin setup and every new user, must set a password of
  their own at `/change-password` before doing anything else. Every other address leads there; logging out stays
  possible. The header shows the name and "Log out", but no menu.
- The form asks for the current password, the new one and its repetition, by the password rules above.
- The change ends all sessions of the user and starts a new one for the browser that made the change, so the other
  browsers of the user are logged out.
- The pending change is cleared only after the password has changed. If that fails, the user changes the password once
  more.
- After the change the user lands on `/folders`. A user without a pending change who opens `/change-password` is led
  there too.

## User list and creating users

- Only the admin sees the user list, at `/users`, with every user, the time it was created and whether its password
  change is pending. The header shows the menu entry "Users" to the admin only; for every other user `/users` is not
  found, with and without an action.
- Only the admin creates users, in the "New user" dialog at `/users?action=create`. The admin enters a user name;
  HippoWiki generates a first password and shows it exactly once, for the admin to pass on. The new user has to change
  it at the first login.
- A generated password is 20 characters long, drawn from a cryptographic random source from letters and digits that are
  not easy to confuse.
- The password is not part of an address or of a stored page, and it is gone after a reload. The dialog closes only
  through its link back to the user list, so that it cannot be lost by a stray click.
- A form cannot choose the password or skip the password change: only the name is read.
- No user name has to be reserved for an address of its own, so `/users/<name>` stays free for every valid name.

## Routes

- `/login`: the login form. Public.
- `/change-password`: the forced password change. It needs a session; without a pending change it leads to `/folders`.
- `/users`: the user list, with the action `create` for the "New user" dialog. For the admin only.
- None of the three has views, and only `/users` has an action; any other action or view shows the not-found page.

## Decisions

- Two features: `users` writes accounts with Prisma and the password hashing and does not use Better Auth; `auth` is
  the only code that uses Better Auth, through `getAuth()`. A lint rule keeps `@/lib/auth` to the auth service and
  `src/lib/`.
- A login is counted with conditional writes of the Prisma client, repeated when another login got in between,
  instead of one SQL statement that checks the wait and counts: the rules of the waits stay in `wait.ts` alone and are
  not written a second time in SQL.
- The two counts of a login are written in one interactive transaction, so that a login is counted in both limits or
  in neither and no login slips past one of them.
- The limit per user name is an hour window and not a count of failures in a row. One address gets 5 guesses at once
  and then one more after each wait, so it would reach 20 failures in a row after about 3 hours and could then hold a
  wait for the name with one request every 15 minutes. In one hour a single address manages 11 counted logins at most,
  and 4 per hour after that, so it never fills the window.
- The wait is counted per user name and client address group, so the owner of an account does not share a wait with a
  stranger who guesses its password. The limit per name alone keeps a bound on the guesses for an account, however
  many addresses they come from.
- The client address comes from a number of trusted reverse proxies (`HIPPOWIKI_TRUSTED_PROXIES`), not from a list of
  their addresses: Next.js never shows the application the address of the connecting peer, so a list could not be
  checked anyway. Without the setting, no header is read.
- The login action reads the client address and the service takes the group as a plain argument, as it takes the
  `Headers`: the service stays free of forwarding headers and of the configuration of the deployment.
- An account is never disabled after many failures, unlike NIST SP 800-63B-4 asks after 100 failures in a row: with
  one admin and no mail there would be no way back in.
- A container needs `DATABASE_URL` and `HIPPOWIKI_ADMIN_PASSWORD` and nothing else, so the secret of the session
  cookies is stored in the database instead of a variable.
- Who is calling is found out in the adapters, from the session cookie. What the caller may do is checked in the
  service: a function of the users service that is for the admin only takes the acting user as its first argument
  and decides itself whether it is the admin (`isAdmin()` in `src/features/users/schema.ts`).
- The auth service takes the `Headers` of the request as an argument, because the session lives in a cookie. `Headers`
  is a web standard and not part of Next.js, so the service still works outside a request of Next.js. The functions
  that change the session also return the response headers that set or clear the cookie. In a Server Action the
  `nextCookies()` plugin of Better Auth has already applied them; a caller outside Next.js, such as the integration
  tests, passes them on itself.
- Better Auth logs through the pino logger, and only its errors. Its warnings repeat a refused login, which the auth
  service logs itself with the user name, or say that no base URL is set, which is on purpose: Better Auth uses it
  for its HTTP handler and for links in mails, and HippoWiki has neither.
- A logout that fails throws and shows the error page, because the button has no place for a message and a session
  that could not be ended must not look ended.
- The seed and the tests have a known admin and a known normal user (`prisma/known-users.ts`), both with the password
  change already done. The seed upserts them by name, because an admin that `npm run admin:setup` created has another
  id.

## Current limits

- no rights and roles: everyone who is logged in can read and change all content
- no way to reset a lost admin password; for now the only way is a change directly in the database
- no password reset by the admin for other users, so a lost first password cannot be replaced
- no change of the own password after the forced password change
- no deactivating or deleting of users
- no expiry of first passwords
- no page for each user, and no pages with an author
- no mail, no TOTP, no passkeys, no sign-in with other providers
- while the hour of a name is full, the right password is refused as well. Roughly 10 to 20 address groups that work
  together, or 4 unused ones every hour, can keep a name locked most of the time; a routed IPv6 /48 or a botnet
  provides them. Closing this needs a budget of its own for clients that have logged in before, see `roadmap.md`.
- no limit on logins per client address across user names; that is a task of the reverse proxy
- the group of an IPv6 address is always its /64; there is no setting for the prefix
- no audit log
- no HTTP API and no browser client of Better Auth
- no switch for session cookies without `Secure`: a production build needs HTTPS in front of it, or `localhost`
- no return to the address that was asked for after the login
- the password change is not atomic: Better Auth ends the sessions, stores the password and starts the new session in
  separate statements, and the flag is cleared after them
