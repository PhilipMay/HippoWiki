# Users and Login – Steps

## Goal

HippoWiki can only be used after logging in with a user name and a password. One admin account is created on the first
start from `HIPPOWIKI_ADMIN_PASSWORD`; the admin creates and lists all other accounts, and every account sets its own
password at the first login. Everyone who is logged in can read and change all content.

The rules of the feature are in `spec/users-and-login-requirements.md`. The steps refer to its sections by their
headings instead of repeating them. Where this plan is more specific than the requirements, the plan holds.

## Scope

- In:
  - password hashing with Argon2id and the limit on concurrent hashes
  - user accounts in the database, user name and password rules, the hidden placeholder email
  - the admin account and its setup, as an npm script in development and as `image-admin.sh` in the container image
  - login with user name and password, logout, sessions of 30 days, several sessions per user
  - authenticated access only: every page, route and Server Action needs a logged-in user, except the login page and
    `/api/health`
  - the wait after failed logins, the same for known and unknown user names
  - the forced password change after a login with a first password
  - the user list and the creation of users with a generated first password, both for the admin only
  - known users in the development seed and the test setup; end-to-end tests that log in once and reuse the session
  - the changes to the container image, its smoke test, `spec/container-image.md`, `.env.example` and `README.md`
- Not in:
  - rights and roles
  - resetting a lost admin password: for now the only way is a change directly in the database
  - password reset by the admin for other users
  - changing the own password after the forced password change
  - deactivating and reactivating users
  - expiry of first passwords
  - a page for each user
  - pages with an author
  - sending mail
  - TOTP, passkeys and sign-in with other providers
  - limits per client address
  - an audit log
  - the HTTP API and the browser client of Better Auth: no `/api/auth/...` route
  - a variable for the secret of the session cookies or for the public address of the wiki
  - a switch for session cookies without `Secure`
  - returning to the address that was asked for after the login
  - removing old rows of the failed login count

## Decisions

These hold for all steps. The wrap-up step moves them into the feature spec.

- Variables: a container needs `DATABASE_URL` and `HIPPOWIKI_ADMIN_PASSWORD` and nothing else. The secret that signs
  the session cookies is generated on first use and stored in the database, in a table with a single row.
- Only the admin setup script reads `HIPPOWIKI_ADMIN_PASSWORD`. It is not part of `serverEnvSchema`; the server never
  reads it.
- Session cookies are `Secure` when `NODE_ENV` is `production`. The browser reaches the wiki over HTTPS through the
  reverse proxy of the environment (Traefik), the container keeps speaking plain HTTP. Browsers also keep `Secure`
  cookies on `localhost`.
- Two features, like the two groups in `roadmap.md`:
  - `src/features/users/`: the accounts (rules, admin setup, list, create). It uses Prisma and the password hashing,
    not Better Auth.
  - `src/features/auth/`: login, logout, the session, the login wait and the forced password change. Its service is
    the only code that uses Better Auth, through `getAuth()` in `src/lib/auth.ts`.
- Users are written with Prisma, not through the sign-up of Better Auth, which stays disabled. A user is a `User` row
  and a credential `Account` row in the shape Better Auth expects. One helper holds that shape; the users service, the
  seed and the test helpers use it. An integration test logs in through Better Auth with such a user, so a change of
  the shape in a later Better Auth version is noticed.
- Better Auth is called only on the server, as `auth.api` from the auth service. Its route handler is not mounted, so
  there is no public endpoint to sign up or to sign in past the login wait.
- Who is calling is found out in the adapters, from the session cookie. What the caller may do is checked in the
  service: the users service gets the acting user as an argument and decides whether it is the admin (see "Reads and
  writes" in `architecture.md`). The admin is the user named `admin`; there is no role column.
- The auth service takes the `Headers` of the request as an argument, because the session lives in a cookie. `Headers`
  is a web standard and not part of Next.js, so the service still works outside a request of Next.js.
- The login is checked in two layers, as the authentication guide of Next.js describes:
  - `src/proxy.ts` sends every request without a session cookie to the login page. It only looks at the cookie.
  - `requireUser()` checks the session in the database, in every page, every query and every Server Action.
- An attempt that is refused during the login wait does not change the failure count.
- After the login the user lands on `/folders`, or on the password change when it is pending.
- An address that does not exist stays "not found" for everyone who has a session cookie.

## Checklist

- [x] Password hashing
- [x] User accounts and admin setup
- [x] Admin setup in the container image
- [x] Login and logout
- [x] Authenticated access only
- [x] Login wait after failed attempts
- [x] Forced password change
- [x] User list
- [ ] Creating users
- [ ] Wrap-up

## Password hashing

### Goal

Passwords can be hashed and checked with Argon2id, and one server process never runs more than 4 hashes at the same
time. Nothing uses it yet.

### Build

- Add `@node-rs/argon2` as a dependency. It is on the list of packages that Next.js keeps out of its bundles by itself
  (`serverExternalPackages`), so `next.config.ts` does not change.
- `src/lib/password-hash.ts` with `hashPassword(password)` and `verifyPassword(hash, password)`:
  - Argon2id with 19 MiB of memory (19456 KiB), 2 iterations and 1 lane. The settings are named in the code instead of
    relying on the defaults of the package.
  - The password is hashed as it is; nothing is trimmed or normalised.
- Both functions run through one limiter per process (see "Password hashing" in the requirements):
  - At most 4 hashes run at the same time. Further callers wait for a free slot, in the order they came.
  - A caller that has not got a slot after 10 seconds gives up with an error of its own class (`PasswordHashBusyError`),
    which the services turn into the code `busy`. It does not take a slot later.
  - A slot is freed when its hash has ended, also when it failed.
  - The limiter is a helper of its own that takes the work as a function, so that the unit tests can run it with a
    work function they control and with fake timers.

### Test

- Unit, `src/lib/password-hash.test.ts`:
  - The encoded hash starts with `$argon2id$v=19$m=19456,t=2,p=1$`.
  - A hash verifies with its password and not with another one.
  - A password with spaces at both ends, one with non-Latin letters and one of 128 characters verify only unchanged.
- Unit, the limiter:
  - Four callers run at once; the fifth starts when one of them has ended, and waiting callers start in their order.
  - A caller that waits 10 seconds is rejected with `PasswordHashBusyError` and its work never runs.
  - A slot is freed when the work rejects.
- No integration or end-to-end tests: the step has no database access and no behaviour in the browser.

## User accounts and admin setup

### Goal

The database holds user accounts, and the admin account can be created with a command in development. The seed
provides a known admin and a known normal user. There is no login yet.

### Build

- Add `better-auth` as a dependency. This step uses it only for its database schema.
- `prisma/schema.prisma` and one migration: the models `User`, `Session`, `Account` and `Verification`.
  - Take the fields from the schema that the CLI of Better Auth generates for the core tables and the `username`
    plugin (documentation of the installed version), then adapt them to the conventions of the existing models:
    PascalCase model names, UUID ids with `gen_random_uuid()`, `@db.Timestamptz(3)` for all times.
  - `User` gets the column `mustChangePassword`, a boolean that is true by default.
  - The user name is stored in the `username` field of the plugin; the `name` field of Better Auth gets the same value.
    The column is required, although the plugin declares it optional: every user of HippoWiki has a name.
- `src/lib/db-errors.ts`: the constant `USER_NAME` for the unique indexes on the user name and on the email of `User`.
  The email is derived from the name, so both stand for a taken name.
- `src/features/users/schema.ts`:
  - `ADMIN_NAME`, the name `admin`.
  - The user name: the name rule of `src/lib/names.ts` with 3 to 30 characters (see "User names" in the requirements),
    and a parse function for names from callers.
  - The password: 8 to 128 characters, counted as Better Auth counts them (the length of the string), nothing trimmed,
    no composition rules, and not the same as the user name (see "Passwords"). The length is checked with a `refine`
    on the length of the string, not with `.min()` and `.max()` of Zod, which count code points: with two measures a
    password of emoji could pass here and be refused by Better Auth.
- `src/features/users/records.ts`: the helper that builds the data of a new user for Prisma, without server-only
  imports:
  - the `User` row with the name, the placeholder email `<name>@users.hippowiki.invalid` (see "Email") and
    `mustChangePassword`
  - its credential `Account` row with the password hash, as Better Auth stores it (`providerId` `credential`,
    `accountId` the id of the user)
- `src/features/users/service.ts` with `ensureAdmin(password)` (see "Admin setup"):
  - If a user named `admin` exists, it does nothing and does not look at the password.
  - Otherwise it checks the password against the password rules, hashes it and creates the admin with
    `mustChangePassword` set.
  - It returns a `Result`: whether the admin was created, or a code for a missing password, an invalid password (with
    the field errors), `busy` and `failed`. A unique violation on the name counts as "exists".
  - It logs the events like the other services and never logs a password.
- `scripts/admin.ts`, the entry of the admin setup:
  - It reads `HIPPOWIKI_ADMIN_PASSWORD` from the environment and passes it to `ensureAdmin`.
  - It prints one line for "created" and one for "exists, nothing to do", and exits with 0.
  - For a missing or invalid password it prints a clear message to the error output, with the rule that was broken,
    and exits with 1. Any other failure also exits with a non-zero code.
  - It closes the database connection at the end, as `prisma/seed.ts` does.
- `package.json`: the script `admin:setup`, which runs `scripts/admin.ts` with `tsx` and loads `.env` when the file
  exists. The script itself does not import `dotenv`, because the same file is bundled for the image in the next step.
- `prisma/known-users.ts`: the names and passwords of the known admin (`admin`) and the known normal user (`alice`),
  for development and tests only. `prisma/seed.ts` upserts both by name, with fixed ids when it creates them, and
  with their known passwords and the password change already done. By name, because an admin that
  `npm run admin:setup` created has another id.
- `.env.example`: `HIPPOWIKI_ADMIN_PASSWORD` with a comment on who reads it.
- `README.md`: the known users after `npm run db:seed`, and `npm run admin:setup` in the list of commands.
- `src/features/services.test.ts`: add the users service.

### Test

- Unit:
  - `schema.test.ts`: user names of 2, 3, 30 and 31 characters, upper case, a leading, a trailing and a double hyphen;
    passwords of 7, 8, 128 and 129 characters, with spaces and non-Latin letters kept, and one equal to the user name.
  - `records.test.ts`: the rows of a new user, with the placeholder email and the credential account.
  - `service.test.ts` for `ensureAdmin`: an existing admin leads to no hash and no write; a missing and an invalid
    password write nothing; a unique violation counts as "exists"; any other database error gives `failed`; what is
    logged, and that no password is logged.
- Integration:
  - `integration/user-service.test.ts`: the first call creates the admin with `mustChangePassword` set, a credential
    account and a hash that verifies with the password; a second call changes nothing, also with another password and
    with none; a missing and an invalid password leave the table empty.
  - `integration/db-errors.test.ts`: a case for `USER_NAME`.
- End-to-end: none, the step has no behaviour in the browser.
- Manual, against the development database: `npm run admin:setup` without the variable and with a password of 7
  characters fails with its message and a non-zero exit code; with a valid password it creates the admin; a second run
  reports that the admin exists. `npm run db:seed` creates both known users.

## Admin setup in the container image

### Goal

A container creates the admin account when it starts for the first time, and does not start the server when it cannot.

### Build

- Add `esbuild` as a development dependency, and the script `build:admin` in `package.json`. It bundles
  `scripts/admin.ts` into one ESM file in `build/` (already ignored by Git):
  - Everything is bundled except `@prisma/client`, `pg`, `pino`, `pino-pretty` and `@node-rs/argon2`. These five stay
    imports, because the standalone output of Next.js carries them in `/app/node_modules`.
  - Do not use `--packages=external`: `zod` and `@prisma/adapter-pg` are bundled into the server by Next.js and are
    missing in the `node_modules` of the standalone output.
  - The format is ESM, because the generated Prisma client uses `import.meta.url`.
  - Check that ESLint ignores `build/`.
- `Containerfile`, with plain instructions only:
  - The `build` stage runs `npm run build:admin` after the build of the application.
  - The `app` stage copies the bundle to `/app`, and `node_modules/@node-rs` from the `deps` stage, so that the native
    build of Argon2 for the platform of the image is there, whatever the trace of Next.js contains.
  - It copies `scripts/image-admin.sh` next to the other two scripts.
- `scripts/image-admin.sh`: runs the bundle with `node` in `/app` and exits with its exit code. Like
  `image-migrate.sh`, it can be the command of a container of its own.
- `scripts/image-start.sh`: runs `./image-admin.sh` after `./image-migrate.sh` and before the server. A failure stops
  the start, as a failed migration does.
- `scripts/image.sh`, the smoke test, in this order:
  1. Before the first good start: a container without `HIPPOWIKI_ADMIN_PASSWORD` against the empty database must exit
     with a non-zero code, and so must one with a password of 7 characters. The table `User` must still be empty.
  2. The application container gets `HIPPOWIKI_ADMIN_PASSWORD`. After its start, `User` must have exactly one row,
     named `admin`, with `mustChangePassword` set.
  3. `@node-rs/argon2` must load and hash in `/app`, checked with `node` in the running container.
  4. The second application container starts against the same database without the variable. It must serve, and the
     admin row with its password hash must stay the same.
  5. `./image-admin.sh` in a further container, with another value in the variable, must exit with 0 and leave the
     admin row the same.
- `spec/container-image.md` (see "Admin setup" and "Container image" in the requirements):
  - a section on the admin setup: when it runs, how to run it in a running container and in a one-off container, what
    it prints, and its exit codes
  - the second variable under "Configuration", the new files in the introduction and under "Image", the new checks
    under "Smoke test", and the bundle with esbuild under "Decisions"
- `README.md`: the second variable and the admin setup in the section on the container image.

### Test

- `npm run image:build` and `npm run image:smoke` pass. The Podman machine needs 4 GiB of memory for the build.
- Manual: `npm run build:admin`, then the bundle run with `node` against the development database behaves like
  `npm run admin:setup`.
- No new unit, integration or end-to-end tests: the smoke test covers the step.
- Assumption to check: esbuild bundles `scripts/admin.ts` without errors, and the standalone output contains the five
  packages that stay imports. If one is missing, copy it from the `deps` stage like `@node-rs`.

## Login and logout

### Goal

A user can log in with a user name and a password and log out again. The header shows who is logged in. The content
can still be reached without a login; the next step closes it.

### Build

- `prisma/schema.prisma` and a migration: the model `AuthSecret` with a single row for the secret of the session
  cookies.
- `src/lib/auth.ts` with `getAuth()`, the single Better Auth instance (see "Login and logout", "Sessions", "User
  names" and "Password hashing" in the requirements):
  - It is created on first use and kept for the process, like the client of `getDb()`. Nothing happens on import,
    because `npm run build` runs without a database.
  - It reads the secret from `AuthSecret`. When there is no row, it inserts 32 random bytes, ignores a conflict with a
    row inserted at the same time, and reads the row again.
  - Prisma adapter for PostgreSQL with the client of `getDb()`; ids are generated by the database.
  - Email and password are enabled, with sign-up disabled, 8 to 128 characters, and `hashPassword` and
    `verifyPassword` from `src/lib/password-hash.ts` as its `password.hash` and `password.verify`.
  - The `username` plugin with the name rule as its validator; its length limits stay 3 to 30.
  - Sessions last 30 days and are never refreshed; the cookie cache stays off.
  - `mustChangePassword` as an additional field of the user that no input can set.
  - Cookies are `Secure` when `NODE_ENV` is `production`. Telemetry is off.
  - `nextCookies()` as the last plugin, so that a Server Action sets the cookie.
- `eslint.config.mjs`: `@/lib/auth` may only be imported in `src/features/auth/service.ts` and `src/lib/**`.
- `src/features/auth/`:
  - `schema.ts`: the input of a login. A name that breaks the name rule and a password of more than 128 characters
    cannot belong to a user; they are answered like a wrong password, without a hash.
  - `service.ts`:
    - `logIn(input, headers)` signs in through Better Auth and returns the user, or the code `invalid-credentials`
      (the same for an unknown name and a wrong password), `busy` or `failed`.
    - `logOut(headers)` ends the session of the request.
    - `logIn` and `logOut` also return the response headers of Better Auth, which set or clear the session cookie.
      In a Server Action `nextCookies()` has already applied them; a caller outside Next.js, such as the integration
      tests, passes them on itself.
    - `getSessionUser(headers)` returns the id, the name and `mustChangePassword` of the user of the session, or
      `null`.
  - `forms.ts` and `actions.ts`: the actions `logIn` and `logOut`.
    - The messages: "Invalid user name or password" and, for `busy`, "Too many logins at the moment, please try
      again".
    - On success both call `revalidatePath("/", "layout")`, so that the header and the cached pages of the browser
      follow the new session. `logIn` redirects to `/folders`, `logOut` to the login page.
  - `session.ts`: `getCurrentUser()`, which reads the headers of the request and calls `getSessionUser`, wrapped in
    React `cache()`.
  - `components/LoginForm.tsx`: user name and password, with the conventions for forms in `architecture.md` (focus,
    lock until hydration). After a failed login it keeps the name and empties the password.
- `src/app/login/page.tsx`: the login page. A logged-in user is redirected to `/folders`.
- `src/lib/addresses.ts`: `loginPath()`.
- `src/components/AppHeader.tsx`: the name of the logged-in user and a "Log out" button, a form with the `logOut`
  action. Without a user it shows neither of them. The menu stays for everyone in this step, because the content can
  still be reached without a login and the existing end-to-end tests use the menu without one; the next step hides
  it.
- Tests:
  - `e2e/support/database.ts`: `createUser()`, which inserts a user with a password through the helper of
    `records.ts`; any field can be set, and the hash of a password is computed once per process.
  - `resetTestDatabase()` leaves `AuthSecret` alone, because the running server keeps the secret, and restores the two
    known users of `prisma/known-users.ts` with fixed ids after it has emptied the tables.
  - The integration tests need empty tables: `integration/setup.ts` uses a variant that only empties them. It also
    provides what `getAuth()` reads from the environment, because CI has no `.env`.
  - `src/features/services.test.ts`: add the auth service.

### Test

- Unit:
  - `src/lib/auth.test.ts`: nothing is created on import; the secret is created once and read afterwards.
  - `schema.test.ts`, `forms.test.ts`, `service.test.ts` (with `@/lib/auth` mocked: every error of Better Auth gives
    its code, a name that breaks the rule and a password that is too long never reach Better Auth, what is logged) and
    `actions.test.ts` (every code gives its form state; success revalidates and redirects) of `src/features/auth/`.
- Integration, `integration/auth-service.test.ts`:
  - A user created by `ensureAdmin` and one built with `records.ts` can log in.
  - A wrong password and an unknown name give the same code.
  - The session ends 30 days after the login, and `getSessionUser` does not move that time.
  - Two logins of one user give two sessions; `logOut` ends only the one of the request.
- End-to-end, `e2e/login.spec.ts`:
  - A login leads to `/folders`, and the header shows the name.
  - A wrong password and an unknown name show the same message; the name stays in the form.
  - "Log out" leads to the login page, and the header shows no name.
  - A logged-in user who opens the login page lands on `/folders`.
  - No browser errors.
- `e2e/hydration.spec.ts`: a case for the login form.
- `npm run test:e2e:production` passes: the `Secure` cookie only exists in a production build.
- Assumptions to check, with what to do when one is wrong:
  - `better-auth/next-js` loads without Next.js, because it imports `next/headers` only when it is called. Then
    `services.test.ts` passes with `nextCookies()`. Otherwise drop the plugin: the service returns the cookie headers
    of Better Auth and the action sets them.
  - `auth.api` works without the route handler and without a base URL. If the installed version asks for a base URL,
    find out in its documentation what it is used for when only `auth.api` is called, before setting a fixed value. A
    variable for it is a change of scope.
  - Chromium keeps a `Secure` cookie on `http://localhost:3100`.

## Authenticated access only

### Goal

Nothing can be read or changed without a login. Only the login page and `/api/health` are public; every other address
leads to the login page.

### Build

- `src/features/auth/session.ts`: `requireUser()`, which returns the user of `getCurrentUser()` or redirects to the
  login page. It is the one place that decides whether a request may go on.
- `src/proxy.ts` (read the proxy documentation of the installed Next.js first):
  - A request without the session cookie of Better Auth is redirected to the login page. It reads the cookie with the
    helper of `better-auth/cookies` and does not ask the database.
  - Its matcher leaves out the login page, `/api/health` and the static files of Next.js.
  - A Server Action that the client of Next.js calls without the cookie, e.g. a form submitted after a logout in
    another tab, is not answered with an HTTP redirect: the client does not follow one and shows the error page
    instead. The proxy answers it the way Next.js answers an action that redirects to another site, with the address
    of the login page in the header `x-action-redirect`, which the client opens with a full page load. It recognises
    such a request by its `next-action` header. Both headers are internals of Next.js; an end-to-end test covers
    them.
  - Every other request that is not a read (not `GET` or `HEAD`) is redirected with 303 instead of 307, so that the
    browser asks for the login page with `GET` instead of sending the request again.
  - `eslint.config.mjs`: `src/proxy.ts` joins the files that must not use `console`.
- Every page under `src/app/folders/` and `src/app/deleted-pages/` and `src/app/page.tsx` call `requireUser()` first,
  before they read the query string, so that an invalid address also leads to the login page.
- Every query in `src/features/folders/queries.ts` and `src/features/pages/queries.ts` calls `requireUser()` after
  `connection()` and before the service.
- Every Server Action in `src/features/folders/actions.ts` and `src/features/pages/actions.ts` calls `requireUser()`
  first, outside its `try` blocks, because the redirect throws.
- `not-found.tsx`, `error.tsx` and `global-error.tsx` show no data and stay without a check.
- `src/components/AppHeader.tsx`: without a user it shows no menu.
- End-to-end tests that log in once (see "Tests" in the requirements):
  - `e2e/auth.setup.ts`, a Playwright setup project: it logs in on the login page as the known admin and as the known
    normal user and saves one storage state each in `e2e/.auth/`. Then it saves the rows of their sessions there too.
  - `playwright.config.ts`: the `chromium` project depends on the setup project and uses the storage state of the
    normal user. A spec that needs the admin or no user sets its own storage state.
  - `resetTestDatabase()` restores the saved session rows together with the known users, so the saved cookies stay
    valid after every reset. It works without the file, because the global setup resets before the login.
  - `e2e/global-setup.ts` removes the files of an earlier run.
  - `e2e/.auth/` is ignored in `.gitignore` and in `.containerignore`.
  - `e2e/smoke.spec.ts` resets the database before every test, like the other specs.
  - `e2e/login.spec.ts` runs without a storage state.
- `scripts/image.sh`, the smoke test: `/login` must answer 200 where it asked `/folders` before, and the static file is
  taken from the login page. `/folders` must redirect to the login page.
- `spec/container-image.md`: the smoke test as it is now; under "What the environment has to provide" the login
  replaces the protection from the public, and TLS in front of the container becomes a condition for the login,
  because the cookies are `Secure`; "no authentication" leaves the limits.
- `README.md`: the sentence about the single user without a login goes; `npm run test:e2e:ui` does not run the setup
  project by itself, so the section on the end-to-end tests says how to run it.

### Test

- Unit:
  - `queries.test.ts` of both features: every query calls `requireUser()` before the service.
  - `actions.test.ts` of both features: without a user no action reaches the service.
  - `session.test.ts`: `requireUser()` returns the user, and redirects to the login page without one.
- End-to-end, `e2e/access.spec.ts`, without a storage state unless noted:
  - The folder list, a folder, a tab, a page, a deleted page, an address with an action, an invalid address and an
    address that does not exist all lead to the login page.
  - `/api/health` answers 200.
  - With a session cookie that the server does not know, the folder list leads to the login page.
  - A Server Action that is submitted after the session has ended changes nothing and leads to the login page: once
    with the session gone from the database, once with the cookie gone from the browser.
  - With the storage state of the normal user and of the admin, the folder list opens.
- All existing specs pass unchanged, except `e2e/smoke.spec.ts`, `e2e/login.spec.ts` and one case of
  `e2e/hydration.spec.ts`: the page view has no button that needs JavaScript, but the header now has "Log out", so
  the case looks at the content only, and a new case checks that "Log out" works without JavaScript.
- `npm run test:e2e:production` passes.
- `npm run image:build` and `npm run image:smoke` pass.

## Login wait after failed attempts

### Goal

Guessing the password of a user name gets slow: after 5 failed logins in a row the next one has to wait, for known and
unknown names alike.

### Build

- `prisma/schema.prisma` and a migration: the model `LoginAttempt` with the submitted user name as its key, the number
  of failures in a row and the time of the last one. It has no relation to `User`, because unknown names are counted
  too.
- `src/features/auth/wait.ts`, a pure helper: the wait for a number of failures (see "Failed logins" in the
  requirements). Fewer than 5 failures give no wait, 5 give 1 minute, each further one doubles it, and it stops at 15
  minutes.
- `logIn` in `src/features/auth/service.ts`, in this order:
  1. A name that breaks the name rule is answered as before. It gets no row, because it cannot belong to a user and
     the table would otherwise take any text.
  2. It reads the row of the name. While the wait since the last failure is not over, it returns the code `wait` with
     the time that is left. It does not call Better Auth, so no password is checked, and it does not change the row.
  3. It signs in through Better Auth. A failure adds one to the count and sets the time, in one statement that also
     creates the row. A success deletes the row.
- `actions.ts`: the message for `wait`, with the minutes that are left. It is the same for known and unknown names.
- The service takes the current time from one place, so that the unit tests can set it.

### Test

- Unit:
  - `wait.test.ts`: the wait for 0, 4, 5, 6, 7, 8, 9 and 20 failures.
  - `service.test.ts`: during the wait Better Auth is not called and the row does not change; a failure counts; a
    success deletes the row; a name that breaks the rule gets no row.
  - `actions.test.ts`: the form state of `wait`.
- Integration, `integration/auth-service.test.ts`:
  - Five failures for a known name and for an unknown name give the same codes and the same wait.
  - During the wait the right password is refused; with the time of the last failure moved back by the wait, it is
    accepted and the row is gone.
  - The count is in the database: it is still there for a new instance of the service.
  - Each further failure after the wait doubles it, up to 15 minutes.
- End-to-end, `e2e/login.spec.ts`:
  - After five wrong passwords the right one is refused with the message of the wait.
  - With the stored time moved back in the test database, the right one logs in.
  - An unknown name shows the same messages.

## Forced password change

### Goal

Whoever logs in with a first password must set a password of their own before doing anything else.

### Build

- `src/lib/addresses.ts`: `changePasswordPath()`, the address `/change-password`.
- `src/features/auth/schema.ts`: the input of the password change, with the current password, the new one and its
  repetition (see "Passwords" and "Forced password change" in the requirements):
  - the new password follows the password rules of `src/features/users/schema.ts`, including "not the user name"
  - it differs from the current one
  - the repetition is the same as the new one
- `src/features/auth/service.ts`: `changeFirstPassword(input, headers)`:
  - It needs a session whose user still has `mustChangePassword` set.
  - It changes the password with `changePassword` of Better Auth, which checks the current password, and lets it end
    the other sessions of the user.
  - It then clears `mustChangePassword`, with `updateMany` and a check of the count.
  - Its codes: `invalid-input` with the field errors, `wrong-password`, `not-logged-in`, `not-required`, `busy` and
    `failed`.
- `forms.ts`, `actions.ts` and `components/ChangePasswordForm.tsx`: the form with its three fields. The action maps
  every code to a form state; on success it revalidates like the login and redirects to `/folders`.
- `src/app/change-password/page.tsx`: without a session it leads to the login page; for a user without a pending
  change it leads to `/folders`.
- `src/features/auth/session.ts`:
  - `requireUser()` also redirects to the password change while `mustChangePassword` is set. This sends every other
    address there, and stops every query and every Server Action.
  - `requireSession()` only asks for a session. The password change page and its action use it.
- The `logIn` action redirects to the password change when it is pending.
- `src/components/AppHeader.tsx`: while the change is pending it shows the name and "Log out", but no menu. `logOut`
  works without the change.

### Test

- Unit:
  - `schema.test.ts`: each rule of the new password, with one case that breaks only that rule.
  - `service.test.ts`: every code; the flag is cleared only after the password has changed.
  - `actions.test.ts`: every form state; where the login redirects with and without a pending change.
  - `session.test.ts`: `requireUser()` redirects to the password change, `requireSession()` does not.
- Integration, `integration/auth-service.test.ts`:
  - After the change the flag is cleared, the new password logs in and the old one does not.
  - A second session of the user is gone; the session of the request still works.
  - A wrong current password and a new password equal to the current one change nothing.
- End-to-end, `e2e/change-password.spec.ts`, with users that the test creates with `createUser()`:
  - A user with a first password logs in and lands on the password change.
  - The folder list, a page and an address with an action lead to the password change while it is pending.
  - "Log out" works while it is pending.
  - Each rule shows its error and keeps the user on the form.
  - After the change the user lands on `/folders`, and the next login needs the new password.
  - A second browser context of the same user is logged out by the change.
  - A user without a pending change who opens `/change-password` lands on `/folders`.
- `e2e/hydration.spec.ts`: a case for the password change form.

## User list

### Goal

The admin sees all users. Nobody else sees the list or its menu entry.

### Build

- `src/lib/addresses.ts`: `usersPath(action?)`, the address `/users`.
- `src/features/users/service.ts`: `listUsers(actor)` (see "User list" in the requirements):
  - It returns every user with the name, the time of creation and `mustChangePassword`, sorted by name.
  - It returns `null` when the actor is not the admin. The check uses `ADMIN_NAME` in one function that "Creating
    users" uses too.
- `src/features/users/queries.ts`: `listUsers()`, which calls `connection()`, `requireUser()` and the service with the
  user as the actor.
- `src/app/users/page.tsx`: the list, with the browser title from `pageTitle()`. It calls `notFound()` when the query
  returns `null`, and for every action and view in the query string.
- `src/features/users/components/UserList.tsx`: a row per user with the name, the time from `formatDateTime()` and a
  mark for a pending password change.
- `src/components/AppHeader.tsx`: the menu entry "Users", for the admin only.
- The matcher of `src/proxy.ts` already covers `/users`.

### Test

- Unit:
  - `service.test.ts`: a normal user as the actor gets `null` and the database is not asked.
  - `queries.test.ts`: the query awaits `connection()`, then `requireUser()`, then calls the service with the user.
- Integration, `integration/user-service.test.ts`: the list for the admin, in the order of the names and with exactly
  the declared fields; `null` for a normal user.
- End-to-end, `e2e/users.spec.ts`:
  - With the storage state of the admin: the list shows the known users and a user with a pending password change,
    with its mark; the header has the entry "Users".
  - With the storage state of the normal user: `/users` shows the not-found page, and the header has no entry "Users".
  - `/users?action=anything` is not found for the admin.
  - Without a storage state `/users` leads to the login page.

## Creating users

### Goal

The admin creates a user by name and gets a generated first password, shown exactly once, to pass on.

### Build

- `src/features/users/password.ts`: `generateFirstPassword()` (see "Creating users" in the requirements): 20
  characters, drawn with the random numbers of `node:crypto` from the letters and digits without `0`, `O`, `1`, `l`
  and `I`.
- `src/features/users/service.ts`: `createUser(actor, input)`:
  - It checks the actor first, then the name, then generates and hashes the password and creates the user through the
    helper of `records.ts`, with `mustChangePassword` set.
  - It returns the stored user together with the password. The password is returned this once and never logged.
  - Its codes: `not-allowed`, `invalid-input` with the field errors, `name-taken` (a unique violation of `USER_NAME`),
    `busy` and `failed`.
- `src/features/users/forms.ts` and `actions.ts`: the action `createUser`.
  - `not-allowed` leads to the not-found page, like the list.
  - `busy` shows "Too many logins at the moment, please try again".
  - On success it revalidates the user list and returns the name and the password in its form state. It does not
    redirect, because the password must not be part of an address or of a stored page.
- `src/features/users/components/CreateUserDialog.tsx`, built like `NameDialog` (`disablePortal`, `focusOnEntered`,
  lock until hydration):
  - First the form with the user name.
  - After the creation, in place of the form: the name, the password, a copy button, a note that the password is
    shown only this once, and a link back to the list.
- `src/app/users/page.tsx`: the action `create` opens the dialog at `/users?action=create`; a "New user" button links
  to it.

### Test

- Unit:
  - `password.test.ts`: the length, the characters that are left out, and that two passwords differ.
  - `service.test.ts`: every code; a normal user as the actor reaches neither the hash nor the database; the password
    is not logged.
  - `forms.test.ts` and `actions.test.ts`: every form state; success revalidates and does not redirect.
- Integration, `integration/user-service.test.ts`:
  - The created user has `mustChangePassword` set, and can log in with the returned password.
  - A taken name gives `name-taken`, also the name `admin`.
  - A normal user as the actor gets `not-allowed` and nothing is stored.
- End-to-end, `e2e/users.spec.ts`, with the storage state of the admin unless noted:
  - Creating a user shows a password of 20 characters; the copy button puts it on the clipboard; the list shows the
    user with a pending password change.
  - After a reload the password is gone.
  - A taken name, a name that breaks the rule and a name of 2 characters show their errors and keep the dialog open.
  - The whole chain: in a context without a storage state, the new user logs in with the password, has to change it
    and then reaches the folder list.
  - With the storage state of the normal user, `/users?action=create` is not found, and a crafted submission of the
    form creates no user.
- `e2e/hydration.spec.ts`: a case for the dialog.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built in `spec/users-and-login.md` (in the style of `pages.md`), with the decisions of this
   plan and the limits; update `architecture.md` (the features `users` and `auth`, `src/lib/auth.ts`,
   `src/lib/password-hash.ts`, `src/proxy.ts`, the session check in pages, queries and Server Actions, the actor in
   service functions, the new lint rule), `testing.md` (the setup project and the storage states, the known users,
   what `resetTestDatabase()` restores, the new integration tests) and `tech.md` (`@node-rs/argon2`, esbuild).
2. Remove the feature from `roadmap.md`: "authentication with Better Auth" in the list at the top ("pages with an
   author" stays), and the items named under "Roadmap items covered" in the requirements. "Ending Sessions on Password
   Change, Reset and Deactivation" stays, because only the forced password change is covered.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file and `spec/users-and-login-requirements.md`.
5. Update the spec catalog in `CLAUDE.md`: add `spec/users-and-login.md`, remove this step file and
   `spec/users-and-login-requirements.md`.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
