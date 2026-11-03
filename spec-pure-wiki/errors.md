# Errors

This document defines how errors look. Which error a request gets is in [Check Order](request-checks.md#check-order)
and, for the login route, in [Login](authentication.md#login).

## REST Error Format

Every REST error uses RFC 9457 problem+json, built by one shared helper in `problem.py`. Every body has these members:

- `type`: always `about:blank`
- `title`: the HTTP reason phrase of the status
- `status`: the HTTP status
- `code`: an extension, so a client can tell apart errors with the same status, such as the two 422s, which need
  different reactions
- `detail`: the fixed text of the `code`, so it never holds an ID, a name or an input value

| Status | `code`                     | `detail`                                   |
| ------ | -------------------------- | ------------------------------------------ |
| 401    | `unauthenticated`          | A valid token is required.                 |
| 401    | `invalid_credentials`      | The name or the password is wrong.         |
| 403    | `forbidden`                | This operation is not allowed.             |
| 403    | `password_change_required` | A new password is required.                |
| 404    | `not_found`                | The item does not exist.                   |
| 405    | `method_not_allowed`       | This method is not allowed on this route.  |
| 409    | `name_conflict`            | The name is already taken.                 |
| 409    | `version_conflict`         | The version is not the current one.        |
| 413    | `body_too_large`           | The request body is over the limit.        |
| 422    | `schema_validation`        | The request is not valid.                  |
| 422    | `domain_validation`        | The request breaks a rule for its values.  |
| 500    | `internal_error`           | An unexpected error occurred.              |
| 503    | `service_unavailable`      | The service can not check the request now. |

A 422 also has an `errors` extension, a list of objects with `field` and `reason`, so a client can show which field
failed:

- `field` is the name of the field, dotted if it is nested, or `body` for a body that can not be parsed.
- `reason` never holds the input value, so a rejected `content_md` or password is not sent back. `DomainValidationError`
  carries its field and reason.

A 500 body contains no exception details. A 404 body has no `instance` and no ID, because a hidden and a missing item
have different IDs and their bodies must be identical.

Two statuses need a header as well as the body:

- A 401 carries `WWW-Authenticate: Bearer`, because RFC 9110 requires the header. When a token was presented, the header
  also carries `error="invalid_token"`, as RFC 6750 asks for.
- The 405 carries `Allow`, because RFC 9110 requires it.
