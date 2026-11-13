# Brute-force login protection without account-lockout denial of service: standards, guidance and identity providers

State: 13 November 2026. How the sources were read:

- "Direct text" means the passage was extracted from the primary page or its source file without a summarising model
  in between (NIST HTML, OWASP and Keycloak source files on GitHub, the two papers' PDFs).
- "Via fetch tool" means the primary page was read through a summarising fetch tool; the wording was returned as a
  quote but could be slightly off. Such quotes are marked.
- Verbatim quotes are used for public-domain or openly licensed texts (NIST, OWASP, Microsoft Learn, Keycloak, NCSC).
  Proprietary vendor documentation (Auth0, Okta, AWS, Google) and the academic papers are paraphrased closely
  instead of quoted.

## What does NIST SP 800-63B say about rate limiting of failed authentication attempts (Revision 3 section 5.2.2 and final Revision 4 section 3.2.2)?

### Takeaway

Both revisions key the limit on the subscriber account (Revision 4: on the authenticator of one account), set a hard
upper bound of 100 consecutive failed attempts, and explicitly list optional techniques whose stated purpose is "to
reduce the likelihood that an attacker will lock the legitimate claimant out". Revision 4 (final, in force since
1 August 2025) moved the section from 5.2.2 to 3.2.2, makes the 100 limit a real disablement that needs rebinding or
account recovery, replaces "CAPTCHA" with "bot detection and mitigation challenge", and drops the IP allow list as a
separate technique.

### Cited Findings

Document versions

- Revision 3 is dated June 2017 and "Includes updates as of 03-02-2020"; its page carries the banner "This revision
  of NIST SP 800-63 has been superseded by NIST SP 800-63-4 as of August 1, 2025." (direct text) —
  [NIST SP 800-63B Rev. 3](https://pages.nist.gov/800-63-3/sp800-63b.html)
- In Revision 4 the throttling section is "Sec. 3.2.2", titled "Rate Limiting (Throttling)"; other sections refer to
  it as "the throttling requirements described in Sec. 3.2.2" (direct text) —
  [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)

Revision 3, section 5.2.2 "Rate Limiting (Throttling)" (complete normative text, direct text)

- "When required by the authenticator type descriptions in Section 5.1, the verifier SHALL implement controls to
  protect against online guessing attacks. Unless otherwise specified in the description of a given authenticator,
  the verifier SHALL limit consecutive failed authentication attempts on a single account to no more than 100." —
  [NIST SP 800-63B Rev. 3, 5.2.2](https://pages.nist.gov/800-63-3/sp800-63b.html)
- "Additional techniques MAY be used to reduce the likelihood that an attacker will lock the legitimate claimant out
  as a result of rate limiting. These include:" —
  [NIST SP 800-63B Rev. 3, 5.2.2](https://pages.nist.gov/800-63-3/sp800-63b.html)
  - "Requiring the claimant to complete a CAPTCHA before attempting authentication."
  - "Requiring the claimant to wait following a failed attempt for a period of time that increases as the account
    approaches its maximum allowance for consecutive failed attempts (e.g., 30 seconds up to an hour)."
  - "Accepting only authentication requests that come from a white list of IP addresses from which the subscriber
    has been successfully authenticated before."
  - "Leveraging other risk-based or adaptive authentication techniques to identify user behavior that falls within,
    or out of, typical norms. These might, for example, include use of IP address, geolocation, timing of request
    patterns, or browser metadata."
- "When the subscriber successfully authenticates, the verifier SHOULD disregard any previous failed attempts for
  that user from the same IP address." —
  [NIST SP 800-63B Rev. 3, 5.2.2](https://pages.nist.gov/800-63-3/sp800-63b.html)
- Revision 3, section 5.1.1.2 (memorized secret verifiers): "Verifiers SHALL implement a rate-limiting mechanism that
  effectively limits the number of failed authentication attempts that can be made on the subscriber's account as
  described in Section 5.2.2." — [NIST SP 800-63B Rev. 3, 5.1.1.2](https://pages.nist.gov/800-63-3/sp800-63b.html)

Revision 4, section 3.2.2 "Rate Limiting (Throttling)" (complete normative text, direct text)

- "When required by the authenticator type descriptions in Sec. 3.1, the verifier SHALL implement controls to protect
  against online guessing attacks. Unless otherwise specified in the description of a given authenticator, the
  verifier SHALL limit consecutive failed authentication attempts using a specific authenticator on a single
  subscriber account to no more than 100 by disabling that authenticator. If more than one authenticator is involved
  with an excessive number of authentication attempts (e.g., single-factor cryptographic authenticator and centrally
  verified password), both authenticators SHALL be disabled. Authenticators that have been disabled SHALL be required
  to rebind to the subscriber account, as described in Sec. 4.1, to be usable in the future." —
  [NIST SP 800-63B-4, 3.2.2](https://pages.nist.gov/800-63-4/sp800-63b.html)
- "The limit of 100 attempts is an upper bound, and agencies MAY impose lower limits. The limit of 100 was chosen to
  balance the likelihood of a correct guess (e.g., 100 attempts against a six-digit decimal OTP authenticator output)
  versus the potential need for account recovery when the limit is exceeded." —
  [NIST SP 800-63B-4, 3.2.2](https://pages.nist.gov/800-63-4/sp800-63b.html)
- "Additional techniques MAY be used to reduce the likelihood that an attacker will lock the legitimate claimant out
  due to rate limiting. These include:" — [NIST SP 800-63B-4, 3.2.2](https://pages.nist.gov/800-63-4/sp800-63b.html)
  - "Requiring the claimant to complete a bot detection and mitigation challenge before attempting authentication"
  - "Requiring the claimant to wait after a failed attempt for a period of time that increases as the subscriber
    account approaches its maximum allowance for consecutive failed attempts (e.g., 30 seconds up to an hour)"
  - "Leveraging other risk-based or adaptive authentication techniques to identify claimant behaviors that fall
    within or outside of typical norms (e.g., the use of the claimant's IP address, geolocation, timing of request
    patterns, or browser metadata)"
- "When the subscriber successfully authenticates, the verifier SHOULD disregard any previous failed attempts for the
  authenticators used in the successful authentication." —
  [NIST SP 800-63B-4, 3.2.2](https://pages.nist.gov/800-63-4/sp800-63b.html)
- "Following successful authentication at a given AAL, the verifier SHOULD reset the retry count of the
  authenticators that were used. If this is provided, the maximum AAL of the authenticator being reset SHALL not
  exceed the AAL of the session from which it is being reset. If the subscriber cannot authenticate at the required
  AAL, the account recovery procedures in Sec. 4.2 SHALL be used." —
  [NIST SP 800-63B-4, 3.2.2](https://pages.nist.gov/800-63-4/sp800-63b.html)
- Revision 4 password verifier requirement: "Verifiers SHALL implement a rate-limiting mechanism that effectively
  limits the number of failed authentication attempts that can be made on the subscriber account, as described in
  Sec. 3.2.2." — [NIST SP 800-63B-4, password verifiers](https://pages.nist.gov/800-63-4/sp800-63b.html)
- Revision 4 on state: "the throttling of authentication attempts described in Sec. 3.2.2 requires the CSP or
  verifier to maintain state information on recent failed authentication attempts" —
  [NIST SP 800-63B-4, authenticator binding](https://pages.nist.gov/800-63-4/sp800-63b.html)

Differences between the revisions (derived from the two direct texts above)

- Section number: 5.2.2 (Rev. 3) became 3.2.2 (Rev. 4) —
  [Rev. 3](https://pages.nist.gov/800-63-3/sp800-63b.html), [Rev. 4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- Scope of the counter: "on a single account" (Rev. 3) became "using a specific authenticator on a single subscriber
  account" (Rev. 4) — [Rev. 4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- Consequence at the limit: Rev. 3 only says "limit ... to no more than 100"; Rev. 4 says "by disabling that
  authenticator" and requires rebinding — [Rev. 4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- "CAPTCHA" (Rev. 3) became "bot detection and mitigation challenge" (Rev. 4) —
  [Rev. 4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- The Rev. 3 bullet on a "white list of IP addresses from which the subscriber has been successfully authenticated
  before" is no longer a separate bullet in Rev. 4; IP address only remains as one example signal of risk-based
  techniques — [Rev. 3](https://pages.nist.gov/800-63-3/sp800-63b.html),
  [Rev. 4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- Reset on success: Rev. 3 resets "previous failed attempts for that user from the same IP address"; Rev. 4 resets
  them "for the authenticators used in the successful authentication" —
  [Rev. 3](https://pages.nist.gov/800-63-3/sp800-63b.html), [Rev. 4](https://pages.nist.gov/800-63-4/sp800-63b.html)

What NIST says about denial of service and usability (direct text)

- Rev. 4 appendix on password strength: "To prevent an attacker (or a persistent claimant with poor typing skills)
  from quickly inflicting a denial-of-service attack on the subscriber by making many incorrect guesses, passwords
  need to be complex enough that a reasonable number of attempts can be permitted with a low probability of a
  successful guess, and rate limiting, as described in Sec. 3.2.2 can be applied before there is a significant chance
  of a successful guess." — [NIST SP 800-63B-4, Appendix A](https://pages.nist.gov/800-63-4/sp800-63b.html)
- Rev. 4 on the blocklist and throttling working together: "Since the blocklist is used to defend against brute-force
  attacks and unsuccessful attempts are rate-limited, the blocklist SHOULD be of sufficient size to prevent
  subscribers from choosing passwords that attackers are likely to guess before reaching the attempt limit." —
  [NIST SP 800-63B-4, passwords](https://pages.nist.gov/800-63-4/sp800-63b.html)
- Rev. 4 usability: "Provide clear, meaningful feedback on the number of remaining allowed attempts. For rate limiting
  (i.e., throttling), inform users how long they have to wait until the next attempt." —
  [NIST SP 800-63B-4, usability](https://pages.nist.gov/800-63-4/sp800-63b.html)
- Rev. 4 appendix: "Throttling is the primary defense against online attacks" —
  [NIST SP 800-63B-4, Appendix A](https://pages.nist.gov/800-63-4/sp800-63b.html)

### Inferences

- NIST's key is the account (user name), not the client address. The address appears only as an optional risk
  signal, and in Rev. 3 as an allow list of addresses with an earlier successful login.
- NIST's own design is a growing delay in front of a hard stop: waits growing from about 30 seconds to an hour as
  the counter approaches 100, then (Rev. 4) disablement with recovery. The hard stop at 100 is itself a lockout an
  attacker can trigger; NIST accepts this and names the delay, the bot challenge and risk-based signals as the ways
  to make it unlikely.
- The counter is for consecutive failures, so every successful login resets it. An attacker who never succeeds will
  reach 100 against a rarely used account unless the growing delay stretches the 100 attempts over a long time
  (with waits of up to an hour the last attempts alone take days).
- Rev. 3's "same IP address" reset rule implies a counter per account and address; Rev. 4 no longer says this, so a
  purely per-account counter is the plain reading of the current text.
- For a password-only application a strict Rev. 4 reading means: after 100 consecutive failures the password is
  disabled and the account needs a recovery path (in practice a password reset or an administrator action).

### Gaps

- NIST gives no concrete schedule for the growing wait beyond "30 seconds up to an hour", no threshold at which the
  wait starts, and no guidance on how to treat administrator accounts differently.
- I did not read the SP 800-63B-4 implementation or conformance material beyond the main document.
- The exact publication day of Rev. 4 was not checked beyond the "superseded ... as of August 1, 2025" banner on the
  Rev. 3 page.

## What does OWASP say (Authentication Cheat Sheet, Blocking Brute Force Attacks, Credential Stuffing Prevention Cheat Sheet, ASVS v4 and v5, device cookies)?

### Takeaway

OWASP consistently says the failed-login counter belongs to the account, not the source address, warns that plain
account lockout is a denial-of-service tool, and points to three ways out: growing (exponential) lockout durations,
letting the forgotten-password path work despite a lockout, and the device-cookie protocol that locks "untrusted
clients" and each known browser separately. ASVS 5.0 turned the concrete v4 number ("100 failed attempts per hour")
into a documentation requirement that must explicitly "prevent malicious account lockout".

### Cited Findings

Authentication Cheat Sheet, section "Protect Against Automated Attacks" / "Login Throttling" (master branch, direct
text of the source file)

- Key of the counter: "The counter of failed logins should be associated with the account itself, rather than the
  source IP address, in order to prevent an attacker from making login attempts from a large number of different IP
  addresses." —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout)
- Factors: "The number of failed attempts before the account is locked out (lockout threshold)", "The time period
  that these attempts must occur within (observation window)", "How long the account is locked out for (lockout
  duration)" —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout)
- Growing delay: "Rather than implementing a fixed lockout duration (e.g., ten minutes), some applications use an
  exponential lockout, where the lockout duration starts as a very short period (e.g., one second), but doubles after
  each failed login attempt." —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout)
- A further list item reads "Amount of time to delay after each account lockout (max 2-3, after that permanent
  account lockout)." —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout)
- Lockout denial of service and the bypass path: "When designing an account lockout system, care must be taken to
  prevent it from being used to cause a denial of service by locking out other users' accounts. One way this could be
  performed is to allow the use of the forgotten password functionality to log in, even if the account is locked
  out." —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout)
- CAPTCHA: "the use of CAPTCHA should be viewed as a defense-in-depth control to make brute-force attacks more
  time-consuming and expensive, rather than as a preventative." and "It may be more user-friendly to only require a
  CAPTCHA be solved after a small number of failed login attempts, rather than requiring it from the very first
  login." —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#captcha)
- MFA: "Multi-factor authentication (MFA) is by far the best defense against the majority of password-related
  attacks, including brute-force attacks" —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#multi-factor-authentication)
- Attack definitions used by OWASP: brute force is "Testing multiple passwords from a dictionary or other source
  against a single account", password spraying is "Testing a single weak password against a large number of different
  accounts" —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#protect-against-automated-attacks)
- Logging: "Ensure that all account lockouts are logged and reviewed" —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#logging-and-monitoring)

"Blocking Brute Force Attacks" community page (direct text of the source file; the old address
`owasp.org/www-community/controls/Blocking_Brute_Force_Attacks` now answers with a permanent redirect to
`community.owasp.org`)

- "However, account lockout is not always the best solution, because someone could easily abuse the security measure
  and lock out hundreds of user accounts." —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)
- Listed problems with account lockouts (selection, verbatim): —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)
  - "An attacker can cause a denial of service (DoS) by locking out large numbers of accounts."
  - "Because you cannot lock out an account that does not exist, only valid account names will lock. An attacker
    could use this fact to harvest usernames from the site, depending on the error responses."
  - "An attacker can continuously lock out the same account, even seconds after an administrator unlocks it,
    effectively disabling the account."
  - "Account lockout is ineffective against slow attacks that try only a few passwords every hour."
  - "Account lockout is ineffective against attacks that try one password against a large list of usernames."
  - "Powerful accounts such as administrator accounts often bypass lockout policy, but these are the most desirable
    accounts to attack. Some systems lock out administrator accounts only on network-based logins."
- Verdict: "Account lockout is sometimes effective, but only in controlled environments or in cases where the risk is
  so great that even continuous DoS attacks are preferable to account compromise." —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)
- Device cookies: "You may also consider locking out authentication attempts from known and unknown browsers or
  devices separately." and "The protocol is less susceptible to DoS attacks than plain account locking out and yet
  effective and easy to implement." —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)
- Delay: "Adding even a few seconds' pause can greatly slow a brute-force attack but will not bother most legitimate
  users" but "it is less effective if the attacker sends multiple simultaneous authentication requests." —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)
- Address blocking: "The problem with this solution is that you could inadvertently block large groups of users by
  blocking a proxy server used by an ISP or large company." and "An attacker with a list of 1,000 proxies can attempt
  2,000 or 3,000 passwords without being blocked." —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)
- Other techniques listed: "For advanced users who want to protect their accounts from attack, give them the option
  to allow login only from certain IP addresses." and "Instead of completely locking out an account, place it in a
  lockdown mode with limited capabilities." —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)
- Attack indicators include "Many failed logins from the same IP address", "Logins with multiple usernames from the
  same IP address" and "Logins for a single account coming from many different IP addresses" —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)

"Slow Down Online Guessing Attacks with Device Cookies" (author Anton Dedov, contributor Daniel Waller; direct text of
the source file; old `owasp.org/www-community/...` address redirects to `community.owasp.org`)

- Problem statement: "Temporary account lockout after several failed attempts is too simple of a target for DoS
  attacks against legitimate users." —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- On keying by account and address: "There is variation of this method that locks out pair of account/IP. It is
  better in regarding to DoS issues but have security downsides: Attacks from botnets can be effective; Attacks
  through proxies can be effective" and "it is not so trivial to implement account/IP lockout. Consider multiple
  proxies with chaining addresses in 'X-Forwarded-For' header or IPv6." —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Idea: "issue a special 'device' cookie to every client (browser) when it is used to successfully authenticate a
  user in a system", used to "Distinguish between known/trusted and unknown/untrusted clients", "Establish universal
  temporary lockouts for all untrusted clients" and "Lockout trusted clients individually" —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Parameters: "T – Time period for lockout duration/attempt counting", "N – Max number of failed authentication
  attempts allowed during T" —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Protocol, entry point: a request with a valid device cookie that is not in the lockout list goes on to
  authentication; a request without a valid cookie is rejected "If authentication from untrusted clients is locked
  out for this user" —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Protocol, failed attempt: with a cookie, "if number of failed attempts within T > N -> put device cookie in lockout
  list until now() + T"; without a cookie, "lockout ALL authentication attempts from untrusted clients for this
  specific user until now() + T" —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Cookie format: "LOGIN,NONCE,SIGNATURE" with "SIGNATURE – HMAC(secret-key, "LOGIN,NONCE")"; a new cookie is issued
  after every successful authentication; validation checks that "LOGIN represents the user who is actually trying to
  authenticate"; cookies should use the "Secure and HttpOnly flags"; JWT with `sub`, `jti` and a distinct `aud` is
  suggested —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Guess bound: "for N = 10 and T = 1h, any attacker will be limited with 240 attempts per day per user or 87600
  attempts per user/year regardless of how large the botnet in their possession is." —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Note: "clients with device cookies are potentially allowed to make N * 2 failed authentication attempts before
  actual lockout." —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Remaining denial of service: "Attackers may cause permanent lockout for all untrusted devices for a specific user.
  Thus the user may be blocked from loggging into the system as they would need to login from a new device or to
  login after cleaning up their browser cache." Mitigation: "Issue a valid device cookie after visiting password
  reset link (an actual password reset is not necessary)." —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Password spraying: "There is no specific mitigation for this threat in the protocol." A CAPTCHA for untrusted
  clients when "there are too many authentication attempts for different accounts" is suggested —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Stolen cookies: "each device cookie adds extra N attempts per T for specific user"; proposal to "permanently lockout
  a device cookie after N*10 failed attempts" —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Who uses it: the page names no adopters of this exact protocol. It cites a talk by Marc Heuse at PasswordsCon 14 as
  the origin of the "device cookie" notion and says that Alec Muffett at the same conference "mentions 'datr cookie'
  from Facebook" —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- The page was extended with a "Storage of Lockout List" section (in-memory map, database with expiry, Redis) whose
  example row carries the date 2025-08-27, so it is still maintained —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)

Credential Stuffing Prevention Cheat Sheet (master branch, direct text of the source file)

- "Blocking IP addresses may be sufficient to stop less sophisticated attacks, but should not be used as the sole or
  primary defense due to the ease in circumvention. It is more effective to have a graduated response to abuse that
  leverages multiple defensive measures depending on different factors of the attack." —
  [OWASP Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html#ip-mitigation-and-intelligence)
- "Mitigations, especially blocking an IP address, should be temporary and processes should be in place to remove an
  IP address from a mitigated state as abuse declines or stops." —
  [OWASP Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html#ip-mitigation-and-intelligence)
- Proxy networks: "This may defeat both IP block-lists and rate limiting, as per IP request volume may remain
  relatively low, even on high volume attacks." —
  [OWASP Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html#ip-mitigation-and-intelligence)
- Device fingerprints: "Many users will have multiple devices or browsers that they use, so it is not practical to
  simply block attempts that do not match the existing fingerprints" —
  [OWASP Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html#device-fingerprinting)
- Proof of work ("Degradation"): measures "that increase the amount of time the attack takes to complete. This may
  include incrementally increasing the complexity of the JavaScript that must be evaluated, requiring users to solve
  a cryptographic or Proof-of-Work computational puzzle, introducing long wait periods before responding to requests,
  returning overly large HTML assets or returning randomized error messages." They "provide some level of security
  without resorting to user tracking or profiling." —
  [OWASP Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html#degradation)
- Client-side defences "may be spoofed or bypassed and other layers of defense should be implemented to account for
  this." —
  [OWASP Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html#defense-in-depth-metrics)

ASVS (direct text of the tagged source files)

- ASVS 4.0.3 (released 28 October 2021), requirement 2.2.1, levels 1 to 3, CWE 307, mapped to NIST 5.2.2: "Verify
  that anti-automation controls are effective at mitigating breached credential testing, brute force, and account
  lockout attacks. Such controls include blocking the most common breached passwords, soft lockouts, rate limiting,
  CAPTCHA, ever increasing delays between attempts, IP address restrictions, or risk-based restrictions such as
  location, first login on a device, recent attempts to unlock the account, or similar. Verify that no more than 100
  failed attempts per hour is possible on a single account." —
  [ASVS 4.0.3, V2.2](https://github.com/OWASP/ASVS/blob/v4.0.3/4.0/en/0x11-V2-Authentication.md)
- ASVS 5.0.0 (released 30 May 2025; still the latest stable release, the GitHub "latest" tag is an automatically
  rebuilt "Bleeding Edge" build of the master branch, last generated 26 October 2026) —
  [ASVS releases](https://github.com/OWASP/ASVS/releases)
- ASVS 5.0.0 requirement 6.1.1, level 1: "Verify that application documentation defines how controls such as rate
  limiting, anti-automation, and adaptive response, are used to defend against attacks such as credential stuffing and
  password brute force. The documentation must make clear how these controls are configured and prevent malicious
  account lockout." —
  [ASVS 5.0.0, V6.1](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x15-V6-Authentication.md)
- ASVS 5.0.0 requirement 6.3.1, level 1: "Verify that controls to prevent attacks such as credential stuffing and
  password brute force are implemented according to the application's security documentation." —
  [ASVS 5.0.0, V6.3](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x15-V6-Authentication.md)
- ASVS 5.0.0 requirement 6.3.2, level 1: "Verify that default user accounts (e.g., "root", "admin", or "sa") are not
  present in the application or are disabled." —
  [ASVS 5.0.0, V6.3](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x15-V6-Authentication.md)
- ASVS 5.0.0 requirement 6.3.5, level 3: "Verify that users are notified of suspicious authentication attempts
  (successful or unsuccessful). This may include authentication attempts from an unusual location or client,
  partially successful authentication (only one of multiple factors), an authentication attempt after a long period
  of inactivity or a successful authentication after several unsuccessful attempts." —
  [ASVS 5.0.0, V6.3](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x15-V6-Authentication.md)
- ASVS 5.0.0 requirement 2.4.1, level 2 (general anti-automation): "Verify that anti-automation controls are in place
  to protect against excessive calls to application functions that could lead to data exfiltration, garbage-data
  creation, quota exhaustion, rate-limit breaches, denial-of-service, or overuse of costly resources." —
  [ASVS 5.0.0, V2.4](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x11-V2-Validation-and-Business-Logic.md)
- The V6.3 introduction of ASVS 5.0.0 still links to NIST SP 800-63B Rev. 3 section 5.2.2, not to Rev. 4 section
  3.2.2; the master branch wording of 6.1.1 and 6.3.1 is unchanged from 5.0.0 —
  [ASVS master, V6](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md)

Web Security Testing Guide, test WSTG-ATHN-03 "Testing for Weak Lock Out Mechanism" (latest; via fetch tool,
paraphrased, not verbatim)

- Unlock mechanisms are ranked from lowest to highest assurance: time-based unlock, self-service unlock by an email
  to the registered address, manual administrator unlock, manual administrator unlock with positive identification
  of the user —
  [OWASP WSTG-ATHN-03](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/04-Authentication/03-Weak_Lock_Out_Mechanism)
- A threshold of 5 to 10 failed attempts is called typical and a timed unlock of 5 to 30 minutes a reasonable
  compromise; manual administrator unlock is called the most secure but means the administrator needs a recovery
  method of their own and an attacker could lock out all users; a CAPTCHA may hinder brute force but should not
  replace a lockout mechanism —
  [OWASP WSTG-ATHN-03](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/04-Authentication/03-Weak_Lock_Out_Mechanism)

### Inferences

- OWASP's position on the key is two-sided: the cheat sheet wants the counter on the account so that address
  rotation does not help the attacker; the brute-force page and the device-cookie page show that an account-only hard
  lockout is exactly what enables the lockout denial of service. The reconciling designs are (a) account-keyed but
  soft: exponential or growing delay instead of a hard lock, and (b) account-keyed with a per-device exemption:
  device cookies.
- The device-cookie protocol is the only OWASP design that keeps a hard global bound on guesses per account (N per T
  for all unknown clients together) while a user on a browser that has logged in before is unaffected by an attack.
  Its weak spot is the user on a new or cleaned browser during an attack; OWASP's answer is an email round trip.
- ASVS 5.0 no longer gives a number. A project that wants to claim ASVS 5.0 level 1 has to write down its throttling
  design and state how it prevents malicious account lockout (6.1.1) and then implement it as written (6.3.1).
- ASVS 5.0 requirement 6.3.2 means a well-known default `admin` account should not exist at all; an administrator
  account with a user name chosen at setup is harder to target for both guessing and lockout.

### Gaps

- The device-cookie page names no production adopters beyond the reference to Facebook's `datr` cookie; I found no
  primary source listing products that implement this exact protocol.
- WSTG-ATHN-03 could only be read through the summarising fetch tool, so the points above are paraphrases.
- The OWASP community pages give no revision dates in their source headers; "current" here means the master branch on
  13 November 2026.

## How do large identity providers solve the lockout denial-of-service problem (Microsoft Entra ID, Auth0, Okta, Google, AWS Cognito)?

### Takeaway

No large provider uses a plain per-account hard lock. They either split the counter by where the attempt comes from
(Entra and AD FS: familiar versus unfamiliar location; Okta: known versus unknown device; Auth0: user plus IP
address by default), or use short, growing temporary locks with automatic expiry (Cognito, Entra), or replace the
lock by a challenge (Google), and all offer a self-service or administrator unlock path. Microsoft states openly
that even smart lockout "doesn't guarantee that a genuine user is never locked out".

### Cited Findings

Microsoft Entra ID smart lockout (page dated 3 June 2026; via fetch tool, page text returned in full)

- "Smart lockout can recognize sign-ins that come from valid users and treat them differently than sign-ins from
  attackers and other unknown sources. Attackers get locked out while your users continue to access their accounts
  and be productive." —
  [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)
- Defaults: lock after "10 failed attempts in Azure Public and Microsoft Azure operated by 21Vianet tenants" and
  "Three failed attempts for Azure US Government tenants"; default lockout duration 60 seconds —
  [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)
- Growing temporary lock: "The account locks again after each subsequent failed sign-in attempt. The lockout period
  is one minute at first, and longer in subsequent attempts. To minimize the ways an attacker could work around this
  behavior, we don't disclose the rate at which the lockout period increases after unsuccessful sign-in attempts." —
  [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)
- Same wrong password does not count twice: "Smart lockout tracks the last three bad password hashes to avoid
  incrementing the lockout counter for the same password." —
  [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)
- Separate counters: "Smart Lockout uses familiar location versus unfamiliar location to differentiate between a bad
  actor and the genuine user. Both unfamiliar and familiar locations have separate lockout counters." —
  [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)
- No guarantee: "Using smart lockout doesn't guarantee that a genuine user is never locked out. When smart lockout
  locks a user account, we try our best to not lock out the genuine user." —
  [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)
- Unlock paths: self-service password reset ("If the user chooses I forgot my password during SSPR, the duration of
  the lockout is reset to 0 seconds"), and "An administrator can unlock a user's cloud account if Smart Lockout has
  locked them out without waiting for the lockout duration to expire." —
  [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)
- Always on: "Smart lockout is always on for all Microsoft Entra customers"; changing threshold and duration needs
  Entra ID P1 or higher —
  [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)
- Additional layer keyed on traffic: "Microsoft Entra ID also protects against attacks by analyzing signals including
  IP traffic and identifying anomalous behavior. Microsoft Entra ID blocks these malicious sign-ins by default and
  returns AADSTS50053 - IdsLocked error code, regardless of the password validity." —
  [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)

Microsoft AD FS Extranet Smart Lockout, the on-premises version with the mechanism documented in detail (page dated
16 June 2023, last touched 10 November 2026; via fetch tool, page text returned in full)

- Purpose: "AD FS can lock out attackers while letting valid users continue to use their accounts. This distinction
  prevents and protects against denial-of-service and certain classes of password spray attacks on the user." —
  [AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)
- How an address becomes familiar: "If the request is successful, all the IPs are added to the Account Activity table
  as 'familiar IPs.'"; a request is unknown if "at least one IP" is not in the list; the list holds a "maximum of 20
  IPs that are familiar to the user. When 20 IPs is exceeded, the oldest IP in the list is removed." —
  [AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)
- Counters: "For each user, separate counters are kept for familiar locations and unknown locations."; AD FS 2019
  adds "Independent lockout thresholds for familiar and unfamiliar locations. Users in known good locations can have
  more room for error than requests from suspicious locations." —
  [AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)
- Lock behaviour: after the threshold, requests from unknown locations are rejected "until the observation window has
  passed"; afterwards "the account is allowed a single password attempt against AD for each observation window";
  recommended values are an observation window of 30 minutes and a threshold of half the Active Directory threshold
  (example 10 against 20) —
  [AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)
- Claimed guarantee: "If AD FS Smart Lockout is set to Enforce mode, then you never see the legitimate user's account
  locked out by brute force or denial of service. The only way a malicious account lockout can prevent a user sign-in
  is if the bad actor has the user password or can send requests from a known good (familiar) IP address for that
  user." —
  [AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)
- Limit for a user on a new address: above the unknown-location threshold "They must then wait past the observation
  window and sign in with a valid password. They might require admin intervention to reset their account." —
  [AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)
- Learning phase: a "Log-Only" mode of 3 to 7 days is recommended before enforcing, otherwise the feature behaves like
  a plain bad-password counter, "potentially blocking legitimate user traffic if the user account is under an active
  brute force attack." —
  [AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)
- Proxy headers: the check uses "a combination of network IP, forwarded IP, and the optional x-forwarded-for IP";
  the feature only works for requests arriving through the Web Application Proxy or a proxy speaking the same
  protocol; "IPv4 and IPv6 addresses are supported." —
  [AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)
- Command-line unlock: `Reset-ADFSAccountLockout user@contoso.com -Location Familiar` or `-Location Unknown`;
  `Set-ADFSAccountActivity ... -AdditionalFamiliarIps` adds a familiar address by hand; the commands can be delegated
  to help-desk staff —
  [AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)

Auth0 attack protection (via fetch tool; paraphrased)

- Brute-force protection counts failed logins from one IP address to one user identifier; the default threshold is
  10 and a custom value from 1 to 100 can be set —
  [Auth0 Brute-Force Protection](https://auth0.com/docs/secure/attack-protection/brute-force-protection)
- The default response ("Block Brute-force Logins", on by default) blocks further attempts on that user identifier
  only from the IP address that triggered the protection; a separate "Account Lockout" option, off by default, blocks
  all login attempts to the identifier —
  [Auth0 Brute-Force Protection](https://auth0.com/docs/secure/attack-protection/brute-force-protection)
- Blocked requests get an HTTP 429 `too_many_attempts` error; the user can be notified by email or SMS —
  [Auth0 Brute-Force Protection](https://auth0.com/docs/secure/attack-protection/brute-force-protection)
- A block ends when 30 days have passed since the last failed login, when an administrator removes it through the
  Management API (`DELETE /user-blocks` by identifier or `DELETE /user-blocks/{id}`), when an administrator raises
  the threshold, when the user follows the unblock link in the notification email, or when the user changes the
  password —
  [Auth0 Brute-Force Protection](https://auth0.com/docs/secure/attack-protection/brute-force-protection)
- The unblock link has an automatic mode (opening the link unblocks) and a manual mode (the user must press a button)
  because email security scanners that open links would otherwise unblock accounts —
  [Auth0 Brute-Force Protection](https://auth0.com/docs/secure/attack-protection/brute-force-protection)
- Addresses on the IP allow list are exempt from brute-force protection —
  [Auth0 Brute-Force Protection](https://auth0.com/docs/secure/attack-protection/brute-force-protection)
- The protection applies to all users including tenant administrators, and Auth0 recommends a secondary tenant
  administrator so that a blocked administrator can be unblocked by another one —
  [Auth0 Brute-Force Protection](https://auth0.com/docs/secure/attack-protection/brute-force-protection)
- Suspicious IP throttling is keyed on the IP address alone, across all accounts: it has a daily maximum of failed
  login attempts per address and then grants further attempts at a throttling rate spread over 24 hours, answering
  with HTTP 429; it is on by default; up to 100 addresses or CIDR ranges (IPv4 or IPv6) can be exempted; tenant
  administrators are notified by email —
  [Auth0 Suspicious IP Throttling](https://auth0.com/docs/secure/attack-protection/suspicious-ip-throttling)
- Auth0's overview orders the features by signal: bot detection uses IP reputation and answers with a CAPTCHA;
  suspicious IP throttling uses the velocity of attempts from one address for any number of accounts; brute-force
  protection uses the velocity of attempts from one address for one account —
  [Auth0 Attack Protection](https://auth0.com/docs/secure/attack-protection)

Okta (via fetch tool and search result summaries; paraphrased)

- The password policy has a classic per-user lock: lock out the user after a configurable number of unsuccessful
  attempts, automatic unlock after a configurable number of minutes, optional lockout email to the user, and an
  optional self-service "Unlock account" link on the sign-in widget —
  [Okta: Configure the password authenticator](https://help.okta.com/oie/en-us/content/topics/identity-engine/authenticators/configure-password.htm)
- The setting "Block suspicious password attempts from unknown devices" (under Security > General, "Protect against
  password-based attacks") changes the lock: a known device is one that has signed in to Okta before; when an unknown
  device exceeds the allowed failed attempts, Okta locks out new attempts from unknown devices but still allows
  sign-ins from known devices (article last updated 19 May 2026) —
  [Okta: Detect lockouts caused by unknown devices](https://support.okta.com/help/s/article/detect-lockouts-caused-by-unknown-devices)
- In that state the Admin Console shows that sign-in attempts for all unknown devices have been blocked for the user;
  an administrator can lift it with "Allow Unknown Devices" under Directory > People, and the user can use
  self-service unlock if the password policy allows it (article last updated 20 May 2026) —
  [Okta: Allow unknown devices](https://support.okta.com/help/s/article/allow-unknown-devices)
- Okta ThreatInsight evaluates sign-in requests before authentication and denies requests from addresses it rates as
  suspicious; blocked requests are not counted as failed sign-in attempts, which reduces lockouts; it needs trusted
  proxies configured to see the real client address and does not claim complete detection —
  [Okta ThreatInsight](https://help.okta.com/en-us/content/topics/security/threat-insight/about-threatinsight.htm)

AWS Cognito user pools (via fetch tool; paraphrased)

- After five failed password sign-in attempts Cognito locks the user out for one second; the lockout doubles with
  each further failed attempt up to about 15 minutes; for n cumulative failed attempts the lockout is 2^(n-5)
  seconds —
  [Amazon Cognito: lockout behavior for failed sign-in attempts](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flow-things-to-know.html#authentication-flow-lockout-behavior)
- Attempts made during a lockout return a "Password attempts exceeded" exception and do not lengthen later lockouts;
  the state resets after a successful sign-in once the lockout has expired, or after 15 minutes without any sign-in
  attempt; AWS states the behaviour is subject to change; no setting to configure it is described —
  [Amazon Cognito: lockout behavior for failed sign-in attempts](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flow-things-to-know.html#authentication-flow-lockout-behavior)

Google (via fetch tool; paraphrased)

- Google Workspace does not document a failed-password lockout on this page; instead a login challenge is shown when
  a sign-in looks suspicious, for example when it does not match the user's earlier sign-in pattern; the challenge
  can be a prompt on the phone, a text message or call, an employee ID or the recovery email address; a user who
  cannot answer is not signed in; an administrator can turn the challenge off for one user for 10 minutes —
  [Google Workspace: Protect accounts with security challenges](https://knowledge.workspace.google.com/admin/security/protect-google-workspace-accounts-with-security-challenges)

Keycloak, as the common self-hosted identity provider, for contrast (direct text of the documentation source, main
branch)

- Brute force detection is off by default, is keyed on the user account, and has three modes: "Lockout permanently",
  "Lockout temporarily" and "Lockout permanently after temporary lockout"; defaults are 30 "Max Login Failures",
  "Wait Increment" 1 minute, "Max Wait" 15 minutes, "Failure Reset Time" 12 hours —
  [Keycloak Server Administration Guide, brute force attacks](https://www.keycloak.org/docs/latest/server_admin/index.html#password-guess-brute-force-attacks)
- Wait formula of the default strategy: "Wait Increment in Seconds * (count / Max Login Failures)" with integer
  division; a linear strategy is "Wait Increment in Seconds * (1 + count - Max Login Failures)" —
  [Keycloak Server Administration Guide, brute force attacks](https://www.keycloak.org/docs/latest/server_admin/index.html#password-guess-brute-force-attacks)
- Keycloak names the weakness itself: "The downside of Keycloak brute force detection is that the server becomes
  vulnerable to denial of service attacks. When implementing a denial of service attack, an attacker can attempt to
  log in by guessing passwords for any accounts it knows and eventually causing Keycloak to disable the accounts."
  Its advice is an intrusion prevention system that reads the log of failures and client addresses and blocks
  addresses at the firewall —
  [Keycloak Server Administration Guide, brute force attacks](https://www.keycloak.org/docs/latest/server_admin/index.html#password-guess-brute-force-attacks)
- A locked user sees the same "Invalid username or password" message as for a wrong password, "to ensure the attacker
  is unaware the account is disabled." —
  [Keycloak Server Administration Guide, brute force attacks](https://www.keycloak.org/docs/latest/server_admin/index.html#password-guess-brute-force-attacks)

### Inferences

- Summary of keys and responses:
  - Entra ID: account, with separate counters for familiar and unfamiliar locations; temporary lock that grows;
    unlock by password reset or administrator.
  - AD FS smart lockout: account plus a per-user list of up to 20 familiar addresses; only unknown locations are
    locked; one attempt per observation window afterwards; unlock by time or cmdlet.
  - Auth0: user plus IP address by default (a block only for that pair), optional account-wide lock; long block
    (up to 30 days) with email unblock link, password change or administrator API; a second limiter on IP address
    alone.
  - Okta: account, optionally split into known and unknown devices; timed auto-unlock, self-service unlock,
    administrator action.
  - Cognito: account; exponential delay from 1 second capped near 15 minutes; never a permanent lock.
  - Google: risk-based challenge instead of a lock.
  - Keycloak: account only; temporary or permanent lock; documents its own denial-of-service weakness.
- The pattern shared by Microsoft, Okta, the device-cookie protocol and the academic PGRP protocol is the same idea:
  a client that has proven itself by an earlier successful login (address, device or cookie) gets its own budget of
  failures, so attempts from elsewhere cannot use it up.
- Cognito shows the simplest design that bounds the denial of service without any client identification: with a cap
  of about 15 minutes an attacker can keep an account in lockout only by attacking continuously, and the owner gets a
  chance at each expiry; the attacker is still limited to roughly 100 guesses per day.
- Auth0's default (user plus IP address) gives no global bound per account: an attacker with many addresses gets the
  threshold again from each address. Auth0 compensates with the separate per-address limiter, bot detection and
  breached-password detection rather than with an account-wide counter.
- Every provider that can lock also documents an unlock path that does not depend on the locked login form: email
  link, password reset, administrator console or API, or a command.

### Gaps

- Auth0's default numbers for suspicious IP throttling (maximum attempts per day and throttling rate) are not stated
  on the pages read; not verified.
- How Okta decides that a device is "known" (cookie, device token or fingerprint) and how long the unknown-device
  block lasts is not stated in the two support articles read.
- Microsoft does not document how Entra ID defines a "familiar location" (the AD FS document does, for AD FS only) or
  how fast the lockout period grows; the latter is withheld on purpose.
- For consumer Google accounts I found no primary documentation of thresholds or lock durations after failed
  passwords; third-party pages mention temporary blocks and CAPTCHAs but are not reliable. A Google Security Blog
  post of 17 May 2019 on the effectiveness of sign-in challenges exists
  (https://security.googleblog.com/2019/05/new-research-how-effective-is-basic.html) but its body could not be
  retrieved, so no figures are taken from it.
- The Auth0, Okta, AWS and Google statements were read through the summarising fetch tool and are paraphrased; the
  exact wording should be checked at the linked pages before quoting.

## What do practitioner and academic sources say about lockout versus throttling versus CAPTCHA versus proof of work, and about the key (user name, user name plus address, address alone)?

### Takeaway

The well-regarded sources agree that a fixed account lockout is the weakest choice because of the denial of service
it creates, that throttling (a growing delay) keyed on the account is preferred, and that the best-studied way to
keep both a hard per-account bound and availability is to treat clients with an earlier successful login (cookie or
address) separately. Address-only limits are easy to bypass with botnets and proxies and can hit many users behind
one address; delays and proof of work do not scale against botnets unless the limit is per account.

### Cited Findings

UK National Cyber Security Centre, "Password administration for system owners" (version 1.0, reviewed 19 November
2018; via fetch tool, quotes as returned)

- Throttling is defined as "a progressively increasing time delay between successive login attempts." —
  [NCSC: Updating your approach](https://www.ncsc.gov.uk/collection/passwords/updating-your-approach)
- "Throttling is preferred, because account lockout can leave legitimate users unable to access their accounts." —
  [NCSC: Updating your approach](https://www.ncsc.gov.uk/collection/passwords/updating-your-approach)
- "Account lockout can provide an attacker with an easy way to launch a denial of service attack." —
  [NCSC: Updating your approach](https://www.ncsc.gov.uk/collection/passwords/updating-your-approach)
- "we recommend you allow between 5 and 10 login attempts before the account is frozen." —
  [NCSC: Updating your approach](https://www.ncsc.gov.uk/collection/passwords/updating-your-approach)
- Monitoring "can be considered alongside account throttling (or lockout)", with indicators such as brute-forcing and
  password spraying; a password deny list is recommended against the most common passwords —
  [NCSC: Updating your approach](https://www.ncsc.gov.uk/collection/passwords/updating-your-approach)

Florêncio, Herley, van Oorschot, "An Administrator's Guide to Internet Password Research", USENIX LISA 2014, pages
44–61 (direct text extracted from the PDF; paraphrased; exponents were lost in extraction)

- Section 4.4 "Rate-limiting and lockout policies" names two main problems of lockout policies: the usability burden
  and the denial-of-service vulnerability, namely that a fixed lockout policy lets an attacker lock selected users
  out of the site —
  [LISA 2014 paper](https://www.usenix.org/conference/lisa14/conference-program/presentation/florencio)
- Its examples: an online auction user locking out a rival as a deadline approaches, or someone locking all users of
  an online brokerage out during trading hours —
  [LISA 2014 paper](https://www.usenix.org/conference/lisa14/conference-program/presentation/florencio)
- It describes the alternative explored by Pinkas and Sander and extended by others: logins are accepted without
  further ado from devices the server has associated with earlier successful logins for that user name (by browser
  cookie or IP address), while attempts from other devices need a password and a correctly answered CAPTCHA; the
  stated downside is CAPTCHA usability —
  [LISA 2014 paper](https://www.usenix.org/conference/lisa14/conference-program/presentation/florencio)
- Its summary table lists as recommended defences against online guessing: password blacklist, rate limiting, account
  lockout, and recognition of known devices (for example by browser cookies or IP address recognition) —
  [LISA 2014 paper](https://www.usenix.org/conference/lisa14/conference-program/presentation/florencio)
- It distinguishes breadth-first online guessing (few guesses against many accounts) from depth-first guessing (many
  guesses against one account), and notes that IP address blacklisting can hinder depth-first attacks but that public
  addresses fronting many client devices complicate it —
  [LISA 2014 paper](https://www.usenix.org/conference/lisa14/conference-program/presentation/florencio)
- It notes that a study by Bonneau and Preibusch found very few sites blocking logins even after 100 failed
  attempts —
  [LISA 2014 paper](https://www.usenix.org/conference/lisa14/conference-program/presentation/florencio)
- The figure of about 10^6 guesses as what a password needs to withstand in a depth-first online attack is attributed
  to this paper by OWASP, which links it next to "limits minimum number attempts to 10^6" —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)

Alsaleh, Mannan, van Oorschot, "Revisiting Defenses against Large-Scale Online Password Guessing Attacks", IEEE
Transactions on Dependable and Secure Computing 9(1), 2012, pages 128–141 (author version of 13 February 2011;
direct text extracted from the PDF; paraphrased)

- The Password Guessing Resistant Protocol (PGRP) builds on Pinkas–Sander and van Oorschot–Stubblebine. It demands an
  automated Turing test (CAPTCHA) after a few (for example three) failed attempts from unknown machines, but allows a
  high number (for example 30) of failed attempts from known machines without any test —
  [PGRP paper](https://people.scs.carleton.ca/~paulv/papers/att-revisited-13feb2011.pdf)
- Known machines are those from which a successful login happened within a fixed period; they are identified by an IP
  address kept in a server-side whitelist of (source address, user name) pairs, by a cookie, or both —
  [PGRP paper](https://people.scs.carleton.ca/~paulv/papers/att-revisited-13feb2011.pdf)
- Counters: failed attempts per (source address, user name) against threshold k1, and failed attempts from any machine
  per user name against threshold k2; a failed attempt from a machine with a valid cookie or whitelisted address does
  not increase the per-user-name total —
  [PGRP paper](https://people.scs.carleton.ca/~paulv/papers/att-revisited-13feb2011.pdf)
- Claimed property: the convenience of the legitimate user is not affected by an attacker's actions as long as the
  user stays under k1 failed attempts on known machines; with n known machines the user has n times k1 plus k2
  attempts without a test —
  [PGRP paper](https://people.scs.carleton.ca/~paulv/papers/att-revisited-13feb2011.pdf)
- On delays and proof of work: delaying the server response slows guessing against one user name but is ineffective
  against adversaries with many machines such as a botnet, and the same holds for techniques that make the client
  perform extra computation before the reply —
  [PGRP paper](https://people.scs.carleton.ca/~paulv/papers/att-revisited-13feb2011.pdf)
- Assumptions and limits: attackers can solve a small share of the tests (programs, low-paid workers); attacks using
  the addresses of known machines or stolen cookies are assumed to be rare; cookies have usability drawbacks with
  several browsers or machines and deleted cookies —
  [PGRP paper](https://people.scs.carleton.ca/~paulv/papers/att-revisited-13feb2011.pdf)

Microsoft, "Account lockout threshold" security policy reference (archived Windows documentation, dated 2 November
2018; via fetch tool, page text returned in full)

- "it's important to note that a denial-of-service (DoS) attack could be performed on a domain that has an account
  lockout threshold configured. A malicious user could programmatically attempt a series of password attacks against
  all users in the organization." —
  [Microsoft: Account lockout threshold](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/account-lockout-threshold)
- Two countermeasures are offered. Either threshold 0, which "ensures that accounts won't be locked, and it will
  prevent a DoS attack that intentionally attempts to lock accounts", acceptable only with complex passwords of eight
  or more characters and "A robust audit mechanism"; or a threshold high enough for typing mistakes: "Windows security
  baselines recommend configuring a threshold of 10 invalid sign-in attempts, which prevents accidental account
  lockouts and reduces the number of Help Desk calls, but doesn't prevent a DoS attack." —
  [Microsoft: Account lockout threshold](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/account-lockout-threshold)
- "Using this type of policy must be accompanied by a process to unlock locked accounts." and "an attacker can easily
  lock any accounts for which the account name is known. This situation is especially dangerous considering that no
  credentials other than access to the network are necessary to lock the accounts." —
  [Microsoft: Account lockout threshold](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/account-lockout-threshold)

Address-only limiting in a self-hosted application: Nextcloud (latest administration manual; via fetch tool;
paraphrased)

- Nextcloud's brute-force protection is keyed on the IP address, not the account: requests from an address with failed
  attempts are slowed down for up to 24 hours, the delay for a login is capped at 25 seconds, and after 10 attempts
  within 30 minutes the address gets HTTP 429 until it falls below the threshold; entries expire after 48 hours; a
  successful login from the same address clears its failed attempts; an account is not affected when it connects
  from a different address —
  [Nextcloud: Brute force protection](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)
- Its documentation warns that `trusted_proxies` and `forwarded_for_headers` must be set correctly, otherwise all
  traffic coming through the reverse proxy is throttled; addresses can be exempted, and exempt addresses are not
  throttled at all —
  [Nextcloud: Brute force protection](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)

OWASP statements on the key and on bypasses (direct text; see the OWASP question above for the full quotes)

- Account as key: counter "associated with the account itself, rather than the source IP address, in order to prevent
  an attacker from making login attempts from a large number of different IP addresses." —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout)
- Account plus address as key: "better in regarding to DoS issues but have security downsides: Attacks from botnets
  can be effective; Attacks through proxies can be effective" —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- Address as key: blocks "a proxy server used by an ISP or large company" and is bypassed with proxy lists using "two
  or three attempts per proxy" —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)
- Password spraying defeats per-account counters: "Account lockout is ineffective against attacks that try one
  password against a large list of usernames." —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)
- CAPTCHA is "a defense-in-depth control ... rather than as a preventative" because implementations can be solved
  automatically or outsourced —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#captcha)
- Proof of work is listed as a "Degradation" measure that needs "a context-dependent risk assessment to gauge their
  efficacy, resistance to countermeasures and user experience impact." —
  [OWASP Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html#degradation)

PCI DSS (secondary sources only)

- PCI DSS 4.0 and 4.0.1 requirement 8.3.4 is reported as: invalid authentication attempts are limited by locking out
  the user ID after not more than 10 attempts and setting the lockout duration to a minimum of 30 minutes or until
  the user's identity is confirmed; the older version 3.2.1 requirement 8.1.6 is reported with six attempts. Not
  verified at the PCI SSC document —
  [Cloudaware copy of PCI DSS v4.0.1 8.3.4](https://ce.prod.cloudaware.com/frameworks/pci-dss-v4.0.1/08/03/04)

### Inferences

- Comparison of keys, combining the sources above:
  - User name alone, hard lock: gives a true bound on guesses per account regardless of botnet size, but lets
    anyone who knows the name lock the owner out (OWASP, NCSC, Microsoft, Keycloak, LISA paper). Worst for a
    well-known name such as `admin`.
  - User name alone, growing delay with a cap and automatic expiry: keeps the bound (for example Cognito's cap
    yields about 100 guesses per day), and turns the denial of service from "locked until someone unlocks" into
    "slow while the attack runs". The owner still competes with the attacker for the next attempt slot.
  - User name plus address: an attacker cannot lock the owner out from a different address, but every new address
    gives the attacker a fresh budget, so there is no global bound (OWASP names botnets and proxies; Auth0's default
    works this way and adds other layers). It also depends on getting the real client address right behind proxies
    and on a sensible treatment of IPv6.
  - Address alone: no account lockout at all, cheap, stops single-source tools; bypassed by distributed attacks and
    can slow down many users behind one address or the whole site if the proxy configuration is wrong (OWASP,
    Nextcloud).
  - User name with a separate budget for known clients (cookie, address list, device): global bound for unknown
    clients plus availability for the owner on a known client (device cookies, PGRP, AD FS and Entra smart lockout,
    Okta). The cost is the state to keep and the special case of the owner on a new client.
- Password spraying is not stopped by any per-account counter; the sources answer it with password deny lists, a
  per-address or global velocity limit, monitoring and MFA.
- CAPTCHA and proof of work raise the attacker's cost per guess but do not bound the number of guesses; the sources
  treat them as an added layer or as a replacement for the lock on unknown clients (PGRP), not as the sole control.
- A layered combination is what the sources converge on: a per-account limit that is soft (delay) or exempts known
  clients, plus a coarse per-address limit against single-source floods and spraying, plus a deny list of common
  passwords so that the small number of allowed guesses is very unlikely to succeed.

### Gaps

- The LISA 2014 numbers (10^6 online, the offline figure) could not be read from the PDF because exponents were lost
  in text extraction; the 10^6 figure is corroborated only indirectly by the OWASP page that cites the paper.
- The original Pinkas–Sander (2002) and van Oorschot–Stubblebine (2006) papers were not read; they are described only
  as summarised by the two later papers.
- The "StopGuessing" work (Tian, Herley, Schechter) on address-based blocking weighted by password popularity was
  not reviewed.
- PCI DSS wording comes from secondary sites; the official standard was not accessible.
- No source was found that quantifies proof of work for login forms specifically; the OWASP text is generic.
- The NCSC guidance carries a 2018 review date; I did not find a newer NCSC statement on throttling versus lockout.

## What recommendations exist specifically for administrator accounts with respect to lockout (second administrator, break-glass account, command-line unlock, MFA)?

### Takeaway

The sources treat the administrator lockout as a known dilemma: operating systems traditionally exempt the built-in
administrator from lockout so that someone can always get in, while OWASP points out that these are the most
attractive accounts to attack. The recommended resolution is not an exemption but redundancy and an out-of-band
path: no well-known default account name, at least two administrators or dedicated break-glass accounts, MFA or
phishing-resistant authentication, and an unlock that works from the server side (console, command or API).

### Cited Findings

Exempting the administrator, and why

- Windows: "The built-in Administrator account, however, whilst a highly privileged account, has a different risk
  profile and is excluded from this policy. This ensures there is no scenario where an administrator cannot sign in
  to remediate an issue. As an administrator, there are additional mitigation strategies available, such as a strong
  password." (via fetch tool, page text returned in full; archived page dated 2 November 2018) —
  [Microsoft: Account lockout threshold](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/account-lockout-threshold)
- Linux `pam_faillock`: "Normally, failed attempts to authenticate root will not cause the root account to become
  blocked", which the manual page attributes to preventing denial of service; locking root as well is an explicit
  option (`even_deny_root`, with `root_unlock_time`) (via fetch tool) —
  [pam_faillock(8)](https://man7.org/linux/man-pages/man8/pam_faillock.8.html)
- OWASP on the downside of such exemptions: "Powerful accounts such as administrator accounts often bypass lockout
  policy, but these are the most desirable accounts to attack. Some systems lock out administrator accounts only on
  network-based logins." (direct text) —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)
- OWASP on re-locking: "An attacker can continuously lock out the same account, even seconds after an administrator
  unlocks it, effectively disabling the account." (direct text) —
  [OWASP Blocking Brute Force Attacks](https://community.owasp.org/controls/Blocking_Brute_Force_Attacks)

No well-known administrator name

- ASVS 5.0.0 requirement 6.3.2, level 1: "Verify that default user accounts (e.g., "root", "admin", or "sa") are not
  present in the application or are disabled." (direct text) —
  [ASVS 5.0.0, V6.3](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x15-V6-Authentication.md)
- Microsoft: with a lockout threshold "an attacker can easily lock any accounts for which the account name is known."
  (via fetch tool, page text returned in full) —
  [Microsoft: Account lockout threshold](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/account-lockout-threshold)

Second administrator and break-glass accounts

- Auth0 applies brute-force protection to all users including tenant administrators and recommends a secondary
  tenant administrator so that blocked administrator accounts can be unblocked by another administrator (via fetch
  tool; paraphrased) —
  [Auth0 Brute-Force Protection](https://auth0.com/docs/secure/attack-protection/brute-force-protection)
- Microsoft Entra (page dated 4 June 2026): "It's important to prevent accidentally locking yourself out of your
  Microsoft Entra organization because you can't sign in or activate a role. You can reduce the impact of accidental
  lack of administrative access by creating two or more emergency access accounts in your organization." (via fetch
  tool, page text returned in full) —
  [Microsoft Entra: Manage emergency access admin accounts](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access)
- Entra guardrails for these accounts: "Maintain at least two emergency access accounts for redundancy."; "Use
  phishing-resistant authentication methods (FIDO2 security keys or certificate-based authentication) that are
  different from your normal admin accounts."; "Don't associate emergency access accounts with any individual user in
  the organization."; "Monitor all sign-in and audit log activity for emergency access accounts with alerts to detect
  unnecessary or unauthorized use."; "Validate account functionality at least every 90 days." —
  [Microsoft Entra: Manage emergency access admin accounts](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access)
- Entra: use emergency accounts "only for emergency or 'break glass' scenarios where normal administrative accounts
  can't be used." —
  [Microsoft Entra: Manage emergency access admin accounts](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access)
- OWASP WSTG-ATHN-03 notes that with manual administrator unlock the administrator needs a recovery method of their
  own, and that an attacker could otherwise lock out all users (via fetch tool; paraphrased) —
  [OWASP WSTG-ATHN-03](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/04-Authentication/03-Weak_Lock_Out_Mechanism)

MFA for administrators

- NCSC on highly privileged or externally accessible accounts: "MFA should be the primary method for protecting these
  accounts"; also "Highly privileged accounts should not be used for high risk or day-to-day user activities." and
  "administrators should also have standard user accounts (with different passwords)." (via fetch tool, quotes as
  returned) — [NCSC: Updating your approach](https://www.ncsc.gov.uk/collection/passwords/updating-your-approach)
- Windows: for the exempted administrator "there are additional mitigation strategies available, such as a strong
  password." —
  [Microsoft: Account lockout threshold](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/account-lockout-threshold)

Server-side and command-line unlock paths documented by products

- GitLab: accounts lock after repeated failed attempts (10 or more on instances without email verification, automatic
  unlock after 10 minutes; both limits configurable on self-managed instances through `max_login_attempts` and
  `failed_login_attempts_unlock_period_in_minutes`); an administrator can unlock in the Admin area or from a Rails
  console with `user = User.find_by_username('exampleuser')` followed by `user.unlock_access!` (via fetch tool) —
  [GitLab: Locked users](https://docs.gitlab.com/security/unlock_user/)
- AD FS: `Reset-ADFSAccountLockout user@contoso.com -Location Unknown` resets the lockout counter; the cmdlets can be
  delegated to help-desk staff with Just Enough Administration (via fetch tool, page text returned in full) —
  [AD FS Extranet Smart Lockout](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/configure-ad-fs-extranet-smart-lockout-protection)
- Entra ID: "An administrator can unlock a user's cloud account if Smart Lockout has locked them out without waiting
  for the lockout duration to expire." —
  [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)
- Auth0: an administrator removes a block through the Management API (`DELETE /user-blocks` or
  `DELETE /user-blocks/{id}`) (via fetch tool) —
  [Auth0 Brute-Force Protection](https://auth0.com/docs/secure/attack-protection/brute-force-protection)
- Okta: an administrator selects "Allow Unknown Devices" for the user under Directory > People (via fetch tool) —
  [Okta: Allow unknown devices](https://support.okta.com/help/s/article/allow-unknown-devices)
- Keycloak: in permanent mode the account stays disabled "until an administrator re-enables it"; "Enabling an user
  account resets the count." (direct text) —
  [Keycloak Server Administration Guide, brute force attacks](https://www.keycloak.org/docs/latest/server_admin/index.html#password-guess-brute-force-attacks)
- Nextcloud: the state of an address can be checked with `occ security:bruteforce:attempts`, and the manual mentions
  several brute-force related `occ` commands under `occ security` (via fetch tool) —
  [Nextcloud: Brute force protection](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/bruteforce_configuration.html)

Unlock paths that do not need another administrator

- OWASP: "allow the use of the forgotten password functionality to log in, even if the account is locked out." (direct
  text) —
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout)
- OWASP device cookies: "Issue a valid device cookie after visiting password reset link (an actual password reset is
  not necessary)." (direct text) —
  [OWASP Device Cookies](https://community.owasp.org/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies)
- NIST Rev. 4: when the limit is exceeded the disabled authenticator must be rebound, and "If the subscriber cannot
  authenticate at the required AAL, the account recovery procedures in Sec. 4.2 SHALL be used." (direct text) —
  [NIST SP 800-63B-4, 3.2.2](https://pages.nist.gov/800-63-4/sp800-63b.html)

### Inferences

- None of the standards (NIST, ASVS) gives a rule that says "exempt administrators from throttling"; the exemption is
  an operating-system tradition (Windows built-in Administrator, Linux root) justified by availability. OWASP's remark
  shows why copying that exemption to a web application is risky: the exempt account is the one attackers most want
  to guess.
- For a self-hosted application without email, the email-based unlock paths (Auth0 link, OWASP forgotten-password
  bypass, device cookie by reset link) are not available. What remains from the sources is: a lock that expires by
  itself (Cognito, Entra, GitLab, NIST's growing wait), a separate budget for known clients (device cookie, familiar
  address), a second administrator who can unlock in the user interface (Auth0's advice), and a server-side command
  that needs shell access rather than the login form (GitLab console, AD FS cmdlet).
- A command-line unlock is safe against the remote attacker by construction, because it needs access to the host; the
  OWASP warning that an attacker can re-lock an account seconds after the unlock still applies, so the command only
  helps durably when combined with a design in which the attacker cannot lock the owner's known client.
- Avoiding a predictable administrator name (ASVS 6.3.2) reduces both guessing and targeted lockout, but only as long
  as the application does not reveal valid user names; OWASP notes that lockout itself can leak which names exist if
  only existing accounts lock.

### Gaps

- I found no standard text that explicitly recommends a command-line unlock for web applications; the evidence is
  product documentation (GitLab, AD FS) and the general OWASP ranking of unlock mechanisms.
- Windows has a newer policy to allow lockout of the built-in Administrator account as well; I did not verify its
  current documentation, so it is not cited above.
- The `faillock` command for resetting counters and the defaults of `deny` and `unlock_time` are documented in
  `faillock(8)` and `faillock.conf(5)`, which were not read.
- Auth0's exact sentence on the secondary tenant administrator and the GitLab, Okta and pam_faillock details were read
  through the summarising fetch tool and should be checked at the linked pages before quoting.
