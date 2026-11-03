# Limits

This document is the one home for every fixed limit. The name length, the document size, the request body limit and the
values of the token check are fixed in the code and are not settings.

## Limits at a Glance

| Limit                                      | Value                                  | Out of range                                            |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------- |
| name of a folder, tab, md_document or user | at most 100 characters                 | `DomainValidationError`                                 |
| `auth_subject`                             | 1 to 255 characters                    | `DomainValidationError`                                 |
| `content_md`                               | at most 256 KiB (262,144 bytes), UTF-8 | `DomainValidationError`                                 |
| request body                               | at most 2 MiB (2,097,152 bytes)        | 413                                                     |
| `limit` of a [list](lists.md)              | 1 to 100, with a default of 50         | a schema validation error, and the value is not clamped |

- The service checks the length of `auth_subject`, because "" would otherwise hit the check constraint and become a 500.

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

## Token Check Values

`auth/tokens.py` holds these values for the [token check](authentication.md#token-check):

- `TOKEN_LEEWAY_SECONDS`, 30: the clock difference allowed for `exp` and `iat`.
- `JWKS_MAX_AGE_SECONDS`, 600: the age at which the cached set is refreshed, so a key removed from Keycloak stops
  working after 10 minutes at most, and sooner if another fetch runs first.
- `JWKS_REFETCH_INTERVAL_SECONDS`, 30: the shortest time between two fetches. If another fetch has just run, a token
  with a new key can get 401 for up to this time.
- `JWKS_FETCH_TIMEOUT_SECONDS`, 5: a fetch that takes longer counts as failed.
