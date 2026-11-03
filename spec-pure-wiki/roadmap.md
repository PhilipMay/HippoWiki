# Roadmap

This documents what still needs to be done and is missing, most urgent first. What is out of scope is in
[Non-Goals](goals.md#non-goals-for-now).

## Next Steps

1. **Foundation**: the settings, `problem.py`, `domain.py`, `logs.py`, `services/errors.py`, `SafeText`, `UtcDatetime`,
   the paging types, the engine and the unit of work, with the import contracts that wait for the first code.
   - `cli.py` replaces `demo.py`, its test and its script entry.
   - The time pin tests drop what only the earlier plan needed, so PyYAML and its stubs can leave the dev dependencies.
2. **Login**: the `users`, `user_passwords` and `sessions` tables with their migration, repositories, fakes and contract
   tests, `UserService` with `create_admin` and `set_admin_password`, `AuthService`, the auth middleware, the token
   check and the [public routes](authentication.md#public-routes), and `hippowiki migrate`, `init` and
   `set-admin-password`.
3. **First feature end to end**: the admin creates a folder with `POST /folders`, a user with a right reads it with
   `GET /folders/{folder_id}`, and a user with no right gets 404. This shows early that the layers fit together, and a
   [production composition test](testing.md#test-kinds) shows it.
   - The models and migration of `folders`, `tabs`, `folder_rights`, `folder_history_entries` and `folder_revisions`,
     because creating a folder also writes its default tab, its entry and its revision.
   - The repositories these need, with their fakes and contract tests. The tests create the user and the right through
     the repositories, because `POST /users` and `PUT` of a right come in the Adapter step.
   - `FolderService` with create, read and list.
   - The two routes and `create_app()` and `create_production_app()`.
4. **Database**: the remaining models, migrations, repositories, and their fakes and contract tests.
5. **Services**: the remaining services for users, rights, folders, tabs and md_documents with revisions and revert.
6. **Adapter**: the remaining REST routes.
7. **Security review**: an independent review of the [login](authentication.md) and its tests, because it is
   security-critical code that HippoWiki owns. Its findings are fixed before anything real goes on the server. Until
   then the server holds test data only.
8. **Deployment**: the `Containerfile`, the complete `compose.yaml` and the NixOS module, which run the same image, see
   [Deployment](deployment.md). The [existing guide](../doc/nixos-setup.md) is adapted to the pure wiki.
9. **Web client**: see [below](#web-client).

## Web Client

The web client connects through [REST](rest.md). These points are open and are planned later:

- Its framework, and how it is built and served.
- Where the browser holds the token.
- Whether it runs on the same origin as REST. Same origin needs no CORS. If other origins ever get allowed, CORS wraps
  outside the auth middleware, because a preflight `OPTIONS` carries no credentials and would otherwise get 401, and it
  is configured by an allowlist that is empty by default, with a preflight test.

One point is a firm requirement, whatever the choices above:

- Rendering: `content_md` is written by other users, and a rendering bug could read a token that JavaScript can reach.
  So the renderer drops raw HTML and allows only safe URL schemes, and the pages get a Content-Security-Policy.

It also shows the one-time password of `POST /users` and of a password reset once, and handles the
`password_change_required` answer of the [login](authentication.md#login).

## Later

- Backup and restore: [Deployment](deployment.md) names `pg_dump`, but the schedule, the retention and a tested restore
  are open.
- Database monitoring: health reports liveness only, so a database outage does not show up in it.
- Erasure: deleted content and the names of deactivated users are never physically erased, so storage only grows and
  personal data stays. A permanent purge, a retention period and the handling of personal data need a design, including
  what happens to the revisions.
- Rate limits and quotas: nothing limits the requests or the storage of a user, and a user can write any number of
  revisions, each up to the [maximum document size](limits.md#document-size). Only logins have limits.
- Large folder reverts: a [folder revert](history-revisions.md#folder-revert) runs in one transaction, whose size grows
  with the folder and which holds the lock on the folder row until it ends.
- Login limit per address: counting failures per client address, which slows down one password tried against many names.
  It needs the app to trust the forwarded address only from the proxy.
- Stronger login: multi-factor login, and a password reset without the admin, which needs an email or another second
  channel.
- add Prometheus for monitoring
- add exporter to Prometheus for Database and other components
- add Grafana for visualization

## Ideas

- Admin role: more than one admin account, so that several administrators and admin scripts need not
  [share one](users.md#admin).
- Conflicting edits: a merge strategy for conflicting edits, beyond optimistic locking.
- API tokens: long-lived tokens for scripts, which now log in like people and get a session of a
  [fixed length](authentication.md#sessions).
- `md_document_links`: rebuilt for a md_document on every save. It enables **backlinks** ("what links here") and
  detection of **broken links**. When a md_document is created, dangling links pointing to it get resolved. md_documents
  have no path, only a folder, tab and name, so the link format has to be defined first.
