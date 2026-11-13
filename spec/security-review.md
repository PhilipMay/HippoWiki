# HippoWiki – Security Review

Open findings of the security review of 2026-11-12, to be fixed later. The review covered the deployment at
`https://hippowiki.maysprot.ddnss.eu/`, checked from outside with harmless requests only (no login attempts, no load),
and a read-only review of the code. The issues follow `issue-report.md`. Remove an issue from this file once it is
fixed.

## Summary

The authentication design holds: every page, query and Server Action checks the session again in the database, so
getting past the proxy does not help an attacker. The weaknesses are in the throttling of failed logins and in the
missing security headers.

- Blocker: 0
- Major: 1
- Minor: 3
- Nit: 2

## Issues

### Major: anyone can keep the admin locked out

- **Location:** `src/features/auth/service.ts`, lines 203–213, `logIn()`; `src/features/auth/wait.ts`,
  `waitAfterFailures()`
- **Category:** security
- **Problem:** The wait is keyed only on the user name, and during the wait the correct password is refused as well.
- **Impact:** From any address, five wrong passwords for `admin` and then one more each time the wait runs out keep the
  admin locked out for good, with about 100 requests a day. There is no unlock and no second admin.
- **Evidence:** `logIn()` returns the code `wait` without checking the password while `reserveAttempt(name)` reports a
  wait; the wait grows to `MAX_WAIT_MS` (15 minutes) and starts again with every further failure.
- **Suggestion (required):** Key the wait on the user name and the client address, and keep a much higher limit for the
  user name alone. The client address has to come from a header set by a trusted reverse proxy, which needs to be
  configured and documented in `container-image.md`.
- **Alternatives:** At least an unlock command in `scripts/admin.ts` that deletes the `LoginAttempt` row of a name.
  This does not stop the lockout, it only shortens it.

### Minor: no security headers

- **Location:** `next.config.ts` (no `headers()`); the reverse proxy sets none either
- **Category:** security
- **Problem:** The responses carry no `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`,
  `X-Content-Type-Options` or `Referrer-Policy`.
- **Impact:** Without HSTS, a first visit can be downgraded to plain HTTP. Nothing prevents clickjacking of actions
  such as deleting a page or creating a user from a same-site page, and there is no CSP as a second line of defence for
  Markdown written by users.
- **Evidence:** The response headers of `GET /login` on the deployment:

  ```text
  cache-control: private, no-cache, no-store, max-age=0, must-revalidate
  content-type: text/html; charset=utf-8
  vary: rsc, next-router-state-tree, ...
  x-powered-by: Next.js
  ```

- **Suggestion (required):** An `async headers()` in `next.config.ts` for `/:path*` with:
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
  - `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data:`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: same-origin`
- **Alternatives:** The reverse proxy sets the headers, and `container-image.md` lists them under what the environment
  has to provide. A CSP for scripts needs nonces because of MUI and emotion and can follow later.

### Minor: Markdown images load from any host

- **Location:** `src/features/pages/components/MarkdownContent.tsx`, `MarkdownContent` (images use the default
  rendering of react-markdown)
- **Category:** security
- **Problem:** `![](https://tracker.example/x.png)` becomes a plain `<img>` that loads from the other host.
- **Impact:** Any logged-in user can track who reads a page (address and browser of the reader). Without a
  `Referrer-Policy`, the address of the page with folder and page names can leak as well.
- **Evidence:** `MarkdownContent.tsx` passes no `img` in `components` and no `urlTransform` that restricts images.
- **Suggestion (optional):** `img-src 'self' data:` and `Referrer-Policy: same-origin` from the issue above fix this.
- **Alternatives:** An `img` component that only allows relative addresses.

### Minor: logins without an account can block all logins and grow the database

- **Location:** `src/lib/password-hash.ts` (`MAX_CONCURRENT_HASHES = 4`); `src/features/auth/service.ts`,
  `reserveAttempt()`
- **Category:** security
- **Problem:** Every login with a valid-looking but unknown name costs one argon2 hash, and every new name adds a
  `LoginAttempt` row that is never deleted.
- **Impact:** A steady stream of such logins fills the 4 hash slots, so real users get "too many logins at the
  moment", and the `LoginAttempt` table grows without limit.
- **Evidence:** The hash limiter allows 4 hashes at a time and queues the rest for at most 10 seconds; no code deletes
  old `LoginAttempt` rows.
- **Suggestion (optional):** A rate limit per client address at the reverse proxy, documented in `container-image.md`,
  and deleting rows older than `MAX_WAIT_MS` when a login is counted.

### Nit: the `X-Powered-By: Next.js` header is sent

- **Location:** `next.config.ts`
- **Category:** security
- **Problem:** Every response names the framework.
- **Suggestion (optional):** `poweredByHeader: false`.

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
- **Unauthenticated access:** Every address except `/login`, `/api/health` and `/_next/static` redirects to `/login`,
  including `/.env`, `/.git/config` and `/api/auth/*`.
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
- **Container and dependencies:** The container runs as `node`; `npm audit --omit=dev` reports no vulnerabilities.
