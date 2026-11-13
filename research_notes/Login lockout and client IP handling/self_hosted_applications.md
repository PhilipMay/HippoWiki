# Login lockout and client IP handling in self-hosted open source web applications

State as of 2026-11-13. Method: official docs plus the default branch of each source repository, read on that day.
Version named per system is the one the source or docs showed. "Not verified" marks anything I could not confirm
from a primary source in this session.

Quick comparison (details and sources in the sections below):

| System | Failed-login limit keyed on | Kind | Default | Anonymous lockout of a known account possible? | Client IP behind proxy |
|---|---|---|---|---|---|
| Nextcloud | IP subnet (IPv4 /32, IPv6 /56) + action | Growing delay, then HTTP 429 | on; max delay 25 s; 429 above 10 attempts in 30 min | No (only for clients sharing the attacker's subnet) | `trusted_proxies` list (default empty), header read right to left |
| GitLab | User account (Devise lock) + per-IP path throttle | Hard lock, auto unlock | 10 attempts, 10 min; 10 req/min/IP on sign-in paths | Yes, for the unlock period, repeatable | Trusted-proxy list; private ranges trusted when nothing is set |
| Gitea / Forgejo | Nothing built in | Optional CAPTCHA; fail2ban on the log | none | No | Hop limit `REVERSE_PROXY_LIMIT = 1` plus trusted list (loopback) |
| Vaultwarden | Client IP | Token-bucket throttle, HTTP 429 | burst 10, then 1 per 60 s | No | `IP_HEADER` (X-Real-IP), accepted only from `IP_HEADER_TRUSTED_PROXIES` (default `local`, since 1.37.0) |
| Grafana | User name (default) and optionally IP | Hard block for the window | 5 attempts in 5 min; IP part off | Yes, by user name | `X-Real-IP`, then leftmost `X-Forwarded-For`, trusted blindly |
| Discourse | Client IP (password step); IP and user name (2FA step) | Request rate limit | 6/min and 30/h per IP | Not for the password step | Rails `remote_ip`; bundled nginx overwrites `X-Forwarded-For` |
| WordPress core | Nothing | none | none | No | `REMOTE_ADDR` only |
| Limit Login Attempts Reloaded | IP and user name | Hard lockout | 4 retries, 20 min; 24 h after 4 lockouts | Not verified (see section) | `REMOTE_ADDR`; optional "trusted IP origins" |
| Wordfence | IP | Hard lockout | 20 failures in 4 h, locked 4 h | No | Auto-detect, or one chosen header, optional trusted proxies |
| Home Assistant | Client IP | Permanent IP ban | ban feature on, but threshold -1 (never bans) | No | Off by default; request with `X-Forwarded-For` is refused with HTTP 400 |
| Jellyfin | User account | Account disabled until an admin re-enables | no lockout unless set (0 means 3) | Yes, when a limit is set | `KnownProxies` list; forwarded headers ignored when empty |
| Paperless-ngx | IP (API token endpoint), allauth limits | Throttle | `5/min` on `/api/token/` | Not verified | `PAPERLESS_TRUSTED_PROXIES` list plus allauth hop count |
| Mattermost | User account | Hard lock until password reset | 10 attempts | Yes, until password reset | `TrustedProxyIPHeader` (default empty), leftmost entry, no proxy list |
| Immich | Nothing built in | Log line only | none | No | `IMMICH_TRUSTED_PROXIES` (default link-local and unique-local) |

## Nextcloud (docs for Nextcloud 36 "upcoming" / 35 "latest"; source `master` = 36.0.0 dev)

### Takeaway

Nextcloud throttles by client IP subnet, never by account: each failed attempt doubles a delay (0.2 s up to 25 s) and
above 10 attempts in 30 minutes the subnet gets HTTP 429. An attacker cannot lock `admin` out from another network,
and the whole scheme depends on `trusted_proxies` being right.

### Cited Findings

- What limits failed logins
  - "The primary filter is IP address-based"; protection slows requests from the offending IP for up to 24 hours and
    in extreme cases blocks access for up to 30 minutes —
    [Brute force protection, admin manual](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)
  - Login page values: maximum delay 25 seconds; maximum attempts 10 counted within the last 30 minutes, above that
    HTTP 429 until the count in the window falls below the threshold —
    [Brute force protection, admin manual](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)
  - Constants: `MAX_DELAY = 25`, `MAX_DELAY_MS = 25000`, `MAX_ATTEMPTS = 10` (since 25.0.0) —
    [IThrottler.php](https://github.com/nextcloud/server/blob/master/lib/public/Security/Bruteforce/IThrottler.php)
  - Delay formula: `$firstDelay = 0.1; $delay = $firstDelay * 2 ** $attempts;` capped at `MAX_DELAY`; more than
    `auth.bruteforce.max-attempts` attempts returns the maximum delay directly. So 1 attempt = 0.2 s, 7 attempts =
    12.8 s, 8 or more = 25 s —
    [Throttler.php](https://github.com/nextcloud/server/blob/master/lib/private/Security/Bruteforce/Throttler.php)
  - Attempts are stored with IP, subnet, action and metadata, but counted by subnet + action only (not by user name);
    default look-back in `getAttempts` is 12 hours, capped at 48 hours —
    [Throttler.php](https://github.com/nextcloud/server/blob/master/lib/private/Security/Bruteforce/Throttler.php)
  - `MaxDelayReached` is thrown only when the attempts of the last 12 hours and the attempts of the last 30 minutes
    both exceed `auth.bruteforce.max-attempts`; the middleware turns it into `TooManyRequestsResponse` /
    `STATUS_TOO_MANY_REQUESTS` —
    [Throttler.php](https://github.com/nextcloud/server/blob/master/lib/private/Security/Bruteforce/Throttler.php),
    [BruteForceMiddleware.php](https://github.com/nextcloud/server/blob/master/lib/private/AppFramework/Middleware/Security/BruteForceMiddleware.php)
  - Attempt history entries expire after 48 hours (daily cron job) —
    [Brute force protection, admin manual](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)
- Settings (all in `config/config.php`)
  - `auth.bruteforce.protection.enabled` (default `true`), `auth.bruteforce.protection.force.database` (default
    `false`), `auth.bruteforce.protection.testing` (default `false`; no sleep, still 429),
    `auth.bruteforce.max-attempts` (default `10`), `ratelimit.protection.enabled` (default `true`) —
    [config.sample.php](https://github.com/nextcloud/server/blob/master/config/config.sample.php)
  - The `bruteforcesettings` app only provides the allow list UI; disabling it leaves the protection on because it is
    in core —
    [Brute force protection, admin manual](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)
- Hard lockout or delay; correct password during the limit
  - It is a delay first and a hard 429 later. The login path calls `sleepDelayOrThrowOnMax($remoteAddress, 'login')`
    before it checks the credentials, so a correct password from a throttled subnet is delayed too, and in the 429
    phase it is refused —
    [Session.php, `logClientIn`](https://github.com/nextcloud/server/blob/master/lib/private/User/Session.php)
  - A successful login from the same source IP clears the earlier invalid attempts —
    [Brute force protection, admin manual](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)
- Lockout of a known account
  - The manual states the filter is IP based and that an account is not affected when it logs in from a different IP
    address than the attacker —
    [Brute force protection, admin manual](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)
  - With wrong proxy settings Nextcloud "may throttle all traffic coming from the proxy or load balancer" (paraphrase
    of the manual), which is the collective lockout case —
    [Brute force protection, admin manual](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)
- Unlock path
  - `occ security:bruteforce:reset <ipaddress>` ("resets bruteforce attempts for given IP address") —
    [BruteforceResetAttempts.php](https://github.com/nextcloud/server/blob/master/core/Command/Security/BruteforceResetAttempts.php)
  - `occ security:bruteforce:attempts <ipaddress> [action]` shows the status for an IP —
    [BruteforceAttempts.php](https://github.com/nextcloud/server/blob/master/core/Command/Security/BruteforceAttempts.php)
  - Allow list under Administration settings, Security ("Brute-force IP whitelist"); an excluded address "can perform
    authentication attempts without any throttling" —
    [Brute force protection, admin manual](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)
  - The `bruteforce_attempts` table is empty when a distributed memory cache is used (attempts then live in the
    cache) —
    [Brute force protection, admin manual](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)
- Client IP behind a reverse proxy
  - `trusted_proxies`: list of IPv4/IPv6 addresses and CIDR ranges, default `[]`. Only if `REMOTE_ADDR` matches an
    entry is the client IP read from the headers in `forwarded_for_headers` —
    [config.sample.php](https://github.com/nextcloud/server/blob/master/config/config.sample.php)
  - `forwarded_for_headers` default `['HTTP_X_FORWARDED_FOR']`; code comment: "only have one default, so we cannot
    ship an insecure product out of the box" —
    [Request.php, `getRemoteAddress`](https://github.com/nextcloud/server/blob/master/lib/private/AppFramework/Http/Request.php)
  - Algorithm: trusted-proxy list, not a hop count. The header values are walked from right to left, entries that are
    trusted proxies are skipped, the first valid non-trusted IP is the client; otherwise `REMOTE_ADDR` —
    [Request.php, `getRemoteAddress`](https://github.com/nextcloud/server/blob/master/lib/private/AppFramework/Http/Request.php)
  - Docs warning: a wrong `forwarded_for_headers` value "may allow clients to spoof their IP address" —
    [Reverse proxy configuration](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/reverse_proxy_configuration.html)
- IPv6 by prefix
  - IPv4 is keyed as `/32`; IPv4-mapped IPv6 is converted to the IPv4 `/32`; IPv6 is masked to
    `security.ipv6_normalized_subnet_size`, default `56`, clamped to 32..64 —
    [Normalizer/IpAddress.php](https://github.com/nextcloud/server/blob/master/lib/private/Security/Normalizer/IpAddress.php)
  - Config text: "For Brute Force Protection and Rate Limiting, IPv6 addresses are truncated using subnet size. It
    defaults to /56, but you can set it between /32 and /64" —
    [config.sample.php](https://github.com/nextcloud/server/blob/master/config/config.sample.php)
- CVEs and advisories
  - CVE-2021-22915: brute force possible "due to lack of inclusion of IPv6 subnets in rate-limiting considerations";
    fixed in 19.0.11, 20.0.10, 21.0.2 — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2021-22915)
  - CVE-2023-49792 / GHSA-5j2p-q736-hw98, "Bruteforce protection can be bypassed with misconfigured proxy": with a
    reverse proxy set as trusted proxy the server "could be tricked into reading a wrong remote address"; fixed in
    26.0.9 and 27.1.4, CVSS 5.3, fix in server PR 41526 —
    [GHSA-5j2p-q736-hw98](https://github.com/nextcloud/security-advisories/security/advisories/GHSA-5j2p-q736-hw98)

### Inferences

- The right-to-left walk in `getRemoteAddress` is most likely the result of the CVE-2023-49792 fix (the advisory
  references PR 41526); I did not read the PR.
- An attacker behind the same NAT, VPN exit or IPv6 /56 as a legitimate user can delay and then block that user's
  logins, which is a collective lockout, not an account lockout.

### Gaps

- The manual says "up to 24 hours" for the slow-down, the code default look-back is 12 hours. I did not resolve which
  describes the login path of the released version.
- I found no primary statement of the design reasoning for "by IP and not by account" beyond the manual sentence
  above.
- `BruteforceAllowList.php` moved; I did not read the allow list implementation (config key names not verified).

## GitLab self-managed (docs current in November 2026; source `master` = 19.6.0-pre)

### Takeaway

GitLab is the clearest example of per-account locking: 10 failed attempts lock the account for 10 minutes (both
configurable), with automatic unlock, an email unlock link and admin unlock. On top it throttles sign-in paths per IP
and can ban IPs for failed Git/registry authentication (off by default).

### Cited Findings

- What limits failed logins
  - Account lock (keyed on the user): "All accounts lock after 10 or more failed attempts" and "unlock automatically
    after 10 minutes" on instances without account email verification —
    [Locked user accounts](https://docs.gitlab.com/security/unlock_user/)
  - On GitLab.com or with account email verification: accounts without 2FA or external identity lock after three or
    more failed attempts within 24 hours and unlock after 24 hours or by email verification; accounts with 2FA lock
    after 10 and unlock after 10 minutes — [Locked user accounts](https://docs.gitlab.com/security/unlock_user/)
  - Failed attempts include wrong passwords, passkeys, OTP codes and wrong current passwords in settings or admin
    mode — [Locked user accounts](https://docs.gitlab.com/security/unlock_user/)
  - Settings `max_login_attempts` and `failed_login_attempts_unlock_period_in_minutes` via the application settings
    API — [Locked user accounts](https://docs.gitlab.com/security/unlock_user/)
  - Implementation: Devise `lock_strategy = :failed_attempts`, `unlock_strategy = :both` (email link and time),
    `maximum_attempts = max_login_attempts || 10`, `unlock_in = (failed_login_attempts_unlock_period_in_minutes ||
    10).minutes` — [8_devise.rb](https://github.com/gitlabhq/gitlabhq/blob/master/config/initializers/8_devise.rb)
  - Per-IP throttle on protected paths: "10 requests per minute per IP address", blocked requests get HTTP 429, on by
    default — [Protected paths](https://docs.gitlab.com/administration/settings/protected_paths/)
  - Default protected POST paths include `/users/password`, `/users/sign_in`, `/api/v4/session`, `/users`,
    `/users/confirmation`, `/admin/session` —
    [Instance limits](https://docs.gitlab.com/administration/instance_limits/)
  - Git and container registry: "GitLab returns HTTP status code 403 for 1 hour, if 10 failed authentication requests
    were received in a 1-minute period from a single IP address"; disabled by default; a successful authentication
    resets the count; an active ban is checked before the credentials, so valid credentials get 403 until it expires —
    [Abuse and failed authentication bans](https://docs.gitlab.com/rate_limits/abuse_bans/)
  - Defaults in code: `rack_attack.git_basic_auth` `enabled = false`, `ip_whitelist = ["127.0.0.1"]`, `maxretry = 10`,
    `findtime = 1.minute`, `bantime = 1.hour` —
    [1_settings.rb](https://github.com/gitlabhq/gitlabhq/blob/master/config/initializers/1_settings.rb)
- Hard lockout or delay
  - Hard account lock for the unlock period (Devise lockable), plus HTTP 429 and HTTP 403 for the per-IP limits —
    sources as above.
- Lockout of a known account
  - Forum reports of users receiving lock emails for logins they never attempted —
    [GitLab forum thread](https://forum.gitlab.com/t/gitlab-com-security/39185)
  - Request to make the lockout values configurable (title: "Make account lockout settings configurable by a user
    admin") — [gitlab-org/gitlab issue 27048](https://gitlab.com/gitlab-org/gitlab/-/issues/27048) (seen in search
    results only, issue text not read)
- Unlock path
  - Wait for the automatic unlock or reset the password —
    [Locked user accounts](https://docs.gitlab.com/security/unlock_user/)
  - Admin area: Overview, Users, user administration dropdown, "Unlock" —
    [Locked user accounts](https://docs.gitlab.com/security/unlock_user/)
  - Rails console: `user = User.find_by_username('exampleuser')` then `user.unlock_access!` —
    [Locked user accounts](https://docs.gitlab.com/security/unlock_user/)
  - IP ban: find it with `grep "Rack_Attack" /var/log/gitlab/gitlab-rails/auth.log`, then in `redis-cli`
    `del cache:gitlab:rack::attack:allow2ban:ban:<ip>`, optionally add the IP to the allow list —
    [Abuse and failed authentication bans](https://docs.gitlab.com/rate_limits/abuse_bans/)
- Client IP behind a reverse proxy
  - Linux package: `gitlab_rails['nginx']['real_ip_trusted_addresses']` (each entry becomes `set_real_ip_from`),
    `real_ip_header = 'X-Forwarded-For'`, `real_ip_recursive = 'on'`; "By default, NGINX and GitLab log the IP address
    of the connected client"; the addresses in `real_ip_trusted_addresses` are also used as GitLab trusted proxies —
    [Omnibus NGINX settings](https://docs.gitlab.com/omnibus/settings/nginx/)
  - Application: `gitlab.trusted_proxies` in `gitlab.yml`; if empty, "Default to private IPs if no proxies configured"
    (`ActionDispatch::RemoteIp::TRUSTED_PROXIES`); localhost is always trusted; the same list is patched into
    `Rack::Request` so Rack::Attack uses it —
    [trusted_proxies.rb](https://github.com/gitlabhq/gitlabhq/blob/master/config/initializers/trusted_proxies.rb),
    [gitlab.yml.example](https://github.com/gitlabhq/gitlabhq/blob/master/config/gitlab.yml.example)
  - Docs troubleshooting: if Rack Attack blocks the load balancer because all traffic appears to come from it,
    configure `nginx[real_ip_trusted_addresses]` or allow-list the load balancer —
    [Abuse and failed authentication bans](https://docs.gitlab.com/rate_limits/abuse_bans/)
- IPv6 by prefix
  - Only found for one limit: SSH certificate authentication, "300 failed authentication attempts per minute per IPv4
    address or IPv6 /64 subnet" (behind a feature flag) —
    [Non-configurable limits](https://docs.gitlab.com/rate_limits/non_configurable/)

### Inferences

- An anonymous attacker who knows a user name can keep the account locked by sending 10 wrong passwords every 10
  minutes; the per-IP limit of 10 requests per minute on `/users/sign_in` does not prevent this (10 requests are
  enough) and can be spread over addresses. The docs do not discuss this trade-off.
- Default trust model is "trust forwarded headers from private-range peers" (Rails default), a trusted-proxy list and
  not a hop count.
- While locked, the correct password is refused (standard Devise lockable behaviour); not confirmed in GitLab docs.

### Gaps

- No official GitLab statement on account-lock denial of service found; issue 27048 text not read.
- Whether GitLab applies IPv6 prefixes in Rack::Attack throttles: not found.
- No CVE specific to `X-Forwarded-For` spoofing in GitLab rate limits was searched for in depth.

## Gitea (release v28.3.0, docs version 28) and Forgejo (default branch `forgejo`)

### Takeaway

Neither has a built-in failed-login counter, delay or account lock. The offered tools are an optional CAPTCHA on
login and a log line for fail2ban, which makes correct client IP detection (`REVERSE_PROXY_LIMIT`,
`REVERSE_PROXY_TRUSTED_PROXIES`) the security-relevant part.

### Cited Findings

- What limits failed logins
  - The example config contains no setting for login attempts, lockout or login rate limit; the only login-related
    protection is `REQUIRE_CAPTCHA_FOR_LOGIN = false` ("Enable this to require captcha validation for login") —
    [Gitea app.example.ini](https://github.com/go-gitea/gitea/blob/main/custom/conf/app.example.ini),
    [Forgejo app.example.ini](https://codeberg.org/forgejo/forgejo/src/branch/forgejo/custom/conf/app.example.ini)
  - Failed logins are logged as `Failed authentication attempt for %s from %s: %v` (user name, remote address) —
    [Gitea routers/web/auth/auth.go](https://github.com/go-gitea/gitea/blob/main/routers/web/auth/auth.go),
    [Forgejo routers/web/auth/auth.go](https://codeberg.org/forgejo/forgejo/src/branch/forgejo/routers/web/auth/auth.go)
  - Official fail2ban guide: filter `failregex = .*(Failed authentication attempt|invalid credentials|Attempted access
    of unknown user).* from <HOST>`, jail `maxretry = 10`, `findtime = 3600`, `bantime = 900`; Gitea returns HTTP 200
    for bad logins, so the Gitea log is the source —
    [Fail2ban setup](https://docs.gitea.com/administration/fail2ban-setup)
- Lockout of a known account
  - No account lock exists, so there is nothing to abuse; fail2ban bans are per IP —
    [Fail2ban setup](https://docs.gitea.com/administration/fail2ban-setup)
- Unlock path
  - Not applicable in the application; fail2ban bans are lifted with fail2ban itself. The guide warns to test the
    setup "so you don't lock yourself out" (paraphrase) —
    [Fail2ban setup](https://docs.gitea.com/administration/fail2ban-setup)
- Client IP behind a reverse proxy
  - Gitea: `REVERSE_PROXY_LIMIT = 1` — "Interpret the X-Real-IP, X-Forwarded-For or Forwarded header, in that order,
    and set this as the remote IP for the request"; `REVERSE_PROXY_TRUSTED_PROXIES = 127.0.0.0/8,::1/128` — "List of
    IP addresses and networks separated by comma of trusted proxy servers. Use `*` to trust all." —
    [Gitea app.example.ini](https://github.com/go-gitea/gitea/blob/main/custom/conf/app.example.ini)
  - Forgejo: same two settings and defaults; comment reads "Interpret X-Forwarded-For header or the X-Real-IP header
    and set this as the remote IP for the request" —
    [Forgejo app.example.ini](https://codeberg.org/forgejo/forgejo/src/branch/forgejo/custom/conf/app.example.ini)
  - The forwarded-headers handler is only installed when `ReverseProxyLimit > 0` and the trusted list is not empty —
    [Gitea routers/common/middleware.go](https://github.com/go-gitea/gitea/blob/main/routers/common/middleware.go)
  - fail2ban guide: nginx must send `proxy_set_header X-Real-IP $remote_addr;`, otherwise all clients appear as
    127.0.0.1; for Docker add the bridge network (for example 172.17.0.0/16) to the trusted proxies —
    [Fail2ban setup](https://docs.gitea.com/administration/fail2ban-setup)

### Inferences

- Model: a hop limit combined with a trusted-proxy list. By default only a proxy on loopback is believed, so a proxy
  on another host or in another container is ignored until it is listed, and all users then share the proxy's IP in
  the log (a fail2ban ban would hit everyone).
- With `REVERSE_PROXY_TRUSTED_PROXIES = *` any client can forge its address and evade fail2ban.

### Gaps

- No issue or advisory links collected (the issue search returned nothing usable); whether either project plans a
  built-in limiter is unknown.
- The Forgejo release version was not determined; no Forgejo-specific docs page was read.
- IPv6 prefix handling: not applicable (no limiter).

## Vaultwarden (release 1.37.5 of 2026-11-01)

### Takeaway

Vaultwarden rate-limits login requests per client IP with a token bucket (burst 10, then one per 60 seconds) and has
no account lockout. Since 1.37.0 the client IP header is only believed from trusted proxies
(`IP_HEADER_TRUSTED_PROXIES`, default `local`); before that the header was accepted from anyone.

### Cited Findings

- What limits failed logins
  - `LOGIN_RATELIMIT_SECONDS=60`: "Number of seconds, on average, between login requests from the same IP address
    before rate limiting kicks in"; `LOGIN_RATELIMIT_MAX_BURST=10`, applies "to both the login and the 2FA" —
    [.env.template](https://github.com/dani-garcia/vaultwarden/blob/main/.env.template)
  - `ADMIN_RATELIMIT_SECONDS=300`, `ADMIN_RATELIMIT_MAX_BURST=3` for the admin page login;
    `ADMIN_SESSION_LIFETIME=20` minutes —
    [.env.template](https://github.com/dani-garcia/vaultwarden/blob/main/.env.template)
  - `UNAUTHENTICATED_RATELIMIT_SECONDS=60`, `UNAUTHENTICATED_RATELIMIT_MAX_BURST=50`, one shared budget for password
    hint, account recovery mails and Send access —
    [.env.template](https://github.com/dani-garcia/vaultwarden/blob/main/.env.template)
  - Implementation: `governor` keyed rate limiter with key type `IpAddr` and an in-memory `DashMapStateStore`; on
    excess `err_code!("Too many login requests", 429)` —
    [src/ratelimit.rs](https://github.com/dani-garcia/vaultwarden/blob/main/src/ratelimit.rs)
- Hard lockout or delay
  - Throttle with HTTP 429, counting requests (not only failures), keyed on the exact IP address —
    [src/ratelimit.rs](https://github.com/dani-garcia/vaultwarden/blob/main/src/ratelimit.rs)
- Client IP behind a reverse proxy
  - `IP_HEADER` default `X-Real-IP`; `none` disables headers and uses the remote IP —
    [.env.template](https://github.com/dani-garcia/vaultwarden/blob/main/.env.template)
  - `IP_HEADER_TRUSTED_PROXIES` default `local`: "Anyone able to reach Vaultwarden can set the header, and the client
    IP is used for the login and admin rate limits, so it is only trusted when the request comes from a proxy listed
    here." `local` = any non-global address; `all` = from anywhere; or a list of IPs and CIDR ranges —
    [.env.template](https://github.com/dani-garcia/vaultwarden/blob/main/.env.template)
  - For list headers "the client IP is the rightmost address that isn't one of these proxies"; if every entry is
    trusted the leftmost is used; IPv4-mapped IPv6 peers are canonicalised before the check —
    [src/auth.rs, `ClientIp`](https://github.com/dani-garcia/vaultwarden/blob/main/src/auth.rs)
  - The setting is present in the templates of 1.37.0, 1.37.4 and 1.37.5 and absent in 1.36.0 —
    [1.37.0 .env.template](https://github.com/dani-garcia/vaultwarden/blob/1.37.0/.env.template),
    [1.36.0 .env.template](https://github.com/dani-garcia/vaultwarden/blob/1.36.0/.env.template)

### Inferences

- No account lock exists, so a known account cannot be locked by name; the cost is that a distributed attacker is
  only limited per address.
- The limiter state is in memory, so a restart clears it and it is not shared between instances; there is no admin
  unlock command because nothing is persisted.
- Up to 1.36.0 a directly reachable instance let a client choose its own `X-Real-IP` and so bypass the per-IP limit;
  1.37.0 closed this with the trusted-proxy check. "local" still trusts every private-range peer.
- Keys are full addresses; nothing in `ratelimit.rs` groups IPv6 by prefix, so an attacker with a /64 gets a fresh
  bucket per address.

### Gaps

- I did not find a published advisory or CVE tied to the introduction of `IP_HEADER_TRUSTED_PROXIES`; the 1.37.0
  release notes list advisories but I could not match one to this change.
- Call order in the login handler (limit check before password check) was not read in this session.

## Grafana (release v13.3.1 of 2026-11-10; source `main`)

### Takeaway

Grafana blocks a user name for five minutes after 5 failed attempts in five minutes, so anyone can keep `admin`
locked out. The per-IP variant exists but is off by default, and the client IP comes from `X-Real-IP` or the first
`X-Forwarded-For` entry without any trusted-proxy check.

### Cited Findings

- What limits failed logins
  - `[security] disable_brute_force_login_protection = false`, `brute_force_login_protection_max_attempts = 5`,
    `disable_username_login_protection = false`, `disable_ip_address_login_protection = true` —
    [conf/defaults.ini](https://github.com/grafana/grafana/blob/main/conf/defaults.ini)
  - Docs: "Login is blocked for five minutes if all login attempts are spent within a 5 minute window"; by user name:
    "User will be unable to login for 5 minutes"; by IP: "Anyone from the IP address will be unable to login for 5
    minutes" — [Configure Grafana, security](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/)
  - Implementation: `loginAttemptsWindow = time.Minute * 5`; `Validate` counts rows for the lower-cased user name
    since now minus 5 minutes and blocks when `count >= BruteForceLoginProtectionMaxAttempts`; `ValidateIPAddress`
    does the same per IP; rows older than 10 minutes are deleted by a job every 10 minutes —
    [login_attempt.go](https://github.com/grafana/grafana/blob/main/pkg/services/loginattempt/loginattemptimpl/login_attempt.go)
- Hard lockout or delay; correct password during the limit
  - Hard block. `AuthenticatePassword` calls `loginAttempts.Validate(ctx, username)` and `ValidateIPAddress(...)`
    before any password client runs and returns "too many consecutive incorrect login attempts for user - login for
    user temporarily blocked", so the correct password is refused while blocked. A failed attempt is recorded with
    `loginAttempts.Add(ctx, username, web.RemoteAddr(...))` —
    [authn/clients/password.go](https://github.com/grafana/grafana/blob/main/pkg/services/authn/clients/password.go)
- Lockout of a known account, and discussion
  - Issue "Authentication: Cannot use brute force login protection by IP address for same user login attempts"
    (2025-08) — [grafana issue 109138](https://github.com/grafana/grafana/issues/109138)
  - Fix: "Auth: Add setting to disable username based brute force login protection" —
    [grafana PR 109152](https://github.com/grafana/grafana/pull/109152)
  - Earlier additions: configurable maximum attempts (PR 97091) and IP address validation (PR 98123) — seen as
    commit titles in a mirror: [commit b2626a2](https://forger.sitiv.fr/apitech/grafana/commit/b2626a2d65dd749c0af8719bfdab70df11eb484a),
    [commit 6200361](https://forger.sitiv.fr/apitech/grafana/commit/6200361f366465069b309657a64a02274a8ba157)
- Client IP behind a reverse proxy
  - `RemoteAddr` returns `X-Real-IP` if present, otherwise the first comma-separated entry of `X-Forwarded-For`,
    otherwise the socket address; the header value is only checked for being a parseable IP ("to prevent log
    forgery"); there is no trusted-proxy setting —
    [pkg/web/context.go](https://github.com/grafana/grafana/blob/main/pkg/web/context.go)

### Inferences

- An anonymous attacker can keep any known login (for example `admin`) blocked with about five requests every five
  minutes: blocked attempts return before `Add`, so the count decays and must be refreshed, which is trivial.
- Switching to IP-only protection (`disable_username_login_protection = true`,
  `disable_ip_address_login_protection = false`) removes the account lockout but is only sound when a reverse proxy
  overwrites `X-Real-IP` / `X-Forwarded-For`; on a directly reachable Grafana the client can pick its own IP per
  request and bypass the limit.
- Unlock path: waiting five minutes, or deleting the rows of the `login_attempt` table (derived from the code, not
  documented).

### Gaps

- No documented admin unlock command found; whether `grafana cli admin reset-admin-password` clears attempts was not
  verified, and I did not find the caller of `Service.Reset`.
- No Grafana security advisory about `X-Forwarded-For` spoofing of the login protection found.
- IPv6 prefix handling: none visible in the code read (exact address string is the key).

## Discourse (source `main`, version string 2026.11.0-latest.1)

### Takeaway

Discourse limits login requests per client IP (6 per minute, 30 per hour) and has no per-account password lockout;
only the second-factor step is additionally limited per user name. Client IP is Rails `request.remote_ip` behind the
bundled nginx, which overwrites `X-Forwarded-For`.

### Cited Findings

- What limits failed logins
  - Site settings `max_logins_per_ip_per_hour` (default 30, min 1) and `max_logins_per_ip_per_minute` (default 6,
    min 1) — [config/site_settings.yml](https://github.com/discourse/discourse/blob/main/config/site_settings.yml)
  - `rate_limit_login` runs as `before_action` for `create` and `email_login` and calls
    `RateLimiter.new(nil, "login-hr-#{request.remote_ip}", SiteSetting.max_logins_per_ip_per_hour, 1.hour).performed!`
    and the same for `login-min-` with `1.minute` —
    [session_controller.rb](https://github.com/discourse/discourse/blob/main/app/controllers/session_controller.rb)
  - Second factor: `second-factor-min-#{request.remote_ip}` 6 per minute and
    `second-factor-min-#{user.username}` 6 per minute —
    [application_controller.rb](https://github.com/discourse/discourse/blob/main/app/controllers/application_controller.rb)
  - Forgot password: `forgot-password-hr-#{request.remote_ip}` 6 per hour and `forgot-password-min-` 3 per minute;
    login codes: 6 per hour and 3 per minute per IP plus 3 per hour per email hash —
    [session_controller.rb](https://github.com/discourse/discourse/blob/main/app/controllers/session_controller.rb)
  - IP block list: `ScreenedIpAddress.should_block?(request.remote_ip)` and
    `ScreenedIpAddress.block_admin_login?(user, request.remote_ip)` are checked at login —
    [session_controller.rb](https://github.com/discourse/discourse/blob/main/app/controllers/session_controller.rb)
- Client IP behind a reverse proxy
  - The sample nginx config sets `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite, not append) —
    [config/nginx.sample.conf](https://github.com/discourse/discourse/blob/main/config/nginx.sample.conf)
  - For Cloudflare the container template sets `real_ip_header cf-connecting-ip;` and generates `set_real_ip_from`
    lines from the published Cloudflare ranges —
    [cloudflare.template.yml](https://github.com/discourse/discourse_docker/blob/main/templates/cloudflare.template.yml)
  - Request tracking reads `env["action_dispatch.remote_ip"]` —
    [lib/middleware/request_tracker.rb](https://github.com/discourse/discourse/blob/main/lib/middleware/request_tracker.rb)

### Inferences

- The limit counts every login request of an IP (it runs before the credentials are checked), so the correct password
  is rejected too once the IP is over the limit; it is a throttle, not a lockout, and expires with the window.
- Because the password step is keyed on IP only, an anonymous attacker cannot lock a known account from elsewhere.
  The per-user-name second-factor limit (6 per minute) is the only account-keyed limit; whether it can be reached
  without the password was not checked.
- An additional outer proxy must be declared to nginx (`set_real_ip_from`), otherwise all users share the proxy
  address and the 6 per minute limit becomes a site-wide login limit.

### Gaps

- No Discourse-specific setting for Rails trusted proxies found in `discourse_defaults.conf`; the default Rails
  behaviour (trusting private ranges) was not verified for Discourse.
- No meta.discourse.org discussion of the lockout trade-off was read; no admin "unlock" path identified beyond the
  windows expiring.
- IPv6 prefix handling: not found (key is the full `remote_ip` string).

## WordPress (core trunk 7.2-beta5; Limit Login Attempts Reloaded 3.4.2; Wordfence 9.1.1)

### Takeaway

WordPress core does not limit login attempts at all and only knows `REMOTE_ADDR`; protection comes from plugins or
from the server or CDN in front. The two common plugins differ: Limit Login Attempts Reloaded locks out after 4
retries by IP and user name, Wordfence after 20 failures by IP, and both make the IP source a setting.

### Cited Findings

- Core
  - Core only fires a hook on failure: `do_action( 'wp_login_failed', $username, $error );` —
    [wp-includes/pluggable.php](https://github.com/WordPress/WordPress/blob/master/wp-includes/pluggable.php)
  - Official guidance: rate-limit at the CDN/WAF or web server first; "a security plugin can throttle login
    attempts" as fallback, with the note that plugins "still execute within PHP"; restrict `wp-login.php` by IP;
    temporarily block abusive IPs "(e.g., Fail2ban)"; "Do not use the username `admin`." —
    [Brute force attacks, Advanced Administration Handbook](https://developer.wordpress.org/advanced-administration/security/brute-force/)
- Limit Login Attempts Reloaded
  - Defaults: `allowed_retries => 4`, `lockout_duration => 1200` (20 minutes), `allowed_lockouts => 4`,
    `long_duration => 86400` (24 hours), `valid_duration => 86400` (code comment says 12 hours), `client_type =>
    LLA_DIRECT_ADDR`, `notify_email_after => 3` —
    [core/Config.php](https://plugins.svn.wordpress.org/limit-login-attempts-reloaded/trunk/core/Config.php)
  - Readme: "Limit login attempts by IP address and by username"; "Custom trusted IP origin for Cloudflare and
    reverse proxy setups" — [readme.txt](https://plugins.svn.wordpress.org/limit-login-attempts-reloaded/trunk/readme.txt)
  - IP detection: iterates the configured `trusted_ip_origins` (server variables), always appends `REMOTE_ADDR` as
    fallback, and splits comma lists —
    [core/Helpers.php, `detect_ip_address`](https://plugins.svn.wordpress.org/limit-login-attempts-reloaded/trunk/core/Helpers.php)
  - FAQ "What do I do if all users get blocked?": behind Cloudflare, Sucuri or nginx every visitor can appear with
    one IP; fix is the Trusted IP Origin setting —
    [readme.txt](https://plugins.svn.wordpress.org/limit-login-attempts-reloaded/trunk/readme.txt)
  - FAQ "What do I do when an admin gets blocked?": try another IP (mobile network, VPN); otherwise rename the plugin
    folder by FTP or file manager, log in, rename back and safelist the IP —
    [readme.txt](https://plugins.svn.wordpress.org/limit-login-attempts-reloaded/trunk/readme.txt)
- Wordfence
  - Defaults: `loginSec_maxFailures => 20`, `loginSec_maxForgotPasswd => 20`, `loginSec_countFailMins => 240`,
    `loginSec_lockoutMins => 240`, `loginSec_lockInvalidUsers => false`, `howGetIPs => ''` —
    [lib/wfConfig.php](https://plugins.svn.wordpress.org/wordfence/trunk/lib/wfConfig.php)
  - IP source: with `howGetIPs` empty (default) it checks the server variable recommended by its own proxy detection,
    then `REMOTE_ADDR`, then `HTTP_X_FORWARDED_FOR`, then `HTTP_X_REAL_IP`; with an explicit choice it uses that
    variable and falls back to `REMOTE_ADDR`; `howGetIPs_trusted_proxies` and `howGetIPs_trusted_proxy_preset` exist —
    [lib/wfUtils.php, `getIPAndServerVariable`](https://plugins.svn.wordpress.org/wordfence/trunk/lib/wfUtils.php)
  - A locked-out admin can request an unlock email (`unlockEmail` function) —
    [lib/wordfenceClass.php](https://plugins.svn.wordpress.org/wordfence/trunk/lib/wordfenceClass.php)

### Inferences

- Both plugins are hard lockouts for a time window, not delays.
- Wordfence keys on IP, so a known account cannot be locked from another address; the optional "immediately lock out
  invalid usernames" option (off by default) also acts on the IP.
- Limit Login Attempts Reloaded trusting a forwarded header that the proxy does not overwrite lets a client choose
  its IP; this is why the default is the direct address.

### Gaps

- Whether Limit Login Attempts Reloaded's user-name lockout lets an anonymous attacker lock `admin` from other IPs
  was not verified in code.
- The Wordfence help pages returned no content, so option labels and the wording of the spoofing warnings are not
  quoted; the WP fail2ban plugin was not researched.
- No CVE list for forwarded-header trust in these plugins was collected.

## Home Assistant (source `dev` = 2026.12; docs page current)

### Takeaway

Home Assistant bans client IPs, never accounts, and the ban is permanent until an admin edits `ip_bans.yaml`; by
default no ban ever happens because the threshold defaults to -1. It is the strictest system on proxy headers: a
request carrying `X-Forwarded-For` is rejected with HTTP 400 unless reverse proxy use is configured and the peer is a
trusted proxy.

### Cited Findings

- What limits failed logins
  - Schema: `ip_ban_enabled` default `True`; `login_attempts_threshold` default `NO_LOGIN_ATTEMPT_THRESHOLD`, which
    is `-1` —
    [http/__init__.py](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/__init__.py),
    [http/const.py](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/const.py)
  - Docs: threshold is "Failed login attempts before an IP address is banned, from 1 to 1000"; alternative option
    "Never ban an IP address, no matter how many login attempts fail" —
    [HTTP integration](https://www.home-assistant.io/integrations/http/)
  - Counter is an in-memory `defaultdict` keyed on the IP address object of `request.remote`; counting is skipped
    when the threshold is below 1; reaching the threshold calls `async_add_ban`; the Supervisor IP is never banned;
    a successful login pops the counter of that IP —
    [http/ban.py](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/ban.py)
  - Each failed login also creates a persistent notification ("Login attempt failed") —
    [http/ban.py](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/ban.py)
- Hard lockout or delay
  - Hard ban: the ban middleware raises `HTTPForbidden` for every request of a banned address —
    [http/ban.py](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/ban.py)
- Unlock path
  - Bans are stored in `ip_bans.yaml` in the configuration folder with the UTC time; they do not expire; remove the
    entry or delete the file and restart Home Assistant —
    [HTTP integration](https://www.home-assistant.io/integrations/http/)
- Client IP behind a reverse proxy
  - `use_x_forwarded_for` (default false) and `trusted_proxies` (addresses or CIDR networks) form one inclusive
    group, so they must be set together —
    [http/__init__.py](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/__init__.py)
  - If a request has `X-Forwarded-For` and `use_x_forwarded_for` is not set: log "A request from a reverse proxy was
    received from %s, but your HTTP integration is not set-up for reverse proxies" and `raise HTTPBadRequest`; if the
    connected peer is not in `trusted_proxies`: "Received X-Forwarded-For header from an untrusted proxy" and HTTP
    400; malformed addresses also give 400 —
    [http/forwarded.py](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/forwarded.py)
  - Algorithm: "We go through the list from the right side, and skip all entries that are in our trusted proxies
    list. The first non-trusted IP is used as the client IP"; if all are trusted, the leftmost is used. Requests
    through Home Assistant Cloud remote access skip this middleware —
    [http/forwarded.py](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/forwarded.py)

### Inferences

- No account-keyed limit, so a known account cannot be locked by name. The collective risk is a shared address: if
  the proxy is not configured as trusted and does not send the header, all users arrive with the proxy's IP and one
  attacker can get that IP banned permanently.
- Refusing requests with an unexpected `X-Forwarded-For` turns a silent misconfiguration into a visible failure,
  which is the opposite default to Grafana.
- Trusted-proxy list model, no hop count; exact addresses, no IPv6 prefix grouping in the ban key.

### Gaps

- No Home Assistant advisory about header spoofing or ban bypass was searched for; none is cited.
- The docs page describes UI options and does not state the defaults; the defaults above come from the source.

## Jellyfin (release tag v12.4 of 2026-10-26; source `master`)

### Takeaway

Jellyfin counts failed logins per user and disables the account when the per-user limit is reached; only an
administrator can re-enable it. The limit is a per-user policy that is unset by default in the code read. Forwarded
headers are ignored unless `KnownProxies` is configured.

### Cited Findings

- On a failed login `user.InvalidLoginAttemptCount++`; if `LoginAttemptsBeforeLockout` has a value and the count
  reaches it, `user.SetPermission(PermissionKind.IsDisabled, true)` and the log says "Disabling user {Username} due to
  {Attempts} unsuccessful login attempts."; a successful login sets the count to 0 —
  [UserManager.cs](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Server.Implementations/Users/UserManager.cs)
- Policy mapping: `-1 => null` (no lockout), `0 => 3`, any other value as given; code comment: "The default number of
  login attempts is 3, but for some god forsaken reason it's sent to the server as \"0\"" —
  [UserManager.cs](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Server.Implementations/Users/UserManager.cs)
- `UserPolicy` constructor default: `LoginAttemptsBeforeLockout = -1` —
  [UserPolicy.cs](https://github.com/jellyfin/jellyfin/blob/master/MediaBrowser.Model/Users/UserPolicy.cs)
- Failed logins are logged with the client address: "Authentication request for {UserName} has been denied (IP:
  {IP})." —
  [UserManager.cs](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Server.Implementations/Users/UserManager.cs)
- Client IP: if `config.KnownProxies.Length == 0` then `options.ForwardedHeaders = ForwardedHeaders.None`; otherwise
  `XForwardedFor | XForwardedProto | XForwardedHost` are honoured for the listed proxies or networks and
  `ForwardLimit = null` (ASP.NET Core forwarded headers middleware) —
  [ApiServiceCollectionExtensions.cs](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Server/Extensions/ApiServiceCollectionExtensions.cs)

### Inferences

- Where a limit is set, this is the harshest account lockout of the systems covered: no automatic unlock, so an
  anonymous attacker who knows a user name (including an administrator's) can disable the account until another
  administrator re-enables it.
- Trusted-proxy list model with "ignore the header" as default; no per-IP limiter in the application.

### Gaps

- Jellyfin admin docs were not read; the unlock path via the dashboard and any separate default for administrators
  are not verified.
- No issue discussion of the lockout denial of service was collected.

## Paperless-ngx (release v3.4.2 of 2026-11-03; source `dev`)

### Takeaway

Paperless-ngx relies on django-allauth's rate limits, a throttle on the API token endpoint and a log line meant for
fail2ban. Its notable point is that it configures both a trusted-proxy list and allauth's trusted proxy hop count.

### Cited Findings

- `PAPERLESS_TOKEN_THROTTLE_RATE`: "Rate limit for the API token authentication endpoint (`/api/token/`), used to
  mitigate brute-force login attempts", default `5/min` —
  [docs/configuration.md](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md)
- Failed logins are logged as "Login failed for user `<name>` from IP `<ip>`" (or "from private IP"), the IP being
  resolved with `IpWare(proxy_list=settings.TRUSTED_PROXIES)` —
  [src/paperless/signals.py](https://github.com/paperless-ngx/paperless-ngx/blob/dev/src/paperless/signals.py)
- `PAPERLESS_TRUSTED_PROXIES`: "This may be needed to prevent IP address spoofing if you are using e.g. fail2ban with
  log entries for failed authorization attempts"; default empty; it also sets allauth's trusted proxy count to the
  number of listed proxies —
  [docs/configuration.md](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md)
- `PAPERLESS_ALLAUTH_TRUSTED_PROXY_COUNT`: "the number of trusted proxy hops represented in each `X-Forwarded-For`
  header, not the number of IP addresses through which those proxies may be reached"; "Only trust `X-Forwarded-For`
  when untrusted clients cannot connect directly to Paperless-ngx." —
  [docs/configuration.md](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md)
- `PAPERLESS_ALLAUTH_TRUSTED_CLIENT_IP_HEADER`: for proxies that set a dedicated header such as `X-Real-IP` or
  `CF-Connecting-IP`; takes precedence over the hop count; default none —
  [docs/configuration.md](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md)

### Inferences

- With nothing configured the hop count is 0, so forwarded headers are not trusted for rate limiting.
- The docs explicitly distinguish "list of proxy addresses" from "number of hops", the two models asked about.

### Gaps

- The default allauth limits for failed logins (per IP and per login key) were not verified in this session, so
  whether an account-keyed limit can lock a known user is open.

## Mattermost (release v12.0.2 of 2026-11-04; source `master`)

### Takeaway

Mattermost locks the account after 10 failed password attempts until the password is reset, so a known account can
be locked by anyone. The client IP header is opt-in, but once set its leftmost entry is trusted without a proxy list.

### Cited Findings

- `ServiceSettingsDefaultMaxLoginAttempts = 10`; `LdapSettingsDefaultMaximumLoginAttempts = 10` —
  [server/public/model/config.go](https://github.com/mattermost/mattermost/blob/master/server/public/model/config.go)
- Check: `if user.FailedAttempts >= maxAttempts` returns the "too many" error (HTTP 401) —
  [server/channels/app/authentication.go](https://github.com/mattermost/mattermost/blob/master/server/channels/app/authentication.go)
- Messages: "Your account is locked because of too many failed password attempts. Please reset your password." and
  for LDAP "Please contact your System Administrator." —
  [server/i18n/en.json](https://github.com/mattermost/mattermost/blob/master/server/i18n/en.json)
- The attempt slot is claimed before the password check: `TryIncrementFailedPasswordAttempts(user.Id, maxAttempts)`
  increments atomically only while `FailedAttempts < maxAttempts`; the slot is refunded when the failure is a backend
  error and not a wrong password ("a transient infra issue could lock out a user with valid creds") —
  [server/channels/app/authentication.go](https://github.com/mattermost/mattermost/blob/master/server/channels/app/authentication.go),
  [user_store.go](https://github.com/mattermost/mattermost/blob/master/server/channels/store/sqlstore/user_store.go)
- Updating the password sets `FailedAttempts = 0` —
  [user_store.go](https://github.com/mattermost/mattermost/blob/master/server/channels/store/sqlstore/user_store.go)
- Client IP: `TrustedProxyIPHeader` defaults to an empty list; `GetIPAddress` takes, for each configured header, the
  first comma-separated entry if it parses as an IP, otherwise the socket address —
  [server/public/model/config.go](https://github.com/mattermost/mattermost/blob/master/server/public/model/config.go),
  [server/channels/utils/utils.go](https://github.com/mattermost/mattermost/blob/master/server/channels/utils/utils.go)

### Inferences

- Hard, account-keyed lock with no time-based unlock; the unlock path is a password reset (by email or by an
  administrator).
- The leftmost `X-Forwarded-For` entry is client-controlled unless the proxy overwrites the header, so IP-based rate
  limiting and audit logs can be spoofed when the header is enabled behind an appending proxy.

### Gaps

- `RateLimitSettings` defaults and the Mattermost admin docs were not read; no advisory collected.

## Immich (release v3.4.1 of 2026-11-11; source `main`)

### Takeaway

Immich has no built-in failed-login limit or lockout; it logs failed attempts with the client IP and leaves blocking
to a proxy or fail2ban. Trusted proxies default to link-local and unique-local ranges.

### Cited Findings

- A failed login only logs "Failed login attempt for user ${dto.email} from ip address ${details.clientIp}" —
  [server/src/services/auth.service.ts](https://github.com/immich-app/immich/blob/main/server/src/services/auth.service.ts)
- `IMMICH_TRUSTED_PROXIES`: "List of comma-separated IPs set as trusted proxies" —
  [environment-variables.md](https://github.com/immich-app/immich/blob/main/docs/docs/install/environment-variables.md)
- Default in code: `trustedProxies: dto.IMMICH_TRUSTED_PROXIES ?? ['linklocal', 'uniquelocal']` —
  [server/src/repositories/config.repository.ts](https://github.com/immich-app/immich/blob/main/server/src/repositories/config.repository.ts)
- The client IP is taken from `request.ip` —
  [server/src/middleware/auth.guard.ts](https://github.com/immich-app/immich/blob/main/server/src/middleware/auth.guard.ts)

### Inferences

- `server/package.json` contains no throttling or rate-limit dependency (searched for "throttl", "rate-limit",
  "ratelimit"), which supports "no built-in limiter".
- The default trusts forwarded headers from private-range peers, the same class of default as GitLab and Vaultwarden
  "local".

### Gaps

- Where the trusted proxies are applied (Express "trust proxy") was not located; no issue discussion collected.

## Cross-system observations

### Takeaway

Three families exist: throttle by IP (Nextcloud, Vaultwarden, Discourse, Wordfence, Home Assistant), lock the account
(GitLab, Grafana, Mattermost, Jellyfin, and optionally Limit Login Attempts Reloaded), and nothing built in (Gitea,
Forgejo, WordPress core, Immich). Every IP-keyed design stands or falls with the client IP configuration, and the
recent changes all move towards "ignore forwarded headers unless the peer is a trusted proxy".

### Cited Findings

- Account-keyed locks differ mainly in the unlock: time (GitLab 10 minutes, Grafana 5 minutes), password reset
  (Mattermost), administrator only (Jellyfin) —
  [GitLab](https://docs.gitlab.com/security/unlock_user/),
  [Grafana](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/),
  [Mattermost](https://github.com/mattermost/mattermost/blob/master/server/i18n/en.json),
  [Jellyfin](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Server.Implementations/Users/UserManager.cs)
- Grafana added a switch to turn the user-name lock off after an issue about it —
  [grafana issue 109138](https://github.com/grafana/grafana/issues/109138)
- Defaults for forwarded headers when nothing is configured:
  - ignore the header: Nextcloud (`trusted_proxies` empty), Jellyfin (`KnownProxies` empty), Mattermost (header list
    empty), WordPress core —
    [Nextcloud](https://github.com/nextcloud/server/blob/master/config/config.sample.php),
    [Jellyfin](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Server/Extensions/ApiServiceCollectionExtensions.cs),
    [Mattermost](https://github.com/mattermost/mattermost/blob/master/server/public/model/config.go)
  - refuse the request: Home Assistant (HTTP 400) —
    [forwarded.py](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/forwarded.py)
  - trust loopback or private peers: Gitea and Forgejo (loopback), GitLab (private ranges), Vaultwarden (`local`),
    Immich (link-local, unique-local) —
    [Gitea](https://github.com/go-gitea/gitea/blob/main/custom/conf/app.example.ini),
    [GitLab](https://github.com/gitlabhq/gitlabhq/blob/master/config/initializers/trusted_proxies.rb),
    [Vaultwarden](https://github.com/dani-garcia/vaultwarden/blob/main/.env.template),
    [Immich](https://github.com/immich-app/immich/blob/main/server/src/repositories/config.repository.ts)
  - trust the header from anyone: Grafana —
    [pkg/web/context.go](https://github.com/grafana/grafana/blob/main/pkg/web/context.go)
- Selection rule: "rightmost entry that is not a trusted proxy" in Nextcloud, Vaultwarden and Home Assistant;
  "leftmost entry" in Grafana and Mattermost; hop count in Gitea/Forgejo (`REVERSE_PROXY_LIMIT`) and allauth as used
  by Paperless-ngx — sources in the sections above.
- IPv6 by prefix: Nextcloud /56 by default (configurable /32 to /64) after CVE-2021-22915; GitLab /64 for one SSH
  limit — [Nextcloud](https://github.com/nextcloud/server/blob/master/config/config.sample.php),
  [NVD](https://nvd.nist.gov/vuln/detail/CVE-2021-22915),
  [GitLab](https://docs.gitlab.com/rate_limits/non_configurable/)

### Inferences

- No system combines user name and IP into one key; the nearest are Grafana (two independent switches) and Discourse
  (IP for the password step, IP and user name for the second factor).
- Systems that lock the account pair it with an automatic or self-service unlock in the larger projects (GitLab,
  Grafana, Mattermost); only Jellyfin needs an administrator.
- Mattermost reserves the attempt slot before checking the password and refunds it on non-credential errors, a
  concurrency-safe pattern worth noting for implementations that count before verifying.

### Gaps

- Advisory coverage is incomplete: only the two Nextcloud CVEs were confirmed from primary or NVD pages. No
  confirmed CVE for forwarded-header trust or lockout denial of service was collected for GitLab, Grafana, Gitea,
  Vaultwarden, Discourse, Home Assistant or the WordPress plugins.
- Design rationale in the projects' own words (why by IP or why by account) was found only as short doc sentences,
  not as a design discussion.
