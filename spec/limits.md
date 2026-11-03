# Limits

This document is the one home for every fixed limit. The name length, the document size, the request body limit and the
values of the OAuth server are fixed in the code and are not settings.

## Limits at a Glance

| Limit                                      | Value                                  | Out of range                                            |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------- |
| name of a folder, tab, md_document or user | at most 100 characters                 | `DomainValidationError`                                 |
| new password                               | 12 to 128 characters                   | the [login page](oauth-server.md#login-page) says so    |
| `content_md`                               | at most 256 KiB (262,144 bytes), UTF-8 | `DomainValidationError`                                 |
| request body                               | at most 2 MiB (2,097,152 bytes)        | 413                                                     |
| `limit` of a [list](lists.md)              | 1 to 100, with a default of 50         | a schema validation error, and the value is not clamped |

- A password is limited, because hashing a very long one would cost time on an anonymous route. A password at login over
  the limit gets the same answer as a wrong one, without hashing it.

## Document Size

- a `content_md` of exactly 256 KiB is accepted (service)
  - it counts bytes, not characters, because bytes bound both the storage and the [request body](#request-body-limit)
- the size is checked only when a client sends `content_md`, so on a create and an update (service)
  - a rename, a move, a restore and a revert bring no new content and are not checked, so a limit lowered later can not
    block recovery or make a folder revert fail
- the value is not a setting, because the request body limit depends on it
- there is no check constraint, so changing the value needs no migration

## Request Body Limit

After authentication and before anything parses the body, the auth middleware answers 413 to a request body over the
limit. It checks this on the declared length and while reading, whatever the route, except a
[public route](authentication.md#public-routes), whose body it never reads. A body of exactly the limit passes.

The limit of 2 MiB is separate from the maximum document size of 256 KiB, but has to leave room for it. JSON escaping
can grow one UTF-8 byte to six, because U+0001 becomes `\u0001` and `SafeText` allows it, so the largest document can
need 1.5 MiB. The other 512 KiB covers the name, the IDs and the JSON-RPC envelope.

`app.py` holds the value as `MAX_REQUEST_BODY_BYTES` and passes it to the middleware, while `services/md_documents.py`
holds `MAX_CONTENT_MD_BYTES`. The [reverse proxy](deployment.md#reverse-proxy-setup) sets no limit of its own, and a
later one must not be lower.

The middleware reads the body up to the limit before it calls the app, and then replays it. Memory is bounded by the
limit, and after the replay `receive` goes to the original one again, so the app still gets `http.disconnect`. The
reason for this design is in [FastAPI Notes](implementation-notes.md#fastapi-notes).

## OAuth Values

`services/oauth.py`, `auth/client_documents.py`, `auth/passwords.py` and `auth/login_limiter.py` hold these values for
the [OAuth Server](oauth-server.md). Vendors name no lifetimes, so these come from their behaviour and are checked in
the [Connector Test](roadmap.md#connector-test).

Tokens:

- `AUTHORIZATION_CODE_SECONDS`, 60: how long a code can be used.
- `AUTHORIZATION_CODE_RETENTION_SECONDS`, 86,400: how long a code row stays after `created_at`, so a second use is
  detected.
- `ACCESS_TOKEN_SECONDS`, 3,600: longer than the 5 minutes before expiry at which Claude can refresh, so it does not
  refresh on every request. A deactivated user or a deleted token still ends on the next request.
- `REFRESH_TOKEN_IDLE_SECONDS`, 5,184,000 (60 days): each refresh starts it again, so regular use never logs out.
- `REFRESH_REUSE_GRACE_SECONDS`, 60: how long a replaced refresh token still works. It is above the 30 seconds Claude
  waits for a refresh, so a retry after a lost response fits.

Requests:

- `OAUTH_FORM_MAX_BYTES`, 16,384: the largest body of a `POST` route. Over it, the login page answers 413 and the other
  routes answer `invalid_request`.
- `OAUTH_PARAMETER_MAX_CHARS`, 2,048: the longest value of a single parameter, also in a query string.

Client documents:

- `CLIENT_DOCUMENT_MAX_BYTES`, 5,120: a larger document is rejected. This follows the recommendation of the CIMD draft,
  and the current documents are under 1 KiB.
- `CLIENT_DOCUMENT_MAX_AGE_SECONDS`, 3,600: the age at which a cached document is fetched again.
- `CLIENT_DOCUMENT_REFETCH_INTERVAL_SECONDS`, 60: the shortest time between two fetches of one URL, also after a
  failure.
- `CLIENT_DOCUMENT_FETCH_TIMEOUT_SECONDS`, 5: a fetch that takes longer counts as failed.

Logins:

- `LOGIN_FREE_FAILURES`, 5: the failures of an account with no wait.
- `LOGIN_MAX_WAIT_SECONDS`, 900: the wait starts at 1 second and doubles with each further failure, up to this value.
- `LOGIN_FAILURES_PER_ADDRESS`, 20, within `LOGIN_ADDRESS_WINDOW_SECONDS`, 300: over this, one address gets no hash.
- `LOGIN_ADDRESSES_TRACKED`, 10,000: the most addresses held in memory, dropping the oldest.
- `ONE_TIME_PASSWORD_BYTES`, 16: the random bytes of a one-time password, so 128 bits.
- `PASSWORD_HASHES_RUNNING`, 4, and `PASSWORD_HASHES_WAITING`, 16: over these, a login gets 503. With the default
  parameters of `argon2-cffi`, each hash uses 64 MiB, so the running hashes use about 256 MiB.
