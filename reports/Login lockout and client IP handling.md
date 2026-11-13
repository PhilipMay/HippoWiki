# Pairing user names with addresses blunts lockouts

Keying the login wait on the user name together with the client address, as the open finding suggests, is the
established way to stop a stranger from locking out a known account: MediaWiki, BookStack, Laravel Fortify, Auth0 and
the reference pattern of `rate-limiter-flexible` all do it, and all of them depend on a client address that only a
correctly configured reverse proxy can supply. The fix has a limit, though. NIST SP 800-63B and OWASP both want a bound
on failed attempts per account, so a limit for the user name alone has to stay, and that limit is again a lever for
anyone who can send from several addresses or from one IPv6 /48. The only designs in the sources that keep a per-account
bound and still let the owner in during an attack give clients with an earlier successful login their own budget:
Microsoft Entra ID and AD FS, Okta, the OWASP device-cookie protocol and the academic PGRP protocol. For the client
address the consensus is strict: ignore forwarding headers unless configured, never take the leftmost `X-Forwarded-For`
entry, group IPv6 by prefix, and treat "the application is reachable only through the proxy" as part of the security
design, which Next.js 16 makes unavoidable because application code never sees the connecting peer once the header is
present. Container networking adds a quiet failure: where the runtime rewrites the source address, every client looks
the same and the new key falls back to the user name alone. HippoWiki's current wait has almost the shape of Amazon
Cognito's and the weakness of Grafana's default; what follows is a two-tier wait, an explicit and documented proxy
setting that is off by default, and a way in for the administrator that does not depend on the login form.

How to read this report: sentences with a source link report what that source states. Paragraphs that begin with
"Inference:", the whole section "What follows for HippoWiki" and the conclusion are conclusions drawn in the research
notes or in this report. "Not verified" marks claims that the research could not confirm in a primary source. The state
of all sources is 13 November 2026.

## NIST and OWASP ask for an account-wide bound and for a guard against malicious lockout

Both revisions of NIST SP 800-63B key the limit on the account, not on the client address. Revision 3 (section 5.2.2)
says the verifier "SHALL limit consecutive failed authentication attempts on a single account to no more than 100"
([NIST SP 800-63B Rev. 3](https://pages.nist.gov/800-63-3/sp800-63b.html)). Revision 4, which superseded it on 1 August
2025, moves the rule to section 3.2.2 and sharpens the consequence: the limit of **100 consecutive failed attempts** is
enforced "by disabling that authenticator", which then has to be rebound to the account, and the number is called "an
upper bound" that was chosen to balance the chance of a correct guess "versus the potential need for account recovery
when the limit is exceeded" ([NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)).

NIST knows that this limit can be turned against the user. Both revisions list techniques that "MAY be used to reduce
the likelihood that an attacker will lock the legitimate claimant out": a CAPTCHA (Revision 4: a "bot detection and
mitigation challenge") before the attempt, a wait after a failed attempt "that increases as the account approaches its
maximum allowance for consecutive failed attempts (e.g., 30 seconds up to an hour)", and risk-based techniques that use
signals such as the IP address, geolocation, timing or browser metadata
([NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)). Revision 3 had a fourth technique that Revision 4
no longer lists separately: "Accepting only authentication requests that come from a white list of IP addresses from
which the subscriber has been successfully authenticated before", and it resets, after a success, "any previous failed
attempts for that user from the same IP address"
([NIST SP 800-63B Rev. 3](https://pages.nist.gov/800-63-3/sp800-63b.html)). Revision 4 resets the failures "for the
authenticators used in the successful authentication" and asks verifiers to "inform users how long they have to wait
until the next attempt" ([NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)).

OWASP takes the same starting point and is blunter about the cost. The Authentication Cheat Sheet says the counter
"should be associated with the account itself, rather than the source IP address, in order to prevent an attacker from
making login attempts from a large number of different IP addresses", describes exponential lockout durations as an
alternative to a fixed one, and warns that "care must be taken to prevent it from being used to cause a denial of
service by locking out other users' accounts"
([OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout)).
The older community page lists what goes wrong with plain lockout, including the sentence that describes HippoWiki's
finding and the limit of an unlock command at once: "An attacker can continuously lock out the same account, even
seconds after an administrator unlocks it, effectively disabling the account." It adds that "Powerful accounts such as
administrator accounts often bypass lockout policy, but these are the most desirable accounts to attack"
([OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)).

On the key that the finding proposes, OWASP is explicit in the device-cookie page: locking the pair of account and IP
address "is better in regarding to DoS issues but have security downsides: Attacks from botnets can be effective;
Attacks through proxies can be effective", and "it is not so trivial to implement account/IP lockout. Consider multiple
proxies with chaining addresses in 'X-Forwarded-For' header or IPv6." Its own answer is a signed "device" cookie issued
after every successful login, with one lockout for all clients without a cookie and a separate one for each cookie; for
N = 10 and T = 1 hour this limits any attacker to "240 attempts per day per user ... regardless of how large the botnet
in their possession is". The remaining weakness is the user on a new or cleaned browser during an attack, which OWASP
answers with an email link
([OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)). The page
names no product that implements this exact protocol.

ASVS turned the old number into a documentation duty. ASVS 4.0.3 required that "no more than 100 failed attempts per
hour is possible on a single account"
([ASVS 4.0.3](https://github.com/OWASP/ASVS/blob/v4.0.3/4.0/en/0x11-V2-Authentication.md)). ASVS 5.0.0 requires at level
1 that the documentation defines how rate limiting, anti-automation and adaptive response are used and that it "must
make clear how these controls are configured and prevent malicious account lockout" (6.1.1), that the controls are
implemented as documented (6.3.1), and that "default user accounts (e.g., "root", "admin", or "sa") are not present in
the application or are disabled" (6.3.2)
([ASVS 5.0.0](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x15-V6-Authentication.md)). The UK NCSC agrees on
direction: "Throttling is preferred, because account lockout can leave legitimate users unable to access their accounts"
([NCSC](https://www.ncsc.gov.uk/collection/passwords/updating-your-approach); read through a summarising fetch tool,
quote as returned).

Inference: the standards do not support dropping the limit for the user name. A counter that exists only per pair of
name and address has no account-wide bound, which is what NIST's 100 and OWASP's "associated with the account itself"
are about. The finding's second half, "keep a much higher limit for the user name alone", is therefore the part that
keeps the design inside the standards. The same standards treat that account-wide limit as the place where malicious
lockout happens and name the remedies: a growing wait instead of a hard stop, and a separate treatment of clients that
have logged in successfully before.

Inference: a strict reading of Revision 4 (disable the password after 100 consecutive failures and require recovery)
would make things worse for an application with one administrator and no email, because anyone could then cause a
lockout that only a command on the host can undo. NIST gives no schedule for the growing wait beyond "30 seconds up to
an hour" and no rule for administrator accounts.

## Products choose among five keys, and none lets the right password through an active wait

More than 40 systems were examined: wikis and knowledge bases, other self-hosted applications, identity providers,
authentication libraries and web frameworks. They use five different keys, and a sixth group has no limit at all. The
links lead to the source or documentation each row rests on; numbers are defaults.

| Key of the limit                                    | Examples                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Can a stranger lock out a known account? | Price                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| User name alone, lock or wait                       | [Grafana](https://github.com/grafana/grafana/blob/main/conf/defaults.ini) (5 in 5 minutes, blocked 5 minutes), [GitLab](https://docs.gitlab.com/security/unlock_user/) (10, unlocked after 10 minutes), [Mattermost](https://github.com/mattermost/mattermost/blob/master/server/public/model/config.go) (10, until password reset), [Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html#password-guess-brute-force-attacks) (off by default), [Authelia](https://www.authelia.com/configuration/security/regulation/) default mode (3 in 2 minutes, banned 5 minutes), [Zitadel](https://zitadel.com/docs/guides/manage/console/default-settings) (off by default, administrator unlocks), [Amazon Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flow-things-to-know.html#authentication-flow-lockout-behavior) (growing wait)       | Yes, from any address                    | None for guessing: a true bound per account                          |
| User name alone, CAPTCHA instead of a lock          | [Confluence](https://confluence.atlassian.com/conf717/configuring-captcha-for-failed-logins-1115676852.html) (3 failures), [XWiki](https://github.com/xwiki/xwiki-platform/blob/master/xwiki-platform-core/xwiki-platform-security/xwiki-platform-security-authentication/xwiki-platform-security-authentication-default/src/main/java/org/xwiki/security/authentication/internal/DefaultAuthenticationConfiguration.java) (3 in 300 seconds), [MediaWiki ConfirmEdit](https://www.mediawiki.org/wiki/Extension:ConfirmEdit) (20 in 600 seconds per user, 3 in 300 seconds per IP)                                                                                                                                                                                                                                                                                                            | No, only a forced CAPTCHA                | A CAPTCHA to operate; raises cost per guess, sets no bound           |
| Client address alone                                | [Nextcloud](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html), [Vaultwarden](https://github.com/dani-garcia/vaultwarden/blob/main/.env.template), [Discourse](https://github.com/discourse/discourse/blob/main/app/controllers/session_controller.rb), [Wiki.js](https://github.com/requarks/wiki/blob/scarlett/backend/helpers/rateLimit.ts), [Docmost](https://github.com/docmost/docmost/blob/main/apps/server/src/integrations/throttle/throttle.module.ts), [Home Assistant](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/ban.py), [Wordfence](https://plugins.svn.wordpress.org/wordfence/trunk/lib/wfConfig.php), [better-auth's own limiter](https://www.better-auth.com/docs/concepts/rate-limit), [django-axes](https://django-axes.readthedocs.io/en/latest/4_configuration.html) default | No                                       | No bound per account; everything depends on the client address       |
| User name and client address together               | [MediaWiki](https://github.com/wikimedia/mediawiki/blob/master/includes/MainConfigSchema.php) (5 in 300 seconds and 150 in 48 hours), [BookStack](https://github.com/BookStackApp/BookStack/blob/v26.09.3/app/Access/Controllers/ThrottlesLogins.php) (5 failures, 1 minute), [Laravel Fortify](https://laravel.com/docs/13.x/fortify) (5 per minute), [Auth0](https://auth0.com/docs/secure/attack-protection/brute-force-protection) default (10), [rate-limiter-flexible example](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example#login-endpoint-protection) (10 in a row, blocked 1 hour)                                                                                                                                                                                                                                                                       | Only from the victim's own address       | Every new address gets a fresh budget; depends on the client address |
| User name, with a separate budget for known clients | [Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout), [AD FS](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection), [Okta](https://support.okta.com/help/s/article/detect-lockouts-caused-by-unknown-devices), [OWASP device cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies), [PGRP](https://people.scs.carleton.ca/~paulv/papers/att-revisited-13feb2011.pdf)                                                                                                                                                                                                                                                                                                                                             | Only for clients without a history       | State to keep; the owner on a new device during an attack            |
| Nothing built in                                    | [DokuWiki core](https://github.com/dokuwiki/dokuwiki/blob/master/inc/auth.php), TiddlyWiki, [Gitea and Forgejo](https://docs.gitea.com/administration/fail2ban-setup), [WordPress core](https://developer.wordpress.org/advanced-administration/security/brute-force/), [Immich](https://github.com/immich-app/immich/blob/main/server/src/services/auth.service.ts), [Ory Kratos](https://github.com/ory/kratos/issues/3037), [Auth.js](https://authjs.dev/getting-started/authentication/credentials), [Spring Security](https://docs.spring.io/spring-security/reference/servlet/authentication/events.html), [Django core](https://docs.djangoproject.com/en/stable/topics/security/)                                                                                                                                                                                                     | No                                       | Guessing is left to a proxy, fail2ban or a WAF                       |

### The user name as the only key is the documented way to lock out an administrator

Grafana has HippoWiki's exact weakness as its default. It counts failed logins per lower-cased user name, blocks at 5
within 5 minutes, checks the block before any password client runs, and ships the per-address variant switched off
(`disable_ip_address_login_protection = true`)
([defaults.ini](https://github.com/grafana/grafana/blob/main/conf/defaults.ini),
[password.go](https://github.com/grafana/grafana/blob/main/pkg/services/authn/clients/password.go)). An issue from 2025
([grafana issue 109138](https://github.com/grafana/grafana/issues/109138)) was followed by a setting that turns the
user-name protection off ([grafana PR 109152](https://github.com/grafana/grafana/pull/109152)). Keycloak says about its
own account-keyed detection that "the server becomes vulnerable to denial of service attacks" and recommends intrusion
prevention software that blocks addresses
([Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/index.html#password-guess-brute-force-attacks)).
Authelia added an `ip` mode in 4.39.0 and states "The recommended mode is `ip`" while the default stays `user`
([Authelia Regulation](https://www.authelia.com/configuration/security/regulation/)). The Ory Kratos maintainers
declined lockout because "you can effectively DoS accounts and lock them by trying to repeatedly log in" and closed the
request as not planned in May 2026 ([ory/kratos issue 3037](https://github.com/ory/kratos/issues/3037)). The
`rate-limiter-flexible` wiki calls its user-name-only variant acceptable for an early product and warns: "It can be
scheduled to send 5 password tries every 15 minutes and block user account for infinity"
([wiki](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example#login-endpoint-protection)).
django-ratelimit warns that "limiting based on field values may open a denial of service vector against your users" and
suggests "a soft blocking mechanism, such as requiring a captcha, rather than a hard block"
([django-ratelimit](https://django-ratelimit.readthedocs.io/en/stable/security.html)). The guidance by the author of the
Lucia library says "IP-based throttling should always be implemented" and that throttling by identifier "can introduce
DoS vulnerabilities" ([The Copenhagen Book](https://copenhagen.pilcrowonpaper.com/password-authentication)).

Where products keep the account key, they differ in the way out. GitLab unlocks after 10 minutes, by an email link, in
the admin area or with `user.unlock_access!` in a Rails console
([GitLab](https://docs.gitlab.com/security/unlock_user/),
[8_devise.rb](https://github.com/gitlabhq/gitlabhq/blob/master/config/initializers/8_devise.rb)). Mattermost stays
locked until a password reset ([en.json](https://github.com/mattermost/mattermost/blob/master/server/i18n/en.json)).
Jellyfin disables the account until an administrator re-enables it, when a limit is set
([UserManager.cs](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Server.Implementations/Users/UserManager.cs)).
Amazon Cognito is the closest relative of HippoWiki's current wait: after five failures the lockout starts at one second
and doubles to about 15 minutes, attempts during a lockout do not lengthen it, and the state resets after a success or
after 15 minutes without attempts
([Amazon Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flow-things-to-know.html#authentication-flow-lockout-behavior);
read through a summarising fetch tool, paraphrased).

Inference: a capped, self-expiring wait such as Cognito's or HippoWiki's turns "locked until someone unlocks" into "slow
while the attack runs", and still bounds an attacker to roughly 100 guesses a day. It does not help the owner much,
because owner and attacker compete for the one attempt that each expiry frees, and the attacker's script is faster.

### Keys that include the address protect the owner and hand the problem to the proxy

MediaWiki's core throttle is the wiki example of the proposed key. The cache key holds the IP and a hash of the user
name, the defaults are 5 attempts per 300 seconds and 150 per 48 hours, and only an operator who adds the `allIPs` key
gets a per-account limit. The source comment names the trade-off: "We need to balance the risk of somebody using this as
a DoS attack to lock someone out of their account, and someone doing a brute force attack"
([MainConfigSchema.php](https://github.com/wikimedia/mediawiki/blob/master/includes/MainConfigSchema.php),
[Throttler.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Auth/Throttler.php)). BookStack and Laravel
Fortify build the key the same way, the lower-cased user name, `|` and the request IP, with 5 attempts per minute
([BookStack](https://github.com/BookStackApp/BookStack/blob/v26.09.3/app/Access/Controllers/ThrottlesLogins.php),
[Fortify LoginRateLimiter](https://raw.githubusercontent.com/laravel/fortify/1.x/src/LoginRateLimiter.php)). Auth0
counts failed logins from one IP address to one user identifier, blocks only that pair by default, keeps an account-wide
lockout as an option that is off, and adds a second limiter on the IP address alone across all accounts
([Auth0](https://auth0.com/docs/secure/attack-protection/brute-force-protection),
[Auth0 Suspicious IP Throttling](https://auth0.com/docs/secure/attack-protection/suspicious-ip-throttling); paraphrased,
read through a summarising fetch tool). The `rate-limiter-flexible` example pairs 10 consecutive failures per user name
and IP (blocked for 1 hour, reset on success) with 100 failures per IP per day
([wiki](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example#login-endpoint-protection)).

The address-only systems show what happens when the address is wrong. Nextcloud throttles per subnet with a delay that
doubles from 0.2 to 25 seconds and answers with HTTP 429 above 10 attempts in 30 minutes
([Throttler.php](https://github.com/nextcloud/server/blob/master/lib/private/Security/Bruteforce/Throttler.php)); its
manual says an account is not affected when it logs in from a different address than the attacker, and that wrong proxy
settings may throttle all traffic coming through the proxy
([Nextcloud](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)).
BookStack's documentation gives the same warning for its pair key: behind a proxy "this can result in the proxy's IP
address being used for all users, which can impact areas of the application like the audit log, and rate limit handling"
([BookStack security docs](https://www.bookstackapp.com/docs/admin/security/)).

Inference: no surveyed product combines, by default, a counter per name and address with a second, higher counter for
the name alone. Products with the pair key accept that a distributed attacker gets a fresh budget per address (MediaWiki
default, BookStack, Fortify, Auth0) and add address-only limits, deny lists or MFA. The two-tier form of the finding
exists as MediaWiki's optional `allIPs` condition, as ConfirmEdit's two CAPTCHA triggers, as the stacked decorators that
django-ratelimit recommends, and most precisely as PGRP's two thresholds. It is sound, but it is HippoWiki's own
combination and not a copied default.

### Known clients are how the large providers keep both the bound and the owner's access

Microsoft documents the mechanism in detail for AD FS. After a successful login the client addresses are stored as
"familiar IPs", at most 20 per user; "separate counters are kept for familiar locations and unknown locations"; and in
enforce mode "The only way a malicious account lockout can prevent a user sign-in is if the bad actor has the user
password or can send requests from a known good (familiar) IP address for that user." A user on a new address during an
attack "might require admin intervention", for which the cmdlet `Reset-ADFSAccountLockout ... -Location Unknown` exists
([AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)).
Entra ID works the same way with a lock that starts at one minute and grows, counts the same wrong password only once,
and admits that "Using smart lockout doesn't guarantee that a genuine user is never locked out"
([Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)).
Okta can lock new attempts from unknown devices while sign-ins from known devices continue
([Okta](https://support.okta.com/help/s/article/detect-lockouts-caused-by-unknown-devices); paraphrased). The academic
PGRP protocol keeps one counter per pair of source address and user name and one per user name for all machines, and a
failed attempt from a machine with a valid cookie or a listed address does not raise the per-name total
([PGRP paper](https://people.scs.carleton.ca/~paulv/papers/att-revisited-13feb2011.pdf)). A survey of password research
for administrators lists the recognition of known devices, by cookie or by address, among the recommended defences
against online guessing, next to rate limiting and a password deny list
([Florêncio, Herley and van Oorschot, LISA 2014](https://www.usenix.org/conference/lisa14/conference-program/presentation/florencio)).

### The right password is refused everywhere, and unlock paths avoid the login form

No surveyed system lets a correct password through an active lock or wait on the same key: MediaWiki returns the
throttle error before any password check
([Throttler.php](https://github.com/wikimedia/mediawiki/blob/master/includes/Auth/Throttler.php)), Keycloak checks
`isDisabledByBruteForce` before it validates the password
([AbstractUsernameFormAuthenticator.java](https://raw.githubusercontent.com/keycloak/keycloak/main/services/src/main/java/org/keycloak/authentication/authenticators/browser/AbstractUsernameFormAuthenticator.java)),
ASP.NET Core Identity returns `LockedOut` from its pre-sign-in check
([SignInManager.cs](https://raw.githubusercontent.com/dotnet/aspnetcore/main/src/Identity/Core/src/SignInManager.cs)).
The exceptions are the CAPTCHA systems, where the correct password works together with the solved CAPTCHA. What changes
with the key is who shares the wait: with the address in the key, the owner is on a different key than the attacker.

Unlock paths, where a lock exists, are time, an email link (Devise, GitLab, Auth0), another administrator in the user
interface (Keycloak, Zitadel, Okta, Auth0's advice to keep a secondary tenant administrator), or a command on the
server: `occ security:bruteforce:reset <ipaddress>` in Nextcloud
([source](https://github.com/nextcloud/server/blob/master/core/Command/Security/BruteforceResetAttempts.php)),
`authelia storage bans user revoke` and `ip revoke` in Authelia
([CLI reference](https://www.authelia.com/reference/cli/authelia/authelia_storage_bans_user_revoke/)), the Rails console
in GitLab, and an SQL statement in Confluence's knowledge base
([Atlassian KB](https://support.atlassian.com/confluence/kb/reset-failed-login-count-from-confluence-database/)).
OWASP's testing guide ranks time-based unlock as the lowest assurance and notes that with manual unlock the
administrator needs a recovery method of their own
([WSTG-ATHN-03](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/04-Authentication/03-Weak_Lock_Out_Mechanism);
paraphrased, read through a summarising fetch tool). Microsoft recommends "two or more emergency access accounts" so
that an organisation cannot lock itself out
([Microsoft Entra emergency access](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access)).

Inference: for an application without email, the paths that remain are a wait that ends by itself, a separate budget for
known clients, a second administrator, and a command that needs shell access. The command is safe against the remote
attacker by construction, but by OWASP's re-lock remark it only helps for more than seconds when the attacker cannot
lock the owner's own client again.

## A client address is only as trustworthy as the proxy hop that wrote it

### The rightmost entry that your own proxy added is the only usable one

`X-Forwarded-For` is a de-facto standard in which each proxy appends the address it saw. MDN states that "Any
security-related use of `X-Forwarded-For` (such as for rate limiting or IP-based access control) _must only_ use IP
addresses added by a trusted proxy", that the list has to be searched from the right, either by a configured proxy count
or by skipping the addresses on a trusted proxy list, and that "If the server can be directly connected to from the
internet — even if it is also behind a trusted reverse proxy — **no part** of the `X-Forwarded-For` IP list can be
considered trustworthy"
([MDN X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For)). The widely
cited survey by adam-p gives the same rule, prefers a list of proxy addresses over a count because counts break when the
architecture changes, warns against single-address headers such as `X-Real-IP` unless the proxy is known to always set
them, and says rate limiters should require explicit configuration instead of relying on defaults
([adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/)). RFC 7239's `Forwarded` header has the same trust problem
and little adoption ([RFC 7239](https://www.rfc-editor.org/rfc/rfc7239.txt)).

Frameworks and applications differ in what they do when nothing is configured, and the differences map directly onto
published vulnerabilities.

| Behaviour when nothing is configured                       | Systems                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ignore forwarding headers, use the connecting peer         | [Express](https://expressjs.com/en/guide/behind-proxies.html), [Fastify](https://fastify.dev/docs/latest/Reference/Server/), [ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer), [Caddy](https://caddyserver.com/docs/caddyfile/options), Echo v5, [Nextcloud](https://github.com/nextcloud/server/blob/master/config/config.sample.php), [MediaWiki](https://github.com/wikimedia/mediawiki/blob/master/includes/Request/WebRequest.php), BookStack, Jellyfin, Mattermost, WordPress core |
| Refuse a request that carries `X-Forwarded-For` (HTTP 400) | [Home Assistant](https://github.com/home-assistant/core/blob/dev/homeassistant/components/http/forwarded.py)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Trust peers on loopback or in private ranges               | [Rails](https://api.rubyonrails.org/classes/ActionDispatch/RemoteIp.html) and with it GitLab, [Tomcat `RemoteIpValve`](https://tomcat.apache.org/tomcat-11.0-doc/config/valve.html) and with it Confluence and XWiki, [DokuWiki](https://github.com/dokuwiki/dokuwiki/blob/master/conf/dokuwiki.php), Gitea and Forgejo (loopback only), Vaultwarden (`local`), Immich                                                                                                                                                                    |
| Trust the header from anyone                               | [Grafana](https://github.com/grafana/grafana/blob/main/pkg/web/context.go), [Docmost](https://github.com/docmost/docmost/blob/main/apps/server/src/main.ts) (hardcoded), [Outline](https://github.com/outline/outline/blob/main/server/env.ts) (`PROXY_HEADERS_TRUSTED` defaults to true), [Gin](https://gin-gonic.com/en/docs/server-config/trusted-proxies/)                                                                                                                                                                            |
| Accept a single-value header, otherwise one shared bucket  | [better-auth 1.7](https://www.better-auth.com/docs/concepts/rate-limit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

The selection rule differs too. Nextcloud, Vaultwarden, Home Assistant, MediaWiki, Express with an address list and
better-auth with `trustedProxies` walk from the right and skip trusted proxies. Grafana, Mattermost, Wiki.js, Docmost
and Outline take the leftmost entry, which the Wiki.js source itself describes as one "which a client can put anything
it likes into" ([Wiki.js backend/index.ts](https://github.com/requarks/wiki/blob/scarlett/backend/index.ts)). Gitea and
Forgejo combine a hop limit (`REVERSE_PROXY_LIMIT = 1`) with a trusted list
([app.example.ini](https://github.com/go-gitea/gitea/blob/main/custom/conf/app.example.ini)); Paperless-ngx documents an
address list, a hop count ("the number of trusted proxy hops represented in each `X-Forwarded-For` header") and a
dedicated header side by side
([Paperless-ngx configuration](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md)). Fastify
removed hop-count-only trust because it "cannot validate the immediate peer"
([Fastify](https://fastify.dev/docs/latest/Reference/Server/)); the related advisory CVE-2026-16732 was read from a
search summary only.

The movement over the last years is in one direction. Vaultwarden accepted its IP header from anyone until 1.36.0 and
since 1.37.0 only from `IP_HEADER_TRUSTED_PROXIES`, because "Anyone able to reach Vaultwarden can set the header, and
the client IP is used for the login and admin rate limits"
([.env.template](https://github.com/dani-garcia/vaultwarden/blob/main/.env.template)). DokuWiki replaced its regular
expression with a rule that every hop has to be trusted
([inc/Ip.php](https://github.com/dokuwiki/dokuwiki/blob/master/inc/Ip.php)). Nextcloud fixed a bypass "with
misconfigured proxy"
([GHSA-5j2p-q736-hw98](https://github.com/nextcloud/security-advisories/security/advisories/GHSA-5j2p-q736-hw98)).
Misskey's insecure `trustProxy` default was classified as a vulnerability of its own, with the impact "An attacker can
brute force accounts bypassing rate limiting protection"
([Misskey advisory](https://github.com/misskey-dev/misskey/security/advisories/GHSA-wwrj-3hvj-prpm)); Vikunja's advisory
notes that "Some reverse proxies like Traefik will overwrite this value by default, but others will not"
([GHSA-m547-hp4w-j6jx](https://github.com/advisories/GHSA-m547-hp4w-j6jx)); Echo changed its default to the direct peer
in v5.1.0 ([CVE-2026-118653](https://advisories.gitlab.com/golang/github.com/labstack/echo/v5/CVE-2026-118653/)).

### Traefik writes a clean header by default; Next.js cannot check who sent it

Traefik v3 deletes the forwarding headers of every request whose peer is not in `forwardedHeaders.trustedIPs`, and with
no list configured that is every request:
`if !x.insecure && !x.isTrustedIP(r.RemoteAddr) { DeleteXForwardedHeaders(r.Header) }`. The deleted set includes
`X-Forwarded-For` and `X-Real-Ip`. Traefik then sets `X-Real-Ip` to the peer address if it is absent and appends the
peer address to `X-Forwarded-For`
([forwarded_header.go](https://raw.githubusercontent.com/traefik/traefik/master/pkg/middlewares/forwardedheaders/forwarded_header.go),
[proxy.go](https://raw.githubusercontent.com/traefik/traefik/master/pkg/proxy/httputil/proxy.go)).
`forwardedHeaders.insecure` trusts everything and is recommended "only for tests purposes"
([Traefik entry points](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/)). Caddy likewise
ignores these values from clients that are not trusted proxies
([Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)). nginx sets no forwarding
headers by default, and its common `$proxy_add_x_forwarded_for` appends to whatever the client sent
([nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)); AWS load balancers append by default
as well ([AWS ALB](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html)).

Inference: behind one Traefik with default settings and nothing in front of it, the application receives
`X-Forwarded-For` with exactly one entry, equal to `X-Real-Ip`, and both are the address Traefik saw. This rests on the
two source files on Traefik's master branch; no Traefik documentation page was found that says it in prose. If
`trustedIPs` covers more than a real outer proxy, or `insecure` is on, client-supplied entries pass through to the left
of Traefik's own entry.

Next.js offers nothing of its own. `request.ip` was removed in 15.0.0 because such values "are provided by your hosting
provider" ([Next.js 15 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15)); the replacement from
`@vercel/functions` reads `x-real-ip` as set by Vercel's proxy
([headers.ts](https://raw.githubusercontent.com/vercel/vercel/main/packages/functions/src/headers.ts)). The server fills
the header only when it is missing, `req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress`
([base-server.ts](https://raw.githubusercontent.com/vercel/next.js/canary/packages/next/src/server/base-server.ts)); the
same line is in the installed 16.4.6 build. The self-hosting guide recommends a reverse proxy and says nothing about
client addresses or trusted proxies ([Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)).

Inference: once a proxy sets the header, application code in Next.js never sees the address of the connecting peer.
Express, Fastify and ASP.NET Core first check that the peer is a trusted proxy; a Next.js application cannot. A list of
trusted proxy addresses can only be applied to the entries inside the header, and the guarantee that the header was
written by the proxy has to come from the network: the application's port is not published and no other container shares
its network. If the application can be reached directly, a client sets any `X-Forwarded-For` it likes, and a hop count,
an address list and a named header are all defeated in the same way. This is a reading of compiled code, not a
documented guarantee, and the standalone server was not tested separately.

better-auth 1.7.22 resolves addresses carefully, but only for its own HTTP handler. Its limiter is keyed on address and
path (3 requests per 10 seconds on paths starting with `/sign-in`), and the documentation states: "Server-side requests
made using `auth.api` aren't affected by rate limiting." Without `advanced.ipAddress.trustedProxies` it accepts
`X-Forwarded-For` only when it holds exactly one address; with the list it walks from the right to the first untrusted
hop. Requests without a usable address share one counter per path and a warning is logged. The documentation asks to
list "the exact addresses of your proxies", "not a broad private range that also covers clients"
([better-auth rate limit docs](https://www.better-auth.com/docs/concepts/rate-limit); the code was also read in the
installed package). It has no failed-attempt counter or lock for password sign-in; an account lockout exists only for
the second factor.

### IPv6 has to be grouped by prefix, and containers can erase the address

An IPv6 customer controls at least a /64 and often a /56 or /48, so a key on the full address gives an attacker an
unlimited supply of fresh keys. Nextcloud fixed this as CVE-2021-22915 and now masks IPv6 to a configurable prefix, /56
by default ([NVD](https://nvd.nist.gov/vuln/detail/CVE-2021-22915),
[config.sample.php](https://github.com/nextcloud/server/blob/master/config/config.sample.php)). better-auth fixed the
same flaw as CVE-2026-45364, rated High, by normalising addresses (IPv4-mapped IPv6 to IPv4, one canonical spelling) and
masking IPv6 to /64 by default
([GHSA-p6v2-xcpg-h6xw](https://github.com/better-auth/better-auth/security/advisories/GHSA-p6v2-xcpg-h6xw)).
express-rate-limit defaults to /56 ([configuration](https://express-rate-limit.mintlify.app/reference/configuration));
Traefik's rate limiter offers `ipStrategy.ipv6Subnet` "to prevent bypassing this middleware by obtaining a new IPv6"
([Traefik RateLimit](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/ratelimit/)). In
the code that was read for Vaultwarden, Grafana, Discourse and Home Assistant, the key is the full address without any
grouping.

The proxy can only forward the address it sees. Podman's default rootless network `pasta` preserves the source address,
but rootless bridge networks forward published ports through `rootlessport`. The current manual says `rootlessport`
"attempts to preserve the original client source IP for remote TCP clients"
([podman-run](https://docs.podman.io/en/latest/markdown/podman-run.1.html)); the Podman blog of 4 September 2026 says it
"rewrites the source to the container's own subnet address", which breaks IP-based rate limiting, and presents
`rootless_port_forwarder = "pasta"` as an experimental fix in Podman 6 ([Podman blog](https://blog.podman.io/feed/)). A
community guide recommends a socket-activated proxy container on a shared custom network with its backends, "to get
source address preserved and native speed communication"
([podman-networking-docs](https://github.com/eriksjolund/podman-networking-docs)). Kubernetes NodePort and LoadBalancer
services rewrite the source unless `externalTrafficPolicy: Local` is set
([Kubernetes](https://kubernetes.io/docs/tutorials/services/source-ip/)). The Gitea documentation gives the container
version of the trust problem: without the right header all clients appear as 127.0.0.1, and for Docker the bridge
network has to be added to the trusted proxies
([Gitea fail2ban setup](https://docs.gitea.com/administration/fail2ban-setup)).

Inference: the symptom is that every login arrives with the same private address. A limit keyed on that address is then
one limit for everybody, and a key of user name and address is the user name alone again. The failure is silent and it
restores exactly the finding that the change is meant to close. On a developer machine with a Podman machine the source
address is most likely not preserved at all, so real addresses cannot be checked locally; tests have to supply the
header.

## What the research could not verify

Several claims that the conclusions lean on carry caveats from the research notes.

- Traefik's default removal of client-supplied forwarding headers was read from source code on the master branch, not
  from documentation.
- The Next.js behaviour is read from compiled and upstream code. No official statement on spoofed `x-forwarded-for` in
  self-hosted deployments was found, and the fallback value for a direct connection (probably an IPv4-mapped IPv6
  string) was not verified.
- The two Podman sources contradict each other on `rootlessport`. The behaviour has to be tested on the target host.
- The statements on Auth0, Okta, Amazon Cognito, Google, the NCSC and OWASP's testing guide were read through a
  summarising fetch tool and are paraphrased; exact wording should be checked at the linked pages before quoting.
  Auth0's default numbers for its IP throttling were not found.
- Several product findings come from a development branch and not from a release (MediaWiki `master`, Wiki.js 3
  `scarlett`, which is days old, Grafana `main`). Confluence's defaults are confirmed for version 7.17 only. XWiki's
  CAPTCHA default comes from a release-note summary, while the code default for the strategy is empty.
- That GitLab refuses the correct password while an account is locked is standard Devise behaviour and was not confirmed
  in GitLab's documentation. Whether the user-name lockout of the WordPress plugin Limit Login Attempts Reloaded can be
  triggered from other addresses was not verified in code. The default limits of django-allauth, which Paperless-ngx
  relies on, were not verified.
- The Fastify advisory and several 2026 CVE numbers for forged forwarding headers were seen in search summaries only and
  are not used as evidence here beyond the Fastify documentation itself.
- Advisory searches were incomplete; the absence of a CVE for a product is not evidence that it is safe. The DokuWiki
  documentation could not be read, so what it recommends against brute force is unknown.
- The exact better-auth release in which the leftmost `X-Forwarded-For` entry stopped being used was not pinned down; it
  lies between 1.5.0 and the 1.6 line.
- No authoritative source ranks hop count, address list and named header for an application that cannot see the peer
  address. The ranking below is inference.

## What follows for HippoWiki

Everything in this section is inference from the findings above, applied to the state described in
`spec/users-and-login.md` and to the Major finding in `spec/security-review.md`. The numbers are proposals, not values
taken from a source, unless a source is named.

### The wait needs two tiers, and the second tier needs an exemption to close the finding

- Key the existing wait (5 failures in a row, then 1 minute, doubling to 15 minutes) on the user name together with the
  client address group. This is the key of MediaWiki, BookStack, Laravel Fortify, Auth0 and the `rate-limiter-flexible`
  example. An attacker on another address then no longer shares a wait with the administrator.
- Keep a counter for the user name alone with a much higher threshold, as the finding says. Without it there is no bound
  per account at all: every new address, and with a /64 grouping every one of the 65,536 /64 prefixes inside a single
  /48, brings five fresh guesses. NIST's bound of 100 consecutive failures per account is the reference point for "much
  higher"; a threshold in the low tens leaves room below it.
- Make the second tier a capped wait that ends by itself, not a disabled account. NIST Revision 4's disabling at 100
  presumes a recovery path that HippoWiki, with one administrator and no email, does not have; Cognito and Entra ID show
  the capped form. State this deviation in the specification.
- Be clear about what the two tiers achieve. They raise the price of the lockout from one address and about 100 requests
  a day to several addresses or one routed IPv6 prefix. An attacker who reaches the name-wide threshold has the
  administrator in the same position as today. OWASP says this about the pair key, and it is why Microsoft, Okta, OWASP
  and PGRP go one step further.
- To close the finding and not only narrow it, let a client that has logged in successfully as that user before keep its
  own budget: its failures count against its own pair counter only, and the name-wide wait does not apply to it. Two
  documented forms exist. AD FS keeps up to 20 familiar addresses per user. OWASP's device cookie is a signed cookie
  holding the login name and a nonce, issued after each successful login. The cookie does not depend on the client
  address at all, so it keeps working behind a proxy that is misconfigured or a container runtime that hides the
  address, and it survives a change of address. This goes beyond what the finding suggests.
- Keep refusing the correct password during a wait on the same key, and keep not counting attempts during the wait.
  Every surveyed system refuses; Cognito, Keycloak and Wiki.js 3 also do not extend a running lock, whereas django-axes
  by default restarts the cool-off timer on a failed attempt during the lockout
  ([django-axes configuration](https://django-axes.readthedocs.io/en/latest/4_configuration.html)), which lets an
  attacker hold a lock for as long as the attack runs.
- Keep counting a login before its password is checked. Mattermost reserves the attempt in the same way and refunds it
  on errors that are not a wrong password
  ([authentication.go](https://github.com/mattermost/mattermost/blob/master/server/channels/app/authentication.go)), as
  `reserveAttempt()` and `releaseAttempt()` already do.
- Clear the pair counter on a successful login, and following NIST Revision 4 the name-wide counter too.
- Delete old rows. A key of name and address multiplies the rows that unknown names and forged addresses can create;
  Wiki.js 3 purges rows untouched for a day
  ([rateLimits.ts](https://github.com/requarks/wiki/blob/scarlett/backend/models/rateLimits.ts)), Nextcloud after 48
  hours, Grafana after 10 minutes
  ([login_attempt.go](https://github.com/grafana/grafana/blob/main/pkg/services/loginattempt/loginattemptimpl/login_attempt.go)).
  This also answers the Minor finding on the growing `LoginAttempt` table.
- Tell the user how long the wait lasts, as the current message does and NIST Revision 4 asks.
- Add a limit per client address across all user names at the reverse proxy, for example Traefik's rate limiter with
  `ipv6Subnet`. Per-account counters do nothing against one password tried on many names, which OWASP states and which
  the `rate-limiter-flexible` example (100 failures per address per day), Auth0 and Discourse (6 logins per minute, 30
  per hour per address) answer with an address-only limit. It also protects the four password-hashing slots named in the
  Minor finding.

### The client address needs one explicit setting that is off by default

- With nothing configured, read no forwarding header and treat all clients as one address group. The pair key then
  equals the user name, which is today's behaviour: the lockout weakness remains, but the limit cannot be bypassed with
  a forged header. This is the default of Express, Fastify, ASP.NET Core, Nextcloud, MediaWiki and BookStack, and the
  opposite of the defaults that became CVEs. Log once at start that the login wait works per user name only.
- With the setting on, read `X-Forwarded-For`, join all lines of the header into one list, and count from the right.
  Never take the leftmost entry.
- A number of trusted proxies is the smallest setting that works: 1 for a single Traefik, which yields the rightmost
  entry. It also gives the right address behind a single nginx that appends, and it needs no container addresses, which
  change. A list of proxy addresses in the style of better-auth's `trustedProxies` is the alternative for chains with a
  CDN, and the one adam-p prefers. Since Next.js hides the connecting peer, neither form can verify the sender, so the
  choice is about convenience, not about security.
- Prefer `X-Forwarded-For` over `X-Real-Ip`. Traefik sets both, but a proxy that does not set or overwrite `X-Real-Ip`
  passes the client's own value through. adam-p advises reading such a header only when the proxy is known to always set
  it, and HTTP Toolkit calls `X-Real-IP` "rarely supported, and generally not recommended"
  ([HTTP Toolkit](https://httptoolkit.com/blog/what-is-x-forwarded-for/)).
- Parse and normalise the selected value before it becomes part of a key: accept only a valid address, turn IPv4-mapped
  IPv6 into IPv4, drop ports and zone identifiers, mask IPv6 to /64 with a setting for a wider prefix such as /56, and
  store the canonical text. A raw header string as a key was the second half of better-auth's CVE-2026-45364 and allows
  memory or table exhaustion.
- When the setting is on and the value is missing, malformed or shorter than the configured number of proxies, put the
  request into the shared group and log a warning. This follows better-auth's shared bucket; the opposite, no limit when
  no address is found, is what adam-p criticised as failing open.
- Log the resolved address group with every failed login, as Gitea, Paperless-ngx and Immich do. A log in which every
  failure has the same private address is the visible sign that the source address is lost on the way.

### The deployment has to be written down, because it is part of the control

`spec/container-image.md` is where the finding wants this documented, and ASVS 5.0 requirement 6.1.1 asks for the same:
how the controls are configured and how they prevent malicious account lockout.

- The application's port must not be published, and only the reverse proxy may share a network with the application
  container. Any other container on that network can connect directly and forge the header. Without this isolation no
  part of the header can be trusted, whatever the application setting says.
- Traefik with default settings needs no extra configuration: `forwardedHeaders.insecure` stays off and
  `forwardedHeaders.trustedIPs` stays empty. If another proxy or a CDN sits in front, `trustedIPs` lists exactly that
  proxy and the application's number of proxies goes up by one. For nginx, say which directive produces the header.
- The reverse proxy must see the real source address. Under rootless Podman this depends on how the port is forwarded:
  socket activation or host networking for the proxy are the long-standing options, the default `pasta` network
  preserves the address, and a rootless bridge network with `rootlessport` has to be assumed to lose it until tested on
  the target host.
- Give the operator a two-part check: a login attempt from a known external address is logged with that address, and the
  same attempt sent with a forged `X-Forwarded-For` (and `X-Real-Ip`) is logged with the same address as before.
- Tests cannot rely on real addresses on the development machine; they have to set the header.

### The administrator needs a way in that does not go through the login form

- The unlock command already on the roadmap matches what Authelia, Nextcloud, GitLab and AD FS offer, and it is safe
  against a remote attacker because it needs access to the host. With the name-only key of today it helps for seconds,
  as the roadmap entry says. It becomes a durable remedy once the attacker can no longer re-lock the administrator's own
  client, which is the pair key for attackers on other addresses and the known-client exemption for the rest. It should
  clear the name-wide counter; clearing a single pair is the equivalent of Nextcloud's reset per address.
- A user name for the administrator that is chosen at setup, and the possibility of a second administrator, remove the
  fixed target. ASVS 5.0 requirement 6.3.2 asks that default accounts such as `admin` do not exist; Auth0 and Microsoft
  recommend a second administrator or emergency accounts. A chosen name helps because, as `spec/security-review.md`
  records, the login reveals neither by its answer nor by its timing which names exist, and unknown names wait like
  known ones.
- Do not exempt the administrator from the wait. Windows and Linux do this for their built-in administrator to keep a
  way in, and OWASP points out that these are the accounts attackers most want to guess.
- A second factor, which is on the roadmap as TOTP, is what OWASP and the NCSC call the best defence against guessing.
  It does not change the lockout question, and better-auth's two-factor plugin brings its own account lockout (10 failed
  verifications, 15 minutes) that would need the same scrutiny.

## Conclusion

The finding's wording is right in each of its three parts and incomplete in one. Address in the key, a higher bound for
the name, and a configured proxy header are each backed by standards text or by several shipping products. What the
survey adds is that the three parts are coupled more tightly than the finding suggests: the pair key is exactly as good
as the address, the address is exactly as good as the network isolation around a Next.js server that cannot see its
peer, and where either fails the design drops back, silently, to the behaviour that is being fixed. That makes the
fail-safe default, the logged address and the operator's forged-header check part of the security change and not an
afterthought to it.

The second lesson is that the name-wide tier is where the lockout survives, for an attacker with more than a handful of
addresses. The vendors that operate at scale stopped trying to tell attacker from owner by address alone and instead
remember where the owner has succeeded before. A device cookie does this without any dependency on the proxy, and for a
wiki with one administrator and no email it is the piece that turns "harder to lock out" into "locked out only by
someone who already holds the administrator's browser". Whether that step is taken now or left on the roadmap, the
specification should say which of the two states the wiki is in.
