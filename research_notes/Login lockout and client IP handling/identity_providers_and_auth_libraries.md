# Brute-force login protection and lockout denial of service in open source identity providers and authentication libraries

State as of 13 November 2026. Versions looked at: better-auth 1.7.22 (the installed package source in
`node_modules/better-auth` and `node_modules/@better-auth/core` of the project, read directly), better-auth docs
(current stable, 1.6 and the 1.8 beta tree), Keycloak 26.8.2 docs and `main` source, authentik 2026.8 docs and `main`
source, Authelia docs (current; regulation modes shipped in 4.39.0), Zitadel `main` defaults, Ory Kratos issue tracker,
Devise `main`, django-axes "latest" docs, Django 6.1 docs, ASP.NET Core docs (default moniker 10.0, page updated
2026-10-31) and `main` source, Laravel 13.x docs and Fortify 1.x source, Spring Security 7.1.2 docs, Rack::Attack
`main`, rate-limiter-flexible wiki, Pocket ID docs (v2.19.2 shown as latest release).

Source conventions: findings marked "installed source" were read from the local package files, the most reliable
source for what the project actually runs. The upstream paths are `packages/better-auth/src/api/rate-limiter/index.ts`
and `packages/core/src/utils/ip.ts` in the better-auth repository. Several web pages were read through a summarising
fetch tool that limits verbatim quotes; where wording is paraphrased this is stated.

## better-auth: how does the built-in rate limiter work, what is it keyed on, and how does it get the client IP?

### Takeaway

better-auth 1.7.22 has only a request rate limiter keyed on `client IP | path` (3 requests per 10 seconds on every path
starting with `/sign-in`), enabled only when `NODE_ENV` is `production`, applied only in the HTTP handler and not to
server-side `auth.api.*` calls. It has no per-account lockout for password sign-in (only for the second factor), and
since the 1.6.x line it no longer takes the leftmost `X-Forwarded-For` value: a multi-value header is ignored unless
`advanced.ipAddress.trustedProxies` is set, and requests without a resolvable IP share one bucket per path.

### Cited Findings

Mechanism and defaults (1.7.22)

- Defaults are set in the context: `enabled: options.rateLimit?.enabled ?? isProduction`, `window: ... || 10`,
  `max: ... || 100`, `storage: options.rateLimit?.storage || (options.secondaryStorage ? "secondary-storage" :
"memory")`; `isProduction` is `nodeENV === "production"` — installed source
  `node_modules/better-auth/dist/context/create-context.mjs` lines 170-175 and
  `node_modules/@better-auth/core/dist/env/env-impl.mjs` line 33;
  [upstream repository](https://github.com/better-auth/better-auth)
- The docs state the same defaults: 10 second window, 100 requests, off in development unless `enabled: true` —
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)
- Built-in stricter rules (`getDefaultSpecialRules`): `window: 10, max: 3` for every path that starts with `/sign-in`,
  `/sign-up`, `/change-password` or `/change-email`; `window: 60, max: 3` for `/request-password-reset`,
  `/send-verification-email`, paths starting with `/forget-password`, `/email-otp/send-verification-otp` and
  `/email-otp/request-password-reset` — installed source
  `node_modules/better-auth/dist/api/rate-limiter/index.mjs` (function `getDefaultSpecialRules`);
  [upstream repository](https://github.com/better-auth/better-auth)
- The docs name only `/sign-in/email` (3 per 10 seconds) and the two-factor paths as stricter rules; the source is
  broader (prefix match, so `/sign-in/username` and `/sign-in/social` are covered as well) —
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit); contradicted in scope by the
  installed source named above
- The `twoFactor` plugin registers its own rule: paths starting with `/two-factor/`, `window: 10, max: 3` — installed
  source `node_modules/better-auth/dist/plugins/two-factor/index.mjs` lines 389-395;
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)
- Rule precedence in `resolveRateLimitConfig`: global `window`/`max`, then the default special rule, then the first
  matching plugin rule, then `rateLimit.customRules` (exact path or `*` wildcard). A custom rule may be an object, a
  function `(request, currentRule) => rule | false`, or `false`, which switches the limiter off for that path —
  installed source `node_modules/better-auth/dist/api/rate-limiter/index.mjs`;
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)
- Key: `createRateLimitKey(ip, path)` returns `` `${ip}|${path}` ``. The key contains no user name, email or account
  id — installed source `node_modules/@better-auth/core/dist/utils/ip.mjs` (function `createRateLimitKey`);
  [upstream repository](https://github.com/better-auth/better-auth)
- Counting: every request to the path is consumed in the request phase, before the endpoint runs, in one atomic
  check-and-increment (`storage.consume(key, rule)`). There is no write-back after the response and no distinction
  between a failed and a successful sign-in, and nothing resets the counter on success — installed source
  `node_modules/better-auth/dist/api/rate-limiter/index.mjs` (functions `onRequestRateLimit`, `decideConsume`)
- Window semantics (memory and database storage): the counter restarts when `now - lastRequest >= window`, and
  `lastRequest` is updated on every allowed request; a denied request does not extend the block. The retry time is
  `lastRequest + window - now` — installed source, same file, functions `decideConsume` and `getRetryAfter`
- A blocked request gets HTTP 429 with body `{"message": "Too many requests. Please try again later."}` and the header
  `X-Retry-After` in seconds — installed source, same file, function `rateLimitResponse`;
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)
- Storage options: `"memory"` (default; process-local `Map`, pruned, capped at 100 000 entries), `"database"` (model
  `rateLimit` with `key`, `count`, `lastRequest`; conditional `incrementOne` updates), `"secondary-storage"` (requires
  `SecondaryStorage.increment(key, ttl)`, otherwise throws "Secondary-storage rate limiting requires
  SecondaryStorage.increment."), or `customStorage` with a single atomic `consume(key, rule)` — installed source, same
  file, functions `getRateLimitStorage`, `createDatabaseStorageWrapper`;
  `node_modules/@better-auth/core/dist/types/init-options.d.mts` lines 203-233
- The docs say the memory store "may not suit serverless environments" (paraphrased) and that separate `get`/`set`
  methods for custom storage are no longer accepted because concurrent requests could pass a stale counter —
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)

Client IP resolution (1.7.22)

- `getIP` returns `null` at once when `advanced.ipAddress.disableIpTracking` is set; otherwise it walks
  `advanced.ipAddress.ipAddressHeaders` in order, default list `["x-forwarded-for"]` (a single header), and falls back
  to `127.0.0.1` only when `isTest() || isDevelopment()`; in production it returns `null` when no header yields an
  address — installed source `node_modules/@better-auth/core/dist/utils/ip.mjs` (functions `getIP`,
  `DEFAULT_IP_HEADERS`)
- `getIPFromHeader`: the header value is split on commas. Without `trustedProxies`, the value is used only if it
  contains exactly one address (`if (forwardedIps.length !== 1) return null;`) and that address is a valid IP. With
  `trustedProxies` (IPs or CIDR ranges), the chain is walked from the right, trusted hops are skipped and the first
  untrusted address is the client; an unparsable entry on the way returns `null` — installed source, same file. The
  source comment reads: "The leftmost token is spoofable, so with `trustedProxies` the chain is stripped from the right
  to the first untrusted hop. Otherwise only a single-value header is trusted."
- There is no hop-count setting; the trusted-proxy concept is an address list. The option documentation warns that
  `trustedProxies` "only interprets the forwarded header chain and cannot verify the direct sender" and is safe only
  when the origin is reachable solely through these proxies; it also says to use the actual proxy addresses, "not a
  broad private range that also covers clients" — installed source
  `node_modules/@better-auth/core/dist/types/init-options.d.mts` lines 238-282;
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)
- Invalid `trustedProxies` entries are ignored with a warning at start ("Ignoring invalid
  `advanced.ipAddress.trustedProxies` entries") — installed source
  `node_modules/better-auth/dist/context/create-context.mjs` lines 91-94
- Normalisation: IPv4-mapped IPv6 becomes IPv4; IPv6 is expanded, lower-cased and masked to
  `advanced.ipAddress.ipv6Subnet`, default 64 (any integer 0 to 128); IPv4 is always limited per single address —
  installed source `node_modules/@better-auth/core/dist/utils/ip.mjs` (function `normalizeIP`);
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)
- No IP resolved: if `disableIpTracking` is set, the limiter is skipped for the request (`return null`). Otherwise the
  key becomes `no-trusted-ip|<path>`, one shared bucket per path for all such requests, and a warning is logged once:
  "Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket." — installed
  source `node_modules/better-auth/dist/api/rate-limiter/index.mjs` (function `resolveRateLimitConfig`)
- The docs confirm: requests without a valid address, "for example when `X-Forwarded-For` contains several addresses
  and `trustedProxies` is not set", "share one counter for each path"; `disableIpTracking: true` turns the limiter off
  for every HTTP request and stops recording the address on sessions; `ipAddressHeaders: []` for direct connections
  means "all clients share one counter for each path" —
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)
- The docs warn about spoofing: "Clients can send this header themselves", the proxy "must replace any value that the
  client sent", and "make sure that clients can reach your server only through it" —
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit);
  [better-auth docs, Security](https://better-auth.com/docs/reference/security)

Server-side `auth.api` calls

- `onRequestRateLimit` is called in exactly one place, the router's `onRequest` hook (`createRouter(... async
onRequest(req) { ... const rateLimitResponse = await onRequestRateLimit(currentRequest, ctx); ...`). The direct
  endpoint wrapper (`to-auth-endpoints.mjs`) contains no reference to the rate limiter — installed source
  `node_modules/better-auth/dist/api/index.mjs` lines 168-176 and a search of
  `node_modules/better-auth/dist/api/to-auth-endpoints.mjs`
- The docs state it outright: "Server-side requests made using `auth.api` aren't affected by rate limiting. Rate limits
  only apply to client-initiated requests." —
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit);
  [better-auth 1.6 docs](https://better-auth.com/docs/1.6/concepts/rate-limit.md)

Per-account lockout in better-auth

- The password sign-in route and the `username` plugin contain no failed-attempt counter and no lock field (search of
  `node_modules/better-auth/dist/api/routes/sign-in.mjs` and `plugins/username/index.mjs` for lock/attempt/ban terms
  found nothing) — installed source
- The `twoFactor` plugin has an account-level lockout for the second factor only: option `accountLockout` with
  `enabled` (default `true`), `maxFailedAttempts` (default 10, consecutive, "across challenges and factors", reset on a
  successful verification) and `durationSeconds` (default 900); stored in `lockedUntil` and `failedVerificationCount`;
  error `ACCOUNT_TEMPORARILY_LOCKED`; the source comment cites NIST SP 800-63B section 5.2.2. In addition a single
  sign-in challenge allows 5 wrong TOTP or backup codes (`beginAttempt(5)`) — installed source
  `node_modules/better-auth/dist/plugins/two-factor/types.d.mts` lines 66-87, `verify-two-factor.mjs` lines 120-202,
  `totp/index.mjs` line 150, `backup-codes/index.mjs` line 205
- The `admin` plugin offers a manual ban (`banned`, `banExpires`, `bannedUserMessage`), set by an administrator, not
  triggered by failed sign-ins — installed source `node_modules/better-auth/dist/plugins/admin/admin.mjs` lines 16-49

Changes across versions and advisories

- GHSA-p6v2-xcpg-h6xw / CVE-2026-45364 ("Rate limiter can be bypassed by rotating IPv6 addresses", High, CVSS 7.3,
  CWE-307): before the fix `getIp` used the leftmost `x-forwarded-for` value after one validity check and the limiter
  keyed on the raw text, so an IPv6 `/64` holder or different spellings of one address produced unlimited keys.
  Affected: below 1.4.17 and 1.5.0-beta.1 to beta.8; patched in 1.4.17 and 1.5.0-beta.9. The fix added `normalizeIP`
  (PR #7470), changed the default IPv6 prefix from /128 to /64 (PR #7509) and put a `|` between address and path —
  [GitHub advisory GHSA-p6v2-xcpg-h6xw](https://github.com/better-auth/better-auth/security/advisories/GHSA-p6v2-xcpg-h6xw)
- 1.6.21 release notes: "Fixed rate limits to be enforced before plugin request handlers run" (#10191); "Fixed client
  IP resolution to prevent `X-Forwarded-For` spoofing in multi-hop proxy chains" (#10203, listed under
  `@better-auth/api-key`); "Refactored request IP resolution into a centralized core resolver" (#10216); "Fixed
  two-factor verification to lock out after five wrong codes for TOTP and backup codes" (#10210) —
  [newreleases.io, better-auth 1.6.21](https://newreleases.io/project/npm/better-auth/release/1.6.21)
- 1.7.0-beta.10 release notes carry the same items plus "Fixed two-factor verification to enforce account-level
  lockout after repeated failed attempts" (#10240) —
  [releases.sh, better-auth v1.7.0-beta.10](https://releases.sh/release/rel_rLmOW5Eb65NNHpcPFpNqK-better-auth-v1-7-0-beta-10-enforces-rate-limiting-before-plugins-and-revokes)
- The 1.6 docs already describe the present model: "By default Better Auth does not trust comma-separated forwarded IP
  chains, since the leftmost `X-Forwarded-For` token is client-controlled behind an appending proxy", with
  `trustedProxies` walked right to left —
  [better-auth 1.6 docs, Rate Limit](https://better-auth.com/docs/1.6/concepts/rate-limit.md)
- A third-party pull request reports that in 1.5.0 better-auth still took the first `x-forwarded-for` entry and that
  `trustedProxies` appeared only in a warning string (third-party report seen in a search result, not verified against
  the 1.5.0 source) — [dailydotdev/daily-api PR 4033](https://github.com/dailydotdev/daily-api/pull/4033)

### Inferences

- The limiter cannot lock out a known account: an attacker who exhausts the bucket blocks only their own IP (or IPv6
  /64) on that path. The price is that it does not stop a distributed attack on one account either; each source IP gets
  3 sign-in requests per 10 seconds, about 26 000 per day.
- A correct password sent from a rate-limited IP is rejected with 429 like any other request, because the check runs
  before the endpoint and counts requests, not failures. The same account can sign in from another IP at the same time.
  Unlock is by time only (10 seconds); there is no admin action because there is nothing account-bound to clear.
- The shared `no-trusted-ip` bucket is a lockout vector of its own, global instead of per account. Where no single
  trustworthy address reaches better-auth (no proxy header, or a proxy that appends to a client-supplied
  `X-Forwarded-For` without `trustedProxies` configured), all affected requests share 3 sign-in requests per
  10 seconds, so one client can keep every user in that bucket from signing in. With an appending proxy and no
  `trustedProxies`, a client can also move itself into the shared bucket on purpose by sending its own
  `X-Forwarded-For` header.
- If the proxy passes a client-supplied single-value `X-Forwarded-For` through unchanged, the client chooses its own
  rate-limit key and the limit is bypassed; the single-value rule protects only against chains, not against a proxy
  that fails to overwrite the header. This follows from `getIPFromHeader` and matches the docs' requirement that the
  proxy "must replace any value that the client sent".
- An application that performs sign-in through server-side `auth.api.signInEmail` or `auth.api.signInUsername` (for
  example from a Next.js server action) gets no rate limiting from better-auth at all and has to add its own; the
  two-factor account lockout still applies because it lives in the endpoint logic, not in the router.
- With the default memory storage each server process has its own counters, so the limit multiplies by the number of
  instances and resets on restart.

### Gaps

- The exact release in which the leftmost `X-Forwarded-For` behaviour ended and `trustedProxies` became functional was
  not pinned down. It lies between 1.5.0 (third-party report) and the 1.6 line (docs, release note #10203 in 1.6.21).
  Tagged source files on GitHub (`v1.3.4` paths) returned 404 through the fetch tool, so older source was not read.
- What older versions did when no IP was found (skip the limiter or not) was not verified; the 1.6 docs do not say.
- No third-party better-auth plugin for per-account password lockout was found in a web search; no better-auth issue
  requesting one was found either. Absence in one search is weak evidence.
- No advisory dedicated to plain `X-Forwarded-For` spoofing (as opposed to IPv6 rotation) was found; the spoofing fix
  appears only as a release-note item (#10203).

## Keycloak: is brute force detection per user, and what do the docs say about the denial-of-service downside?

### Takeaway

Keycloak's brute force detection is per user account (not per IP), is disabled by default, and its own documentation
says it makes the server vulnerable to denial of service because an attacker can get known accounts disabled; the
recommended complement is intrusion prevention software that blocks IPs from the logged failures.

### Cited Findings

- The Server Administration Guide (version 26.8.2) has the sections "Lockout permanently", "Lockout temporarily",
  "Lockout permanently after temporary lockout", "Secondary Authentication Failures Lockout" and "Downside of Keycloak
  brute force detection" — [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/index.html)
- Brute force detection is disabled by default. Parameters and defaults: Max Login Failures 30; Quick Login Check
  Milliseconds 1000; Minimum Quick Login Wait 1 minute; Strategy to increase wait time "Multiple" (alternative
  "Linear"); Wait Increment 1 minute; Max Wait 15 minutes; Failure Reset Time 12 hours (counted from the last failed
  login); Maximum temporary lockouts 1 (mixed mode only) —
  [Keycloak docs source, brute-force.adoc](https://raw.githubusercontent.com/keycloak/keycloak/main/docs/documentation/server_admin/topics/threat/brute-force.adoc)
- Wait time: by multiples "Wait Increment in Seconds * (count / Max Login Failures)" with integer division; linear
  "Wait Increment in Seconds * (1 + count - Max Login Failures)" —
  [Keycloak docs source, brute-force.adoc](https://raw.githubusercontent.com/keycloak/keycloak/main/docs/documentation/server_admin/topics/threat/brute-force.adoc)
- Permanent lockout "disables a user account (blocking log in attempts) until an administrator re-enables it";
  "Enabling an user account resets the `count`" —
  [Keycloak docs source, brute-force.adoc](https://raw.githubusercontent.com/keycloak/keycloak/main/docs/documentation/server_admin/topics/threat/brute-force.adoc)
- During a temporary lockout: "`count` does not increment when a temporarily disabled account commits a login
  failure"; the user sees the generic "Invalid username or password" message —
  [Keycloak docs source, brute-force.adoc](https://raw.githubusercontent.com/keycloak/keycloak/main/docs/documentation/server_admin/topics/threat/brute-force.adoc)
- A correct password is rejected while locked: in `validatePassword` the check
  `if (isDisabledByBruteForce(context, user)) return false;` runs before
  `user.credentialManager().isValid(UserCredentialModel.password(password))`; the event error is
  `USER_TEMPORARILY_DISABLED` or the permanent variant —
  [Keycloak source, AbstractUsernameFormAuthenticator.java](https://raw.githubusercontent.com/keycloak/keycloak/main/services/src/main/java/org/keycloak/authentication/authenticators/browser/AbstractUsernameFormAuthenticator.java)
- The downside, verbatim: "The downside of {project_name} brute force detection is that the server becomes vulnerable
  to denial of service attacks." An attacker can try passwords for accounts they know until the accounts are disabled.
  Recommendation: "Consider using intrusion prevention software (IPS)."; Keycloak "logs every login failure and client
  IP address failure", and the IPS can read these logs and block the addresses —
  [Keycloak docs source, brute-force.adoc](https://raw.githubusercontent.com/keycloak/keycloak/main/docs/documentation/server_admin/topics/threat/brute-force.adoc)
- Secondary authentication failures lockout: enabled by a non-zero "Maximum Secondary Authentication Failures"
  (default 0, off), applies to OTP only, locks permanently when exceeded, reset by a successful second factor —
  [Keycloak docs source, brute-force.adoc](https://raw.githubusercontent.com/keycloak/keycloak/main/docs/documentation/server_admin/topics/threat/brute-force.adoc)

### Inferences

- Keycloak has no built-in per-IP limit on the login form; the IP is recorded for logging and delegated to an external
  IPS. Every mode it offers is a lockout of the account and therefore usable against a known user name.
- Unlock paths are time (temporary mode, up to Max Wait) and an administrator re-enabling the account; the docs name no
  email unlock link.

### Gaps

- The admin "Unlock users" action and the admin REST endpoints for clearing brute force state were not read in the
  docs; only the "administrator re-enables it" wording is confirmed.
- The docs do not state "per user" in so many words; this follows from the wording ("user account") and the source.

## authentik: is the reputation policy keyed on IP, user name or both?

### Takeaway

authentik has no fixed lockout; it keeps a reputation score per (IP, identifier) pair that drops by 1 on each failed
login, and a Reputation policy that an administrator binds into a flow (typically to show a CAPTCHA) and that can
check the IP, the user name or both.

### Cited Findings

- Docs: authentik "tracks a reputation score over time"; "failed logins decrease the score", "successful logins
  increase the score"; the policy can check "the client IP", "the username" or "both together"; "The policy passes
  when the score is at or below the configured threshold"; typical use is to "bind a CAPTCHA stage so it runs only for
  low-reputation requests" — [authentik docs, Reputation policy](https://docs.goauthentik.io/customize/policies/types/reputation/)
- Source: `login_failed` and `identification_failed` call `update_score(request, <username or uid_field>, -1)`; the
  row is upserted on the conflict target `["ip", "identifier"]`; on a successful login a negative score is reset to 0,
  otherwise incremented by 1; scores are clamped between the configured lower and upper limit —
  [authentik source, policies/reputation/signals.py](https://raw.githubusercontent.com/goauthentik/authentik/main/authentik/policies/reputation/signals.py)
- Source: policy fields `check_ip` (default `True`), `check_username` (default `True`), `threshold` (default `-5`);
  `passes()` builds `Q(ip=remote_ip)` and/or `Q(identifier=request.user.username)` joined with OR, sums the scores of
  all matching rows and returns `score <= self.threshold`; each row has `expires` set from the `reputation.expiry`
  configuration — [authentik source, policies/reputation/models.py](https://raw.githubusercontent.com/goauthentik/authentik/main/authentik/policies/reputation/models.py)
- System settings (docs version 2026.8): reputation lower limit "Defaults to `-5`", upper limit "Defaults to `5`" —
  [authentik docs, System settings](https://docs.goauthentik.io/sys-mgmt/settings/)

### Inferences

- Because the check on the user name sums the scores of all IPs that failed for that identifier, a policy with
  `check_username` enabled lets an attacker push a known user name below the threshold from anywhere; whether this is
  a lockout or only an extra challenge depends on what the administrator binds the policy to. With `check_ip` only,
  the effect stays on the attacker's address.
- A successful login from a given IP repairs only that (IP, identifier) row, not the rows created by other IPs.

### Gaps

- The default value of `reputation.expiry` was not found in the pages read.
- The authentik docs read do not discuss the denial-of-service trade-off of checking the user name.
- How authentik determines the client IP behind proxies (`ClientIPMiddleware`) was not researched here.

## Authelia: what does regulation key on, and what do the docs say about user mode?

### Takeaway

Authelia's `regulation` bans after 3 failures within 2 minutes for 5 minutes; since 4.39.0 it has `modes` with `user`
and `ip`, the default is still `['user']`, and the docs say plainly "The recommended mode is `ip`", without spelling
out the denial-of-service reason.

### Cited Findings

- Options and defaults: `modes` default `['user']` ("user: The user account is the subject of any automatic bans";
  "ip: The remote ip is the subject of any automatic bans"), `max_retries` default 3 ("Setting this option to 0
  disables regulation entirely"), `find_time` default 2 minutes, `ban_time` default 5 minutes ("After this duration
  the account will be able to login again") — [Authelia docs, Regulation](https://www.authelia.com/configuration/security/regulation/)
- "The recommended mode is `ip`." and "regardless of the currently configured ban modes, if bans exist in the
  database, the user or IP will be denied access." — [Authelia docs, Regulation](https://www.authelia.com/configuration/security/regulation/)
- The regulation page does not mention denial of service; its stated purpose is that Authelia "can temporarily ban
  accounts when there are too many authentication attempts on the username / password endpoint" —
  [Authelia docs, Regulation](https://www.authelia.com/configuration/security/regulation/)
- IP bans and unbanning were added by the pull request "feat(regulation): ip bans and unbanning", merged 23 February
  2025, milestone v4.39.0 — [authelia/authelia PR 7230](https://github.com/authelia/authelia/pull/7230)
- CLI unlock paths exist for both subjects: `authelia storage bans ip revoke`, `authelia storage bans user revoke`
  (with `--id`), plus `add` (duration or permanent) and `list` —
  [Authelia CLI reference, storage bans](https://www.authelia.com/reference/cli/authelia/authelia_storage_bans_ip_revoke/);
  [Authelia CLI reference, storage bans user revoke](https://www.authelia.com/reference/cli/authelia/authelia_storage_bans_user_revoke/)
- Separately, "Authelia implements a tokenized bucket rate limiter on specific endpoints", "applied on a per-IP
  basis"; and it delays every authentication adaptively (minimum 250 ms, random 0 to 85 ms added) to hinder user
  enumeration — [Authelia docs, Security measures](https://www.authelia.com/overview/security/measures/)
- CVE-2025-24806: with login by user name and by email both allowed, regulation counted them as separate events,
  doubling the attempts; fixed in 4.38.19 and 4.39.0 —
  [Debian security tracker, CVE-2025-24806](https://security-tracker.debian.org/tracker/CVE-2025-24806)

### Inferences

- With the default `['user']` mode an attacker who knows a user name can keep the account banned with 3 wrong
  passwords every 5 minutes; the recommendation of `ip` mode is the project's answer to that, although the regulation
  page does not give the reason.
- A user ban is a real lockout: during `ban_time` the correct password does not help (the docs say the account "will
  be able to login again" only after the duration). Unlock is by time or by the CLI.

### Gaps

- No Authelia page read states that user mode enables denial of service; the assignment's expectation of such a
  statement could not be confirmed. It may exist in the 4.39 release notes or in the PR discussion, which were not
  read in full.
- How Authelia determines the remote IP (trusted proxy settings) was not researched here.

## Zitadel: how does the lockout policy work?

### Takeaway

Zitadel's lockout policy is a per-account hard lock after a maximum number of password or OTP attempts, off by default
(0), with unlock only by an administrator; next to it there is a small per-attempt delay ("tarpit").

### Cited Findings

- Settings: "Maximum Password Attempts: When the user has reached the maximum password attempts the account will be
  locked" and the same for "Maximum OTP Attempts"; 0 disables the trigger; "If an account is locked, the administrator
  has to unlock it in the ZITADEL Management Console." —
  [Zitadel docs, Default settings](https://zitadel.com/docs/guides/manage/console/default-settings)
- Defaults of a new instance: `MaxPasswordAttempts: 0`, `MaxOTPAttempts: 0`, `ShouldShowLockoutFailure: true`
  (environment variables `ZITADEL_DEFAULTINSTANCE_LOCKOUTPOLICY_*`) —
  [Zitadel source, cmd/defaults.yaml](https://raw.githubusercontent.com/zitadel/zitadel/main/cmd/defaults.yaml)
- The same file has a `Tarpit` block under `SystemDefaults`: `MinFailedAttempts: 5`, `StepDuration: 1s`,
  `StepSize: 5`, `MaxDuration: 10s`; the comment says the tarpit starts after that many failed attempts (as summarised
  by the fetch tool) — [Zitadel source, cmd/defaults.yaml](https://raw.githubusercontent.com/zitadel/zitadel/main/cmd/defaults.yaml)
- API docs (seen as a search result excerpt): attempts "are reset as soon as the password is entered correctly or the
  password is reset"; "If set to 0 the account will never be locked"; a custom policy of an organisation overrides the
  instance setting —
  [Zitadel API docs, Update Password Lockout Settings](https://docs-bekvoqo0l-zitadel.vercel.app/docs/apis/resources/mgmt/management-service-update-custom-lockout-policy)
- A community request asks for locks that expire on their own (for example after 15 minutes) because otherwise
  somebody has to unlock the affected users — [Zitadel community question, Lockout policy](https://questions.zitadel.com/m/1361675373590347806)

### Inferences

- When enabled, the Zitadel lockout is the most severe variant in this survey with respect to denial of service: per
  account, no automatic expiry, administrator needed. The default of 0 avoids it.

### Gaps

- Whether automatic unlock after a time has been added by November 2026 was not confirmed.
- No Zitadel text discussing the denial-of-service trade-off was found.
- The tarpit semantics (per user, per IP, linear steps) were not verified beyond the configuration keys.

## Ory Kratos: is there any built-in limit or lockout?

### Takeaway

Self-hosted Ory Kratos has neither login rate limiting nor account lockout; the maintainers declined lockout
explicitly because it allows denial of service against accounts, and the long-standing feature request was closed as
not planned in May 2026.

### Cited Findings

- Issue "Throttling repeated login requests & account lock" (#3037), opened 19 January 2023, closed as not planned on
  8 May 2026 — [ory/kratos issue 3037](https://github.com/ory/kratos/issues/3037)
- Maintainer statement in that issue: "The problem with this is that you can effectively DoS accounts and lock them by
  trying to repeatedly log in."; the suggested alternative was a capped backoff of roughly 16 to 30 seconds, later
  "keep this feature out of scope for now"; in February 2025: WAFs such as Cloudflare or Akamai are a better fit, a
  failed-login webhook was suggested, "I'm considering to close this as a wontfix" —
  [ory/kratos issue 3037](https://github.com/ory/kratos/issues/3037)
- Community answers state that self-hosted Kratos does nothing against brute force and that a reverse proxy or WAF has
  to rate limit, while the hosted Ory Network rate limits its public endpoints (forum threads, secondary sources) —
  [Ory community archive](https://archive.ory.sh/t/23178350/does-kratos-do-any-exponential-rate-limiting-to-combat-brute);
  [Ory community archive, rate limiting](https://archive.ory.sh/t/30283445/u04uq68083h-is-there-a-way-to-add-login-rate-limiting-to-ory)

### Inferences

- Kratos is the clearest example of a project that chose no lockout over lockout denial of service and pushed
  throttling to the network edge.

### Gaps

- The official Kratos security documentation page was not opened; the statements about the hosted service come from
  forum answers.

## Kanidm and Pocket ID

### Takeaway

Kanidm uses a per-credential "softlock" (temporary, time-based, with a counting cycle) rather than a permanent lock;
Pocket ID is passkey-based and has built-in per-IP rate limits with an explicit trusted-proxy setting.

### Cited Findings

- Kanidm's `credential::softlock` module "Represents a temporary denial of the credential to authenticate. This is
  used to ratelimit and prevent bruteforcing of accounts."; the first failure sets `unlock_at` about one second later
  and a `reset_count_at` for the cycle (example: 24 hours after the first failure); once the policy's failure count is
  exceeded, `unlock_at` is set to `reset_count_at`; the doc refers to NIST SP 800-63B (search result excerpt of the
  rustdoc, page not opened) —
  [Kanidm rustdoc, credential::softlock](https://kanidm.github.io/kanidm/master/rustdoc/kanidmd_lib/credential/softlock/index.html)
- The Kanidm account policy chapter of the book says nothing about failed authentication handling —
  [Kanidm book, Account policy](https://kanidm.github.io/kanidm/stable/accounts/account_policy.html)
- Pocket ID: `TRUST_PROXY` default `false`, "The reverse proxies to take the client IP from" (addresses or CIDR ranges;
  `true` trusts every address); `TRUSTED_PLATFORM` names the header the platform puts the client IP in, such as
  `CF-Connecting-IP`; `DISABLE_RATE_LIMITING` default `false`, turns off the built-in rate limits ("Only do this when
  your reverse proxy limits requests instead"); `PROXY_PROTOCOL` for load balancers —
  [Pocket ID docs, Environment variables](https://pocket-id.org/docs/configuration/environment-variables)

### Inferences

- Kanidm's softlock is bound to the credential of an account, so it is a time-limited per-account lock; an attacker
  can hold a known account locked until the cycle ends.
- Pocket ID has no password to guess, so a per-account lockout is not needed; its limits protect endpoints per IP.

### Gaps

- Kanidm's threshold, backoff schedule and unlock paths were not verified in source.
- Pocket ID's concrete limits (requests per window, endpoints) were not found.

## Devise `:lockable` (Rails)

### Takeaway

Devise locks the account record after `maximum_attempts` failed sign-ins (template value 20) and unlocks by email
link, by time (`unlock_in`, template value 1 hour) or both; it is purely per account and a correct password does not
work while the lock holds.

### Cited Findings

- Options: `maximum_attempts`, `lock_strategy` (`:failed_attempts` or `:none`), `unlock_strategy` (`:time`, `:email`,
  `:both`, `:none`), `unlock_in`, `unlock_keys` —
  [Devise source, models/lockable.rb](https://raw.githubusercontent.com/heartcombo/devise/main/lib/devise/models/lockable.rb)
- Generator template (commented defaults): `config.lock_strategy = :failed_attempts`, `config.unlock_keys = [:email]`,
  `config.unlock_strategy = :both`, `config.maximum_attempts = 20`, `config.unlock_in = 1.hour`,
  `config.last_attempt_warning = true` —
  [Devise source, generators/templates/devise.rb](https://raw.githubusercontent.com/heartcombo/devise/main/lib/generators/templates/devise.rb)
- Counting is on the user row (`self.class.increment_counter(:failed_attempts, id)`); `valid_for_authentication?` first
  runs `unlock_access! if lock_expired?`, succeeds only `if super && !access_locked?`, otherwise increments and locks
  when `attempts_exceeded?`. `lock_expired?` is true only with the time strategy and
  `locked_at < self.class.unlock_in.ago` —
  [Devise source, models/lockable.rb](https://raw.githubusercontent.com/heartcombo/devise/main/lib/devise/models/lockable.rb)
- Reset on success: a Warden hook, "After each sign in, if resource responds to failed_attempts, sets it to 0" —
  [Devise source, hooks/lockable.rb](https://raw.githubusercontent.com/heartcombo/devise/main/lib/devise/hooks/lockable.rb)
- In paranoid mode the `:locked` message is replaced by the generic one because it "leaks the existence of an
  account" — [Devise source, models/lockable.rb](https://raw.githubusercontent.com/heartcombo/devise/main/lib/devise/models/lockable.rb)

### Inferences

- With `unlock_strategy :email` or `:both`, the email link is a way out for the real user that an attacker cannot
  use, which softens the denial of service; with `:time` only, an attacker can re-lock the account every hour with 20
  requests.
- Devise has no IP dimension; Rails applications are expected to add Rack::Attack or the Rails rate limiter.

### Gaps

- The Devise version of `main` was not recorded, and no Devise text on the denial-of-service trade-off was found.

## Rack::Attack (documented login throttles)

### Takeaway

Rack::Attack's documented examples throttle logins by IP and, separately, by the normalised email parameter, and the
example configuration notes in a comment that the email throttle lets an attacker block another user's logins.

### Cited Findings

- README: `Rack::Attack.throttle('limit logins per email', limit: 6, period: 60)` on `POST /login`, keyed on
  `req.params['email'].to_s.downcase.gsub(/\s+/, "")`, with the instruction to normalise the email the same way as
  the authentication process "to protect against rate limit bypasses"; a general throttle by `request.ip`; an
  Allow2Ban example on `req.ip` with `maxretry: 20, findtime: 1.minute, bantime: 1.hour` for `POST /login` —
  [Rack::Attack README](https://raw.githubusercontent.com/rack/rack-attack/main/README.md)
- Example configuration: `logins/ip`, 5 `POST /login` requests per 20 seconds per `req.ip`; `logins/email`, 5 per
  20 seconds per normalised email; a comment says an attacker could trigger the email throttle for another user's
  account on purpose and block that user's logins, and calls this uncommon (paraphrased by the fetch tool) —
  [Rack::Attack docs, example_configuration.md](https://raw.githubusercontent.com/rack/rack-attack/main/docs/example_configuration.md)
- State is kept in a configurable cache that "defaults to `Rails.cache` if present" —
  [Rack::Attack README](https://raw.githubusercontent.com/rack/rack-attack/main/README.md)

### Inferences

- These are request throttles (all login posts count, also successful ones); during the throttle the correct password
  is rejected as well, and the only unlock is the end of the 20 or 60 second period. The short period keeps the
  denial of service cheap to mount but short-lived.

### Gaps

- The README does not explain how `req.ip` is derived behind proxies.

## django-axes, django-ratelimit and Django's own guidance

### Takeaway

Django itself does not throttle logins; django-axes locks by IP address by default (3 failures, permanent until reset
unless a cool-off is set) and can be switched to user name or combinations; django-ratelimit's docs recommend limiting
by IP and by user name together and warn that field-based limits "may open a denial of service vector".

### Cited Findings

- Django 6.1: "Django does not throttle requests to authenticate users. To protect against brute-force attacks against
  the authentication system, you may consider deploying a Django plugin or web server module to throttle these
  requests." — [Django docs, Security in Django](https://docs.djangoproject.com/en/stable/topics/security/)
- django-axes defaults: `AXES_FAILURE_LIMIT` 3; `AXES_LOCK_OUT_AT_FAILURE` `True`; `AXES_COOLOFF_TIME` `None` ("If
  `None`, lockout is permanent until attempts are manually reset"); `AXES_USE_ATTEMPT_EXPIRATION` `False` (rolling
  window when `True`); `AXES_RESET_ON_SUCCESS` `False`; `AXES_RESET_COOL_OFF_ON_FAILURE_DURING_LOCKOUT` `True` ("any
  failed login attempt during lockout resets the cool-off timer"); `AXES_LOCKOUT_PARAMETERS` `["ip_address"]`;
  `AXES_HTTP_RESPONSE_CODE` 429; `AXES_ENABLE_ADMIN` `True`; `AXES_NEVER_LOCKOUT_WHITELIST` `False`;
  `AXES_IP_WHITELIST` `None` — [django-axes docs, Configuration](https://django-axes.readthedocs.io/en/latest/4_configuration.html)
- `AXES_LOCKOUT_PARAMETERS`: a list in which a string is a separate parameter and a nested list is a combination;
  `["ip_address", ["username", "user_agent"]]` locks "using ip_address or combination of username and user_agent";
  it can also be a callable; the documented example returns `["username"]` for localhost and
  `["ip_address", "username"]` otherwise ("axes will lockout client by username or ip_address") —
  [django-axes docs, Customization](https://django-axes.readthedocs.io/en/latest/5_customization.html)
- Client IP: "Axes makes use of `django-ipware` package to detect the IP address of the client";
  `AXES_IPWARE_PROXY_COUNT` default `None` ("The number of reverse proxies in front of Django as an integer");
  `AXES_IPWARE_META_PRECEDENCE_ORDER` default `('REMOTE_ADDR', )`; `AXES_IPWARE_PROXY_ORDER` default `"left-most"`;
  `AXES_CLIENT_IP_CALLABLE` for a custom function; warning that "the client can spoof IP addresses by just setting
  the header in their request" and that header values "must be secure and trusted" —
  [django-axes docs, Configuration](https://django-axes.readthedocs.io/en/latest/4_configuration.html)
- django-ratelimit: "Django-Ratelimit is not the correct place to handle reverse proxies and adjust the IP address";
  "Mishandling client IP data creates an IP spoofing vector that allows attackers to circumvent IP ratelimiting
  entirely."; recommended is a small middleware that sets `REMOTE_ADDR`, or a key such as `header:x-real-ip` when the
  header "_only_ contains the client IP" —
  [django-ratelimit docs, Security considerations](https://django-ratelimit.readthedocs.io/en/stable/security.html)
- django-ratelimit on login: "Protecting against the single IP address cases is easy" (`@ratelimit(key='ip')`);
  "Also limiting by username provides better protection" (`@ratelimit(key='ip')` stacked with
  `@ratelimit(key='post:username')`); "limiting based on field values may open a denial of service vector against
  your users"; "consider implementing a soft blocking mechanism, such as requiring a captcha, rather than a hard
  block" — [django-ratelimit docs, Security considerations](https://django-ratelimit.readthedocs.io/en/stable/security.html)

### Inferences

- django-axes with its defaults cannot be used to lock out a named account (IP key), but with `REMOTE_ADDR` as the only
  source it locks the reverse proxy's address, that is everyone, as soon as the deployment sits behind a proxy and the
  ipware settings are not configured. The combined form `[["username", "ip_address"]]` gives the "user name + IP"
  counter that avoids both problems; it follows from the documented list semantics, the docs example uses
  `user_agent`.
- A django-axes lockout blocks the correct password as well (the request is "considered locked"); with the default
  `AXES_COOLOFF_TIME = None` only a manual reset unlocks.

### Gaps

- The reset paths of django-axes (management commands such as `axes_reset`, admin actions) were not found in the two
  pages read and are unverified here.
- The django-axes docs read contain no warning about denial of service when locking by user name.
- The version number of the django-axes "latest" docs was not shown.

## ASP.NET Core Identity lockout

### Takeaway

ASP.NET Core Identity locks per account after 5 failed attempts for 5 minutes, but only if the sign-in call passes
`lockoutOnFailure: true`; the scaffolded login page passes `false`, so the lockout does not trigger by default.

### Cited Findings

- `LockoutOptions` defaults: `AllowedForNewUsers` `true`, `DefaultLockoutTimeSpan` 5 minutes,
  `MaxFailedAccessAttempts` 5; "A successful authentication resets the failed access attempts count and resets the
  clock." — [Microsoft Learn, Configure ASP.NET Core Identity](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-configuration)
- The login template calls `PasswordSignInAsync(Input.Email, Input.Password, Input.RememberMe, lockoutOnFailure:
false)` with the comment "This doesn't count login failures towards account lockout. To enable password failures to
  trigger account lockout, set lockoutOnFailure: true" —
  [Microsoft Learn, Configure ASP.NET Core Identity](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-configuration)
- Source: `CheckPasswordSignInCoreAsync` runs `PreSignInCheck(user)` first, which returns `SignInResult.LockedOut`
  when `IsLockedOut(user)`; only afterwards `UserManager.CheckPasswordAsync(user, password)`; on a wrong password
  `UserManager.AccessFailedAsync(user)` is called only `if (UserManager.SupportsUserLockout && lockoutOnFailure)`; the
  reset on success runs when `AlwaysResetLockoutOnSuccess` is set, two-factor is not enabled or the client is
  remembered — [dotnet/aspnetcore source, SignInManager.cs](https://raw.githubusercontent.com/dotnet/aspnetcore/main/src/Identity/Core/src/SignInManager.cs)

### Inferences

- The lockout is per account with time-based unlock only (plus whatever the application builds on
  `UserManager.SetLockoutEndDateAsync`); a correct password is rejected during the 5 minutes. An attacker can keep a
  known account locked with 5 requests every 5 minutes once `lockoutOnFailure` is on.
- Identity has no IP dimension; per-IP limiting is left to the ASP.NET Core rate limiting middleware or the edge.

### Gaps

- The Microsoft page read does not discuss the denial-of-service trade-off.

## Laravel (`RateLimiter`, Fortify)

### Takeaway

Laravel Fortify throttles login on the combination of lower-cased user name and IP address, 5 attempts per minute,
and its docs point to a custom limiter (for example by IP alone) and to a mix of throttling, two-factor
authentication and a WAF.

### Cited Findings

- "By default, Fortify will throttle authentication attempts using the `EnsureLoginIsNotThrottled` middleware. This
  middleware throttles attempts that are unique to a username and IP address combination." A custom limiter can be
  set through `fortify.limiters.login`, "such as throttling by IP address alone"; "Utilizing a mixture of throttling,
  two-factor authentication, and an external web application firewall (WAF) will provide the most robust defense for
  your legitimate application users." — [Laravel 13.x docs, Fortify](https://laravel.com/docs/13.x/fortify)
- `LoginRateLimiter::throttleKey`: `Str::transliterate(Str::lower($request->input(Fortify::username())).'|'.$request->ip())`;
  `tooManyAttempts(..., 5)`; `increment` calls `hit($key, 60)`; `clear` removes the key —
  [laravel/fortify source, LoginRateLimiter.php](https://raw.githubusercontent.com/laravel/fortify/1.x/src/LoginRateLimiter.php)
- Service provider stub: `RateLimiter::for('login', ...)` returns `Limit::perMinute(5)->by($throttleKey)` with the same
  key; `RateLimiter::for('two-factor', ...)` returns
  `Limit::perMinute(5)->by($request->session()->get('login.id'))` —
  [laravel/fortify source, stubs/FortifyServiceProvider.php](https://raw.githubusercontent.com/laravel/fortify/1.x/stubs/FortifyServiceProvider.php)
- The generic `RateLimiter` facade offers `attempt`, `tooManyAttempts`, `increment` (atomic on `redis`, `memcached`
  and `database` stores), `remaining`, `availableIn` and `clear`, with any string as key —
  [Laravel 13.x docs, Rate limiting](https://laravel.com/docs/13.x/rate-limiting)

### Inferences

- The "user name + IP" key means a remote attacker cannot lock out a known user (the victim's own IP has its own
  counter), and a NAT full of users is not blocked by one bad client either. The gap is a distributed attack on one
  account: every new IP gets 5 fresh attempts per minute, with no global per-account or per-IP cap in the default.
- `$request->ip()` depends on Laravel's trusted-proxy configuration; behind an unconfigured proxy all clients share
  the proxy address, which turns the key into a per-user-name lock again.

### Gaps

- Whether the counter is cleared on a successful login was not verified in the action source (the `clear` method
  exists).
- The Fortify docs do not discuss the denial-of-service trade-off in so many words.

## Spring Security

### Takeaway

Spring Security (7.1.2) ships no brute-force counter or automatic lockout; it publishes authentication failure events
and honours a locked flag that the application has to set itself.

### Cited Findings

- "For each authentication that succeeds or fails, a `AuthenticationSuccessEvent` or `AuthenticationFailureEvent`,
  respectively, is fired."; `BadCredentialsException` and `UsernameNotFoundException` map to
  `AuthenticationFailureBadCredentialsEvent`, `LockedException` to `AuthenticationFailureLockedEvent`; the page
  describes no throttling or lockout logic —
  [Spring Security 7.1.2 reference, Authentication events](https://docs.spring.io/spring-security/reference/servlet/authentication/events.html)

### Inferences

- The usual pattern (count failures in a listener, per user name or per IP, and make
  `UserDetails.isAccountNonLocked()` return false) is application code, so the key and the denial-of-service
  behaviour are whatever the application chooses.

### Gaps

- No Spring Security reference page prescribing a brute-force pattern was found; the `isAccountNonLocked` part is
  general knowledge of the API and was not cited from a page.

## Auth.js / NextAuth and Lucia's guidance

### Takeaway

Auth.js provides no rate limiting or lockout for its credentials provider and leaves it to the developer; the guidance
by Lucia's author (The Copenhagen Book) says IP-based throttling should always be implemented and that
identifier-based throttling "can introduce DoS vulnerabilities".

### Cited Findings

- Auth.js credentials page: for the credentials provider "you just have to provide the necessary logic, eg. to encrypt
  passwords, add rate-limiting"; "if possible, we recommend a more modern and secure authentication mechanism"; no
  built-in brute-force protection is described —
  [Auth.js docs, Credentials](https://authjs.dev/getting-started/authentication/credentials)
- The Copenhagen Book, brute-force section: "IP-based throttling should always be implemented."; "A basic example is
  to block all attempts from an IP address for 10 minutes after they fail 10 consecutive attempts."; identifier-based
  throttling can be added on top but "this can introduce DoS vulnerabilities"; IP-based throttling also "prevents DOS
  attacks as password hashing is resource-intensive"; MFA is "the best defense against brute-force attacks"; bot
  detection with Captchas as another layer. The page notes that this website has been replaced and is no longer
  maintained — [The Copenhagen Book, Password authentication](https://copenhagen.pilcrowonpaper.com/password-authentication)
- A Lucia v2 guidebook page "Login throttling" exists (seen in search results, not opened) —
  [Lucia v2 guidebook, Login throttling](https://v2.lucia-auth.com/guidebook/login-throttling)

### Inferences

- For a Next.js application the two common libraries differ sharply: Auth.js has nothing, better-auth has an IP + path
  request limiter but only on its HTTP handler.

### Gaps

- The current Lucia site page on rate limiting (`lucia-auth.com/rate-limit/token-bucket`) returned 404; the current
  location of Lucia's rate-limit guidance was not found.
- An Auth.js statement that says "no rate limiting is provided" outright was not found; the conclusion rests on the
  credentials page.

## Passport-based patterns with rate-limiter-flexible

### Takeaway

The rate-limiter-flexible wiki's "login endpoint protection" example uses two failure counters, 100 failures per IP
per day and 10 consecutive failures per "user name + IP", and explicitly rejects the user-name-only variant because it
lets an attacker block an account forever.

### Cited Findings

- `limiterSlowBruteByIP`: key prefix `login_fail_ip_per_day`, 100 points, duration 1 day, "blockDuration: 60 * 60 *
  24, // Block for 1 day, if 100 wrong attempts per day" —
  [rate-limiter-flexible wiki, Overall example](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example#login-endpoint-protection)
- `limiterConsecutiveFailsByUsernameAndIP`: key prefix `login_fail_consecutive_username_and_ip`, 10 points,
  "duration: 60 * 60 * 24 * 90, // Store number for 90 days since first fail", block for 1 hour; key
  ``const getUsernameIPkey = (username, ip) => `${username}_${ip}`;`` —
  [rate-limiter-flexible wiki, Overall example](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example#login-endpoint-protection)
- Route logic: both counters are read first (`get`, not `consume`) and a blocked one yields 429 with `Retry-After`;
  on a failed login the IP limiter always consumes a point, the user name + IP limiter only "for registered users";
  on success the user name + IP key is deleted ("Reset on successful authorisation"). The stated reasons for `get`
  first: "consume calls are more expensive" and "if there is a consume call by random username allowed, it can
  overflow the storage with junk keys" —
  [rate-limiter-flexible wiki, Overall example](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example#login-endpoint-protection)
- The user-name-only "minimal protection" variant (5 consecutive failures, 15 minute block) is called acceptable for
  an early-stage product, with the warning: "It can be scheduled to send 5 password tries every 15 minutes and block
  user account for infinity." Suggested mitigations: IP limits over short and long periods, and "Implement trusted
  device approach additionally" (a token stored on the client after a successful login). The dynamic block duration
  example is flagged as possibly not a good fit because an attacker could lock out a real user —
  [rate-limiter-flexible wiki, Overall example](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example#login-endpoint-protection)

### Inferences

- This is the most complete documented pattern in the survey for avoiding lockout denial of service: only failures
  count, the per-account counter is bound to the attacker's IP, a slow per-IP cap catches attacks spread over many user
  names, and the correct password from the victim's own IP keeps working while an attacker elsewhere is blocked.
- Its remaining weakness is a distributed attack on one account (10 attempts per IP, up to the per-IP daily cap), and
  it depends entirely on a trustworthy client IP.

### Gaps

- The example takes the IP from `req.ip` (Express); how to configure `trust proxy` is outside the wiki page read.

## Does the correct password still work during the limit, and which unlock paths exist?

### Takeaway

In every system that locks the account (Keycloak, Authelia user mode, Zitadel, Devise, ASP.NET Core Identity, Kanidm,
django-axes with a user name key) the correct password is refused during the lock; only designs keyed on IP or on user
name + IP leave the real user able to sign in from their own address.

### Cited Findings

- Keycloak: lock check before password validation; unlock by time (temporary mode) or by an administrator re-enabling
  the account —
  [Keycloak source, AbstractUsernameFormAuthenticator.java](https://raw.githubusercontent.com/keycloak/keycloak/main/services/src/main/java/org/keycloak/authentication/authenticators/browser/AbstractUsernameFormAuthenticator.java);
  [Keycloak docs source, brute-force.adoc](https://raw.githubusercontent.com/keycloak/keycloak/main/docs/documentation/server_admin/topics/threat/brute-force.adoc)
- Authelia: "After this duration the account will be able to login again" (time, default 5 minutes); CLI
  `authelia storage bans user revoke` and `ip revoke` —
  [Authelia docs, Regulation](https://www.authelia.com/configuration/security/regulation/);
  [Authelia CLI reference](https://www.authelia.com/reference/cli/authelia/authelia_storage_bans_user_revoke/)
- Zitadel: "the administrator has to unlock it in the ZITADEL Management Console" (no time-based unlock documented) —
  [Zitadel docs, Default settings](https://zitadel.com/docs/guides/manage/console/default-settings)
- Devise: success requires `super && !access_locked?`; unlock by email link, by time, both, or none —
  [Devise source, models/lockable.rb](https://raw.githubusercontent.com/heartcombo/devise/main/lib/devise/models/lockable.rb)
- ASP.NET Core Identity: `PreSignInCheck` returns `LockedOut` before the password check; unlock after
  `DefaultLockoutTimeSpan` —
  [dotnet/aspnetcore source, SignInManager.cs](https://raw.githubusercontent.com/dotnet/aspnetcore/main/src/Identity/Core/src/SignInManager.cs)
- django-axes: permanent "until attempts are manually reset" when `AXES_COOLOFF_TIME` is `None`, otherwise time;
  a failed attempt during the lockout restarts the cool-off by default —
  [django-axes docs, Configuration](https://django-axes.readthedocs.io/en/latest/4_configuration.html)
- better-auth 1.7.22: the 429 is returned in the router's `onRequest` hook before the endpoint runs; time-based only —
  installed source `node_modules/better-auth/dist/api/index.mjs` lines 168-176;
  [better-auth docs, Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)
- rate-limiter-flexible example: blocked keys return 429 before `authorise` is called; the per-account key includes
  the IP; block 1 hour (user name + IP) or 1 day (IP); reset of the user name + IP key on success —
  [rate-limiter-flexible wiki, Overall example](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example#login-endpoint-protection)

### Inferences

- None of the systems surveyed lets a correct password through an active lock on the same key. The difference lies only
  in the key: if the key includes the attacker's IP, the victim is on a different key.
- Unlock paths by type: time (Keycloak temporary, Authelia, Devise `:time`, ASP.NET, Kanidm, better-auth, Rack::Attack,
  Laravel, rate-limiter-flexible), email link (Devise only), administrator UI (Keycloak, Zitadel, django-axes admin),
  CLI (Authelia).

### Gaps

- No system surveyed was found to offer a "trusted device" bypass built in; it appears only as a suggestion in the
  rate-limiter-flexible wiki.

## Which systems document the lockout denial-of-service trade-off, and what do they recommend?

### Takeaway

The trade-off is stated explicitly by Keycloak, Ory (maintainer), django-ratelimit, The Copenhagen Book, the
rate-limiter-flexible wiki and a Rack::Attack code comment; Authelia implies it by recommending `ip` mode. The
recommendations converge on limiting by IP (or user name + IP), using soft measures such as CAPTCHA or capped delays
for per-account signals, and adding MFA and an edge WAF or IPS.

### Cited Findings

- Keycloak: "the server becomes vulnerable to denial of service attacks"; recommendation: intrusion prevention
  software working on the logged client IPs —
  [Keycloak docs source, brute-force.adoc](https://raw.githubusercontent.com/keycloak/keycloak/main/docs/documentation/server_admin/topics/threat/brute-force.adoc)
- Ory Kratos maintainer: "you can effectively DoS accounts and lock them by trying to repeatedly log in";
  recommendation: capped backoff instead of lockout, WAF at the edge, failed-login webhook —
  [ory/kratos issue 3037](https://github.com/ory/kratos/issues/3037)
- django-ratelimit: "limiting based on field values may open a denial of service vector against your users";
  recommendation: "a soft blocking mechanism, such as requiring a captcha, rather than a hard block" —
  [django-ratelimit docs, Security considerations](https://django-ratelimit.readthedocs.io/en/stable/security.html)
- The Copenhagen Book: identifier-based throttling "can introduce DoS vulnerabilities"; recommendation: always IP-based
  throttling (example 10 consecutive failures, 10 minutes), MFA, bot detection —
  [The Copenhagen Book, Password authentication](https://copenhagen.pilcrowonpaper.com/password-authentication)
- rate-limiter-flexible wiki: user-name-only blocking can "block user account for infinity"; recommendation: counter on
  user name + IP, slow per-IP counter, trusted devices —
  [rate-limiter-flexible wiki, Overall example](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example#login-endpoint-protection)
- Rack::Attack example configuration: comment that the per-email throttle can be triggered against another user's
  account (paraphrased) — [Rack::Attack docs, example_configuration.md](https://raw.githubusercontent.com/rack/rack-attack/main/docs/example_configuration.md)
- Authelia: "The recommended mode is `ip`." (default remains `user`) —
  [Authelia docs, Regulation](https://www.authelia.com/configuration/security/regulation/)
- Laravel Fortify: default key user name + IP; "a mixture of throttling, two-factor authentication, and an external
  web application firewall (WAF)" — [Laravel 13.x docs, Fortify](https://laravel.com/docs/13.x/fortify)
- authentik: the reputation policy is described as a trigger for an extra challenge (CAPTCHA) for low-reputation
  requests, not as a block — [authentik docs, Reputation policy](https://docs.goauthentik.io/customize/policies/types/reputation/)

### Inferences

- Summary of keys: per account only (Keycloak, Zitadel, Devise, ASP.NET Core Identity, Kanidm, Authelia default);
  per IP only (better-auth, django-axes default, Authelia `ip` mode, Pocket ID, Rack::Attack `logins/ip`);
  user name + IP combined (Laravel Fortify, rate-limiter-flexible, django-axes when configured); score per IP and
  identifier (authentik); nothing built in (Ory Kratos, Auth.js, Spring Security, Django core).
- Systems that key on IP move the hard problem to client IP resolution: better-auth (single-value header or
  `trustedProxies`), django-axes (`AXES_IPWARE_PROXY_COUNT`, precedence order), Pocket ID (`TRUST_PROXY`),
  django-ratelimit (own middleware). All warn that a client-settable header defeats the limit.
- Devise is the only system here whose unlock path (email link) is usable by the legitimate user but not by the
  attacker; the others rely on time or an administrator.

### Gaps

- No statement on the trade-off was found in the docs read for Zitadel, Devise, ASP.NET Core Identity, django-axes,
  authentik and better-auth.
- NIST SP 800-63B and OWASP guidance, which several of these projects cite, were not part of this assignment and were
  not read.
