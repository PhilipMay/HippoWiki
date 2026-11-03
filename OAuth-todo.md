# OAuth Todo

This file lists what is still open for the [OAuth Server](spec/oauth-server.md): decisions to make, points only the
[Connector Test](spec/roadmap.md#connector-test) can settle, and known gaps. Rules that are already fixed are in the
specification and not here. Until a decision is made, the behaviour under "Today" stays in force.

## Decisions to Make

### Product Tokens on REST

- **Question**: should a token given to Claude or ChatGPT also work on REST?
- **Today**: yes, for the whole account, as an [accepted trade-off](spec/connectors.md#client-registration). The MCP
  specification says a server should accept only tokens meant for it.
- **Recommendation**: refuse trusted clients on REST. Products only use MCP, so nothing breaks, and a leaked product
  token can then not reach history, revert or anything else only REST offers. The token row already stores the client,
  so this is one check in the credential check.
- **Alternatives**:
  - Keep it as it is: no work, but a product holds more access than it needs.
  - Separate resources for MCP and REST: the cleanest split, but clients then need a different token per resource, and
    it also changes the Web GUI and scripts.

### Stronger Login Before Production

- **Question**: can a password login on the public internet go to production as it is?
- **Today**: password only, with multi-factor login [for later](spec/roadmap.md#later) and no check for weak passwords
  beyond the length.
- **Recommendation**: check new passwords against a bundled list of common passwords now, because it is little code and
  sends nothing outside. Add TOTP as the first later item, before real accounts of other people go on the server.
- **Alternatives**:
  - Passkeys (WebAuthn): stronger and phishing-resistant, but more code and more ways to lock a person out.
  - The Have I Been Pwned API: a better list, but login depends on an outside service, and it receives a hash prefix.
  - Sign-in through Google or GitHub: no passwords to protect, but an outside dependency, and it brings back account
    linking.
  - Keep passwords only: acceptable only for a small group that uses long, unique passwords.

### Independent Security Review

- **Question**: who reviews the OAuth code, and when?
- **Today**: the [roadmap](spec/roadmap.md#next-steps) requires a review before anything real goes on the server, and
  names nobody.
- **Recommendation**: a person with OAuth experience, once the code exists, working from RFC 9700 and the MCP
  authorization specification. Automated review adds to this and does not replace it.
- **Alternatives**:
  - Automated review only: cheap, and misses more. Acceptable only while the server holds test data.
  - A paid penetration test: the strongest evidence, and only worth it once other people's data is at stake.

### Account Lockout

- **Question**: may an attacker keep a known account from logging in?
- **Today**: yes. One wrong password per wait is enough, and the name `admin` is known. Tokens that exist keep working,
  and the [wait](spec/oauth-server.md#login-protection) can be cleared.
- **Recommendation**: keep it. Guessing a password is the worse risk, and the admin does not use the login page until
  the Web GUI exists. Look at it again when the Web GUI is designed.
- **Alternatives**:
  - A wait per account and address: an attacker can not lock out others, but many addresses can guess slowly.
  - A lower `LOGIN_MAX_WAIT_SECONDS`: a shorter lockout, and faster guessing.
  - Add multi-factor login, then soften the wait: the best end state, and it depends on the item above.

### One-Time Password Expiry

- **Question**: should a one-time password expire?
- **Today**: no. [Users](spec/users.md#passwords) calls this accepted because it "opens nothing until it is replaced".
  That reason is too weak: whoever gets the password first can replace it and take the account.
- **Recommendation**: let it expire after 7 days, compared with `changed_at`, and correct that sentence. It takes one
  comparison and one limit, and the admin can reset it again.
- **Alternatives**:
  - Keep no expiry: simplest, and acceptable if the admin passes it on over a safe channel and the person logs in soon.
  - A one-time link instead of a password: friendlier, and it needs a new route and a way to deliver it.

### Token Lifetime

- **Question**: should a login ever end even when it is in regular use?
- **Today**: no absolute limit, only 60 days idle, see [Refresh Rotation](spec/oauth-server.md#refresh-rotation).
- **Recommendation**: keep it for the first version. Rotation already detects a thief at a later refresh, and connectors
  that ask people to log in again get in the way. Let the security review confirm it.
- **Alternatives**:
  - An absolute limit, such as 180 days: limits a theft that rotation misses. It needs a family start time, and everyone
    logs in again at that interval.
  - A shorter idle limit: helps little for connectors in daily use.

### ChatGPT Workspaces With Domain Restrictions

- **Question**: does HippoWiki have to work with these Enterprise workspaces?
- **Today**: not supported. They need `openid`, `email` and a UserInfo endpoint with a verified email, and HippoWiki
  stores no email, see [Open Risks](spec/oauth-server.md#open-risks).
- **Recommendation**: leave it out unless you need such a workspace. Test first on the plan you use, and document the
  limit.
- **Alternatives**:
  - Add an email column set by the admin, the two scopes and UserInfo: about a day of work and new personal data. The
    `email_verified: true` claim would then rest only on the admin's word.
  - Add real email verification: it needs mail delivery, and it would also allow a self-service password reset.

### Clients Outside the Allowlist

- **Question**: how do other MCP clients connect, such as Codex or MCP Inspector?
- **Today**: the [allowlist](spec/oauth-server.md#trusted-clients) has only the three products, so others need an own
  client created on the server.
- **Recommendation**: keep the exact allowlist. Add a URL to the setting when a client you use has a metadata document,
  and use `hippowiki client add --public` when it does not.
- **Alternatives**:
  - Allow any metadata document on trusted domains: less upkeep, and any client on those domains can then ask for a
    login.
  - Accept any document, with protection against server-side request forgery: the most open, with the most code, and the
    login page then shows names nobody vetted.
  - Dynamic client registration: not recommended, because MCP deprecates it and anyone could create clients.

### Terminal Access for People

- **Question**: how does a person get a token for `curl`?
- **Today**: the operator creates a [script client](spec/connectors.md#scripts) on the server, and the device flow is
  [for later](spec/roadmap.md#later).
- **Recommendation**: keep this while the operator is the main terminal user. Add the device flow when other people need
  it.
- **Alternatives**:
  - A CLI login through a loopback redirect: no device codes, and it needs a small client program.
  - Personal access tokens from the Web GUI: familiar to users, and it adds a second kind of long-lived token.

### Who Manages Script Clients

- **Question**: should only the operator on the shell manage clients?
- **Today**: yes, with `hippowiki client`. The admin has no REST route for them.
- **Recommendation**: keep it until the Web GUI exists, then add admin routes for script clients only.
- **Alternatives**:
  - Admin routes now: helps if the admin is not the operator, and it is more surface before anyone needs it.

### Password Recovery

- **Question**: should a person be able to recover a password without the admin?
- **Today**: no, because HippoWiki [stores no email](spec/users.md#passwords).
- **Recommendation**: keep it for a small group of users. Decide again together with the email question above.
- **Alternatives**:
  - Reset by email: the usual way, and it needs an email column and mail delivery, and the mailbox becomes a way in.
  - Recovery codes, shown once: no mail needed, and people lose them.

## To Settle in the Connector Test

Each of these has a planned answer, which only the real clients can confirm. See
[Connector Test](spec/roadmap.md#connector-test).

### Clients Accept the Metadata Documents

- **Open**: all three log in with nothing entered but the MCP URL. This is read from the vendor pages and has never run.
- **Recommendation**: test Claude Code first, because it needs no plan or approval and has the shortest loop, then
  Claude and ChatGPT.
- **Alternatives if it fails**: an own client with `--public` and its ID entered by hand, and only then an external
  service such as Logto.

### ChatGPT Plan and Public Mode

- **Open**: that ChatGPT uses its stable `client_id` and runs as a public client, and whether a Business member needs an
  admin to publish the connector. The OpenAI page on developer mode could not be read during the review.
- **Recommendation**: use a workspace where you are the admin, and read the `client_id` in the log.
- **Alternatives if it fails**: if ChatGPT sends a `client_id` with a callback ID, add that URL to the allowlist. If it
  insists on `private_key_jwt`, add client assertions, which is the larger change.

### Whether Tools Need `securitySchemes`

- **Open**: the OpenAI documentation names them, and [MCP](spec/mcp.md#tools) does not define them.
- **Recommendation**: start without them, and add them only if ChatGPT fails to link.
- **Alternatives**: add them from the start, which is harmless and leaves more text to maintain.

### `form-action` on the Login Page

- **Open**: Chrome may block the login if a callback redirects on to another origin or to an app. The Claude desktop and
  mobile apps share one callback, and its behaviour is unknown.
- **Recommendation**: keep it, and test those apps in particular.
- **Alternatives if it fails**: drop `form-action`, as [already planned](spec/oauth-server.md#browser-protection). The
  page has no scripts and escapes its values, so little depends on it.

### Refresh Behaviour and Lifetimes

- **Open**: parallel refreshes and retries are assumed, and the values in [OAuth Values](spec/limits.md#oauth-values)
  are estimates, because vendors name none.
- **Recommendation**: run parallel tool calls across a refresh, and leave a client logged in overnight and over a
  weekend.
- **Alternatives if it fails**: a longer grace window, a longer access token, or as a last resort no rotation for that
  client, which gives up reuse detection.

### Client Reactions

- **Open**: how each client reacts to a deactivated user, to the admin being refused, to 405 on `GET /mcp`, to its
  `Origin` being checked, and to a 401 on a discovery path that does not exist.
- **Recommendation**: read the log for each case and write down what the person sees.
- **Alternatives if it fails**: for a 401 on discovery, make `/.well-known/openid-configuration` a public 404. For a bad
  message on the login page, change the wording.

### Document Fetch From the Server

- **Open**: the vendor documents answered during the review, from a developer machine. They sit behind Cloudflare, so a
  data centre address may be treated differently.
- **Recommendation**: run the [check in the guide](doc/nixos-setup.md#checks) from the real host.
- **Alternatives if it fails**: ship copies of the documents in the image and use them when a fetch fails. Trust then
  rests on the image, and a vendor change needs a new image.

### Real Client Address and Secrets in the Journal

- **Open**: which address Podman shows for Traefik, and that `podman exec` output stays out of the journal. Neither has
  been run, and neither has the [NixOS guide](doc/nixos-setup.md) as a whole.
- **Recommendation**: follow the guide once on a test host, and fix it as you go.
- **Alternatives if it fails**: for the address, a different `--forwarded-allow-ips` or a host network for the app. For
  the journal, `--log-driver=none`.

## Known Gaps

These are small, and each has a clear fix once it is worth doing.

### No Rate Limit on Anonymous OAuth Routes

- **Open**: only logins are limited. `POST /oauth/token` and `GET /oauth/authorize` have none, and each token request
  can cost a database lookup.
- **Recommendation**: a Traefik `rateLimit` middleware on `/oauth/`, because it needs no code, and it stays out of the
  streamed MCP path.
- **Alternatives**:
  - Extend `auth/login_limiter.py` in the app: works without the proxy, and is more code.
  - Accept it for now: acceptable while the server holds test data.

### No Way to End All Tokens

- **Open**: there is no command that ends every token at once, such as after a leak. A
  [restored backup](spec/configuration-and-failure-modes.md#postgresql-and-alembic) also brings back tokens that had
  already ended.
- **Recommendation**: add `hippowiki revoke-all-tokens`, and run it after every restore. Everybody logs in again, and
  nothing else is lost.
- **Alternatives**:
  - Empty the tables by hand with `psql`: works today, and is easy to get wrong under pressure.

### Parallel Logins Past the Address Limit

- **Open**: concurrent attempts from one address all pass the check before any failure is counted.
- **Recommendation**: accept it for now. The limit on running and waiting hashes already bounds the burst.
- **Alternatives**:
  - Count an attempt when it starts and take it back on success: closes the gap with a few lines, and needs tests for
    the race.

### Refetch Interval and the Metadata Document Draft

- **Open**: after a failed fetch the server waits 60 seconds, close to the draft's rule against caching error responses.
  The specification does not call this a deliberate deviation.
- **Recommendation**: add one sentence to [Trusted Clients](spec/oauth-server.md#trusted-clients) saying it is
  deliberate, because the limit protects the vendor.
- **Alternatives**:
  - A shorter interval: closer to the draft, with more requests during an outage.

### Old Review Report

- **Open**: `spec-qa-report.md` still describes the Keycloak design, so its findings no longer apply.
- **Recommendation**: delete it, because most of what it covers has been rewritten.
- **Alternatives**:
  - Keep it with a note at the top saying which design it describes.
