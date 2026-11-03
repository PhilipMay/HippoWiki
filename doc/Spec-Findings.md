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
