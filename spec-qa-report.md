# Spec QA Report

Date: 2026-11-03. Scope: `spec/`, `doc/nixos-keycloak-setup.md` (called "the guide" below), `README.md` and `CLAUDE.md`.
This report is the only file this round created. Nothing in the spec was changed.

## Summary

There are no blockers. The core design held up: existence leaks, lock order, history numbering, the rights tables and
the fixed-client login were all tested and found sound. There are 8 major and 58 minor findings.

The major findings cluster around three things:

- **Signing keys:** cached keys never expire, and one case in the refetch limit has two possible answers.
- **Login and tokens:** no person can get a REST token today, and a token issued for an AI product carries full REST
  rights.
- **The plan:** step 5 can not be built as written, and production has no defined deployment.

The other two are a data conflict in folder revert and undefined error bodies.

### Decisions Only You Can Make

- How a person gets a REST token, see [No person can get a REST token](#no-person-can-get-a-rest-token).
- Whether tokens get bound to a client, see
  [A token issued for an AI product carries full REST rights](#a-token-issued-for-an-ai-product-carries-full-rest-rights).
- What production runs on, see [Production has no defined deployment](#production-has-no-defined-deployment).
- Smaller ones, marked **Decision** in the list of minor findings, and the [cut candidates](#cut-candidates).

### What to Settle Before Roadmap Step 1

Step 1 writes the token check, the middleware and the MCP tools, so these change code that is about to be written:

- Both signing key findings.
- The token check details and the `resource_metadata` value.
- Public route matching and trailing slashes.
- The error bodies, because the tool error text comes with them.
- The stale ChatGPT and Claude notes in the Connector Test, and whether its fallback plan is complete.

The rest can wait for the step that touches it, or for the implementation to show whether it matters.

## How This Was Checked

- A script checked all internal links and anchors, the document indexes, term variants and numbers with units. It found
  no broken links and no conflicting values.
- Six reviewers each read the whole spec from one angle: operation and state matrices, a simulated implementer of
  roadmap steps 1 and 5, state and concurrency, security, outside facts, and traceability and scope.
- Their overlapping findings were merged into 69 candidates. Two skeptics then tried to disprove each one against the
  text and primary sources, and many severities went down in that pass.

Removed or corrected in that pass:

- **Refuted:** first `PUT` of a right being 200 or 201. The operation is always called assign, and "Everything else
  answers 200 with the item" settles it.
- **Refuted:** a conflict between logging `azp` and `tokens.py` returning the subject. `connector_test_app.py` may
  import anything and can read those values itself.
- **Refuted:** podman-compose settling the wait for `migrate`, so that risk stays open.
- **Dropped:** a missing test for restoring a tab with an earlier deleted item, because `testing.md` already requires a
  test for every rule.
- **Corrected:** rejecting Unicode tag characters would break valid flag emoji, so that fix is no longer recommended.
- **Corrected:** the guide runs PostgreSQL and Keycloak as containers, not natively. Only Traefik is native.

Limits of this round:

- Nothing was run against a real system. Claims about SQLAlchemy, asyncpg and Starlette come from documentation and
  source reading.
- `help.openai.com` could not be read, so ChatGPT claims rest on OpenAI's developer guide and on third-party documents.
- [Experiments](#experiments) lists what documentation could not settle.

## Major Findings

### Cached signing keys never expire

**Where:** `authentication.md`, Token Check: "Signing keys are cached in memory", "An unknown `kid` causes one refetch"
and "A cached key keeps working while Keycloak is down". Nothing states a maximum age or that a refetch replaces the
set.

**Problem:** A refetch happens only for an unknown `kid`, so a known key is never dropped. An operator removes a
compromised key in Keycloak, and tokens signed with it keep passing on the running app until someone restarts it.
Nothing tells the operator to restart.

**Recommended fix:** In `authentication.md`, a successful fetch replaces the whole set, and the set is refreshed once it
is older than a fixed age, such as 10 minutes. A failed refresh keeps the old set, which preserves the "keeps working"
rule. Add the case to `test-cases.md`.

**Alternatives:** Keep no expiry and document "restart the app after removing a key" in
`configuration-and-failure-modes.md`. This needs no code, but relies on an operator remembering it during an incident.

### An unknown key inside the refetch limit has two possible answers

**Where:** `authentication.md`, Token Check: "A key that is still unknown after the refetch gets 401" and "When a needed
key can not be fetched, the lookup failed". `test-cases.md`: "further unknown `kid`s within the rate limit cause no
further fetch", with no result stated. No document gives the interval a value. `time.md` only uses
`jwks_refetch_interval_seconds` as a naming example.

**Problem:** Inside the window no fetch happens, so neither rule applies.

- The app starts with an empty cache before Keycloak is up. The first request gets 503. A retry inside the window can
  get 401, so a client discards valid credentials, which Failed Credential Lookup forbids: "it is never a 401".
- A junk `kid` can use up the slot just after a key rotation, so valid tokens with the new key get 401 until the window
  ends.

**Recommended fix:** In `authentication.md`, with the value in `limits.md`:

- Use a fixed interval, such as 30 seconds, and allow one fetch at a time. A failed fetch counts against the limit.
- Inside the window, the answer is 503 if the last fetch failed and 401 if it succeeded.
- Add both cases to `test-cases.md`.

**Alternatives:**

- Answer 503 for every unknown `kid` inside the window. A valid credential is never discarded, but junk tokens get 503
  and clients retry them.
- Skip the limit while the cache is empty. This recovers faster at startup, but protects a struggling Keycloak less.

### A token issued for an AI product carries full REST rights

**Where:** `authentication.md`, Token Check: "Only `sub` is used". `connectors.md`: "One audience covers both MCP and
REST". `test-cases.md`: "The same admin token works on REST."

**Problem:** This is a deliberate design, but its consequence is not stated. No client asks for consent, so a browser
holding the admin's Keycloak session can complete a connector login with no screen. MCP then answers 403, the person
fixes the setup and moves on, and the refresh token stays at the vendor or on disk, valid for every admin operation on
REST. The same silent login can bind `alice` instead of the intended `alice-claude`. The silent login is inferred from
Keycloak's defaults and was not tested.

**Recommended fix:** Turn on "Consent required" on the product clients in the guide, and add a check of it to the
Connector Test. This conflicts with no rule and is the cheapest step. State the remaining risk in `connectors.md`.

**Alternatives:**

| Option                              | Gain                                | Cost                                                                               |
| ----------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| Allowlists on `azp`                 | Strongest: a client can be refused  | Reverses "Only `sub` is used", and `tokens.py` has to return more than the subject |
| Audience scope per client           | Stops future clients getting access | Replaces the default client scope, and does not solve the admin case               |
| Separate audiences for MCP and REST | Cleanest split                      | Conflicts with the single `HIPPOWIKI_OAUTH_AUDIENCE` and the shared-token rule     |
| Keycloak flow override per client   | The token is never issued           | Console configuration that `make test` can not cover, and it needs a realm role    |

**Decision needed:** yes.

### No person can get a REST token

**Where:** `goals.md`: "It is the only way to administer the system." `connectors.md`: "Each script gets its own
Keycloak client with a service account". The guide: "The HippoWiki admin account also goes in this realm".

**Problem:** The guide makes the admin a person with a password, but no client can give that person a token for REST.
Product clients redirect into the products, and MCP rejects the admin. Script clients have "Standard flow" off, and
their token carries the service account's `sub`, which gets 401. So after setup the operator can not call `POST /users`
or `POST /folders`, and roadmap step 5 needs exactly that call. A person with `manage` has the same problem, because
history and revert are REST only.

**Recommended fix:** Define one client for people, such as `hippowiki-cli`, using device flow or authorization code with
a localhost callback. Describe it in `connectors.md`, add it to the guide, and add a row to the Connector Test.

**Alternatives:**

- Link the admin to a service account of a `hippowiki-admin` client. `hippowiki link-admin` already takes any subject,
  so this needs no new client type. But the admin is then no person, the guide and `users.md` change, and history and
  revert for people stay unsolved.
- Direct access grants on one client. This is the simplest, but it is the password grant, which OAuth 2.1 removes.

**Decision needed:** yes.

### Folder revert of an item deleted at both points conflicts with the write rule

**Where:** `history-revisions.md`, Folder Revert: "return to their state at that number" and "stays deleted, or is
deleted again". `content.md`: "writes use `WHERE deleted_at IS NULL`" and "a statement that changes no row gets
`NotFoundError`".

**Problem:** An item can differ between the target and now while being deleted at both. At number 10 it is deleted with
name `a`. Then it is restored, renamed `b` and deleted again. A revert to 10 has three readings:

- Skip it. A later restore shows `b`, so the state at the revert's number is not the state at 10.
- Write `a` with a revision. This matches "state at that number".
- Follow `content.md` literally. The write changes no row, and the whole revert rolls back as a 404.

**Recommended fix:** In `history-revisions.md`, say the item still gets the name, content and tab of the target, with a
revision, and stays deleted. In `content.md`, limit the `WHERE` rule to normal operations, since a folder revert writes
rows by ID in any deleted state. Add the sequence to `test-cases.md`.

Also in `content.md`, reword the sentence "gets `VersionConflictError` and not this `NotFoundError`". It reads as if a
stale update on a deleted row could get 409, while `test-cases.md` says it gets 404, and under the lock the `WHERE` can
never fire for an update. Say a deleted item gets 404 when it is read after the lock, and that the `WHERE` is a
safeguard.

**Alternatives:** Treat deleted-to-deleted as unchanged. The revert is smaller and writes less, but such items then no
longer match the target, and a later restore shows content from after the target.

### Error bodies are undefined apart from `type` and `code`

**Where:** `errors.md`: "`type` stays `about:blank`. Every body has a `code` extension". `implementation-notes.md`:
"FastAPI's default 422 body has to be replaced", with nothing saying what replaces it. `mcp.md`: "the field and reason
only". `errors.md` says a tool error's message starts with the code, and gives no separator or remainder.

**Problem:** This is the public contract for every REST client on every error. One implementer returns only `detail`,
another an `errors` array, and a third keeps FastAPI's shape, which echoes the input and so can return a rejected
`content_md`. Tests that compare the full 404 body also need a fixed text to compare against.

**Recommended fix:** In `errors.md`:

- `title` is the HTTP reason phrase, and `status` is always present.
- `detail` is a fixed text per `code`, with one `not_found` text for all entities.
- A 422 adds `errors: [{"field", "reason"}]`, with no input values, which matches MCP.
- A tool error is `<code>: <detail>`, with the same field and reason for validation errors.

**Alternatives:** `detail` as one formatted string. This is simpler, but clients have to parse it to show which field
failed.

### Step 5 can not be built as written

**Where:** `roadmap.md`, step 5: "the models and migration, repositories, fakes and contract tests, services, routes,
tool, `create_app()` and `create_production_app()`". Step 6: "the remaining models", and `hippowiki migrate`. Step 7:
`hippowiki init`, `hippowiki link-admin` and "The real services replace the stand-ins". `architecture.md`: "It builds
the services once and passes them to both adapters".

**Problem:** Step 5 needs things it does not list, or that only later steps build:

- **Tables:** creating a folder also writes `tabs`, `folder_history_entries` and `folder_revisions`, and users and
  rights need `users` and `folder_rights`.
- **People:** `POST /users` and `PUT` of rights come in step 8, so nothing says how "a user with a right" exists.
- **Running it:** `create_production_app()` can not run without `migrate`, `init` and `link-admin`, and it also needs
  `auth/credentials.py`, which is not listed.
- **MCP tools:** the five tools from step 1 have no real services until step 7, and the stand-ins live in a module
  nothing may import. So `create_app()` either fails strict mypy, advertises tools that always fail, or differs from the
  Connector Test App.
- **Proof:** no test kind runs `create_production_app()`, so "shows early that the layers fit together" has no test
  behind it.

**Recommended fix:** In `roadmap.md`, step 5, and `testing.md`:

- List the six tables and `auth/credentials.py`. Move `migrate`, `init` and `link-admin` into step 5.
- State that the user and right are seeded through repositories.
- The MCP factory takes one Protocol-typed argument per service group and registers only the tools of the groups it is
  given, so step 5 registers `get_folder`. Step 7 makes all groups required. This also goes in `package-layout.md`.
- Add one `podman` test through the real factory, the real repositories and a stubbed key source.

**Alternatives:**

- Drop `create_production_app()` from step 5. The step is smaller, but the real wiring is shown only later.
- Build the real services of the five tools in step 5. No temporary wiring is needed, but it stops being a small first
  feature.

### Production has no defined deployment

**Where:** The guide: "the container is replaced by the complete deployment" and "HippoWiki's database goes on the same
server later". `roadmap.md`, step 9: "the complete `compose.yaml`". `deployment.md` scopes compose to "development and
simple self-hosting".

**Problem:** The Connector Test host runs PostgreSQL and Keycloak as NixOS containers, with Traefik native. Running
`compose.yaml` there starts a second PostgreSQL and Keycloak, and a new realm means new `sub` values. If the host's
services stay instead, no step covers creating the HippoWiki database and role, a `migrate` unit or the app module, and
the guide's database init script no longer runs: "Runs only when the PostgreSQL data volume is first created."
`HIPPOWIKI_DATABASE_URL` is also missing from the guide's "What HippoWiki Needs".

**Recommended fix:** Name the NixOS host as production in `deployment.md`, keep compose for development and simple
self-hosting, and add the app module and database setup to the guide and to step 9. This builds on what was already
tested.

**Alternatives:** Compose everywhere. This gives one path to maintain, but discards the tested guide and needs a
migration of the realm.

**Decision needed:** yes.

## Minor Findings

### Token Check and Public Routes

- **Required claims and clock tolerance** (`authentication.md`, Token Check: "The token has not expired"). PyJWT checks
  `exp` only if present, and rejects a future `iat`, so a small clock difference can reject fresh tokens. Fix: require
  `exp`, give a fixed leeway, and add cases for a missing `exp` and a future `iat`. Passing an issuer already rejects a
  missing `iss`, and the spec already requires `sub`.
- **The `resource_metadata` value** (`errors.md`: `WWW-Authenticate: Bearer resource_metadata="..."`). The value is
  never defined, and `authentication.md` names two forms. Fix: use the path form, derived from the audience, so no new
  setting is needed. Either form is allowed, because RFC 9728 section 5 and MCP accept a root pointer.
- **Public route methods** (`authentication.md`: "A public route matches on the exact path"; `test-cases.md`: "An
  unauthenticated request to an unknown route or with a wrong method gets 401."). An unauthenticated `POST /health` gets
  405 by one rule and 401 by the other, and may also buffer up to 2 MiB, depending on how `limits.md` is read. Fix:
  match path and method, and never buffer on a public route. Alternative: answer 405 and adjust the test case.
- **Trailing slashes** (`request-checks.md`: "an unknown route (404)"). Starlette's default answers `/api/v1/folders/`
  with a 307, whose `Location` is likely `http://` behind the proxy. The existing `/mcp/` test still passes with the
  redirect, so it does not catch this. Fix: `redirect_slashes=False` in `implementation-notes.md`, plus a test case.

### Security and Operations

- **Stored content is untrusted** (`connectors.md`: "An AI agent acts as the account it logged in with."). Nothing tells
  clients that tool results are data written by other users, and a person with `write` can store instructions for
  another user's agent. Fix: a short section in `mcp.md` and a line in the server instructions, plus advice for
  connector accounts to hold the smallest rights. Alternatives: a last editor field, which needs a read of the latest
  entry because no table stores it; a rights ceiling per client or scoped tokens, which reverse "There are no tokens
  with fewer rights than their user". **Decision** for those two.
- **Backups are secrets** (guide: `pg_dump -U postgres -Fc keycloak > "keycloak-$(date +%F).dump"`). The Keycloak dump
  probably holds signing keys and client secrets, and the spec has no rule for it. Copies off the host are the real
  risk. Fix: in `deployment.md`, backups are encrypted and root-only, and a leak means rotating realm keys and client
  secrets.
- **Exposed master realm** (`deployment.md`: "It exposes Keycloak's login paths (`/realms/` and `/resources/`) and
  `/.well-known/`"). The guide excludes `/realms/master`, the spec does not, and Keycloak's proxy guide marks it
  internal. Fix: state an allowlist for the `hippowiki` realm that keeps every discovery form MCP clients try.
- **Compose ports** (`deployment.md`, Containers and Compose). No rule on published ports, although the guide warns they
  bypass the firewall, and Traefik is not in the compose list. Fix: `postgres` publishes nothing, and `app` and
  `keycloak` bind to `127.0.0.1`. Alternative: put Traefik in the compose file. **Decision** for that alternative.
- **Stolen connector logins** (`users.md`: "the link and the rights stay, and apply again after reactivation").
  Reactivating revives a stolen refresh token. Fix: a short procedure in `users.md` to sign out the user and revoke
  offline sessions, and rotate a service account's secret. Alternatives: comparing `auth_time`, or having the app call
  the Keycloak admin API, which are automatic but heavier. **Decision** for those two.
- **Trust in the Keycloak admin** (`authentication.md`: "It administers Keycloak and has no rights in HippoWiki.").
  `users.md` already admits the HippoWiki admin is no security boundary, but the Keycloak side is not stated, and the
  guide saves only user events. Fix: state the trust and turn on admin events. Alternative: an audit table, which
  reverses "changes to folder rights are not tracked". **Decision** for that alternative.
- **Admin login strength** (guide, Realm Setup). The all-powerful admin has a password only on a public login. Fix: OTP
  for the admin and a password policy. Direct access grants default to off in the 26.8.1 UI, so listing them is
  optional.
- **Rights on deleted folders** (`content.md`: "changing them needs a restore first"; `rights.md`: "Rows on deleted
  folders are left out"). This is a deliberate rule, and the effect is a short window after a restore, before a right is
  removed. Fix: leave it and name the window. Alternatives: let the admin list and delete these rights, which changes
  both rules; or a restore option that drops all rights. **Decision**.
- **Control characters in content** (`limits.md`: "U+0001 becomes `\u0001` and `SafeText` allows it"). ANSI escapes and
  invisible characters can be stored. Fix: keep the current verbatim rule, and tell clients to filter on display.
  Alternative: reject C0 and C1 controls, which means rewriting the sizing reason in `limits.md` and its test case. Do
  not reject tag characters, because flag emoji need them. **Decision**.
- **What must not be logged** (`architecture.md`: "log who changed what"; `roadmap.md`: "the `azp` and `scope` of the
  token"). No rule exists, and the Connector Test App runs before logging is added in step 4. Fix: logs never hold
  tokens, secrets or `content_md`; set `hide_parameters=True`; the test app escapes its values and logs token claims
  only after verification.
- **Tool annotations** (`mcp.md`: "`readOnlyHint` on the list and get tools and `destructiveHint` on the delete
  tools."). In the MCP schema, `destructiveHint` and `openWorldHint` default to true, so other write tools count as
  destructive by default. Fix: give each tool explicit values, and say they are hints only.
- **Rendering content** (`roadmap.md`: "Browser clients: same origin only for now"). Nothing says `content_md` is unsafe
  to render. Fix: one line in that roadmap item. There is no web UI today.

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
- **Name and subject both taken** (`request-checks.md`: "the first one that fails decides the response"). One INSERT
  raises one violation, chosen by index creation order. Fix: state that either 409 may result, and fix the order in the
  fakes. Pinning the index order is fragile.
- **`auth_subject` wording** (`rest.md`: "where `null` removes the link and leaving it out changes nothing"). Behaviour
  is settled elsewhere. Fix: limit the sentence to `PATCH /users/{id}`, and drop the last clause.
- **Restoring a live folder** (`request-checks.md`: "so a 404 means it really does not exist or is deleted"). This is
  false for a restore of a live folder, per `content.md`. Fix: add the exception.
- **Trailing newline in names** (`content.md`: "`^[a-z0-9]+(-[a-z0-9]+)*$`"). Running it confirmed that `re.match`
  accepts `admin\n`, which also passes the `is_admin` check constraint. Names are validated in services, so Pydantic's
  engine does not help. Fix: say full match, and add `a\n` and `admin\n` to Name Cases.
- **OpenAPI security scheme** (`authentication.md`: "the OpenAPI security scheme is declared separately"). No type is
  named. Fix: `http` bearer with `bearerFormat: JWT`, which needs no settings.
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
  the copy until step 7, since the code is temporary, though the Connector Test then exercises a copy.
- **`create_app()` signature** (`package-layout.md`: "create_app(unit-of-work factory, credential check)"). Issuer,
  audience, hosts and origins have no stated way in, and reading them inside makes fake-based tests depend on the
  environment. Fix: write the signature with a settings parameter.
- **Settings list** (`architecture.md`: "(`HIPPOWIKI_DATABASE_URL`, …)"). There is no complete list, and a required
  database URL on one settings class would stop the repeatable Connector Test container. Fix: one table of settings, and
  a separate group for the test app. Alternative: make the URL optional and check it at production startup.
- **Open risks outside the roadmap** (`configuration-and-failure-modes.md`: "open items of the specification stay in the
  [Roadmap](roadmap.md)"). Six risks are in neither place's plan: realm recreation, clock differences, rollbacks, the
  connection pool, compose providers and upgrades. Fix: move them to the roadmap, and settle pool pre-ping now in
  `implementation-notes.md`.
- **Connector test data** (`roadmap.md`: "a right on it for the linked user and the service account"). The level is
  unnamed, and other details are open, for throwaway code with one implementer. Fix: give one example JSON with `write`.
- **Container command** (guide: `cmd = [ "uvicorn" "--factory"`). An `ENTRYPOINT` in the `Containerfile` would break it.
  Fix: state in `deployment.md` that there is no `ENTRYPOINT` and `uvicorn` is on the `PATH`.
- **Sort order claim** (`configuration-and-failure-modes.md`: "which affects anything sorted by name";
  `implementation-notes.md`: "It also does not depend on the image"). All name columns use `COLLATE "C"`, so the first
  sentence is wrong. Fix: correct it, and also the reason in `deployment.md`.
- **After the Connector Test** (`roadmap.md`: "and this section is removed"; `testing.md`: "The real Keycloak is covered
  by the"). Real clients only ever see 5 tools and stand-ins, 23 links point to that section, and removing
  `connector-test.nix` is not listed. Fix: end step 9 with a repeat of the client checks, keep a short procedure, and
  list the removals in step 7.
- **Duplicated values** (`README.md`: "Each topic has one home"). The rights in `rest.md` restate `rights.md`, and
  external values are copied, with no drift found so far. Fix: a test that compares routes with the rights matrix, and
  let the guide link to values outside runnable code.

### Outside Facts

- **Realm export** (guide: "use "Action" and then "Partial export""; `roadmap.md`: "export the realm from the console").
  [Keycloak](https://www.keycloak.org/server/importExport) calls console exports unfit for moving between servers. Fix:
  use `kc.sh export --file <path> --realm hippowiki --users skip`, and strip secrets and keys before versioning the
  file, because `deployment.md` requires a file without secrets. Keycloak has to be stopped for this. Alternatives: keep
  the partial export and rely on the planned fresh-install test, or use a declarative tool, which adds a dependency.
- **Connector Test fallback** (`roadmap.md`: "turn on the Keycloak feature `resource-indicators`, and `cimd` for Claude
  and Claude Code only"). [The flags alone are not enough](https://www.keycloak.org/securing-apps/mcp-authz-server): the
  manual path needs a client with `resource_url` and an audience mapper, and CIMD needs a client profile and policy. An
  unconfigured `resource` gets `invalid_target`, which would make ChatGPT worse. Fix: list these steps in the roadmap
  and the guide.
- **`eager_defaults`** (`implementation-notes.md`: "reading one after UPDATE, such as `deleted_at = now()` or the
  incremented `revision_counter`"). [SQLAlchemy](https://docs.sqlalchemy.org/en/21/orm/persistence_techniques.html)
  expires an attribute assigned a SQL expression, so the setting does not prevent the implicit IO. The failure would be
  loud in the first integration test. Fix: correct the note and use Core `update(...).returning(...)`, which fits
  repositories that return dataclasses. Alternatives: `server_onupdate=FetchedValue()` on each column, or
  `await session.refresh(row)`.
- **Claude's early refresh** (`configuration-and-failure-modes.md`: "a retry or two parallel refreshes can log a
  connector out"). [Claude](https://claude.com/docs/connectors/building/authentication.md) refreshes up to five minutes
  before expiry, which equals the token lifetime here, and refresh reuse is 0. Whether this causes a logout is not
  verified. Fix: name the overlap in the existing Connector Test check. Alternatives: longer access tokens, reuse of 1,
  or rotation off. **Decision** if the test fails.
- **ChatGPT setup** (`roadmap.md`: "names a predefined OAuth client, but does not describe the dialog"). This is still
  true of [OpenAI's guide](https://developers.openai.com/api/docs/guides/custom-mcp-server.md), but
  [Zuora](https://docs.zuora.com/en/zuora-ai/zuora-mcp-server/zuora-mcp-server/configure-zuora-remote-mcp-server/configure-zuora-remote-mcp-clients/install-zuora-mcp-server-in-chatgpt)
  and [BoldSign](https://developers.boldsign.com/boldsign-mcp-server/chatgpt.md) describe the dialog. Fix: keep the
  check and add these as hints, including the choice of a user-defined OAuth client.
- **Anthropic's IP ranges** (`deployment.md`: "including Anthropic's range `160.79.104.0/21`"). A
  [second range](https://platform.claude.com/docs/en/api/ip-addresses), `153.61.208.0/20`, exists. Fix: link the page
  instead of copying a value.
- **Claude plans** (`roadmap.md`: "offers it on Pro and Max, and on Team plans only owners can add one."). The
  [current page](https://claude.com/docs/connectors/custom/add-unlisted.md) also covers Free, Ultra and Enterprise, and
  auth settings can not be edited, so replacing a secret means remove, re-add and reconnect. Fix: update the roadmap and
  `connectors.md`.
- **Claude Code secret** (`connectors.md`: "shows whether it needs a secret").
  [`--client-secret`](https://code.claude.com/docs/en/mcp) exists and a confidential client needs it, and the guide
  already uses it. Fix: update `connectors.md` and the roadmap. Alternative: a public client with PKCE, so no secret
  sits on laptops. **Decision**.
- **Anonymous registration** (guide: "do not enable `cimd`, `resource-indicators` or anonymous client registration").
  [It is a policy](https://www.keycloak.org/securing-apps/client-registration), not a feature flag. Fix: say "leave
  Trusted Hosts empty", and add a check that an anonymous registration is rejected.
- **Traefik version** (`tech-stack.md`: "tested with 3.7.17"). The `nixos-26.05` package is at 3.7.16, which a
  [High denial-of-service advisory](https://github.com/traefik/traefik/security/advisories/GHSA-xv5x-242w-7hf7) covers.
  This is worth acting on, for availability. Fix: add `traefik version` to the guide's checks, and update or override
  the package.
- **MCP wording** (`authentication.md`: "MCP draft specification"; `connectors.md`: "the MCP specification is
  deprecating it"). [Revision 2026-07-28](https://modelcontextprotocol.io/specification/versioning) is current, with the
  same `offline_access` rule. Fix: update the wording and links.
- **Sampling and elicitation reason** (`mcp.md`: "Tools can not send requests to the client, so there is no sampling or
  elicitation."). [Revision 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog.md) removes
  sessions and changes this. The tools-only decision stands. Fix: limit the reason to earlier revisions, and check how
  the SDK behaves.
- **Podman compose wait** (`configuration-and-failure-modes.md`: "how they support waiting for the `migrate` service to
  finish."). [An issue](https://github.com/containers/podman-compose/issues/1330) showed it could pass early, and the
  fix came after the latest release checked. Fix: keep the risk open, and update its text.
- **401 or 403 with no linked user** (`configuration-and-failure-modes.md`: "a valid token with no linked user, or of a
  deactivated user, gets 401").
  [MCP's table](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) permits 403, which could
  avoid the login loop. It conflicts with several rules and needs a third outcome from the credential check. Fix: record
  the option before the Connector Test, and try both. **Decision** after the test.
- **`BaseHTTPMiddleware` reason** (`configuration-and-failure-modes.md`: "Using `BaseHTTPMiddleware` would break MCP
  streaming"). [Starlette](https://starlette.dev/middleware/) documents only a contextvars limit, and a reported break
  [could not be reproduced](https://github.com/modelcontextprotocol/python-sdk/issues/2702). Fix: keep pure ASGI and
  change the reason, for example the body replay in `limits.md`.
- **Script clients** (guide: "with "Service accounts roles" on and "Standard flow" off."). Client authentication has to
  be on as well, and the UI enforces it, so nothing fails silently. Fix: add it to the guide.

## Experiments

Documentation could not settle these:

- **`eager_defaults`:** a `podman` test that assigns `func.now()` in an `AsyncSession`, flushes and reads. Expect
  `MissingGreenlet`.
- **Stale reads:** run the existing race test against the first repository code. Expect a 500 unless the re-read is
  fixed.
- **Silent login:** with a live admin session, add a connector and see whether Keycloak shows a screen, with and without
  "Consent required".
- **Claude refresh:** parallel tool calls over 30 minutes, reading refresh events in Keycloak.
- **`offline_access`:** read `scope` in the log for each client. For Claude Code, retry with `oauth.scopes` if it is
  missing.
- **CIMD audience:** on a scratch Keycloak with `cimd` on, log in with Claude Code and check whether the token's `aud`
  contains the MCP URL.
- **ChatGPT dialog:** confirm the fields in the UI, and whether a Business member needs an admin to publish.
- **401 or 403:** try both for an unlinked user during the Connector Test.
- **Trailing slash redirect:** check the `Location` scheme behind the proxy.
- **Traefik:** run `traefik version` on the host.
- **Keycloak dump and export:** confirm which keys and secrets a `pg_dump` and a `kc.sh export` contain, and which
  action ends offline sessions.
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
- **Root form of the protected resource metadata:** the 401 can name the path form directly. This saves one public
  route. Check first whether MCP clients fall back to the root form when the header is absent.
- **Full rights matrix on MCP:** run one allowed and one denied call per tool instead, plus the mapping of each domain
  error. This saves most of a second copy of the matrix, but a tool calling the wrong method in an unusual cell goes
  unnoticed.
- **Folder revert:** no goal names revert, only "Full **revision history**". This is the largest saving: the route, the
  `folder_revert` kind, name swap handling, about six hard test cases, and one major finding in this report. One-step
  undo of an agent's bulk damage is lost, but revisions keep recording, so it can be added later.
- **Tabs beyond the default tab:** `goals.md` gives no reason for them. This saves seven routes, seven of 18 tools, and
  the rules for items hidden through a deleted tab. Keep the table and `tab_id`, so adding tabs later needs no data
  migration. Grouping inside a folder is lost.
- **Deactivate and reactivate:** removing the link has the same effect on login. This saves a column, two routes and
  some test cases. An explicit state is lost, and reactivating needs the subject entered again.
- **Fakes and the contract suite:** only if the rule that `make test` needs no Podman changes, which I would not do.

## Next Check

A clean review can not replace running code. Once the major findings are settled, the Connector Test and the first
feature will show more than another round of review.
