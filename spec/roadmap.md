# Roadmap

This documents what still needs to be done and is missing, most urgent first. What is out of scope is in
[Non-Goals](goals.md#non-goals-for-now).

## Next Steps

1. **Connector setup**: everything the [Connector Test](#connector-test) needs and no server provides yet.
   - PostgreSQL and Traefik with TLS on a public URL, both as in the [guide](../doc/nixos-setup.md).
   - The parts of the foundation this step uses, and only those: the settings for the public URL, the trusted clients,
     the database and the allowed hosts and origins, `problem.py`, `domain.py`, `services/errors.py`, `SafeText`,
     `UtcDatetime`, the paging types, the response models of the tools, the engine and the unit of work, with the import
     contracts that wait for the first code.
   - The [OAuth Server](oauth-server.md) in full, because login and refresh are what the test has to prove, so it can
     not be a stand-in. That means the real `users`, `user_passwords` and [OAuth tables](database.md#oauth-tables), with
     their migration, repositories, fakes and contract tests.
   - `UserService` with `create_admin` and `set_admin_password`, and `cli.py` with `hippowiki migrate`, `init`,
     `set-admin-password` and `client`. It replaces `demo.py`, its test and its script entry.
   - The auth middleware, the token check, the [public routes](authentication.md#public-routes) and the MCP routes.
   - The tools `get_own_user`, to show who is logged in, `list_folders` and `list_md_documents`, to find the IDs,
     `get_md_document`, for the maximum size case, and `create_md_document`, as one write tool and for a body of the
     maximum size through the proxy. They start without `securitySchemes`, which are added only if ChatGPT needs them.
   - The `Containerfile`, whose image runs on the NixOS host, see the [guide](../doc/nixos-setup.md#connector-test-app).
   - The [Connector Test App](#connector-test-app).
2. **Connector Test**: see [below](#connector-test).
3. **Foundation**: add logging and the settings and `schemas/` that the first step left out.
4. **First feature end to end**: the admin creates a folder with `POST /folders`, a user with a right reads it with
   `GET /folders/{folder_id}` and the MCP tool `get_folder`, and a user with no right gets 404. This shows early that
   the layers fit together, on both adapters, and a [production composition test](testing.md#test-kinds) shows it.
   - The models and migration of `folders`, `tabs`, `folder_rights`, `folder_history_entries` and `folder_revisions`,
     because creating a folder also writes its default tab, its entry and its revision.
   - The repositories these need, with their fakes and contract tests. The tests create the user and the right through
     the repositories, because `POST /users` and `PUT` of a right come in the Adapters step.
   - `FolderService` with create, read and list, and `UserService` with the own account.
   - The two routes and `create_app()` and `create_production_app()`. The MCP server factory
     [registers only the tools of the services it gets](package-layout.md#layer-rules), so here `get_own_user`,
     `list_folders` and `get_folder`. The stand-ins get `get_folder` too, so the
     [Connector Test App](#connector-test-app) keeps working.
5. **Database**: the remaining models, migrations, repositories, and their fakes and contract tests.
6. **Services**: the remaining services for users, rights, folders, tabs and md_documents with revisions and revert. The
   real services replace the stand-ins, the MCP server factory requires all services, and the
   [Connector Test App](#connector-test-app) is removed.
7. **Adapters**: the remaining REST routes and MCP tools.
8. **Security review**: an independent review of the [OAuth Server](oauth-server.md) and its tests, because it is
   security-critical code that HippoWiki owns. Its findings are fixed before anything real goes on the server. Until
   then the server holds test data only.
9. **Deployment**: the complete `compose.yaml` and the NixOS module of the
   [complete deployment](../doc/nixos-setup.md#complete-deployment), which run the same image, see
   [Deployment](deployment.md).

### Connector Test App

The first step has MCP tools, but no content services or repositories yet. So the test runs in its own composition,
`connector_test_app.py`, outside `create_production_app()`. The middleware, the token check, the public routes, the MCP
routes, the tools, the OAuth server and the tables of the first step stay, with their tests. Everything below is thrown
away in the Services step, so it does not become a design for the services. Until then, the test can be repeated.

- It passes stand-in content services, with only the methods the tools call, to the MCP server factory. The services use
  the real principal, so the real login decides who sees what.
- It passes the middleware the real credential check.
- It reads the test data from a JSON file named by the environment variable `HIPPOWIKI_CONNECTOR_TEST_DATA`:
  - Three user names: a normal user, a deactivated user and the user of a script client. The admin comes from
    `hippowiki init`.
  - A folder with its default tab, and a right on it for the normal user and the user of the script client.
  - A md_document of exactly the [maximum document size](limits.md#document-size).
- `POST /users` does not exist yet, so a small command of this module creates these users in the database, and prints
  their one-time passwords once. It is idempotent, and leaves existing users alone.
- It logs the method, path and status of each request, its `Origin` and `User-Agent`, and the client and scope of the
  token, because the test has to read these values and nothing else shows them. It never logs a token or a password.

### Connector Test

The login method is defined in [OAuth Server](oauth-server.md), but the local transport tests can not show whether it
works with the real clients, so this test comes before the other implementation work. It checks:

- All three clients log in through their [metadata document](oauth-server.md#trusted-clients), with nothing entered but
  the MCP URL. Claude Code uses `claude mcp add --transport http hippowiki https://wiki.example.org/mcp`.
- ChatGPT uses `https://chatgpt.com/oauth/client.json` and its stable redirect URI, and runs as a public client, because
  the server advertises only `none` of the methods it supports. It runs on a Business or Enterprise plan, where a
  workspace admin first turns on developer mode, see
  [OpenAI: developer mode](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt).
  [OpenAI's guide](https://developers.openai.com/api/docs/guides/custom-mcp-server.md) names no such step, so check
  whether it is still needed, and whether a Business member needs an admin to publish the connector.
- Whether ChatGPT asks for `openid`, `email` and UserInfo on the plan in use, see
  [Open Risks](oauth-server.md#open-risks). HippoWiki stores no email, so if it needs them, this needs a decision.
- Whether ChatGPT needs `securitySchemes` on the tools, which [Connectors](connectors.md#why-oauth) names and
  [MCP](mcp.md#tools) does not define. The documentation says its linking UI needs them together with a tool error that
  carries `_meta["mcp/www_authenticate"]`, which HippoWiki does not send, because the 401 comes before any tool runs.
- A connector can be added by a user on Claude without approval by Anthropic. The
  [documentation](https://claude.com/docs/connectors/custom/add-unlisted.md) offers custom connectors on every plan,
  with one on Free, and on Team and Enterprise an owner adds them.
- The [login page](oauth-server.md#login-page) works in a real browser, in Chrome, Firefox and Safari, coming from each
  product:
  - The redirect after the form is not blocked by `form-action`, and the `Origin` check and the `SameSite=Strict` cookie
    accept the form after the product sent the browser there.
  - A one-time password can be replaced in the flow.
  - Each product shows its name and redirect host on the page.
- All clients keep working after a token refresh, and the lifetimes in [OAuth Values](limits.md#oauth-values) are long
  enough that nobody has to log in again every day. The
  [documentation of Claude](https://claude.com/docs/connectors/building/authentication.md) says it can refresh up to
  five minutes before expiry. So run parallel tool calls with Claude across a refresh, and read the results in the log
  of the app. If this logs it out, try a longer [grace window](oauth-server.md#refresh-rotation).
- Whether each client requests `offline_access`. The server gives a refresh token either way, and the `scope` in the log
  shows the result. Check that each client stays logged in overnight.
- Whether each client sends an `Origin`, and which one, because a foreign `Origin` gets 403, see
  [Serving the MCP App](mcp.md#serving-the-mcp-app).
- All clients accept 405 on `GET /mcp`, see [Serving the MCP App](mcp.md#serving-the-mcp-app), and a server that sends
  no session ID, see [Sessions and Principal](mcp.md#sessions-and-principal).
- How each client reacts to the 401 and `invalid_grant` for a deactivated user, and whether the person sees why at the
  login page.
- How each client reacts when the [admin is refused on the login page](oauth-server.md#admin), and the 403 for a token
  of an admin script client with `curl`, see [Admin Account](mcp.md#admin-account).
- What each client does with a `get_md_document` result at the [maximum document size](limits.md#document-size), which
  is more than some clients put into the context at once.
- A body of the largest size gets through the proxy. An AI client can not realistically write this much, so the script
  client sends a `create_md_document` call with `curl`, using a token from the
  [client credentials grant](connectors.md#scripts): a body of exactly the
  [request body limit](limits.md#request-body-limit) passes the middleware, and one byte more gets the 413 problem+json
  of the app.
- The script client gets a result from `get_own_user` with `curl`. REST has no routes yet, so this shows only that the
  token passes the token check.
- The log of the app shows the real client address, and failed logins count against it, see
  [Login Protection](oauth-server.md#login-protection).

If a client refuses CIMD, try an [own login client](oauth-server.md#own-clients) with `--public`, with its ID entered by
hand in the product. If that also fails, evaluate
[Logto](https://docs.logto.io/use-cases/ai/mcp-server-enable-third-party-ai-agent-access).

The results go into [OAuth Server](oauth-server.md), including the lifetimes, and this section is removed.

## Later

- Backup and restore: [Deployment](deployment.md) names `pg_dump`, but the schedule, the retention and a tested restore
  are open.
- Database monitoring: health reports liveness only, so a database outage does not show up in it.
- Erasure: deleted content and the names of deactivated users are never physically erased, so storage only grows and
  personal data stays. A permanent purge, a retention period and the handling of personal data need a design, including
  what happens to the revisions.
- Rate limits and quotas: nothing limits the requests or the storage of a user, and an AI agent can write any number of
  revisions, each up to the [maximum document size](limits.md#document-size). Only logins have limits.
- Large folder reverts: a [folder revert](history-revisions.md#folder-revert) runs in one transaction, whose size grows
  with the folder and which holds the lock on the folder row until it ends.
- Partial reads: reading part of a large md_document, so a tool result does not have to hold all of it. The
  [Connector Test](#connector-test) shows how urgent this is.
- MCP resources: the first version has tools only. Adding resources needs their errors, the identical 404 and tests
  defined, because a failed resource read is a protocol error in the SDK.
- Web GUI: a GUI for admins and normal users, with the login in [People](connectors.md#people). It needs a design and an
  [own login client](oauth-server.md#own-clients) with `--admin-allowed`.
  - Its server part: how it is deployed and routed next to the app, and the CSRF protection of its session cookie. It
    runs on its own hostname, so a rendering bug can not reach the login page.
  - Rendering: `content_md` is written by other users, so the renderer drops raw HTML and allows only safe URL schemes,
    and the pages get a Content-Security-Policy.
  - CORS: the browser never calls REST directly, so REST needs none. A preflight `OPTIONS` carries no credentials, so
    the auth middleware would reject it with 401. If other origins ever get allowed, CORS wraps outside the auth
    middleware and is configured by an allowlist that is empty by default, with a preflight test.
- Stronger login: multi-factor login, and a password reset without the admin, which needs an email or another second
  channel.
- Device flow: RFC 8628 for people in a terminal, so they need no [script client](connectors.md#scripts) from the
  operator.
- add Prometheus for monitoring
- add exporter to Prometheus for Database and other components
- add Grafana for visualization

## Ideas

- Admin role: more than one admin account, so that several administrators and admin scripts need not
  [share one](users.md#admin).
- Conflicting edits: a merge strategy for conflicting AI and human edits, beyond optimistic locking.
- Record the client of the token in revisions, to tell AI edits from human edits made with the same account. Left out
  for now, because a [separate account](connectors.md#ai-agents) already shows up separately in the history.
- API tokens: REST accepts [OAuth tokens only](connectors.md#scripts), and no token has fewer rights than its user.
- Tokens bound to a client, which would close the [accepted trade-off](connectors.md#client-registration) that a token
  of a product is valid for the whole account, also on REST. The token row already stores the client, so this is a small
  check in the credential check, such as refusing a trusted client on REST. It takes a decision on what the Web GUI and
  scripts may do, and reverses that one token covers MCP and REST.
- `md_document_links`: rebuilt for a md_document on every save. It enables **backlinks** ("what links here") and
  detection of **broken links**. When a md_document is created, dangling links pointing to it get resolved. md_documents
  have no path, only a folder, tab and name, so the link format has to be defined first.
