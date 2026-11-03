# List of Open Points

This list holds what is still open for HippoWiki: decisions to make, points only the
[Connector Test](../spec/roadmap.md#connector-test) can settle, checks on the real host, known gaps, review findings,
experiments and possible cuts. Rules that are already fixed are in the [specification](../spec/README.md) and not here,
and the plan is in the [Roadmap](../spec/roadmap.md).

## Overview

| Section                                         | Open points |
| ----------------------------------------------- | ----------- |
| [OAuth Decisions](#oauth-decisions)             | 11          |
| [Connector Test Points](#connector-test-points) | 6           |
| [Host Checks](#host-checks)                     | 2           |
| [OAuth Known Gaps](#oauth-known-gaps)           | 4           |
| [Spec Findings](#spec-findings)                 | 37          |
| [Experiments](#experiments)                     | 5           |
| [Cut Candidates](#cut-candidates)               | 8           |

How to read this list:

- There are no blockers and no open major findings.
- Until a decision is made, the behaviour under "Today" stays in force.
- Choices inside the findings are marked **Decision**, and the [cut candidates](#cut-candidates) are also yours to
  decide.
- The open findings can wait for the step that touches them, or for the implementation to show whether they matter.

## OAuth Decisions

### Product Tokens on REST

- **Question**: should a token given to Claude or ChatGPT also work on REST?
- **Today**: yes, for the whole account, as an [accepted trade-off](../spec/connectors.md#client-registration). The MCP
  specification says a server should accept only tokens meant for it.
- **Recommendation**: refuse trusted clients on REST. Products only use MCP, so nothing breaks, and a leaked product
  token can then not reach history, revert or anything else only REST offers. The token row already stores the client,
  so this is one check in the credential check.
- **Alternatives**:
  - Keep it as it is: no work, but a product holds more access than it needs.
  - Separate resources for MCP and REST: the cleanest split, but clients then need a different token per resource, and
    it also changes the Web GUI and scripts.
- My decision (fix): Keep it as it is: no work, but a product holds more access than it needs. Document this in the
  specs as an explicit decision.

### Stronger Login Before Production

- **Question**: can a password login on the public internet go to production as it is?
- **Today**: password only, with multi-factor login [for later](../spec/roadmap.md#later) and no check for weak
  passwords beyond the length.
- **Recommendation**: check new passwords against a bundled list of common passwords now, because it is little code and
  sends nothing outside. Add TOTP as the first later item, before real accounts of other people go on the server.
- **Alternatives**:
  - Passkeys (WebAuthn): stronger and phishing-resistant, but more code and more ways to lock a person out.
  - The Have I Been Pwned API: a better list, but login depends on an outside service, and it receives a hash prefix.
  - Sign-in through Google or GitHub: no passwords to protect, but an outside dependency, and it brings back account
    linking.
  - Keep passwords only: acceptable only for a small group that uses long, unique passwords.
- My decision (fix): Keep passwords only: acceptable only for a small group that uses long, unique passwords. Add other
  options as ideas for improvement to the roadmap

### Independent Security Review

- **Question**: who reviews the OAuth code, and when?
- **Today**: the [roadmap](../spec/roadmap.md#next-steps) requires a review before anything real goes on the server, and
  names nobody.
- **Recommendation**: a person with OAuth experience, once the code exists, working from RFC 9700 and the MCP
  authorization specification. Automated review adds to this and does not replace it.
- **Alternatives**:
  - Automated review only: cheap, and misses more. Acceptable only while the server holds test data.
  - A paid penetration test: the strongest evidence, and only worth it once other people's data is at stake.
- My decision (fix): I will do a security review with Codex and Claude code - add that to the roadmap

### Account Lockout

- **Question**: may an attacker keep a known account from logging in?
- **Today**: yes. One wrong password per wait is enough, and the name `admin` is known. Tokens that exist keep working,
  and the [wait](../spec/oauth-server.md#login-protection) can be cleared.
- **Recommendation**: keep it. Guessing a password is the worse risk, and the admin does not use the login page until
  the Web GUI exists. Look at it again when the Web GUI is designed.

### One-Time Password Expiry

- **Question**: should a one-time password expire?
- **Today**: no. [Users](../spec/users.md#passwords) calls this accepted because it "opens nothing until it is
  replaced". That reason is too weak: whoever gets the password first can replace it and take the account.
- **Recommendation**: let it expire after 7 days, compared with `changed_at`, and correct that sentence. It takes one
  comparison and one limit, and the admin can reset it again.

### Token Lifetime

- **Question**: should a login ever end even when it is in regular use?
- **Today**: no absolute limit, only 60 days idle, see [Refresh Rotation](../spec/oauth-server.md#refresh-rotation).
- **Recommendation**: keep it for the first version. Rotation already detects a thief at a later refresh, and connectors
  that ask people to log in again get in the way. Let the security review confirm it.

### ChatGPT Workspaces With Domain Restrictions

- **Question**: does HippoWiki have to work with these Enterprise workspaces?
- **Today**: not supported. They need `openid`, `email` and a UserInfo endpoint with a verified email, and HippoWiki
  stores no email, see [Open Risks](../spec/oauth-server.md#open-risks).
- **Recommendation**: leave it out unless you need such a workspace. Test first on the plan you use, and document the
  limit.

### Clients Outside the Allowlist

- **Question**: how do other MCP clients connect, such as Codex or MCP Inspector?
- **Today**: the [allowlist](../spec/oauth-server.md#trusted-clients) has only the three products, so others need an own
  client created on the server.
- My decision (fix): any (authenticated) MCP client should be allowed - add this as an explicit decision to the spec.
  Claude and ChatGPT are just examples

### Terminal Access for People

- **Question**: how does a person get a token for `curl`?
- **Today**: the operator creates a [script client](../spec/connectors.md#scripts) on the server, and the device flow is
  [for later](../spec/roadmap.md#later).
- **Recommendation**: keep this while the operator is the main terminal user. Add the device flow when other people need
  it.

### Who Manages Script Clients

- **Question**: should only the operator on the shell manage clients?
- **Today**: yes, with `hippowiki client`. The admin has no REST route for them.
- **Recommendation**: keep it until the Web GUI exists, then add admin routes for script clients only.

### Password Recovery

- **Question**: should a person be able to recover a password without the admin?
- **Today**: no, because HippoWiki [stores no email](../spec/users.md#passwords).
- My decision (fix): keep it as it is. Decide again together with the email question above. Add it to the roadmap.

## OAuth Known Gaps

These are small, and each has a clear fix once it is worth doing.

### No Rate Limit on Anonymous OAuth Routes

- **Open**: only logins are limited. `POST /oauth/token` and `GET /oauth/authorize` have none, and each token request
  can cost a database lookup.
- **Recommendation**: a Traefik `rateLimit` middleware on `/oauth/`, because it needs no code, and it stays out of the
  streamed MCP path. Add this as a reminder somewhere - maybe in the roadmap

### No Way to End All Tokens

- **Open**: there is no command that ends every token at once, such as after a leak. A
  [restored backup](../spec/configuration-and-failure-modes.md#postgresql-and-alembic) also brings back tokens that had
  already ended.
- **Recommendation**: add `hippowiki revoke-all-tokens`, and run it after every restore. Everybody logs in again, and
  nothing else is lost.

### Parallel Logins Past the Address Limit

- **Open**: concurrent attempts from one address all pass the check before any failure is counted.
- **Recommendation**: accept it for now. The limit on running and waiting hashes already bounds the burst.

### Refetch Interval and the Metadata Document Draft

- **Open**: after a failed fetch the server waits 60 seconds, close to the draft's rule against caching error responses.
  The specification does not call this a deliberate deviation.
- **Recommendation**: add one sentence to [Trusted Clients](../spec/oauth-server.md#trusted-clients) saying it is
  deliberate, because the limit protects the vendor.
