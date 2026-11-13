# HippoWiki – Security Review

Open findings of the security review of 2026-11-12, to be fixed later. The review covered the deployment at
`https://hippowiki.maysprot.ddnss.eu/`, checked from outside with harmless requests only (no login attempts, no load),
and a read-only review of the code. It was checked again on 2026-11-13, against the code that now counts logins per
client address group and against the deployment, again with harmless requests only. The issues follow
`issue-report.md`. Remove an issue from this file once it is fixed.

## Issues

### Minor: logins without an account can block all logins

- **Location:** `src/lib/password-hash.ts` (`MAX_CONCURRENT_HASHES = 4`); `src/features/auth/service.ts`,
  `reserveAttempt()`; `src/features/auth/wait.ts`
- **Category:** security
- **Problem:** Every login with a valid-looking but unknown name costs one argon2 hash, unless its password is longer
  than 128 characters.
- **Impact:** A steady stream of such logins fills the 4 hash slots, so real users get "too many logins at the
  moment". Every new name also writes a row of `LoginAttempt`, kept for a day, and a row of `LoginWindow`, so such a
  stream makes the two tables grow, which otherwise stay small.
- **Evidence:** The hash limiter allows 4 hashes at a time and queues the rest for at most 10 seconds. The two limits
  of the login both count per user name:
  - 5 failed logins in a row per user name and client address group
  - 20 logins per user name and hour, from all groups together

  Neither counts across user names, so every new name starts with fresh counts.

- **Suggestion (optional):** A rate limit per client address in the reverse proxy of the deployment.
  `container-image.md` ("What the environment has to provide") already says that a reverse proxy can add it; the
  setup on the deployment is missing.
- **Alternatives:** A limit per client address group across all user names in the server, next to the two limits in
  `reserveAttempt()`. It needs `HIPPOWIKI_TRUSTED_PROXIES` of at least 1: with `0` every login is in the group
  `shared`, and the limit would hold back all users together.

### Nit: the runtime user can change the server code in the image

- **Location:** `Containerfile`, lines 58–67, the `COPY --chown=node:node` lines
- **Category:** security
- **Problem:** The files of the server belong to `node`, the user the server runs as.
- **Impact:** If an attacker ever runs code as `node`, they can change `server.js` for good, until the container is
  recreated.
- **Suggestion (optional):** Copy the files as root, without `--chown`, and give `node` write access only to
  `.next/cache`.

## Checked and Found Fine

- **TLS:** Let's Encrypt certificate, valid until 2027-02-10; TLS 1.0 and 1.1 are refused; plain HTTP gets a 308
  redirect to HTTPS.
- **Unauthenticated access:** Every address except `/login`, `/api/health`, `/_next/static` and `/_next/image`
  redirects to `/login` on the deployment, including `/.env`, `/.git/config` and `/api/auth/*`. The code now sends
  `/_next/image` to `/login` as well; the deployment still answers it until it runs a release with this change.
- **Forged session cookie:** It passes the proxy, but `requireUser()` sends the request to the login page. The HTTP
  handler of Better Auth is not mounted, so `/api/auth/*` answers 404.
- **Server Actions:** Every action and query calls `requireUser()` first, and admin-only functions check the role in
  the service, so posting an action to `/login` does not help. An action with a foreign `Origin` is refused on the
  deployment.
- **Forced password change:** `requireUser()` blocks every other action until the password is changed.
- **Sign-up and sessions:** Sign-up is disabled. The cookies are `__Secure-`, `HttpOnly` and `SameSite=Lax`.
  Changing the password ends all other sessions, and logging out deletes the session in the database.
- **User names:** Unknown names and wrong passwords get the same answer and both run a hash, so neither the answer nor
  its timing shows which names exist.
- **XSS and redirects:** No `dangerouslySetInnerHTML`, no raw HTML in Markdown, `javascript:` links are removed. The
  login takes no `next` parameter.
- **Information leaks:** `/api/health` returns only `{"status":"ok"}`, error pages show only a digest, and a spoofed
  `X-Forwarded-Host` does not change the redirect.
- **Host:** Of 14 common ports only 22, 80 and 443 are open; SSH (OpenSSH 10.6) accepts only keys.
- **Client address:** The client address group of a login comes from the n-th entry from the right of
  `X-Forwarded-For`, for n trusted reverse proxies (`HIPPOWIKI_TRUSTED_PROXIES`), so the leftmost entry, which a client
  can write, is never used. `X-Real-Ip` and `Forwarded` are never read, and with the default of `0` no header is read
  at all. A missing or invalid entry puts the login into the group `shared`, so it is still counted, and the auth
  service checks the group once more (`isClientAddressGroup()`). Not checked on the deployment yet: whether Traefik
  replaces a forged `X-Forwarded-For`, and whether the port of the server is reachable only through it (see "Things to
  Check" in `roadmap.md`).
- **Client address probe:** `HIPPOWIKI_LOG_CLIENT_ADDRESS` is off by default. It logs only seven forwarding and host
  headers, each cut to 200 characters, and never cookies, `authorization` or the body.
- **Container and dependencies:** The container runs as `node`; `npm audit --omit=dev` reports no vulnerabilities, also
  on 2026-11-13.
