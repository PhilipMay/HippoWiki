# Login lockout and client IP handling in wikis and knowledge bases

State as of 2026-11-13. Method: source files were downloaded from the public repositories and read directly; documentation
pages were fetched where reachable. Each finding names the version or branch it was read from. "Not verified" marks
anything taken from a search-result summary or from memory instead of from a fetched primary source.

## Cross-system overview

### Takeaway

No system in this set uses a hard, account-wide lockout by default. The defaults are either a throttle keyed on
IP + user name (MediaWiki, BookStack), a throttle keyed on IP alone (Wiki.js, Outline, Docmost), a per-user CAPTCHA
(Confluence, XWiki) or nothing at all (DokuWiki core, TiddlyWiki). For the client IP, three systems trust nothing until
a proxy list is set (MediaWiki, BookStack, Tomcat-based Confluence/XWiki with private ranges pre-trusted), DokuWiki
pre-trusts private ranges, and three Node.js systems trust the left-most `X-Forwarded-For` entry blindly once proxy
trust is on (Wiki.js, Outline by default, Docmost always).

### Cited Findings

- MediaWiki's own default-value comment names the trade-off: "We need to balance the risk of somebody using this as a
  DoS attack to lock someone out of their account, and someone doing a brute force attack." —
  [MainConfigSchema.php](https://github.com/wikimedia/mediawiki/blob/master/includes/MainConfigSchema.php)
- Wiki.js 3 source comments state that `trustProxy: true` "trusts the whole chain and therefore takes the LEFTMOST
  `X-Forwarded-For` entry, which a client can put anything it likes into" and that a hop count or CIDR list "cannot
  [be] express[ed] yet". — [backend/index.ts](https://github.com/requarks/wiki/blob/scarlett/backend/index.ts)
- Koa's documentation describes the same forged-leftmost-entry risk for `app.proxy` and offers `proxyIpHeader` and
  `maxIpsCount` as mitigations. — [koa request.md](https://github.com/koajs/koa/blob/master/docs/api/request.md)
- Fastify documents `trustProxy: true` as "Trust all proxies" and states that hop-count-only trust is disabled because
  it "lets direct clients spoof `X-Forwarded-*` values". —
  [Fastify Server.md](https://github.com/fastify/fastify/blob/main/docs/Reference/Server.md)

### Inferences

- Comparison of defaults (all from the per-system sections below):

  | System                  | Limiter key                      | Default numbers                       | Kind                                           | Correct password works while limited?      | Anonymous lockout of a known account                           |
  | ----------------------- | -------------------------------- | ------------------------------------- | ---------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
  | MediaWiki core          | IP + user name                   | 5 / 300 s and 150 / 48 h              | throttle (fixed window)                        | No                                         | Only from the same IP; from anywhere if `allIPs` is configured |
  | MediaWiki + ConfirmEdit | IP; user name                    | 3 / 300 s per IP; 20 / 600 s per user | CAPTCHA                                        | Yes, with CAPTCHA                          | No lockout, only a forced CAPTCHA                              |
  | DokuWiki core           | none                             | none                                  | none                                           | n/a                                        | No (no limiter)                                                |
  | BookStack               | lower-cased user name + IP       | 5 failures, 1 minute                  | throttle                                       | No                                         | Only from the same IP (or when all users share the proxy IP)   |
  | Wiki.js 2.5             | IP + mutation                    | 5 / 60 s                              | throttle                                       | No (same IP)                               | No per-account state                                           |
  | Wiki.js 3               | IP (all auth endpoints together) | 10 / 5 min, then 15 min ban           | throttle with ban                              | No (same IP)                               | No per-account state                                           |
  | Outline                 | IP (unauthenticated)             | 10 / hour on email sign-in            | throttle                                       | n/a (no passwords)                         | No per-account state                                           |
  | Docmost                 | IP + route                       | 10 / 60 s                             | throttle                                       | No (same IP)                               | No per-account state                                           |
  | XWiki                   | user name (+ session)            | 3 / 300 s                             | CAPTCHA by default; optional account disabling | Yes with CAPTCHA; No with `disableAccount` | Forced CAPTCHA; real lockout with `disableAccount`             |
  | Confluence DC           | user (per-user counter)          | 3 failures                            | CAPTCHA                                        | Yes, with CAPTCHA                          | Forced CAPTCHA; API logins refused until a web login           |
  | TiddlyWiki server       | none                             | none                                  | none                                           | n/a                                        | No (no limiter)                                                |

- Systems that key on IP alone or IP + user name avoid the lockout DoS but depend entirely on a correct client IP.
  Behind an unconfigured proxy every user shares the proxy's address, which turns an IP-keyed limiter into a global
  one; with blind header trust the limiter can be bypassed by rotating a forged header.
- Systems that key on the user name alone (Confluence, XWiki) chose a CAPTCHA instead of a lockout, which is the
  common way to keep the owner able to log in while an attacker keeps failing.

### Gaps

- Advisory searches were run only for MediaWiki, DokuWiki and Wiki.js. No CVE search was done for BookStack, Outline,
  Docmost, XWiki, Confluence or TiddlyWiki regarding `X-Forwarded-For` trust or lockout DoS; absence of a finding
  below is not evidence of absence.

## MediaWiki

### Takeaway

Core throttles password attempts per IP + user name (5 per 300 s and 150 per 48 h) through
`$wgPasswordAttemptThrottle`; it is a fixed-window throttle that also rejects the correct password while active, and it
becomes a per-account lockout only if an operator adds the `allIPs` key. The client IP comes from `X-Forwarded-For`
only for hops listed in `$wgCdnServers` / `$wgCdnServersNoPurge`; the default lists are empty, so nothing is trusted.

### Cited Findings

Version read: `master`, `MW_VERSION` = `1.48.0-alpha`
([Defines.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Defines.php)).

Failed-login limit

- `$wgPasswordAttemptThrottle` default is `[ [ 'count' => 5, 'seconds' => 300 ], [ 'count' => 150, 'seconds' => 60*60*48 ] ]`.
  Doc comment: "Limit password attempts to X attempts per Y seconds per IP per account. … If the key 'allIPs' (case
  sensitive) is present, then the limit is just per account instead of per IP per account." Multiple limits and
  `allIPs` exist since 1.27; "Requires $wgMainCacheType to be enabled". —
  [MainConfigSchema.php](https://github.com/wikimedia/mediawiki/blob/master/includes/MainConfigSchema.php)
- The manual page confirms the defaults (1.14 to 1.26: a single 5 per 300 s; 1.27+: the two thresholds), states that
  `$wgMainCacheType` must not be `CACHE_NONE`, that `$wgPasswordAttemptThrottle = [];` disables it, and that the
  `AuthenticationAttemptThrottled` hook runs when the throttle is hit. —
  [Manual:$wgPasswordAttemptThrottle](https://www.mediawiki.org/wiki/Manual:$wgPasswordAttemptThrottle)
- Keying, verified in code: the cache key is `throttler:<type>:<index>:<ip or ''>:<md5(username) or ''>`. With the
  default conditions (no `allIPs`) the key is IP + user name. The IP part is dropped only for a condition that has
  `allIPs`; the user part is dropped only when the request carries no user name ("If nothing uses usernames, just
  throttle by IP"). So there is no separate IP-only counter by default. —
  [Throttler.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Auth/Throttler.php),
  [ThrottlePreAuthenticationProvider.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Auth/ThrottlePreAuthenticationProvider.php)
- The counter is increased before every authentication attempt (`testForAuthentication` calls `increase()`), not only
  after failures; every user name the input could normalise to is throttled individually. —
  [ThrottlePreAuthenticationProvider.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Auth/ThrottlePreAuthenticationProvider.php)
- `$wgRateLimits` (the ping limiter) has no login action in its defaults. Default keys are `edit`, `move`, `upload`,
  `rollback`, `mailpassword` (`ip` 5 per 3600 s), `sendemail`, `changeemail`, `confirmemail`, `purge`, `linkpurge`,
  `renderfile`, `renderfile-nonstandard`, `stashedit`, `stashbasehtml`, `changetags`, `editcontentmodel`. —
  [MainConfigSchema.php](https://github.com/wikimedia/mediawiki/blob/master/includes/MainConfigSchema.php)
- `$wgRateLimits` supports the limit groups `ip`, `subnet` (/24 IPv4, /64 IPv6), `ip-all`, `subnet-all`, `newbie`,
  `user`; ConfirmEdit adds a `badcaptcha` action key. — [Manual:$wgRateLimits](https://www.mediawiki.org/wiki/Manual:$wgRateLimits)

Lockout, throttle or CAPTCHA

- Core: throttle. When the stored count has reached `count`, `increase()` returns `wait` = the full `seconds` value
  and `testForAuthentication` returns a fatal `login-throttled` status before any password check, so the correct
  password is rejected too. While throttled the counter is not incremented further; the counter is created with the
  window as its TTL (`incrWithInit( $throttleKey, $expiry, 1 )`). —
  [Throttler.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Auth/Throttler.php)
- A successful login clears the counters for that user name and IP (`postAuthentication` calls `clear()` on `PASS`). —
  [ThrottlePreAuthenticationProvider.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Auth/ThrottlePreAuthenticationProvider.php)
- CAPTCHA via the ConfirmEdit extension: triggers `badlogin` ("triggered after several failed login attempts from the
  same IP address") and `badloginperuser` ("…using the same username"), both `true` by default. Defaults:
  `$wgCaptchaBadLoginAttempts = 3`, `$wgCaptchaBadLoginExpiration = 300`, `$wgCaptchaBadLoginPerUserAttempts = 20`,
  `$wgCaptchaBadLoginPerUserExpiration = 600`. A second, longer tier applies at attempts × 30 within expiration × 300.
  Requires `$wgMainCacheType` other than `CACHE_NONE`. —
  [Extension:ConfirmEdit](https://www.mediawiki.org/wiki/Extension:ConfirmEdit),
  [ConfirmEdit extension.json](https://github.com/wikimedia/mediawiki-extensions-ConfirmEdit/blob/master/extension.json)
- ConfirmEdit resets the bad-login counter on success and increases it on failure, and remembers a per-user trigger in
  the session. —
  [CaptchaPreAuthenticationProvider.php](https://github.com/wikimedia/mediawiki-extensions-ConfirmEdit/blob/master/includes/Auth/CaptchaPreAuthenticationProvider.php)

Lockout of a known account

- The risk is acknowledged in the source comment on the long-term limit: "We need to balance the risk of somebody
  using this as a DoS attack to lock someone out of their account, and someone doing a brute force attack." —
  [MainConfigSchema.php](https://github.com/wikimedia/mediawiki/blob/master/includes/MainConfigSchema.php);
  repeated on [Manual:$wgPasswordAttemptThrottle](https://www.mediawiki.org/wiki/Manual:$wgPasswordAttemptThrottle)

Client IP behind a proxy

- `WebRequest::getIP()` starts from the raw connection address and reads only `X-Forwarded-For`. It walks the chain
  from right to left and moves one hop further only while the current address `isTrustedProxy()`. It stops at a
  private next hop unless `$wgUsePrivateIPs` is true or the current hop is a configured proxy. An invalid address in
  the header from a configured proxy raises "Invalid IP given in XFF". Extensions can override through the `GetIP`
  hook. — [WebRequest.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Request/WebRequest.php)
- `isTrustedProxy()` is `isConfiguredProxy()` (exact match against the simple list, then CIDR match against the
  complex list) plus the `IsTrustedProxy` hook. —
  [ProxyLookup.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Request/ProxyLookup.php)
- Settings and defaults: `$wgUseCdn = false`; `$wgCdnServers = []` ("When MediaWiki is running behind a proxy, it will
  trust X-Forwarded-For headers sent/modified from these proxies"; these servers are also purged);
  `$wgCdnServersNoPurge = []` ("use to set a list of trusted proxies, etc. Supports both individual IP addresses and
  CIDR blocks"); `$wgUsePrivateIPs = false` ("Should forwarded Private IPs be accepted?"). —
  [MainConfigSchema.php](https://github.com/wikimedia/mediawiki/blob/master/includes/MainConfigSchema.php)
- The manual example for a non-caching reverse proxy is `$wgUseCdn = true; $wgCdnServersNoPurge[] = "192.0.2.0/24";`. —
  [Manual:$wgCdnServersNoPurge](https://www.mediawiki.org/wiki/Manual:$wgCdnServersNoPurge)

Advisories

- CVE-2023-29141: an auto-block could be applied for addresses in an untrusted `X-Forwarded-For` header; fixed in
  1.35.10, 1.38.6 and 1.39.3 ("Do not apply autoblocks to untrusted XFF headers"). Taken from a search-result summary
  of the advisory and the Phabricator task, not from a fetched page. —
  [Phabricator T285159](https://phabricator.wikimedia.org/T285159),
  [GitLab advisory](https://advisories.gitlab.com/pkg/composer/mediawiki/core/CVE-2023-29141/)

### Inferences

- With defaults, an anonymous attacker on another IP cannot throttle the admin account, because every counter
  includes the attacker's own IP. The lockout DoS applies when an operator adds `allIPs`, and also when MediaWiki sits
  behind a proxy that is not listed in `$wgCdnServers` / `$wgCdnServersNoPurge`: then every client has the proxy's IP
  and the "IP + user name" key degrades to "user name".
- Because trust is an explicit list and the chain is walked from the right, a client cannot forge its address by
  prepending values to `X-Forwarded-For`; the forged entry sits to the left of the first untrusted hop.
- The throttle window is fixed from the first attempt and is not extended by attempts made while throttled, so a
  throttled user is free again at most `seconds` after the first counted attempt.
- `getIP()` as read does not consult `$wgUseCdn`; the trust decision rests on the two server lists.

### Gaps

- Unlock path: no maintenance script for clearing a password throttle was found (not searched exhaustively). The
  counters live in the local-cluster object cache, so they end by expiry, by a successful login from the same
  IP + user name before the limit, or by clearing the cache; this is derived from the code, not from documentation.
- The latest stable release number in November 2026 was not checked; all code findings are from `master`.
- How `ProxyLookup` is wired to the two settings (service wiring) was not read; the mapping is taken from the setting
  doc comments.
- No Phabricator task dedicated to the lockout DoS was located.

## DokuWiki

### Takeaway

DokuWiki core has no failed-login limit of any kind; protection is left to plugins (CAPTCHA plugin), fail2ban or a
proxy. Client IP handling was rewritten: current releases use `X-Forwarded-For` only when every hop is in
`$conf['trustedproxies']`, whose default pre-trusts loopback and all private ranges.

### Cited Findings

Versions read: `master` (`$updateVersion = "58"`), `stable` branch (`57.3`), tags `release-2026-07-14c`,
`release-2025-05-14`, `release-2024-02-06b`. Latest release tag on GitHub: `release-2026-07-14c`, published 2026-09-02
([releases](https://github.com/dokuwiki/dokuwiki/releases)).

Failed-login limit

- `auth_login()` contains no attempt counter, delay per failure, lockout or CAPTCHA. The only delay is
  `usleep(random_int(0, 250))` on a non-empty password, commented "add a random delay to prevent timing attacks
  #4491" (that is at most 250 microseconds). —
  [inc/auth.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/auth.php)
- The default configuration has no setting for login attempts; the auth-related settings are
  `auth_security_timeout = 900` and `securecookie = 1`. —
  [conf/dokuwiki.php](https://github.com/dokuwiki/dokuwiki/blob/master/conf/dokuwiki.php)
- The CAPTCHA plugin (separate plugin by the DokuWiki lead developer) ships the options `loginprotect` (default `2`),
  `logindenial` (default `0`) and `logindenial_max` (default `3600`). —
  [dokuwiki-plugin-captcha conf/default.php](https://github.com/splitbrain/dokuwiki-plugin-captcha/blob/master/conf/default.php)
- Login can be intercepted by plugins through the `AUTH_LOGIN_CHECK` event. —
  [inc/auth.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/auth.php)

Client IP behind a proxy

- Current behaviour (`master`, `stable`, `release-2026-07-14c`): `Ip::clientIps()` builds the list in this order:
  the header named by `$conf['client_ip_header']` if set, the `X-Forwarded-For` addresses if all proxies are trusted,
  then `REMOTE_ADDR`, with `0.0.0.0` as fallback; the client IP is the first entry. —
  [inc/Ip.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/Ip.php)
- `Ip::forwardedFor()`: the client is the left-most entry; every remaining entry plus `REMOTE_ADDR` must match
  `trustedproxies`, otherwise the whole header is ignored (empty array). "To prevent spoofing of the client IP, every
  proxy listed in the X-Forwarded-For header must be trusted, as well as the TCP/IP endpoint". —
  [inc/Ip.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/Ip.php)
- Default: `$conf['trustedproxies'] = array('::1', 'fe80::/10', '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16');`
  (addresses or CIDR ranges). `$conf['client_ip_header'] = '';` with the comment "Only enable this if your server
  writes this header, otherwise it may be spoofed." —
  [conf/dokuwiki.php](https://github.com/dokuwiki/dokuwiki/blob/master/conf/dokuwiki.php)
- `X-Forwarded-Host` and `X-Forwarded-Proto` are honoured only when `REMOTE_ADDR` is a trusted proxy. —
  [inc/Ip.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/Ip.php)
- Change between versions:
  - `release-2024-02-06b`: `$conf['trustedproxy']` was a regular expression
    (`'^(::1|[fF][eE]80:|127\.|10\.|192\.168\.|172\.((1[6-9])|(2[0-9])|(3[0-1]))\.)'`). `clientIP()` collected
    `REMOTE_ADDR`, then all `X-Forwarded-For` entries, then `X-Real-IP` unconditionally and returned the first address
    not matching the regex. —
    [conf/dokuwiki.php at release-2024-02-06b](https://github.com/dokuwiki/dokuwiki/blob/release-2024-02-06b/conf/dokuwiki.php),
    [inc/common.php at release-2024-02-06b](https://github.com/dokuwiki/dokuwiki/blob/release-2024-02-06b/inc/common.php)
  - `release-2025-05-14`: `trustedproxies` array (as today) plus `$conf['realip'] = false` ("Enable reading the
    X-Real-IP header"). —
    [conf/dokuwiki.php at release-2025-05-14](https://github.com/dokuwiki/dokuwiki/blob/release-2025-05-14/conf/dokuwiki.php)
  - `release-2026-07-14c`: `realip` is replaced by `client_ip_header` (a configurable header name). —
    [conf/dokuwiki.php at release-2026-07-14c](https://github.com/dokuwiki/dokuwiki/blob/release-2026-07-14c/conf/dokuwiki.php)

### Inferences

- With no limiter there is no lockout DoS, and also no built-in brute-force protection; an operator must add
  fail2ban, the CAPTCHA plugin or proxy-level rate limiting.
- In the 2024 code, a request arriving through a private-range proxy took the left-most public `X-Forwarded-For`
  entry, which the client controls when the proxy appends instead of replacing; the 2025 rewrite closes this by
  requiring every hop after the first to be trusted.
- The default trust of all private ranges means a client inside a private network that reaches DokuWiki directly, or
  through an appending proxy, can still present a forged address; narrowing `trustedproxies` to the real proxy
  address removes this.
- When the header fails the trust check, DokuWiki falls back to `REMOTE_ADDR`, which behind a proxy is the proxy's
  own address, not the attacker's.

### Gaps

- dokuwiki.org documentation pages (`config:trustedproxies`, `config:client_ip_header`, `security`, `tips:fail2ban`,
  `changes`) could not be read: the site answered every request with a bot check (HTTP 402). Statements about what
  the documentation recommends (fail2ban) are therefore not verified.
- The meaning of the CAPTCHA plugin values (`loginprotect = 2`, `logindenial`) was not read from the plugin's
  settings metadata.
- No DokuWiki CVE on `X-Forwarded-For` handling was found in one search; the reason for the 2025 rewrite was not
  traced to an advisory.

## BookStack

### Takeaway

BookStack throttles failed email/password logins per lower-cased user name + client IP: 5 failures, then a refusal
for 1 minute, hardcoded. The client IP comes from Laravel's TrustProxies middleware; `APP_PROXIES` is empty by
default, so forwarded headers are ignored until a proxy list (or `*`) is set.

### Cited Findings

Versions read: tag `v26.09.3` (published 2026-11-11) and the `development` branch; the throttle trait is identical in
both.

Failed-login limit

- Throttle key: `Str::transliterate(Str::lower($request->input($this->username())) . '|' . $request->ip())`.
  `maxAttempts()` returns `5`, `decayMinutes()` returns `1`; both are plain methods with no configuration option. —
  [ThrottlesLogins.php](https://github.com/BookStackApp/BookStack/blob/v26.09.3/app/Access/Controllers/ThrottlesLogins.php)
- Flow in `login()`: the limit is checked first (`hasTooManyLoginAttempts`); if exceeded, the failed login is logged
  and a lockout response is sent without checking the password. Only a failed attempt increments the counter. A
  successful login calls `clearLoginAttempts()`. —
  [LoginController.php](https://github.com/BookStackApp/BookStack/blob/v26.09.3/app/Access/Controllers/LoginController.php)
- The lockout response is a validation error with HTTP 429 and the `auth.throttle` message carrying the remaining
  seconds. —
  [ThrottlesLogins.php](https://github.com/BookStackApp/BookStack/blob/v26.09.3/app/Access/Controllers/ThrottlesLogins.php)
- Registration, invite, password-reset request and password-reset routes use the route middleware
  `throttle:public`. — [routes/web.php](https://github.com/BookStackApp/BookStack/blob/v26.09.3/routes/web.php)
- For external tools: `LOG_FAILED_LOGIN_MESSAGE` (default `false`) and `LOG_FAILED_LOGIN_CHANNEL`
  (default `errorlog_plain_webserver`) write failed logins to a log, "to use with tools such as Fail2Ban"; works for
  email/password and LDAP logins, not for social or SAML2 logins. —
  [BookStack security docs](https://www.bookstackapp.com/docs/admin/security/),
  [.env.example.complete](https://github.com/BookStackApp/BookStack/blob/development/.env.example.complete)

Client IP behind a proxy

- "By default BookStack will consider the IP address it receives to be that of the end user. If BookStack is hosted
  behind a proxy server, this can result in the proxy's IP address being used for all users, which can impact areas
  of the application like the audit log, and rate limit handling." `APP_PROXIES` takes one address, a comma-separated
  list, or `*` to trust all; for `*` the docs advise that specifying proxies is better "since you are delegating
  trust". — [BookStack security docs](https://www.bookstackapp.com/docs/admin/security/)
- Implementation: `'proxies' => env('APP_PROXIES', '')`; the middleware passes `*`, `**` or the exploded list to
  Laravel's `TrustProxies` and honours `X-Forwarded-For`, `-Host`, `-Port`, `-Proto` and the AWS ELB header. —
  [app/Config/app.php](https://github.com/BookStackApp/BookStack/blob/development/app/Config/app.php),
  [TrustProxies.php](https://github.com/BookStackApp/BookStack/blob/development/app/Http/Middleware/TrustProxies.php)

### Inferences

- Throttle, not lockout, and the correct password is refused during the minute for that user name + IP pair.
- Because the key contains the IP, an attacker elsewhere cannot lock out a known account. The exception is the
  situation the docs warn about: behind a proxy without `APP_PROXIES`, every request has the proxy's IP, the key
  becomes effectively "user name", and five bad passwords per minute keep that account locked for everyone.
- The limit is per user name + IP, so one IP can still try five passwords per minute against each of many accounts;
  there is no IP-only login limit.
- Unlock: wait one minute. The counters are in Laravel's rate limiter, which uses the application cache, so clearing
  the cache would also remove them (derived from the framework, not from BookStack documentation).
- A list in `APP_PROXIES` is a trusted-address list, not a hop count.

### Gaps

- The exact semantics of `*` versus `**` in the installed Laravel version (right-most versus left-most entry) were
  not read from the framework source.
- The definition of the `public` rate limiter (numbers and key) was not read.
- Whether MFA code verification is throttled was not established (no throttle call was seen in `MfaController`).
- No BookStack issue or advisory on login lockout or forwarded-header trust was searched for.

## Wiki.js

### Takeaway

Both lines limit login attempts by client IP only, with no per-account state: 2.5 allows 5 login calls per 60 s per
IP, 3.x allows 10 attempts per 5 minutes per IP across all authentication endpoints and then bans the IP for
15 minutes. Proxy trust is a single boolean in both lines; when on, the left-most `X-Forwarded-For` entry is taken
without a trusted-proxy list or hop count.

### Cited Findings

Versions read: tag `v2.5.315`, and the default branch `scarlett` (3.x). GitHub lists releases 3.2.0 (2026-11-08),
3.3.0 (2026-11-09) and 3.3.1 (2026-11-11) ([releases](https://github.com/requarks/wiki/releases)).

Wiki.js 2.5

- GraphQL mutations carry a rate-limit directive: `login`, `loginTFA` and `loginChangePassword` have
  `@rateLimit(limit: 5, duration: 60)`; `forgotPassword` has `@rateLimit(limit: 3, duration: 60)`. —
  [authentication.graphql](https://github.com/requarks/wiki/blob/v2.5.315/server/graph/schemas/authentication.graphql)
- Key: `` `${context.req.ip}:${info.parentType}.${info.fieldName}` ``, that is IP + mutation name, using
  `graphql-rate-limit-directive` 1.2.1. —
  [rate-limit.js](https://github.com/requarks/wiki/blob/v2.5.315/server/graph/directives/rate-limit.js),
  [package.json](https://github.com/requarks/wiki/blob/v2.5.315/package.json)
- Proxy: `if (WIKI.config.security.securityTrustProxy) { app.enable('trust proxy') }`; default
  `securityTrustProxy: false`. —
  [master.js](https://github.com/requarks/wiki/blob/v2.5.315/server/master.js),
  [data.yml](https://github.com/requarks/wiki/blob/v2.5.315/server/app/data.yml)

Wiki.js 3.x

- `limitAuthAttempts` is an `onRequest` hook on the authentication routes (login with user/password and further auth
  endpoints). Defaults: `max: 10`, `windowSeconds: 300`, `banSeconds: 900`. Settings under `security`:
  `authRateLimitEnabled`, `authRateLimitMax`, `authRateLimitWindow`, `authRateLimitBan` (durations written like `5m`,
  `15m`). — [helpers/rateLimit.ts](https://github.com/requarks/wiki/blob/scarlett/backend/helpers/rateLimit.ts),
  [api/authentication.ts](https://github.com/requarks/wiki/blob/scarlett/backend/api/authentication.ts)
- Key: `` `auth:${req.ip}` ``, "One counter per client address, shared by all of them" (all guarded endpoints).
  "Attempts are counted whether or not they succeed." Refusal is HTTP 429 with `Retry-After`; the comment mentions
  "a legitimate user locked out by a shared address". —
  [helpers/rateLimit.ts](https://github.com/requarks/wiki/blob/scarlett/backend/helpers/rateLimit.ts)
- Storage and algorithm: a PostgreSQL table `rateLimits`, one upsert per attempt; fixed window; the attempt that
  exceeds `max` sets `bannedUntil`; "A banned key stops counting: its ban runs for exactly as long as it was set
  for"; after the ban the window starts from zero; shared across instances behind a load balancer; rows untouched
  for a day are purged. —
  [models/rateLimits.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/rateLimits.ts)
- Proxy: Fastify is created with `trustProxy: () => WIKI.config.security?.trustProxy === true`, read per request.
  Comment: "`true` trusts the whole chain and therefore takes the LEFTMOST `X-Forwarded-For` entry, which a client
  can put anything it likes into. … a deployment where clients can reach the wiki without passing the proxy needs a
  hop count or a CIDR list, which this setting cannot express yet." The rate-limit helper notes that behind a proxy
  "the `trustProxy` security setting has to be on for this to see anything but the proxy". —
  [backend/index.ts](https://github.com/requarks/wiki/blob/scarlett/backend/index.ts),
  [helpers/rateLimit.ts](https://github.com/requarks/wiki/blob/scarlett/backend/helpers/rateLimit.ts)
- Admin recovery CLI commands present: `reset-password` ("Give an account a new random password, removing 2FA and
  passkeys") and `reset-security` (turns off CSP enforcement and resets CORS); command files are `accounts`, `info`,
  `listAdmins`, `maintenance`, `resetPassword`, `sites`. —
  [cli/commands/resetPassword.ts](https://github.com/requarks/wiki/blob/scarlett/backend/cli/commands/resetPassword.ts),
  [cli/commands/maintenance.ts](https://github.com/requarks/wiki/blob/scarlett/backend/cli/commands/maintenance.ts)

Advisories

- One search found no Wiki.js advisory about a rate-limit bypass through `X-Forwarded-For` or about lockout; the only
  hit was the unrelated CVE-2022-1681 (authentication bypass before 2.5.281), seen in a search summary only. —
  [CVE-2022-1681 summary](https://www.rainforest.tech/en/cves/CVE-2022-1681)

### Inferences

- No account can be locked by an anonymous attacker in either line, since nothing is stored per account. The cost is
  that a shared address (NAT, or the proxy itself while proxy trust is off) is limited as one client, and in 3.x is
  banned for 15 minutes for everyone behind it.
- In 2.5, Express `trust proxy` enabled as a boolean also means the left-most forwarded entry is used, so in both
  lines an attacker who can send their own `X-Forwarded-For` (proxy appends, or direct access to the app port) gets a
  fresh limiter bucket per forged value once proxy trust is on.
- In 3.x a correct password is refused while the IP is banned, and successful logins do not reset the counter (no
  call to the model's `reset()` was found in the auth API or the users model).
- Unlock in 3.x: wait for the ban to end, or delete the row from `rateLimits`; no CLI command for clearing a ban was
  seen.
- The 2.5 limiter state is most likely in process memory (library default), so it is per instance and reset by a
  restart; this was not verified.

### Gaps

- The default value of `security.trustProxy` in 3.x was not found in the files read.
- 3.x findings are from the head of the `scarlett` branch; they were not compared against the `3.3.1` tag, and the
  3.x line is days old, so details may still move.
- Whether 2.5 always had the `securityTrustProxy` switch (or trusted proxies unconditionally in early 2.x) was not
  checked.

## Outline

### Takeaway

Outline has no password login, so there is no password brute-force limiter and no account lockout; sign-in is through
external identity providers, email links/codes and passkeys, protected by a Redis-backed request rate limiter keyed
on IP for unauthenticated requests. Forwarded headers are trusted by default (`PROXY_HEADERS_TRUSTED=true`) with no
trusted-proxy list.

### Cited Findings

Version read: `main`, `package.json` version `1.12.0` (release v1.12.0 published 2026-10-23).

Limits

- `RATE_LIMITER_ENABLED` defaults to `true`; the global limiter allows `RATE_LIMITER_REQUESTS=1000` per
  `RATE_LIMITER_DURATION_WINDOW=60` seconds; "Individual endpoints have hardcoded rate limits that are enabled with
  the above setting"; `RATE_LIMITER_MULTIPLIER` (default 1) scales the per-endpoint limits. —
  [.env.sample](https://github.com/outline/outline/blob/main/.env.sample),
  [server/env.ts](https://github.com/outline/outline/blob/main/server/env.ts)
- Identifier: no token means `[ctx.ip]`; an API key or OAuth token means IP and a credential identifier; a session
  token means the user id ("so that users behind a shared NAT do not share a bucket"). Per-endpoint limiters use the
  key `<path>:<identifier>`. —
  [middlewares/rateLimiter.ts](https://github.com/outline/outline/blob/main/server/middlewares/rateLimiter.ts)
- The email sign-in request endpoint (`POST email`) uses `RateLimiterStrategy.TenPerHour` (10 requests per 3600 s);
  a second route in the same file uses `FivePerMinute` (5 per 60 s). —
  [plugins/email/server/auth/email.ts](https://github.com/outline/outline/blob/main/plugins/email/server/auth/email.ts),
  [utils/RateLimiter.ts](https://github.com/outline/outline/blob/main/server/utils/RateLimiter.ts)
- Exceeding a limit returns a rate-limit error with `Retry-After` and `RateLimit-*` headers. If the limiter store
  fails, the error is logged and the request proceeds ("an outage of the store does not take the endpoint down with
  it"). The store is Redis with an in-memory fallback limiter. —
  [middlewares/rateLimiter.ts](https://github.com/outline/outline/blob/main/server/middlewares/rateLimiter.ts),
  [utils/RateLimiter.ts](https://github.com/outline/outline/blob/main/server/utils/RateLimiter.ts)

Client IP behind a proxy

- `PROXY_HEADERS_TRUSTED`: "Whether to trust the X-Forwarded-* headers … Defaults to true for backwards compat. Set
  to false if not running behind a proxy in production." `PROXY_IP_HEADER`: "The default value is
  \"X-Forwarded-For\", common values are \"X-Real-IP\" and \"X-Client-IP\"." —
  [server/env.ts](https://github.com/outline/outline/blob/main/server/env.ts)
- Implementation: `if (env.PROXY_HEADERS_TRUSTED) { app.proxy = true; if (env.PROXY_IP_HEADER) { app.proxyIpHeader = env.PROXY_IP_HEADER; } }`;
  no trusted-proxy list or hop count is set there. —
  [server/services/web.ts](https://github.com/outline/outline/blob/main/server/services/web.ts)
- Koa: with `app.proxy` the forwarded addresses are returned "ordered from upstream -> downstream", and a client can
  forge the first entry when the proxy appends; mitigations are `proxyIpHeader` or `maxIpsCount`. —
  [koa request.md](https://github.com/koajs/koa/blob/master/docs/api/request.md)

### Inferences

- Brute-force protection of passwords is delegated to the external identity provider; Outline only limits how often
  its own endpoints can be called.
- No named account can be locked out. An attacker can request sign-in emails for a known address up to the per-IP
  limit (10 per hour per IP), which is a nuisance, not a lockout.
- With the default `PROXY_HEADERS_TRUSTED=true` and `X-Forwarded-For`, the IP used for unauthenticated limits is the
  left-most header entry, so the limits can be bypassed with forged headers unless the proxy overwrites the header
  or `PROXY_IP_HEADER` points to a header the proxy always sets (for example `X-Real-IP`).
- Unlock: limits expire by themselves; state is in Redis under the key prefix `rl`.

### Gaps

- The version in which `PROXY_HEADERS_TRUSTED` and `PROXY_IP_HEADER` were introduced was not determined.
- The passkey and one-time-code verification limits were not read in detail.
- docs.getoutline.com was not consulted; findings are from source only. No advisory search was done.

## XWiki

### Takeaway

XWiki's Authentication Security Module counts failed logins per user name (3 within 300 s by default) and then applies
a configurable strategy: CAPTCHA by default according to the release notes, or disabling the account. It does not use
the client IP at all, and XWiki has no proxy setting of its own; the client IP is whatever the servlet container
reports.

### Cited Findings

Version read: `master`, `18.10.0-SNAPSHOT`
([pom.xml](https://github.com/xwiki/xwiki-platform/blob/master/pom.xml)).

Failed-login limit

- Introduced in 11.6RC1. Release notes (search-result summary, page not fetched): by default three failed logins
  within five minutes show a CAPTCHA; attempts and window are configurable in Administration > Authentication; the
  module offers different strategies. —
  [XWiki 11.6RC1 release notes: Multiple login attacks protection](https://www.xwiki.org/xwiki/bin/view/ReleaseNotes/Data/XWiki/11.6RC1/Change007/)
- Code defaults: `maxAuthorizedAttempts` = 3, `timeWindowAttempts` = 300, `isAuthenticationSecurityEnabled` = true,
  `failureStrategy` = empty string (comma-separated list of strategy names). The values come from an XObject of class
  `XWiki.Authentication.ConfigurationClass` in the document `XWiki.Authentication.Configuration`. —
  [DefaultAuthenticationConfiguration.java](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-security/xwiki-platform-security-authentication/xwiki-platform-security-authentication-default/src/main/java/org/xwiki/security/authentication/internal/DefaultAuthenticationConfiguration.java),
  [AuthenticationConfigurationSource.java](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-security/xwiki-platform-security-authentication/xwiki-platform-security-authentication-default/src/main/java/org/xwiki/security/authentication/internal/AuthenticationConfigurationSource.java)
- Keying: failures are stored in an in-memory map keyed by the submitted user name; empty user names are skipped.
  When the threshold is reached the HTTP session id is also flagged for one day, so that session keeps getting the
  strategy form. —
  [DefaultAuthenticationFailureManager.java](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-security/xwiki-platform-security-authentication/xwiki-platform-security-authentication-default/src/main/java/org/xwiki/security/authentication/internal/DefaultAuthenticationFailureManager.java)
- Window logic: below the threshold the counter resets when the window has passed; once the threshold is reached,
  "each new failure is the new beginning of the time window". —
  [DefaultAuthenticationFailureManager.java](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-security/xwiki-platform-security-authentication/xwiki-platform-security-authentication-default/src/main/java/org/xwiki/security/authentication/internal/DefaultAuthenticationFailureManager.java)
- Login flow: a login succeeds only if the credentials are valid and `validateForm(username, request)` passes; the
  counter is then reset. A failed login records a failure. —
  [MyFormAuthenticator.java](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-oldcore/src/main/java/com/xpn/xwiki/user/impl/xwiki/MyFormAuthenticator.java)
- Strategy `captcha`: adds a CAPTCHA field to the login form and validates it. —
  [CaptchaAuthenticationFailureStrategy.java](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-security/xwiki-platform-security-authentication/xwiki-platform-security-authentication-default/src/main/java/org/xwiki/security/authentication/internal/CaptchaAuthenticationFailureStrategy.java)
- Strategy `disableAccount`: when the threshold is reached the user account found for the user name is disabled
  (`setDisabled(true)`), "allowing an admin to take an action"; logins are refused until the account is enabled
  again. —
  [DisableAccountFailureStrategy.java](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-security/xwiki-platform-security-authentication/xwiki-platform-security-authentication-default/src/main/java/org/xwiki/security/authentication/internal/DisableAccountFailureStrategy.java)
- Unlock: turning the feature off clears all recorded failures (the manager calls `clearRecords()` whenever it finds
  the feature disabled). —
  [DefaultAuthenticationFailureManager.java](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-security/xwiki-platform-security-authentication/xwiki-platform-security-authentication-default/src/main/java/org/xwiki/security/authentication/internal/DefaultAuthenticationFailureManager.java)
- From a search-result summary only (issue pages not fetched, issue numbers not confirmed): XWiki Jira notes that
  disabling the authentication security clears the login-failure information "which might unlock users in case of
  problems", and an open issue named XWIKI-22397 says administrators cannot yet view the list of users blocked by
  the mechanism. — [XWiki Jira, XWIKI-22397 (URL built from the issue key, not fetched)](https://jira.xwiki.org/browse/XWIKI-22397)

Client IP behind a proxy

- The `xwiki.properties` template contains no setting for forwarded headers, trusted proxies or a remote-IP header
  (searched for `forwarded`, `remoteip`, `proxy`). —
  [xwiki.properties.vm](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-tools/xwiki-platform-tool-configuration-resources/src/main/resources/xwiki.properties.vm)
- In Tomcat the usual mechanism is `RemoteIpValve`: `remoteIpHeader` defaults to `x-forwarded-for`; addresses
  matching `internalProxies` (default: private, link-local and loopback ranges as a regular expression) are trusted;
  `trustedProxies` has no default ("If not specified, no proxies will be trusted"). —
  [Tomcat 10.1 Remote IP Valve](https://tomcat.apache.org/tomcat-10.1-doc/config/valve.html#Remote_IP_Valve)

### Inferences

- With the CAPTCHA strategy the correct password still works once the CAPTCHA is solved, so an attacker can only
  force the CAPTCHA onto a known account, and can keep it there indefinitely because each further failure restarts
  the window.
- With `disableAccount`, any anonymous visitor can disable any known account, including an administrator, with three
  bad passwords; recovery then needs another administrator (or turning the feature off, which clears records but
  does not re-enable an already disabled account).
- The state is in memory, so a restart clears the counters and they are not shared between cluster nodes.
- The client IP is irrelevant to this limiter; it matters only for logs and for whatever the container exposes.

### Gaps

- The extension documentation page for the Authentication Security Module returned HTTP 403, so the documented
  defaults could not be read directly. The code default for `failureStrategy` is empty while the release notes say
  CAPTCHA is the default; where the CAPTCHA default is set (default configuration document or flavor) was not found.
- No XWiki documentation page on reverse-proxy client IP handling was located; the superadmin recovery account was
  not verified.
- No advisory search was done for XWiki.

## Atlassian Confluence (Data Center)

### Takeaway

Confluence shows a CAPTCHA on login after three failed attempts for a user (enabled by default, configurable), instead
of locking the account; the correct password plus the CAPTCHA still logs in. The client IP is a Tomcat matter:
`RemoteIpValve` in `conf/server.xml` with `internalProxies` as a regular-expression list of trusted proxies.

### Cited Findings

Version of the documentation read: Confluence 7.17 Data Center and Server (public page); the "latest" documentation
page redirected to a login and could not be read.

Failed-login limit

- "By default, Captcha for failed logins is enabled and the number of failed login attempts is set to three." The
  settings are "CAPTCHA on login" and "Maximum Authentication Attempts Allowed" under Administration > General
  Configuration > Security Configuration ("You must enter a number greater than zero"). —
  [Configuring Captcha for Failed Logins (7.17)](https://confluence.atlassian.com/conf717/configuring-captcha-for-failed-logins-1115676852.html)
- API logins: "after three failed login attempts via the XML-RPC or SOAP API, an error message will be returned
  instructing the user to log in via the web interface. Captcha will automatically be activated when they attempt
  this login." —
  [Configuring Captcha for Failed Logins (7.17)](https://confluence.atlassian.com/conf717/configuring-captcha-for-failed-logins-1115676852.html)
- The system property `password.confirmation.disabled` turns off password confirmation including the CAPTCHA for
  failed logins (meant for custom authentication setups). —
  [Configuring Captcha for Failed Logins (7.17)](https://confluence.atlassian.com/conf717/configuring-captcha-for-failed-logins-1115676852.html)
- The counter is per user: table `LOGININFO` with columns `TOTALFAILED` and `CURFAILED`, joined to `user_mapping` by
  user key. —
  [KB: Reset failed login count from Confluence database](https://support.atlassian.com/confluence/kb/reset-failed-login-count-from-confluence-database/)

Unlock path

- When the administration UI is not reachable: back up the database, shut down Confluence, run
  `UPDATE LOGININFO SET CURFAILED = 0 WHERE username IN ( SELECT user_key FROM user_mapping WHERE lower_username = 'admin' );`,
  start Confluence. The article describes the symptom as "You're seeing CAPTCHA on every Confluence login attempt." —
  [KB: Reset failed login count from Confluence database](https://support.atlassian.com/confluence/kb/reset-failed-login-count-from-confluence-database/)

Client IP behind a proxy

- "Tomcat will log the LB/Proxy IP in the access logs by default." The fix is a valve in `conf/server.xml` on every
  node, placed before the `AccessLogValve`:
  `<Valve className="org.apache.catalina.valves.RemoteIpValve" internalProxies="PROXY_IP_ADDRESS" remoteIpHeader="x-forwarded-for" protocolHeader="x-forwarded-proto" proxiesHeader="x-forwarded-by" />`.
  `internalProxies` "needs to be specified as a regular expression"; ranges allowed by default are 10.0.0.0/8,
  192.168.0.0/16, 169.254.0.0/16, 127.0.0.0/8 and ::1; the `AccessLogValve` needs `requestAttributesEnabled="true"`. —
  [KB: Enable X-Forwarded-For … Confluence Data Center](https://support.atlassian.com/confluence/kb/enable-x-forwarded-for-http-header-for-identifying-the-originating-ip-address-of-a-client-connecting-to-confluence-data-center/)
- Tomcat reference: `remoteIpHeader` defaults to `x-forwarded-for`; `internalProxies` is a regular expression with a
  default that "assumes that all local networks are trusted"; `trustedProxies`: "If not specified, no proxies will
  be trusted". —
  [Tomcat 10.1 Remote IP Valve](https://tomcat.apache.org/tomcat-10.1-doc/config/valve.html#Remote_IP_Valve)
- From search-result summaries only (pages not fetched): since Confluence 7.11 the shipped `server.xml` already
  contains a `RemoteIpValve`, which can trigger a "Tomcat config is incorrect" health warning with two reverse
  proxies; a bug report describes websudo failing with "IP address is blank" behind the valve. —
  [KB: Tomcat config is incorrect warning in Confluence 7.11 or later](https://support.atlassian.com/confluence/kb/tomcat-config-is-incorrect-warning-in-confluence-711-or-later-when-there-are-two-reverse-proxies/),
  [CONFSERVER-95945](https://jira.atlassian.com/browse/CONFSERVER-95945)

### Inferences

- CAPTCHA, not lockout: an anonymous attacker who knows a user name can force the CAPTCHA onto that user (the KB
  symptom "CAPTCHA on every login attempt" is what a sustained attack looks like) but cannot keep the user out of
  the web login. Scripted or API logins of that user are refused until someone logs in through the web interface,
  which is a denial of service for integrations.
- The counter is per user and not per IP, so the client IP plays no role in the CAPTCHA decision; the proxy
  configuration matters for access logs, IP allowlists and audit data.
- Trust is a list of proxy addresses (regular expression), not a hop count; private ranges are pre-trusted by Tomcat.

### Gaps

- The current Data Center version in November 2026 and its documentation page could not be read (login redirect);
  the defaults above are confirmed for 7.17 and by search summaries of other version pages, which state the same
  default of three.
- Behaviour of REST calls with basic authentication after the limit is not documented on the pages read.
- Other unlock paths (another administrator in the user management UI, the recovery admin started with a system
  property) were not verified in this session.
- No advisory search was done for Confluence regarding CAPTCHA-forcing or forwarded-header trust.

## Docmost

### Takeaway

Docmost limits the authentication routes to 10 requests per 60 seconds per client IP using `@nestjs/throttler` with
Redis; there is no per-account counter or lockout. Fastify runs with `trustProxy: true` hardcoded, so forwarded
headers are always trusted from any sender.

### Cited Findings

Version read: `main`, version `0.97.0` (release v0.97.0 published 2026-10-25).

- Throttler definition: `{ name: AUTH_THROTTLER, ttl: 60_000, limit: 10 }`, stored in Redis with key prefix
  `throttle:`, error message "Too many requests". —
  [throttle.module.ts](https://github.com/docmost/docmost/blob/main/apps/server/src/integrations/throttle/throttle.module.ts)
- The auth controller applies `@UseGuards(ThrottlerGuard)` with only the `auth` throttler active
  (`@SkipThrottle({ ...ALL_NAMED_THROTTLERS_SKIPPED, [AUTH_THROTTLER]: false })`); it covers `login`, `setup`,
  `forgot-password`, `password-reset` and `verify-token`, and is skipped for `change-password`, `collab-token` and
  `logout`. —
  [auth.controller.ts](https://github.com/docmost/docmost/blob/main/apps/server/src/core/auth/auth.controller.ts)
- The guard is the stock `ThrottlerGuard`, which uses its default tracker and key generator unless overridden. —
  [nestjs/throttler throttler.guard.ts](https://github.com/nestjs/throttler/blob/master/src/throttler.guard.ts)
- Proxy: the Fastify adapter is created with `trustProxy: true`. —
  [main.ts](https://github.com/docmost/docmost/blob/main/apps/server/src/main.ts)
- Fastify: `true` means "Trust all proxies". —
  [Fastify Server.md](https://github.com/fastify/fastify/blob/main/docs/Reference/Server.md)
- `.env.example` has no proxy, throttle or rate-limit variable. —
  [.env.example](https://github.com/docmost/docmost/blob/main/.env.example)

### Inferences

- The limit counts all requests to a route, successful or not, per IP and per route; a correct password is refused
  with "Too many requests" while the IP is over the limit.
- No known account can be locked by an attacker on another address.
- Because every sender is trusted as a proxy, the IP is the left-most `X-Forwarded-For` value; an attacker can evade
  the limit with forged headers unless the reverse proxy overwrites the header. There is no switch to turn this off.
- Unlock: wait up to 60 seconds, or delete the `throttle:` keys in Redis.

### Gaps

- The body of the default tracker (expected to be the request IP) was not read line by line.
- Docmost documentation and issue tracker were not consulted; no advisory search was done.

## TiddlyWiki (Node.js server)

### Takeaway

The TiddlyWiki server has no brute-force protection, no lockout and no client IP handling; it offers HTTP Basic
authentication or a trusted header from a single-sign-on proxy, and leaves everything else to a reverse proxy.

### Cited Findings

Version read: `master`, `5.5.0-prerelease`; the server code now lives under `core-server/`.

- Authentication options: Basic authentication, "activated if credentials are specified via the username/password or
  credentials parameters", recommended only together with HTTPS. —
  [WebServer Basic Authentication](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/editions/tw5.com/tiddlers/webserver/WebServer%20Basic%20Authentication.tid)
- Header authentication through `authenticated-user-header`: the user logs in at an SSO proxy, which passes the user
  name in a request header that TiddlyWiki uses to identify the user. —
  [WebServer Header Authentication](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/editions/tw5.com/tiddlers/webserver/WebServer%20Header%20Authentication.tid)
- The server and both authenticator modules contain no attempt counting, throttling or lockout and do not read
  `X-Forwarded-For` or the socket address (searched for `throttle`, `attempt`, `lockout`, `forwarded`,
  `remoteAddress`: no matches). Authorisation is by `readers` and `writers` user lists. —
  [server.js](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/core-server/server/server.js),
  [authenticators/basic.js](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/core-server/server/authenticators/basic.js),
  [authenticators/header.js](https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/core-server/server/authenticators/header.js)

### Inferences

- Password guessing against Basic authentication is unlimited unless a proxy, fail2ban or an identity provider in
  front limits it; there is nothing to lock and nothing to unlock.
- Header authentication trusts the configured header from any sender, so the server must be reachable only through
  the proxy that sets it.

### Gaps

- Only the three server files and two documentation tiddlers were read; plugins and the multi-wiki server were not
  examined.
