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

### Independent Security Review

- **Question**: who reviews the OAuth code, and when?
- **Today**: the [roadmap](../spec/roadmap.md#next-steps) requires a review before anything real goes on the server, and
  names nobody.
- **Recommendation**: a person with OAuth experience, once the code exists, working from RFC 9700 and the MCP
  authorization specification. Automated review adds to this and does not replace it.
- **Alternatives**:
  - Automated review only: cheap, and misses more. Acceptable only while the server holds test data.
  - A paid penetration test: the strongest evidence, and only worth it once other people's data is at stake.

### Account Lockout

- **Question**: may an attacker keep a known account from logging in?
- **Today**: yes. One wrong password per wait is enough, and the name `admin` is known. Tokens that exist keep working,
  and the [wait](../spec/oauth-server.md#login-protection) can be cleared.
- **Recommendation**: keep it. Guessing a password is the worse risk, and the admin does not use the login page until
  the Web GUI exists. Look at it again when the Web GUI is designed.
- **Alternatives**:
  - A wait per account and address: an attacker can not lock out others, but many addresses can guess slowly.
  - A lower `LOGIN_MAX_WAIT_SECONDS`: a shorter lockout, and faster guessing.
  - Add multi-factor login, then soften the wait: the best end state, and it depends on the item above.

### One-Time Password Expiry

- **Question**: should a one-time password expire?
- **Today**: no. [Users](../spec/users.md#passwords) calls this accepted because it "opens nothing until it is
  replaced". That reason is too weak: whoever gets the password first can replace it and take the account.
- **Recommendation**: let it expire after 7 days, compared with `changed_at`, and correct that sentence. It takes one
  comparison and one limit, and the admin can reset it again.
- **Alternatives**:
  - Keep no expiry: simplest, and acceptable if the admin passes it on over a safe channel and the person logs in soon.
  - A one-time link instead of a password: friendlier, and it needs a new route and a way to deliver it.

### Token Lifetime

- **Question**: should a login ever end even when it is in regular use?
- **Today**: no absolute limit, only 60 days idle, see [Refresh Rotation](../spec/oauth-server.md#refresh-rotation).
- **Recommendation**: keep it for the first version. Rotation already detects a thief at a later refresh, and connectors
  that ask people to log in again get in the way. Let the security review confirm it.
- **Alternatives**:
  - An absolute limit, such as 180 days: limits a theft that rotation misses. It needs a family start time, and everyone
    logs in again at that interval.
  - A shorter idle limit: helps little for connectors in daily use.

### ChatGPT Workspaces With Domain Restrictions

- **Question**: does HippoWiki have to work with these Enterprise workspaces?
- **Today**: not supported. They need `openid`, `email` and a UserInfo endpoint with a verified email, and HippoWiki
  stores no email, see [Open Risks](../spec/oauth-server.md#open-risks).
- **Recommendation**: leave it out unless you need such a workspace. Test first on the plan you use, and document the
  limit.
- **Alternatives**:
  - Add an email column set by the admin, the two scopes and UserInfo: about a day of work and new personal data. The
    `email_verified: true` claim would then rest only on the admin's word.
  - Add real email verification: it needs mail delivery, and it would also allow a self-service password reset.

### Clients Outside the Allowlist

- **Question**: how do other MCP clients connect, such as Codex or MCP Inspector?
- **Today**: the [allowlist](../spec/oauth-server.md#trusted-clients) has only the three products, so others need an own
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
- **Today**: the operator creates a [script client](../spec/connectors.md#scripts) on the server, and the device flow is
  [for later](../spec/roadmap.md#later).
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
- **Today**: no, because HippoWiki [stores no email](../spec/users.md#passwords).
- **Recommendation**: keep it for a small group of users. Decide again together with the email question above.
- **Alternatives**:
  - Reset by email: the usual way, and it needs an email column and mail delivery, and the mailbox becomes a way in.
  - Recovery codes, shown once: no mail needed, and people lose them.

## Connector Test Points

Each of these has a planned answer, which only the real clients can confirm. See
[Connector Test](../spec/roadmap.md#connector-test).

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

- **Open**: the OpenAI documentation names them, and [MCP](../spec/mcp.md#tools) does not define them.
- **Recommendation**: start without them, and add them only if ChatGPT fails to link.
- **Alternatives**: add them from the start, which is harmless and leaves more text to maintain.

### `form-action` on the Login Page

- **Open**: Chrome may block the login if a callback redirects on to another origin or to an app. The Claude desktop and
  mobile apps share one callback, and its behaviour is unknown.
- **Recommendation**: keep it, and test those apps in particular.
- **Alternatives if it fails**: drop `form-action`, as [already planned](../spec/oauth-server.md#browser-protection).
  The page has no scripts and escapes its values, so little depends on it.

### Refresh Behaviour and Lifetimes

- **Open**: parallel refreshes and retries are assumed, and the values in [OAuth Values](../spec/limits.md#oauth-values)
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

## Host Checks

Each of these has a planned answer, which depends on the real host and not on how an AI client behaves. They need the
[NixOS guide](nixos-setup.md) and the app from the first [roadmap step](../spec/roadmap.md#next-steps).

### Document Fetch From the Server

- **Open**: the vendor documents answered during the review, from a developer machine. They sit behind Cloudflare, so a
  data centre address may be treated differently.
- **Recommendation**: run the [check in the guide](nixos-setup.md#checks) from the real host.
- **Alternatives if it fails**: ship copies of the documents in the image and use them when a fetch fails. Trust then
  rests on the image, and a vendor change needs a new image.

### Real Client Address and Secrets in the Journal

- **Open**: which address Podman shows for Traefik, and that `podman exec` output stays out of the journal. Neither has
  been run, and neither has the [NixOS guide](nixos-setup.md) as a whole.
- **Recommendation**: follow the guide once on a test host, and fix it as you go.
- **Alternatives if it fails**: for the address, a different `--forwarded-allow-ips` or a host network for the app. For
  the journal, `--log-driver=none`.

## OAuth Known Gaps

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
  [restored backup](../spec/configuration-and-failure-modes.md#postgresql-and-alembic) also brings back tokens that had
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
- **Recommendation**: add one sentence to [Trusted Clients](../spec/oauth-server.md#trusted-clients) saying it is
  deliberate, because the limit protects the vendor.
- **Alternatives**:
  - A shorter interval: closer to the draft, with more requests during an outage.

## Spec Findings

File names in these findings are in `spec/`, unless they are named with a path. "The guide" is the
[NixOS guide](nixos-setup.md).

### Security and Operations

- **Stored content is untrusted** (`connectors.md`: "An AI agent acts as the account it logged in with."). Nothing tells
  clients that tool results are data written by other users, and a person with `write` can store instructions for
  another user's agent. Fix: a short section in `mcp.md` and a line in the server instructions, plus advice for
  connector accounts to hold the smallest rights. Alternatives: a last editor field, which needs a read of the latest
  entry because no table stores it; a rights ceiling per client or scoped tokens, which reverse "There are no tokens
  with fewer rights than their user". **Decision** for those two.
- **Compose ports** (`deployment.md`, Containers and Compose). No rule on published ports, although the guide warns they
  bypass the firewall, and Traefik is not in the compose list. Fix: `postgres` publishes nothing, and `app` binds to
  `127.0.0.1`. Alternative: put Traefik in the compose file. **Decision** for that alternative.
- **Rights on deleted folders** (`content.md`: "changing them needs a restore first"; `rights.md`: "Rows on deleted
  folders are left out"). This is a deliberate rule, and the effect is a short window after a restore, before a right is
  removed. Fix: leave it and name the window. Alternatives: let the admin list and delete these rights, which changes
  both rules; or a restore option that drops all rights. **Decision**.
- **Control characters in content** (`limits.md`: "U+0001 becomes `\u0001` and `SafeText` allows it"). ANSI escapes and
  invisible characters can be stored. Fix: keep the current verbatim rule, and tell clients to filter on display.
  Alternative: reject C0 and C1 controls, which means rewriting the sizing reason in `limits.md` and its test case. Do
  not reject tag characters, because flag emoji need them. **Decision**.
- **What must not be logged** (`architecture.md`: "log who changed what"; `oauth-server.md`: "Logs never hold a
  password, token, code or secret"). The rule covers login data only. Fix: logs also never hold `content_md`; set
  `hide_parameters=True`; the Connector Test App escapes the values it logs.
- **Tool annotations** (`mcp.md`: "`readOnlyHint` on the list and get tools and `destructiveHint` on the delete
  tools."). In the MCP schema, `destructiveHint` and `openWorldHint` default to true, so other write tools count as
  destructive by default. Fix: give each tool explicit values, and say they are hints only.

### REST and Checks

- **Not-live item with a low right** (`request-checks.md`, Deleted Items: "gets the same 404 as a missing item, for
  every operation except the deleted list, restore and history"; `history-revisions.md`: the revert row is labelled
  "Target lookup", which comes after Required right). The text mostly points to 404. Fix: reword the labels, and add a
  case with a `read` user on a deleted item.
- **Revert result** (`rest.md`: "Everything else answers 200 with the item."). The summary rules do not name revert, and
  their reason, "because the client just sent it", does not apply. Fix: add revert to the summary rule. Alternative:
  return the full md_document, which saves a read but makes an exception and a large response.
- **Integer ranges** (`database.md`: `version` is `integer`; `limits.md` has no range). A value above int32 in a path,
  `target_version`, `target_number` or a cursor reaches asyncpg and becomes a 500. Fix: a shared bounded type in
  `schemas/`, a row in `limits.md` and test cases. Also add missing revisions and history entries to the Target lookup
  row. Alternative: treat out-of-range as missing and answer 404, which does not cover cursors.
- **Invalid `access_right`** (`database.md`: "A check constraint limits `access_right`"). No check row covers it. Fix: a
  row in `users.md` making it schema validation, and word the `Literal` as an exception to the `SafeText` rule.
- **Unknown query parameters** (`request-checks.md`: "unknown fields: request models forbid them"). `?tabid=...`
  silently returns all tabs, while MCP rejects unknown arguments. Fix: 422 through a query model. A body on a route with
  no body model needs its own choice, and ignoring it is simplest. **Decision**, a small one.
- **MCP errors outside tools** (`request-checks.md`: "HTTP 421 or 403"). Statuses are defined and bodies come from the
  SDK. Fix: say so in `errors.md`, and say an unexpected tool error carries `internal_error`.
- **Restoring a live folder** (`request-checks.md`: "so a 404 means it really does not exist or is deleted"). This is
  false for a restore of a live folder, per `content.md`. Fix: add the exception.
- **Trailing newline in names** (`content.md`: "`^[a-z0-9]+(-[a-z0-9]+)*$`"). Running it confirmed that `re.match`
  accepts `admin\n`, which also passes the `is_admin` check constraint. Names are validated in services, so Pydantic's
  engine does not help. Fix: say full match, and add `a\n` and `admin\n` to Name Cases.
- **OpenAPI security scheme** (`authentication.md`: "the OpenAPI security scheme is declared separately"). No type is
  named. Fix: `http` bearer without `bearerFormat`, because the tokens are opaque, which needs no settings.
- **History items hide deleted state** (`rest.md`, History item). A `folder_revert` entry has one `kind` for every item,
  and tabs have no revision route, so nobody can read what a revert did to a tab. Fix: add `is_deleted` and
  `previous_is_deleted`. Alternative: a tab revision route, which is more surface.
- **"The deleted rows"** (`request-checks.md`: "resolves its ID among the deleted rows too"). The row of a md_document
  in a deleted tab has `deleted_at` null, so this does not cover it, although `rights.md` allows the read. Fix: say "all
  rows", and add a test.

### Data Model and Concurrency

- **Folder state after the lock** (`history-revisions.md`: "A write runs in this order, after the visibility and right
  checks"; `content.md` covers only "a tab that is being deleted at the same time"). Writes to existing items already
  get 404, so the gaps are tab create and folder revert racing a folder delete. A right revoked while waiting is a
  similar race. Fix: filter the lock on `deleted_at IS NULL`, except for a folder restore, and add tests. Accept the
  right race in `architecture.md`. Alternative: re-read the right after the lock, at one more query per write.
  **Decision** for the right race.
- **Isolation and stale reads** (`architecture.md`: "One unit of work, over one DB session and transaction, runs per
  public service method"). Reads before and after the lock share one identity map, so a re-read keeps the old `version`,
  the compare passes, and the revision hits the primary key: a 500 and not a 409. No data is lost, and the existing race
  tests should catch it. Fix: state READ COMMITTED, and in `implementation-notes.md` use `populate_existing()` or plain
  column reads, and increment counters in SQL. Alternative: a separate session for the checks, which breaks the unit of
  work rule.
- **Indexes and lists** (`database.md`: "A partial index on `(tab_id, name, id) WHERE deleted_at IS NOT NULL` supports
  the deleted list"). Lists across a folder are ordered by name, and `md_documents` has no `folder_id` to lead an index,
  so each page sorts all rows of the folder. This affects performance only. Fix: correct the claim and accept it for
  now. Alternative: add `folder_id` to `md_documents`, with a composite foreign key that also lets the database reject
  moves across folders. **Decision**, now or when folders grow.
- **"(service)" glossary entry** (`README.md`: "marks a rule that table constraints can not express"; `database.md`:
  "`NOT is_default OR deleted_at IS NULL` enforces that the default tab is never deleted"). Fix: reword it to say the
  service enforces it, because constraints can not express it or would give the wrong error.

### Structure and Plan

- **Composition wiring** (`package-layout.md`: "may import anything, and nothing imports them"; `limits.md`: "`app.py`
  holds the value as `MAX_REQUEST_BODY_BYTES`"). `connector_test_app.py` needs the value in step 1, and the wiring gets
  copied. Fix: one assembly function with a named exception, and the constants in a neutral module. Alternative: accept
  the copy until step 6, since the code is temporary, though the Connector Test then exercises a copy.
- **`create_app()` signature** (`package-layout.md`: "create_app(unit-of-work factory, credential check, client document
  source, public URL)"). The allowed hosts and origins and the trusted client URLs have no stated way in, and reading
  them inside makes fake-based tests depend on the environment. Fix: write the signature with a settings parameter.
- **Settings list** (`architecture.md`: "(`HIPPOWIKI_DATABASE_URL`, …)"). There is no complete list, and the settings
  are named across several documents. Fix: one table of settings, with a separate group for the test app.
- **Open risks outside the roadmap** (`configuration-and-failure-modes.md`: "open items of the specification stay in the
  [Roadmap](../spec/roadmap.md)"). Four risks are in neither place's plan: rollbacks, the connection pool, compose
  providers and upgrades. Fix: move them to the roadmap, and settle pool pre-ping now in `implementation-notes.md`.
- **Connector test data** (`roadmap.md`: "a right on it for the normal user and the user of the script client"). The
  level is unnamed, and other details are open, for throwaway code with one implementer. Fix: give one example JSON with
  `write`.
- **Container command** (guide: `cmd = [ "uvicorn" "--factory"`). An `ENTRYPOINT` in the `Containerfile` would break it.
  Fix: state in `deployment.md` that there is no `ENTRYPOINT` and `uvicorn` is on the `PATH`.
- **Sort order claim** (`configuration-and-failure-modes.md`: "which affects anything sorted by name";
  `implementation-notes.md`: "It also does not depend on the image"). All name columns use `COLLATE "C"`, so the first
  sentence is wrong. Fix: correct it, and also the reason in `deployment.md`.
- **After the Connector Test** (`roadmap.md`: "and this section is removed"; `testing.md`: "The real clients are covered
  by the"). Real clients only ever see a few tools and the stand-ins, and 21 links point to that section. Fix: end step
  9 with a repeat of the client checks, and keep a short procedure.
- **Duplicated values** (`README.md`: "Each topic has one home"). The rights in `rest.md` restate `rights.md`, and
  external values are copied, with no drift found so far. Fix: a test that compares routes with the rights matrix, and
  let the guide link to values outside runnable code.

### Outside Facts

- **`eager_defaults`** (`implementation-notes.md`: "reading one after UPDATE, such as `deleted_at = now()` or the
  incremented `revision_counter`"). [SQLAlchemy](https://docs.sqlalchemy.org/en/21/orm/persistence_techniques.html)
  expires an attribute assigned a SQL expression, so the setting does not prevent the implicit IO. The failure would be
  loud in the first integration test. Fix: correct the note and use Core `update(...).returning(...)`, which fits
  repositories that return dataclasses. Alternatives: `server_onupdate=FetchedValue()` on each column, or
  `await session.refresh(row)`.
- **Anthropic's IP ranges** (`deployment.md`: "including Anthropic's range `160.79.104.0/21`", and the guide copies it).
  A [second range](https://platform.claude.com/docs/en/api/ip-addresses), `153.61.208.0/20`, exists. Fix: link the page
  instead of copying a value.
- **Traefik version** (`tech-stack.md`: "tested with 3.7.17"). The `nixos-26.05` package is at 3.7.16, which a
  [High denial-of-service advisory](https://github.com/traefik/traefik/security/advisories/GHSA-xv5x-242w-7hf7) covers.
  This is worth acting on, for availability. Fix: add `traefik version` to the guide's checks, and update or override
  the package.
- **MCP wording** (`oauth-server.md`: "the MCP specification deprecates it", with its sources on the draft pages).
  [Revision 2026-07-28](https://modelcontextprotocol.io/specification/versioning) is current. Fix: check the rules
  against that revision and cite it, or say why the draft is used.
- **Sampling and elicitation reason** (`mcp.md`: "Tools can not send requests to the client, so there is no sampling or
  elicitation."). [Revision 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog.md) removes
  sessions and changes this. The tools-only decision stands. Fix: limit the reason to earlier revisions, and check how
  the SDK behaves.
- **Podman compose wait** (`configuration-and-failure-modes.md`: "how they support waiting for the `migrate` service to
  finish."). [An issue](https://github.com/containers/podman-compose/issues/1330) showed it could pass early, and the
  fix came after the latest release checked. Fix: keep the risk open, and update its text.
- **`BaseHTTPMiddleware` reason** (`configuration-and-failure-modes.md`: "Using `BaseHTTPMiddleware` would break MCP
  streaming"). [Starlette](https://starlette.dev/middleware/) documents only a contextvars limit, and a reported break
  [could not be reproduced](https://github.com/modelcontextprotocol/python-sdk/issues/2702). Fix: keep pure ASGI and
  change the reason, for example the body replay in `limits.md`.

## Experiments

Most open questions about real clients are checks of the [Connector Test](../spec/roadmap.md#connector-test).
Documentation could not settle these others:

- **`eager_defaults`:** a `podman` test that assigns `func.now()` in an `AsyncSession`, flushes and reads. Expect
  `MissingGreenlet`.
- **Stale reads:** run the existing race test against the first repository code. Expect a 500 unless the re-read is
  fixed.
- **Traefik:** run `traefik version` on the host.
- **Podman compose:** test the wait for `migrate` with the version in use.
- **`BaseHTTPMiddleware`:** run one streaming transport test with a wrapper, if you want the reason settled.

## Cut Candidates

The factual basis of each was checked, but whether to cut is your call. The first three need no product decision and I
would take them. The others are product decisions.

- **Time input rules:** no request field or tool argument takes a time, and the only list filter is `tab_id`, so the 422
  cases in Time Cases can only run at type level. Cutting saves the strict parser and its pin tests, and possibly
  PyYAML, which only `tests/test_time_libraries.py` uses. Nothing is lost today.
- **Detail out of proportion:** the AppArmor and Ubuntu bug text in `testing.md`, and the SDK line numbers in
  `implementation-notes.md`, which go stale on an upgrade. Test names would serve better.
- **Components section** of `configuration-and-failure-modes.md`: it mostly restates other documents. Keep "Values That
  Must Match" and the risks. A per-component checklist is lost.
- **Root form of the protected resource metadata:** the 401 already names the path form, so this saves one public route.
  Check first whether MCP clients fall back to the root form when the header is absent.
- **Full rights matrix on MCP:** run one allowed and one denied call per tool instead, plus the mapping of each domain
  error. This saves most of a second copy of the matrix, but a tool calling the wrong method in an unusual cell goes
  unnoticed.
- **Folder revert:** no goal names revert, only "Full **revision history**". This is the largest saving: the route, the
  `folder_revert` kind, name swap handling and about six hard test cases. One-step undo of an agent's bulk damage is
  lost, but revisions keep recording, so it can be added later.
- **Tabs beyond the default tab:** `goals.md` gives no reason for them. This saves seven routes, seven of 18 tools, and
  the rules for items hidden through a deleted tab. Keep the table and `tab_id`, so adding tabs later needs no data
  migration. Grouping inside a folder is lost.
- **Fakes and the contract suite:** only if the rule that `make test` needs no Podman changes, which I would not do.

## Values to Check

These values were chosen while resolving review findings, and you may want to check them:

- The `detail` texts in `errors.md`.
- The `postgresql+asyncpg://` format of `HIPPOWIKI_DATABASE_URL` in the guide.

## How the Findings Were Checked

The [Spec Findings](#spec-findings), [Experiments](#experiments) and [Cut Candidates](#cut-candidates) come from a
review of `spec/`, the NixOS guide, `README.md` and `CLAUDE.md` on 2026-11-03. All 8 major findings and 10 of its 58
minor findings were resolved in the specification. The change to a built-in OAuth server then removed 11 more minor
findings. The [OAuth Server](../spec/oauth-server.md) was reviewed separately, and what that left open is in the OAuth
sections above.

The core design held up: existence leaks, lock order, history numbering and the rights tables were all tested and found
sound.

- A script checked all internal links and anchors, the document indexes, term variants and numbers with units. It found
  no broken links and no conflicting values.
- Six reviewers each read the whole spec from one angle: operation and state matrices, a simulated implementer of
  roadmap steps 1 and 5, state and concurrency, security, outside facts, and traceability and scope.
- Their overlapping findings were merged into 69 candidates. Two skeptics then tried to disprove each one against the
  text and primary sources, and many severities went down in that pass.

Removed or corrected in that pass:

- **Refuted:** first `PUT` of a right being 200 or 201. The operation is always called assign, and "Everything else
  answers 200 with the item" settles it.
- **Refuted:** podman-compose settling the wait for `migrate`, so that risk stays open.
- **Dropped:** a missing test for restoring a tab with an earlier deleted item, because `testing.md` already requires a
  test for every rule.
- **Corrected:** rejecting Unicode tag characters would break valid flag emoji, so that fix is no longer recommended.

Limits of this round:

- Nothing was run against a real system. Claims about SQLAlchemy, asyncpg and Starlette come from documentation and
  source reading.
- `help.openai.com` could not be read, so ChatGPT claims rest on OpenAI's developer guide and on third-party documents.
- [Experiments](#experiments) lists what documentation could not settle.

A clean review can not replace running code. The major findings are settled, so the Connector Test and the first feature
will show more than another round of review.
