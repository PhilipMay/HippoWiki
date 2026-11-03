## Connector Test Points

Each of these has a planned answer, which only the real clients can confirm. See
[Connector Test](../spec/roadmap.md#connector-test).

### Clients Accept the Metadata Documents

- **Open**: all three log in with nothing entered but the MCP URL. This is read from the vendor pages and has never run.
- **Recommendation**: test Claude Code first, because it needs no plan or approval and has the shortest loop, then
  Claude and ChatGPT.
- **Alternatives if it fails**: an own client with `--public` and its ID entered by hand, and only then an external
  service such as Logto.

### ChatGPT Plan and Public Mode

- **Open**: that ChatGPT uses its stable `client_id` and runs as a public client, and whether a Business member needs an
  admin to publish the connector. The OpenAI page on developer mode could not be read during the review.
- **Recommendation**: use a workspace where you are the admin, and read the `client_id` in the log.
- **Alternatives if it fails**: if ChatGPT sends a `client_id` with a callback ID, add that URL to the allowlist. If it
  insists on `private_key_jwt`, add client assertions, which is the larger change.

### Whether Tools Need `securitySchemes`

- **Open**: the OpenAI documentation names them, and [MCP](../spec/mcp.md#tools) does not define them.
- **Recommendation**: start without them, and add them only if ChatGPT fails to link.
- **Alternatives**: add them from the start, which is harmless and leaves more text to maintain.

### `form-action` on the Login Page

- **Open**: Chrome may block the login if a callback redirects on to another origin or to an app. The Claude desktop and
  mobile apps share one callback, and its behaviour is unknown.
- **Recommendation**: keep it, and test those apps in particular.
- **Alternatives if it fails**: drop `form-action`, as [already planned](../spec/oauth-server.md#browser-protection).
  The page has no scripts and escapes its values, so little depends on it.

### Refresh Behaviour and Lifetimes

- **Open**: parallel refreshes and retries are assumed, and the values in [OAuth Values](../spec/limits.md#oauth-values)
  are estimates, because vendors name none.
- **Recommendation**: run parallel tool calls across a refresh, and leave a client logged in overnight and over a
  weekend.
- **Alternatives if it fails**: a longer grace window, a longer access token, or as a last resort no rotation for that
  client, which gives up reuse detection.

### Client Reactions

- **Open**: how each client reacts to a deactivated user, to the admin being refused, to 405 on `GET /mcp`, to its
  `Origin` being checked, and to a 401 on a discovery path that does not exist.
- **Recommendation**: read the log for each case and write down what the person sees.
- **Alternatives if it fails**: for a 401 on discovery, make `/.well-known/openid-configuration` a public 404. For a bad
  message on the login page, change the wording.
