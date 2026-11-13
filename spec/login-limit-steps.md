# Login Limit per Client Address – Steps

## Goal

Nobody can keep a user, above all the admin, out of the wiki from a single address any more. The wait after failed
logins counts per user name and client address, so the owner of an account no longer shares a wait with a stranger who
guesses its password. A second limit per user name alone keeps a bound on the guesses for an account, however many
addresses they come from. This fixes the Major finding "anyone can keep the admin locked out" in `security-review.md`.

## Scope

- In:
  - the client address group of a login, read from `X-Forwarded-For` only when `HIPPOWIKI_TRUSTED_PROXIES` says how
    many reverse proxies are in front of the server
  - the wait after 5 failed logins in a row, per user name and client address group
  - a limit of 20 counted logins per user name and hour, from all addresses together
  - deleting old rows of the two tables that count logins
  - the client address group in the log lines of refused logins
  - the documentation of the setup that the limit depends on, in `container-image.md`
- Not in:
  - a budget of its own for clients that have logged in before (device cookie, familiar addresses)
  - a limit per client address across all user names; that stays a task of the reverse proxy
  - the unlock command of `scripts/admin.ts`
  - a list of trusted proxy addresses, `X-Real-Ip` and the `Forwarded` header
  - a setting for the IPv6 prefix
  - a user name for the admin that is chosen at setup, and a second admin
  - a message at the start of the server about the configuration
  - a change to `src/proxy.ts` or to `HIPPOWIKI_LOG_CLIENT_ADDRESS`

## Design

The rules that span several steps. The wrap-up moves them into `users-and-login.md` and `container-image.md`.

- Two limits, and a login is refused while either of them asks for a wait:
  - per user name and client address group: 5 failed logins in a row, then a wait of 1 minute that doubles up to 15
    minutes, as `src/features/auth/wait.ts` has it today
  - per user name alone: at most 20 counted logins per hour, from all addresses together. A further login waits until
    the hour is over.
- The limit per user name is an hour window and not a count of failures in a row. One address gets 5 guesses at once
  and then one more after each wait, so it would reach 20 failures in a row after about 3 hours and would then hold a
  wait for the name with one request every 15 minutes, as it can today. In one hour a single address manages 11
  counted logins at most, and 4 per hour after that, so it never fills the window.
- During a wait the right password is refused as well, without a hash and without counting the attempt, as today.
- A login is counted in both limits before its password is checked, or in neither.
- A successful login deletes the count of its name and address and the hour window of its name. The counts of the
  name for other addresses stay.
- What stays open: the right password is refused while the hour window of a name is full. Roughly 10 to 20 address
  groups that work together, or 4 unused ones every hour, keep a name locked most of the time; a routed IPv6 /48 or a
  botnet provides them. Closing this needs a budget for clients that have logged in before
  (`reports/Login lockout and client IP handling.md`), which is not in scope.
- The account is never disabled, unlike NIST SP 800-63B-4 asks after 100 failures in a row: with one admin and no mail
  there would be no way back in.
- The client address group:
  - With `HIPPOWIKI_TRUSTED_PROXIES=0`, the default, no forwarding header is read and every client is in the group
    `shared`. The first limit then counts per user name alone, as before this plan.
  - With `HIPPOWIKI_TRUSTED_PROXIES=n`, the group comes from the n-th entry from the right of `X-Forwarded-For`: 1 for
    a single reverse proxy such as Traefik. The leftmost entry is never used, because a client can write it.
  - An entry that is missing or not an address puts the login into `shared`, and a warning is logged. A login never
    goes uncounted because its address is unknown.
  - An IPv4 address is its own group. An IPv6 address is in the group of its /64, because one customer controls at
    least that many addresses.
  - Next.js never shows the application the address of the connecting peer. The header can only be trusted when the
    server is reachable through the reverse proxy alone and the proxy replaces what the client sent. That is part of
    the setup and is documented in `container-image.md`.
- The login action reads the address, because `/login` does not pass `src/proxy.ts`. It passes the group to the auth
  service as a plain argument, so the service still knows nothing about forwarding headers.

## Checklist

- [x] Client address group
- [x] Limit per user name and hour
- [x] Wait per user name and client address
- [ ] Deleting old rows
- [ ] Wrap-up

## Client address group

### Goal

The server can tell from the headers of a request which client address group it came from, when it is configured to.
Nothing uses the group yet, so no behaviour changes.

### Build

- `src/lib/env.ts`: the variable `HIPPOWIKI_TRUSTED_PROXIES`, one digit from `0` to `9`, default `0`, read as a
  number. Any other value, such as `-1`, `1.5`, `10`, `one` or an empty string, stops the server like a wrong
  `HIPPOWIKI_LOG_CLIENT_ADDRESS`.
- `integration/setup.ts`: the mocked `getServerEnv()` returns the new variable as `0`.
- `src/lib/client-address.ts`, a pure module without server-only imports, next to `client-address-probe.ts`:
  - `SHARED_CLIENT_ADDRESS`, the group `shared`.
  - A function that takes the `Headers` of a request and the number of trusted proxies and returns the group, and,
    when it fell back to `shared` although a header was to be read, why: the header is missing, it has fewer entries
    than trusted proxies, or the entry is not an address.
    - With 0 trusted proxies it reads no header and returns `shared` without a reason.
    - It reads `X-Forwarded-For` only. `Headers.get()` joins several header lines with commas; the entries are split
      at the commas and trimmed, and the n-th from the right is taken.
  - The entry becomes a group as follows:
    - A port and the square brackets around an IPv6 address are dropped (`203.0.113.7:51234`, `[2001:db8::1]:443`),
      and so is a zone id (`fe80::1%eth0`).
    - What is left has to be an IPv4 or IPv6 address (`isIP()` of `node:net`).
    - An IPv4-mapped IPv6 address (`::ffff:203.0.113.7`) counts as its IPv4 address.
    - An IPv4 address is the group, in dotted form.
    - An IPv6 address gives the group of its /64 in one spelling: the first four blocks in lower case without leading
      zeros, then `::/64`, such as `2001:db8:0:1::/64`.
  - A function that says whether a string is a group as this module writes them: `shared`, an IPv4 address or a /64
    in that spelling. The auth service uses it in a later step.
  - The module does not log; its caller does.

### Test

- Unit tests in `src/lib/env.test.ts`: the default is 0, every digit is read as its number, and the values named above
  are rejected with the name of the variable in the error.
- Unit tests in `src/lib/client-address.test.ts`:
  - With 0 trusted proxies the group is `shared`, whatever the headers say, and no reason is given.
  - With 1, a single entry is the group, and of several entries the rightmost one is: a forged entry to its left
    changes nothing.
  - With 2, the second entry from the right is taken; with fewer than 2 entries the group is `shared` with the reason.
  - A missing header, an empty one and an entry that is not an address (text, `unknown`, an address with a path, an
    empty entry at the right end) give `shared` with the reason.
  - `X-Real-Ip` and `Forwarded` are never read.
  - IPv4, IPv4 with a port, an IPv4-mapped IPv6 address, IPv6 in short and in full spelling, in upper case, in
    brackets with a port and with a zone id each give the expected group. Two addresses of one /64 give the same
    group, two of different /64 give different ones.
  - The function that checks a group accepts `shared`, an IPv4 address and a /64 in the spelling of the module, and
    refuses a full IPv6 address, another spelling of a /64 and any other text.
- The commands in "When a step is done" in `spec/workflow.md` pass.

## Limit per user name and hour

### Goal

No more than 20 logins per hour are checked for a user name, wherever they come from. This bound is in place before
the next step lets every address count on its own.

### Build

- `prisma/schema.prisma`: the model `LoginWindow` with `username` as its id, `attempts` and `startedAt`
  (`@db.Timestamptz(3)`), documented like `LoginAttempt`: the logins counted for a submitted user name in the current
  hour, from all client addresses together, with no relation to `User`. A migration with
  `npm run db:migrate -- --name add_login_windows`.
- `src/features/auth/wait.ts`:
  - `MAX_ATTEMPTS_PER_WINDOW` (20) and `NAME_WINDOW_MS` (1 hour).
  - A pure function that returns how long a login for a name has to wait for its window, given the window and the
    current time: 0 without a window, for a window whose hour is over and for one with fewer than 20 attempts;
    otherwise the time until the hour is over.
- `reserveAttempt()` in `src/features/auth/service.ts`:
  - It reads the row of `LoginAttempt` and the row of `LoginWindow` for the name. If either asks for a wait, the login
    is refused with the longer of the two waits and nothing is written.
  - Otherwise it counts the login in both tables in one interactive transaction of the Prisma client
    (`getDb().$transaction(async (tx) => ...)`):
    - `LoginAttempt` as today, with the write that only succeeds if the row is still the one that was read.
    - `LoginWindow` without a row: a row with 1 attempt that starts now, with `createMany` and `skipDuplicates`.
    - `LoginWindow` with a row whose hour is over: 1 attempt that starts now, with an `updateMany` that names the old
      `attempts` and `startedAt` in its condition.
    - `LoginWindow` with a running hour: `attempts` incremented by 1, with an `updateMany` whose condition names the
      `startedAt` that was read and `attempts` below 20. Logins from different addresses then do not make each
      other read again.
  - If one of the two writes reports a count other than 1, the transaction is rolled back, by an error that only
    `reserveAttempt()` knows and catches, and the counts are read again. `MAX_RESERVE_ROUNDS` goes up from 10 to 50:
    with the transaction a round takes longer, and in the existing test of 20 logins at the same time with the right
    password, the successful ones delete the counts while the others still try, so some of them lost more than 10
    rounds. A round is only lost to another login for the name that wrote in between, at most twice per such login.
  - The reservation remembers the `startedAt` of the window it counted in.
- `releaseAttempt()` also takes the login back from the window: `attempts` decremented by 1 for the row with the
  remembered `startedAt` and `attempts` above 0. A window that the login started (there was none, or its hour was
  over) is deleted instead while it still has only this login, so that a name without a window has none afterwards.
  A database error is logged and does not change the answer, as today.
- `clearFailures()` also deletes the window of the name.
- The log line of a refused login says which limit asked for the wait.
- The rules of `logIn()` for what is counted stay: a name that breaks the name rule gets no row in either table, and a
  password of more than 128 characters is counted in both.
- The message of the wait in `src/features/auth/actions.ts` stays as it is; it now shows up to 60 minutes.
- The mocks of `@/lib/db` in `src/features/auth/service.test.ts` get the `loginWindow` functions and a `$transaction`
  that calls its callback with the same mocked functions.

### Test

- Unit tests in `src/features/auth/wait.test.ts` for the new function: no window, 19 and 20 attempts in a running
  hour, the last millisecond of the hour and the first one after it.
- Unit tests in `src/features/auth/service.test.ts`:
  - The first login for a name creates the window in a write that skips an existing row; a further one increments it
    only below 20 and for the `startedAt` it read; a login after the hour starts a new window only if the row is
    still the one it read. Each of them is counted before Better Auth checks the password.
  - With a full window the login is refused with the code `wait` and the time that is left of the hour, without a
    write and without a password check.
  - With a wait from both limits the longer one is returned.
  - When the write of the window or the write of `LoginAttempt` reports a count of 0, the counts are read again and
    the password is checked once; when this keeps happening, the answer is `failed` without a password check.
  - A successful login deletes the window of the name. A login that was not checked decrements it for the `startedAt`
    it counted in; an error in that is logged and the answer stays.
  - An error of the transaction gives `failed` without a password check.
  - The existing assertions on what is logged hold, and no password is logged.
- Integration tests in `integration/auth-service.test.ts`. A helper gets 20 logins for a name counted within the hour
  by moving `lastFailedAt` of its `LoginAttempt` row back after each failure, as `letTimePass()` does today.
  - The 21st login within the hour is refused with a wait of up to an hour, also with the right password, without a
    hash and without a change to either table.
  - Once the hour is over (`startedAt` moved back), a login is checked again and the window starts anew with 1
    attempt.
  - A successful login deletes the window of its name and keeps the windows of other names.
  - An unknown name is counted like a known one, and a name that breaks the name rule gets no window.
  - When the password hashing is busy, the window is as it was before the login, and a name without one has none
    afterwards.
  - With a window of 18 attempts, 10 logins at the same time (`Promise.all`) get exactly 2 password checks: the window
    has 20 attempts and `LoginAttempt` has 2 failures afterwards, so no login was counted in one table only.
- End-to-end test in `e2e/login.spec.ts`: with a full window for the known user, the right password shows "Too many
  failed logins. Please try again in 60 minutes.", and the admin can still log in.
- The commands in "When a step is done" in `spec/workflow.md` pass.

## Wait per user name and client address

### Goal

The wait after five failed logins holds back only the address group the failures came from. The owner of an account
logs in from another address while a stranger's address waits.

### Build

- `prisma/schema.prisma`: `LoginAttempt` gets the column `clientAddress` and the id `@@id([username, clientAddress])`.
  The migration is created with `--create-only` and edited by hand (see "Database" in `architecture.md`): the existing
  rows get the group `shared`, and the column keeps no default afterwards.
- `logIn()` in `src/features/auth/service.ts` takes the client address group as a third argument, after the headers.
  - The service trusts no caller: a value that is not a group as `src/lib/client-address.ts` writes them counts in
    `shared`, and an error is logged.
  - `reserveAttempt()`, `releaseAttempt()` and `clearFailures()` read, write and delete the row of the name and the
    group. Their conditional writes stay as they are, with the group added to every condition.
  - `LoginWindow` stays keyed on the name alone.
  - A successful login deletes the row of its name and group and the window of the name; the rows of the name for
    other groups stay.
  - Every log line of a refused login has the client address group next to the name.
- `logIn()` in `src/features/auth/actions.ts`:
  - It finds the group with `src/lib/client-address.ts` from the headers it already reads and from
    `HIPPOWIKI_TRUSTED_PROXIES` (`getServerEnv()`), and passes it to the service.
  - When the group fell back to `shared` although a header was to be read, it logs a warning with the reason. The
    value of the header is not logged; `HIPPOWIKI_LOG_CLIENT_ADDRESS` is there for that.
  - `logClientAddressProbe()` stays.
- `playwright.config.ts`: `HIPPOWIKI_TRUSTED_PROXIES` is `1` for the test server, so that a test can choose its
  address with an `X-Forwarded-For` header (`extraHTTPHeaders` of a browser context). A request without the header
  gets the address of the connection from Next.js.
  - Check this first, against the development server and against `next start`: the action must see the header that
    the browser context sends. If it does not, change the plan as `spec/workflow.md` describes before going on.
- `README.md` and `.env.example`: the variable, off by default, with a pointer to `spec/container-image.md`.
- The comments at the top of `service.ts` and of `wait.ts` and the documentation of `LoginAttempt` in the schema say
  what is counted per name and address and what per name.

### Test

- Unit tests in `src/features/auth/service.test.ts`:
  - Every read, write and delete of `LoginAttempt` names the user name and the group.
  - A value that is not a group counts in `shared` and is logged as an error.
  - A successful login deletes only the row of its group, and the window.
  - The log lines of refused logins carry the group.
- Unit tests in `src/features/auth/actions.test.ts`:
  - With 0 trusted proxies the service gets `shared`, whatever `X-Forwarded-For` says, and nothing is logged.
  - With 1 the service gets the group of the rightmost entry.
  - With 1 and no usable entry the service gets `shared` and a warning with the reason is logged, without the value
    of the header.
- Integration tests in `integration/auth-service.test.ts`:
  - The existing tests of the wait pass with the group `shared`.
  - After five failures from one address, a login from that address waits, and the right password logs in from
    another address. The row of the first address is still there afterwards, the row of the second and the window
    are gone.
  - The failures of one address do not count for another one: each address gets its own five.
  - Across addresses the hour window holds: after 5 failures from each of 4 addresses, the right password from a
    fifth address waits for the rest of the hour. The helper of the step before now uses addresses instead of moving
    `lastFailedAt` back.
  - 40 logins at the same time for one name from 8 addresses, 5 from each, get exactly 20 password checks, and no
    address gets more than 5.
- End-to-end tests in `e2e/login.spec.ts`, with one browser context per address:
  - After five wrong passwords from one address the right password is refused there with the message of the wait and
    logs in from another address. The row of `LoginAttempt` has the group of the first address.
  - A forged entry to the left of the address does not give a new budget: after five wrong passwords with
    `X-Forwarded-For: 203.0.113.7`, a login with `X-Forwarded-For: 198.51.100.9, 203.0.113.7` waits.
  - A header that is not an address counts in `shared`.
  - The existing tests pass; where they read or write a row of `LoginAttempt` by its user name, they name the group
    or use `updateMany` and `findMany`.
- Manual checks on the deployment, for the user, with `HIPPOWIKI_TRUSTED_PROXIES=1` behind Traefik:
  - A failed login from a known address outside the network of the server is logged with that address.
  - The same login with a forged `X-Forwarded-For` and `X-Real-Ip` is logged with the same address as before.
  - A failed login over IPv6 is logged with the /64 of the client. This was not checked on 2026-11-13.
- The commands in "When a step is done" in `spec/workflow.md` pass.

## Deleting old rows

### Goal

The two tables that count logins stay small, although every pair of a name and an address now has a row.

### Build

- `src/features/auth/wait.ts`: `ATTEMPT_RETENTION_MS` (24 hours). The longest wait is 15 minutes, so no row that still
  makes a login wait is older.
- After `reserveAttempt()` has counted a login, `logIn()` deletes, outside the transaction:
  - the rows of `LoginAttempt` whose `lastFailedAt` is more than 24 hours ago, of all names and groups
  - the rows of `LoginWindow` whose hour is over, of all names
- A database error in these deletes is logged and does not change the answer of the login.
- A login that is refused because of a wait, or for a name that breaks the name rule, deletes nothing.
- `prisma/schema.prisma`: an index on `lastFailedAt` of `LoginAttempt` and one on `startedAt` of `LoginWindow`, with a
  migration.
- Failures in a row are now failures with less than 24 hours between them: after a day without a login for a name and
  an address, the count starts again at 0.

### Test

- Unit tests in `src/features/auth/service.test.ts`:
  - A counted login deletes with the two times of the clock, for a wrong password and for a right one.
  - A login that waits and one with a name that breaks the name rule delete nothing.
  - When a delete fails, the error is logged and the login is answered as without it.
- Integration tests in `integration/auth-service.test.ts`:
  - After a counted login, a row of `LoginAttempt` of another name and address that is older than 24 hours is gone,
    and one that is 23 hours old is still there.
  - A window of another name whose hour is over is gone, and a running one is still there.
  - A row of the name itself that is older than 24 hours does not make the login wait: it counts as the first
    failure.
- The commands in "When a step is done" in `spec/workflow.md` pass.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the feature as built by extending the existing specs; update `architecture.md`, `testing.md` or `tech.md`
   where conventions changed.
   - `users-and-login.md`:
     - "Model": `LoginAttempt` with its new key, and `LoginWindow`.
     - "Failed logins": the two limits, the client address group, what a successful login deletes, what is taken
       back, and the deleting of old rows.
     - "Decisions": an hour window instead of failures in a row for the name, with the reason from "Design"; a number
       of trusted proxies instead of a list of their addresses; the action reads the address and the service takes
       the group; one transaction for the two counts; no disabling of an account, with the reference to NIST; a
       pointer to `reports/Login lockout and client IP handling.md`.
     - "Current limits": what stays open from "Design", in its own words; no limit per client address across user
       names; the /64 for IPv6 is fixed. Remove "no limit on logins per client address" and "old rows of
       `LoginAttempt` are never removed".
   - `container-image.md`:
     - "Configuration": `HIPPOWIKI_TRUSTED_PROXIES`, with its default and what each value does.
     - "What the environment has to provide": the port of the server reachable through the reverse proxy alone; a
       reverse proxy that replaces `X-Forwarded-For` of the client, which Traefik does by default; a container network
       that keeps the source address; the check with a known and a forged address; a limit per client address at the
       reverse proxy as before. The results of the checks of 2026-11-13 move here from the finding in
       `security-review.md`, with the date.
   - `architecture.md`: the arguments of the auth service under "Reads and writes", and that the login action reads
     the client address under "Login and sessions"; the transaction under "Database".
   - `testing.md`: how the end-to-end tests choose their address.
   - `security-review.md`:
     - Remove the finding "anyone can keep the admin locked out", set the summary to Major 0 and reword the sentence
       on the weaknesses.
     - In the finding "logins without an account can block all logins and grow the database", remove what is fixed:
       the rows that are never deleted, in the title, the problem, the impact, the evidence and the suggestion.
2. Update `roadmap.md`:
   - Remove "Login limit per client address".
   - Reword "Unlock command": it deletes the rows of `LoginAttempt` and `LoginWindow` of a user name.
   - Add a budget for clients that have logged in before, with the device cookie as the candidate and a pointer to the
     report.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: remove this step file, and update the entries of the specs whose content
   changed.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
- `security-review.md` has no finding left that this plan fixed, and its summary counts match its issues.
