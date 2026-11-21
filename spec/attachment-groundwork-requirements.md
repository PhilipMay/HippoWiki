# Attachment Groundwork – Requirements

Status: approved

## Goal

Before attachments are built, two findings of the security review are closed that attachments would make worse: the
image optimizer of Next.js, which nobody uses but which could load images into the server's image processing, and
the missing limits of the MCP addresses, through which one token can make the server do unbounded work. Afterwards
`/_next/image` no longer exists, and every MCP request carries one call, has a known size limit and counts against a
rate limit per user, all of them with defaults that an operator can change within bounds.

## Users and roles

- Users of the wiki in the browser: they see no change; the app never used `/_next/image`.
- AI apps with a connection to an MCP address, and the users who connected them: their requests are limited to one
  call each, in size and in number per time.
- Operators: they can rely on the limits that the app sets itself, change them with environment variables, and read
  in the documentation what the reverse proxy still has to cover.

## Scenarios

- A logged-in user, or a script with the user's session cookie, requests `/_next/image?url=/folders&w=64&q=75`. The
  wiki answers that the address does not exist, and the server fetches and processes nothing.
- An AI app of an older protocol revision sends several tool calls as one JSON-RPC batch. The wiki refuses the
  request as a whole with a JSON-RPC error that says to send the calls one by one, and no tool runs.
- An agent reads a large folder: its first 60 requests go through at once, then it gets 429 with `Retry-After` and
  continues at five requests a second. Its user's other connected apps share the same budget.
- An operator whose AI apps send larger edits sets `HIPPOWIKI_MCP_BODY_LIMIT` to 4 MiB; a typo in the value stops
  the server at its start with an error that names the variable.

## Requirements

### Image optimizer

- R1: `/_next/image` must no longer be a function of the wiki: a request to it with a valid session must be answered
  as an address that does not exist, whatever its query, and must make the server fetch and process nothing.
  - Acceptance: with a session cookie, `/_next/image?url=%2Ffolders&w=64&q=75` and the same address with the address
    of an existing static file as `url` both answer 404, and the server log shows no line of the image optimizer.
  - Acceptance: without a session cookie the address leads to the login page, as every address behind the login does.

### Batches at the MCP addresses

- R2: An MCP request whose body is a JSON-RPC batch, a JSON array of messages, must be refused as a whole, on every
  MCP address and for every protocol revision, before any tool runs.
  - Acceptance: a batch of two `read_page` calls at a Reader address is refused, and the log of the tools shows no
    call.
  - Acceptance: the same two calls sent one by one in two requests both work.
- R7: A refused batch must be answered with HTTP 400 and the JSON-RPC error "Invalid Request" (`-32600`), whose
  message says that batches are not supported and that calls are sent one by one, and logged as one warning line with
  the user, the grant and the address, without the content of the request.
  - Acceptance: the refused batch of R2 gets 400 with the code `-32600` and that message, and the log has one warning
    line for it, holding no title, content or argument of the calls.

### Body limit of MCP requests

- R3: The body of an MCP request must be at most the body limit, 1 MiB by default, on every MCP address and for every
  protocol revision; a larger body must be refused with 413 before anything else of it is read, also when it is sent
  in chunks.
  - Acceptance: with the default, a `replace_page_content` call with content at the length limit of a page, every
    character of it one that JSON escapes as `\uXXXX`, fits and works.
  - Acceptance: with the default, a body of 1 MiB and one byte is refused with 413, sent with a `Content-Length` and
    sent in chunks, and no tool runs.
  - Acceptance: `mcp.md` names the limit as a number of the wiki, not as the default of a library.

### Rate limit of MCP requests

- R4: The MCP requests of one user must share one budget across all the user's connections and addresses: by
  default at most 60 at once, refilled at 300 per minute. Every request whose access token is valid for its address
  counts, whatever message it carries and also when it is refused with 403 because the user's role on the folder is
  too low now; a request without a valid token is not counted, because it reaches nothing and is the reverse proxy's
  to limit.
  - Acceptance: with the defaults, 60 requests of one user in quick succession all work, the 61st is refused, and one
    second later five more work again.
  - Acceptance: the budget is shared: 30 requests at a Reader address and 30 at a Writer address of the same user use
    it up together, and the requests of another user are not affected.
  - Acceptance: a list of the tools counts like a tool call, and so does a request refused with 403 for its role.
  - Acceptance: 70 requests without a token, or with an invalid one, get 401 and leave the budget of every user as it
    was.
- R5: A request over the budget must be answered with 429 and a `Retry-After` header with the number of seconds until
  the next request is allowed, before the protocol is spoken and before any tool runs.
  - Acceptance: the refused request in R4 gets 429 with `Retry-After` of at least 1, and the log of the tools shows no
    call for it.
- R8: Refusals by the rate limit must be logged at most once per user and minute: the first refusal of a user in a
  minute writes one warning line with the user, the grant and the address, and the next line of that user, a minute or
  more later, says how many requests were refused since the line before.
  - Acceptance: 100 refused requests of one user within one minute write one warning line; the first refusal after
    that minute writes a second line that counts the 99 others.
- R6: The budget is kept by the running server only: a restart must give every user a full budget again, and the
  documentation must say that several instances would each keep a budget of their own.
  - Acceptance: `mcp.md` states the defaults, that they count per user, and what a restart and several instances
    mean.

### Configuration

- R9: An operator must be able to set the three limits with optional environment variables, read when the server
  runs, each with its default when it is not set:
  - `HIPPOWIKI_MCP_BODY_LIMIT`: the body limit in whole bytes, from 1048576 (1 MiB) to 16777216 (16 MiB), default
    1048576;
  - `HIPPOWIKI_MCP_RATE_BURST`: how many requests a user may send at once, a whole number from 1 to 10,000, default
    60;
  - `HIPPOWIKI_MCP_RATE_PER_MINUTE`: how many requests the budget of a user gains per minute, a whole number from 1
    to 100,000, default 300.
  - Acceptance: each variable set to a value within its bounds changes the limit of R3 or R4 accordingly.
  - Acceptance: a value outside its bounds, not a whole number, with a unit, or empty, stops the server at its start
    with an error that names the variable, like a wrong `DATABASE_URL`; `0` for either rate variable is such a value,
    so the rate limit cannot be switched off.
  - Acceptance: `container-image.md` describes the three variables next to the other optional variables.

## Scope

- In: switching off the image optimizer; refusing batches at the MCP addresses; the body limit of MCP requests; a
  rate limit of MCP requests per user; the environment variables of these limits.
- Not in: the other findings of the review that attachments touch (limits on the number of items and quotas, the
  writable directories of a read-only root file system, CSRF of an upload route and a security overview, the list of
  costly functions); they are part of the requirements of attachments. Rate limits of the browser, of the login and of
  the OAuth endpoints. A limit for requests without a valid token, which stays with the reverse proxy.

## Effect on existing features

- MCP (`mcp.md`): "The endpoint" names the body limit of the wiki and its variable instead of the default of the SDK,
  says that batches are refused and describes the rate limit and its order among the refusals (after the check of the
  token, before the check of the role and the protocol); "Current limits" no longer lists "no rate limits of MCP
  requests".
- The container image (`container-image.md`): "Configuration" gains the three optional variables.
- The login rules of `architecture.md` no longer mention the image optimizer as a function the app does not use but
  serves.
- Clients of the protocol revision 2025-03-26 that send batches must send their calls one by one.
- The review report: the two findings are deleted, as "Fixing a finding of the review report" in
  `step-plan-workflow.md` describes.

## Decisions

- Only the two findings that should be closed before attachments are in scope; the four other related findings belong
  to the requirements of attachments, because their numbers and directories follow from how attachments are stored.
  Rejected: all six findings at once; only the MCP findings.
- The image optimizer is switched off, not restricted: attachments will process their images in a route of their own,
  with their own limits, and need no second way into the image processing. Rejected: keeping it on with no allowed
  sources; keeping it as an accepted deviation.
- Batches are refused instead of capped: the current protocol revision has no batches, so only old clients that batch
  notice, and every other limit can count requests. Rejected: batches of at most a few calls.
- A refused batch gets 400 with the JSON-RPC error `-32600`, so that a client of the protocol reads why. Rejected: a
  short JSON message like the refusals before the protocol.
- The body limit is 1 MiB by default: the largest write of a page needs about 600 KB in the worst case, and the limit
  also bounds the replacements of `edit_page_content`. A later inline upload through MCP can carry about 700 KB of a
  file with the default; larger files are for an upload address. Rejected: keeping 4 MiB, now named; 2 MiB.
- The rate limit counts per user, so that many connected apps of one user do not multiply the budget. Rejected: per
  connection; no limit in the app, left to the reverse proxy, which cannot tell users apart.
- 60 at once and 300 per minute by default, as in Wiki.js: an agent reads a whole folder in a burst and then five
  pages a second, and a runaway loop or a stolen token still meets a ceiling. Rejected: 30 and 120, which slows down
  agents that read large folders; 120 and 600.
- Every request with a valid access token counts, list requests and refusals for a role that is too low included: one
  request is one message now, the budget is checked in one place before the body is read, and an app that keeps
  calling after its role was lowered is slowed down too. Requests without a valid token are not counted: they reach
  no tool, and counting them would need a budget per client address, which the reverse proxy keeps better. Rejected:
  counting only tool calls; counting only requests that reach the protocol.
- The budget is counted in the memory of the server: a count in the database would be a write per request, the very
  load the limit is meant to keep away. A restart forgets it, which is accepted for one container.
- A request over the budget gets 429 with `Retry-After`, like the other refusals of the endpoint before the protocol.
  Rejected: a tool error for the model, which would need another rule for requests that are no tool call.
- Refusals by the rate limit are logged once per user and minute, with a count, so that an agent in a loop cannot fill
  the log. Rejected: a line per refused request.
- An operator can change all three limits with environment variables, validated like the other variables. Rejected:
  numbers fixed in the app; a variable only for the rate limit.
- The body limit can only be raised, from 1 MiB to 16 MiB: below 1 MiB a write of a large page could fail, and
  16 MiB keeps one request, and the work it can carry, small against the memory of one server. Rejected: a lower bound
  of 64 KiB.
- The rate limit cannot be switched off: a reverse proxy can limit more strictly in front of it, but the wiki keeps its
  own ceiling. Rejected: `0` to switch it off.

## Open questions
