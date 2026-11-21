# Attachment Groundwork – Steps

## Goal

Before attachments are built, two findings of the security review are closed that attachments would make worse. The
image optimizer of Next.js is switched off, so that `/_next/image` no longer exists. Every MCP request carries one
call, has a body limit of 1 MiB by default and counts against a budget per user of 60 at once and 300 per minute, and
an operator can change the three limits with environment variables within bounds. The requirements are in
`spec/attachment-groundwork-requirements.md` (R1 to R9).

## Scope

- In: switching off the image optimizer (R1); refusing JSON-RPC batches at the MCP addresses (R2, R7); the body limit
  of MCP requests (R3); the rate limit of MCP requests per user, its answer and its log (R4, R5, R6, R8); the three
  environment variables `HIPPOWIKI_MCP_BODY_LIMIT`, `HIPPOWIKI_MCP_RATE_BURST` and `HIPPOWIKI_MCP_RATE_PER_MINUTE`
  (R9); deleting the two findings from `review-report.md`.
- Not in: the other findings of the review that attachments touch (limits on the number of items and quotas, the
  writable directories of a read-only root file system, CSRF of an upload route and a security overview, the list of
  costly functions); rate limits of the browser, of the login and of the OAuth endpoints; a limit for requests without
  a valid token, which stays with the reverse proxy; a budget shared between several instances; `OPTIONS` at the MCP
  addresses and `Cache-Control` of their answers, which are findings of their own.

## Checklist

- [x] Switch off the image optimizer
- [x] Environment variables of the MCP limits
- [ ] Body limit and batches at the MCP addresses
- [ ] Rate limit of MCP requests
- [ ] Spec tests
- [ ] Wrap-up

## Switch off the image optimizer

### Goal

`/_next/image` answers 404 to a user with a session, whatever its query, and the server fetches and processes nothing
(R1). The finding "the image optimizer of Next.js stays switched on although the app uses no `next/image`" of
`review-report.md` is closed in this step.

### Build

- `next.config.ts`: `images: { unoptimized: true }`, with a comment that the app uses no `next/image`, that the
  option makes Next.js answer `/_next/image` with 404 (`render404()` in the image route of `next-server.js` of the
  installed version, checked before the parameters are read), and that attachments will process their images in a
  route of their own. Check this against `node_modules/next/dist/docs/` and the server code of the installed version
  for both `next dev` and `next start`; if one of them still serves the optimizer, stop and ask before choosing
  another way.
- `src/proxy.ts` keeps `/_next/image` behind the login: without a session cookie the address still leads to the login
  page (R1). Only its comment changes where it gives the optimizer as a reason.
- The finding is fixed as "Fixing a finding of the review report" in `spec/step-plan-workflow.md` describes, all of it
  in the commit of this step:
  - `architecture.md`, "Login and sessions": the matcher no longer mentions the image optimizer as an address that the
    app does not use but serves; `/_next/image` is switched off in `next.config.ts` and answers 404 behind the login.
  - `users-and-login.md`: the sentence on the image optimizer behind the login says that it is switched off.
  - `review-report.md`: the section of the finding is deleted; "Summary" gets the new counts by severity, label and
    confidence (one Nit, one `nit:`, one Medium less); the requirements of the finding (OWASP A02:2025, ASVS 15.2.3,
    CWE-1188) move into the "Reviewed" list of "Access control and the entry points of requests" with what the fix
    does and how it is checked; the entry point "Other addresses of Next.js behind the login" and every other
    reference to the finding are reworded.
  - `roadmap.md`, "Things to Check": the check on the deployment names the 404 of `/_next/image` with a session and
    the redirect to `/login` without one.
  - A search of `spec/`, `README.md` and `CLAUDE.md` for "image optimizer" and `_next/image` leaves no reference to
    the finding.

### Test

- End-to-end, in `e2e/access.spec.ts`: with a session cookie, `/_next/image?url=%2Ffolders&w=64&q=75` and the same
  address with the address of an existing static file of `/_next/static/` as `url` both answer 404; without a session
  cookie the address leads to the login page.
- The change of `next.config.ts` touches every page: the complete `npm run test:e2e` runs in this step. The optimizer
  behaves differently in a production build, so `npm run test:e2e:production -- e2e/access.spec.ts` runs as well, last.
- Manual: with `npm run dev` and a session, the request of the first item answers 404 and the server log shows no line
  of the image optimizer (no `internal image response failed`).

## Environment variables of the MCP limits

### Goal

The server reads the three limits from optional environment variables, each with its default and its bounds, and a
wrong value stops the server with an error that names the variable, like a wrong `DATABASE_URL` (R9). Nothing uses
the values yet.

### Build

- `src/lib/env.ts`: `HIPPOWIKI_MCP_BODY_LIMIT` (whole bytes, 1048576 to 16777216, default 1048576),
  `HIPPOWIKI_MCP_RATE_BURST` (a whole number from 1 to 10000, default 60) and `HIPPOWIKI_MCP_RATE_PER_MINUTE` (a
  whole number from 1 to 100000, default 300) in `serverEnvSchema`, each transformed to a number, with a comment on
  what it limits and why it cannot be lower or switched off. Only plain decimal digits are accepted: a value with a
  sign, a fraction, an exponent, spaces, a unit such as `1MiB`, leading zeros or an empty string is refused, so that a
  typo stops the server instead of changing a limit.
- The defaults and bounds are named constants in one place, so that the adapter and its tests use the same numbers.
- `.env.example`: the three variables commented out with their defaults, next to the other optional variables.

### Test

- Unit, in `src/lib/env.test.ts`: without the variables the three defaults; the lower and upper bound of each are
  accepted; one below the lower and one above the upper bound, `0` for both rate variables, `1.5`, `1e6`, `+60`,
  ` 60`, `60 `, `1MiB`, `060` and an empty string are each refused with an error that names the variable.
- No end-to-end spec: nothing that the app runs reads the values yet.

## Body limit and batches at the MCP addresses

### Goal

Every MCP address reads at most the body limit of a request and refuses a larger body with 413, also when it is sent
in chunks (R3), and refuses a JSON-RPC batch as a whole with 400 and `-32600` before any tool runs, for every protocol
revision (R2, R7).

### Build

- `src/features/mcp/http.ts`, after the check of the token, the role and the folder, before `isLegacyRequest()`: the
  adapter reads the body itself with the body limit of `HIPPOWIKI_MCP_BODY_LIMIT`, with `readRequestBody()` of the SDK
  or a reader of its own that stops at the limit, so that a body over it is refused with 413 as soon as the limit is
  passed, whether it has a `Content-Length` or is sent in chunks, and nothing after it is read.
- A body whose JSON is an array is a batch: it is answered with 400 and the JSON-RPC error `-32600` "Invalid Request",
  whose message says that batches are not supported and that calls are sent one by one, with `id` `null`. It is logged
  as one `warn` line with the user, the grant and the address (folder and role), without the content of the request.
  The array check is done on the parsed body, before the choice of the path, so that it holds for both paths and every
  protocol revision.
- The parsed body is handed on to the SDK (`parsedBody` of `isLegacyRequest()`, of the handler and of the transport,
  where the installed SDK takes it), so that the body is read once; the body limit is passed as `maxRequestBodySize` to
  `createMcpHandler()` in `getModernHandler()`, to `isLegacyRequest()` and to the transport of `serveLegacy()` as
  well, so that the SDK never applies another limit. A body that is no JSON keeps the answer of the SDK.
- The comments of `handleMcpRequest()`, `getModernHandler()` and `serveLegacy()` name the body limit of the wiki
  and the refusal of batches in the order of the refusals, instead of the default of the SDK.

### Test

- Unit, in `src/features/mcp/http.test.ts`, with the default limit: a body of 1 MiB fits and a body of 1 MiB and one
  byte is refused with 413, once with a `Content-Length` and once as a `ReadableStream` without one; the reader stops
  at the limit (a stream that would go on for longer is not read to its end); a refused body reaches neither the SDK
  nor a tool. With `HIPPOWIKI_MCP_BODY_LIMIT` at 4 MiB in the mocked environment, a body of 2 MiB fits.
- Unit: a batch of two `read_page` calls is refused with 400, `-32600` and the message, with and without the
  per-request `_meta` envelope and with `MCP-Protocol-Version` `2025-03-26` and `2025-06-18`; no tool runs and no
  `info` line of a tool is written; exactly one `warn` line with the user, the grant and the address, and none of the
  titles, names or arguments of the calls. An empty array is refused the same way. A body without a token is not read
  (401 first).
- End-to-end, in a new `e2e/mcp-limits.spec.ts`: a batch of two `read_page` calls at a Reader address gets 400 with
  `-32600` and the message; the same two calls sent one by one both work. A `replace_page_content` call with content
  at the length limit of a page (`CONTENT_MAX_LENGTH`), every character after the title heading a non-ASCII character
  and the body written as a client that escapes every such character as `\uXXXX` sends it (like `json.dumps` of
  Python), fits and works. A body of 1 MiB and one byte is refused with 413, sent with a `Content-Length` and sent in
  chunks (a `fetch` of Node.js with a `ReadableStream` body), and the page is unchanged.
- The specs `e2e/mcp-limits.spec.ts` and every `e2e/mcp-*.spec.ts`, whose route the step changes, run.

## Rate limit of MCP requests

### Goal

The MCP requests of one user share one budget across all the user's connections and addresses, 60 at once and 300
per minute by default (R4, R9); a request over it gets 429 with `Retry-After` before the protocol and any tool (R5);
the refusals are logged at most once per user and minute, with a count (R8); and the budget lives in the memory of the
server (R6).

### Build

- A new pure module `src/features/mcp/rate-limit.ts`: a token bucket per user id with the burst and the refill per
  minute as parameters and the clock injected. `take(userId)` either takes one request from the budget or answers how
  many milliseconds until the next one is allowed. A user whose bucket is full again needs no entry, so the map is
  pruned of such entries and holds only users who sent requests lately. It also keeps, per user, when the last refusal
  was logged and how many were refused since, so that the adapter writes the first refusal of a user and then at most
  one line a minute with the count since the line before.
- The grant service: the error `role-too-low` of `authenticateAccessToken()` carries the user id and the grant id of
  the token, so that a request refused for its role counts as well (R4). Its callers outside the adapter, if any, are
  brought in line.
- `src/features/mcp/http.ts`: one budget for the running server, built from `HIPPOWIKI_MCP_RATE_BURST` and
  `HIPPOWIKI_MCP_RATE_PER_MINUTE` on first use. Every request whose token is valid for its address, or is refused as
  `role-too-low`, takes from the budget of its user right after the check of the token and before the check of the role,
  the reading of the body and the protocol. Over the budget it answers 429 with a short JSON message like the other
  refusals before the protocol and `Retry-After` with the whole seconds until the next request is allowed, rounded up
  and at least 1. A request without a token, with an invalid one or whose token could not be checked takes nothing.
- The log of a refusal is one `warn` line with the user, the grant and the address, and the number of refusals since
  the line before when there were others; it holds no token and nothing of the body.
- The comment of `handleMcpRequest()` lists the rate limit in the order of the refusals: after the 401 of the token,
  before the 403 of the role and the 413 and 400 of the body.
- The end-to-end servers keep the defaults (`playwright.config.ts` sets none of the variables), so that the spec checks
  them. The new tests use users of their own, so that their budgets are fresh and the user of the other MCP specs is
  not drained. If the complete suite shows that another spec meets the limit, that spec gets a user of its own; the
  limits of the servers are not raised.

### Test

- Unit, in `src/features/mcp/rate-limit.test.ts`, with a fake clock: with the defaults 60 requests at the same instant
  are taken and the 61st is refused with a wait of 200 ms; one second later exactly five more are taken; two users have
  budgets of their own; with a burst of 2 and 60 per minute the third request is refused and one second later one is
  taken; a full bucket leaves no entry; the log decision: 100 refusals within one minute give one line, and the first
  refusal a minute or more later gives a second line that counts the 99 others.
- Unit, in `src/features/mcp/http.test.ts`: the 61st request of a user gets 429 with `Retry-After` of at least 1, the
  SDK and no tool see it, and one `warn` line is written; a list of the tools and a request refused as `role-too-low`
  take from the budget like a tool call, and the 429 comes before the 403 once the budget is used up; 70 requests
  without a token or with an invalid one get 401 and leave the budget as it was; a body over the limit still counts;
  with `HIPPOWIKI_MCP_RATE_BURST` at 2 in the mocked environment the third request is refused. Each test starts with a
  fresh budget.
- Integration, in `integration/grant-service.test.ts`: the error `role-too-low` names the user and the grant of the
  token.
- End-to-end, in `e2e/mcp-limits.spec.ts`, with a user of its own per test: requests sent one after the other until
  the first 429 work at least 60 times, and at most as many more as five a second of the time they took; the 429 has
  `Retry-After` of at least 1; after waiting for it a further request works. 30 requests at a Reader address and the
  rest at a Writer address of the same user use up one budget, while a request of another user still works. 70
  requests without a token and with an invalid token get 401, and the user's budget is untouched afterwards.
- This is the last step that changes more than documentation unless the spec tests keep a test: the specs
  `e2e/mcp-limits.spec.ts`, every `e2e/mcp-*.spec.ts` and `e2e/oauth.spec.ts` run here, and the complete suite runs
  in "Spec tests".
- Manual: a restart of `npm run dev` gives a user whose budget was used up a full budget again (R6).

## Spec tests

### Goal

Tests written from `spec/attachment-groundwork-requirements.md` alone check the contract of the limits: the status
codes, the error of a batch, the bounds of the variables, the headers and the order of the refusals.

### Build

- Start the `spec-tester` agent (`.claude/agents/spec-tester.md`) with `spec/attachment-groundwork-requirements.md`
  and wait for it, as "Step plans" in `spec/step-plan-workflow.md` says. The tests it keeps belong to this step. A
  finding with High confidence within the scope of the plan is fixed in this step, with the failing test of its
  Evidence added back; any other finding stops the plan.

### Test

- The tests the agent keeps pass.
- The complete `npm run test:e2e` runs in this step, the last that changes more than documentation, also when the
  agent keeps no end-to-end test.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan. The finding "one token can make
the server do unbounded work" of `review-report.md` is closed in this step, because the fix of steps three and four
is complete only now and its documents are those of this step.

### Build

1. Describe the limits as built:
   - `mcp.md`, "The endpoint": the body limit of the wiki, 1 MiB by default, with `HIPPOWIKI_MCP_BODY_LIMIT` and a
     pointer to `src/lib/env.ts`, instead of the default of the SDK; that batches are refused with 400 and `-32600`,
     and why; the rate limit per user, its defaults, that it counts every request with a valid token, those refused
     for their role included, and none without; its 429 with `Retry-After`; its log once per user and minute; that a
     restart gives every user a full budget and that several instances would each keep a budget of their own (R6).
     "The connections": the list of what a client gets instead of an answer of the protocol gains the 429 after the
     401 and before the 403, and the 413 and 400 of the body after the 403. "Decisions" takes the decisions of the
     requirements that still hold; the decision on prompt injection no longer names capping batches and a rate limit
     as rejected. "Current limits" no longer lists "no rate limits of MCP requests" and names that the budget is not
     shared between instances. The pointers to the code and the tests name `src/features/mcp/rate-limit.ts`, its test
     and `e2e/mcp-limits.spec.ts`.
   - `container-image.md`, "Configuration": the three optional variables next to the others, with their bounds,
     defaults and what a wrong value does, and the sentence that lists the optional variables names them.
   - `connected-apps.md`, "Current limits": "no rate limits of requests with an access token" says that the MCP
     requests have one (see `mcp.md`) and the token endpoint none.
   - `architecture.md` or `testing.md` only where a convention changed, such as the end-to-end tests of the rate limit
     using users of their own.
   - The finding is fixed as "Fixing a finding of the review report" in `spec/step-plan-workflow.md` describes: its
     section in "MCP server" is deleted; "Summary" gets the new counts (one Minor, one `issue:`, one Low less) and its
     verdict no longer names unbounded bodies and batches of MCP; its requirements (OWASP A06:2025, ASVS 2.4.1 and
     15.2.2, CWE-770, the MCP specification) move into the "Reviewed" list of "MCP server" with what the fix does and
     how it is checked, and the item "Body size" there names the limit of the wiki; the other findings that name the
     4 MiB of the SDK or the batches (the list of costly functions, the regression tests of Next.js, the SDK and Better
     Auth) and "Checks on the deployment", the threat model, "Standards coverage" and "Open questions" are reworded
     where they rely on it.
2. `roadmap.md`: the check on the deployment that the reverse proxy sets body limits and rate limits for `/mcp/` says
   that the wiki has its own now and the proxy may limit more strictly, and limits requests without a valid token.
3. `README.md`: the commands are unchanged; its summary of what the prototype can do names the limits of MCP if it
   describes MCP in that detail.
4. Delete this step file and `spec/attachment-groundwork-requirements.md`. The steps before name the rules in the
   comments of the code and the tests, not the requirement IDs, so that no ID is left to remove; a search for `R1` to
   `R9` in `src/`, `e2e/`, `integration/` and `scripts/` checks it. An ID found all the same is replaced by the
   section of `mcp.md` or `container-image.md` that holds the rule now, or dropped with its sentence kept.
5. `CLAUDE.md`: remove the entries of this step file and of the requirements file; the entries of `mcp.md` and
   `container-image.md` keep their questions.

### Test

- The commands in "When a step is done" in `spec/step-plan-workflow.md` pass. The step changes only documentation, so
  `npm run check` runs and no end-to-end spec; if a requirement ID had to be removed from a code or test file, it is
  the last step that changes more than documentation, and all commands run with the complete `npm run test:e2e`.
- A search of `spec/`, `README.md` and `CLAUDE.md` for "batch", "rate limit", "4 MiB", `maxRequestBodySize` and the
  title of the finding leaves no reference to it and no statement that contradicts the limits.
