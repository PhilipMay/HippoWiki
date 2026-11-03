# Spec QA Report

Date: 2026-11-03. Scope: `spec/`, `doc/nixos-setup.md` (called "the guide" below), `README.md` and `CLAUDE.md`. The
[OAuth Server](spec/oauth-server.md) was reviewed separately, and its open items are in [OAuth Todo](OAuth-todo.md).

## Status

All 8 major findings and 10 of the 58 minor findings are resolved in the spec, and are removed from this report. The
change to a built-in OAuth server then removed 11 more minor findings, and this report was updated to match it. 37 minor
findings, the experiments and the cut candidates are still open.

Values chosen while resolving the findings, which you may want to check:

- The `detail` texts in `errors.md`.
- The `postgresql+asyncpg://` format of `HIPPOWIKI_DATABASE_URL` in the guide.

Decisions still open are marked **Decision** in the list of minor findings, and the [cut candidates](#cut-candidates)
are also yours to decide.

## Summary

There are no blockers and no open major findings. The core design held up: existence leaks, lock order, history
numbering and the rights tables were all tested and found sound.

The open minor findings can wait for the step that touches them, or for the implementation to show whether they matter.

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
- **Refuted:** podman-compose settling the wait for `migrate`, so that risk stays open.
- **Dropped:** a missing test for restoring a tab with an earlier deleted item, because `testing.md` already requires a
  test for every rule.
- **Corrected:** rejecting Unicode tag characters would break valid flag emoji, so that fix is no longer recommended.

Limits of this round:

- Nothing was run against a real system. Claims about SQLAlchemy, asyncpg and Starlette come from documentation and
  source reading.
- `help.openai.com` could not be read, so ChatGPT claims rest on OpenAI's developer guide and on third-party documents.
- [Experiments](#experiments) lists what documentation could not settle.

## Minor Findings

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
  [Roadmap](spec/roadmap.md)"). Four risks are in neither place's plan: rollbacks, the connection pool, compose
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

Most open questions about real clients are checks of the [Connector Test](spec/roadmap.md#connector-test). Documentation
could not settle these others:

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

## Next Check

A clean review can not replace running code. The major findings are settled, so the Connector Test and the first feature
will show more than another round of review.
