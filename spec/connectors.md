# Connectors

This document defines how AI agents, people and scripts log in, and why HippoWiki uses OAuth. The server they log in at
is in [OAuth Server](oauth-server.md), and how tokens are checked is in [Authentication](authentication.md).

## AI Agents

An AI agent acts as the account it logged in with. There are no tokens with fewer rights than their user.

- A person can log a connector in with their own account, unless it is the admin account.
- The admin account [can not approve a product](oauth-server.md#admin), and [MCP rejects it](mcp.md#admin-account). The
  person who is the admin uses a separate account for connectors.
- A separate account, such as `alice-claude`, is a normal user: it gets its own folder rights, such as read-only, and
  shows up separately in the revision history.

## People

REST accepts the same OAuth tokens as MCP. Admins and normal users log in the same way, and what they can do depends
only on their account.

- **Web GUI**, which comes [later](roadmap.md#later): the normal way for a person to use REST.
  - Its server part is an [own login client](oauth-server.md#own-clients) that is confidential, which logs in with the
    authorization code flow and S256 PKCE and keeps the tokens. It adds the bearer token when it calls REST.
  - The browser only gets a session cookie that scripts can not read. The GUI displays Markdown written by other users,
    so a script that runs through a rendering bug must not be able to take the tokens away.
  - This cookie ends at the server part of the GUI, so REST stays bearer only.
- **Terminal**: until the Web GUI exists, and for work in a terminal afterwards, a person uses a
  [script client](#scripts) that the operator creates for their account, and uses the token with `curl` or a similar
  tool. A device flow is [for later](roadmap.md#later).

## Scripts

There are no API tokens for now.

- Each script gets its own [script client](oauth-server.md#own-clients) linked to one user, and uses the client
  credentials grant.
- `hippowiki client add` needs shell access to the server, so the operator creates these.
- A script that administers the system has to use the one [admin](users.md#admin) account. Until the Web GUI exists,
  this is also how the admin uses REST.

## Client Registration

Products need no client to be created and no secret to be entered. A person enters only the MCP URL, and the product
finds everything else through the [metadata](oauth-server.md#metadata) and logs in as a
[trusted client](oauth-server.md#trusted-clients).

- ChatGPT and Claude: add a connector with the MCP URL. Plans differ in who may add one, see
  [Connector Test](roadmap.md#connector-test).
- Claude Code: `claude mcp add --transport http hippowiki https://wiki.example.org/mcp`, and then log in with `/mcp` in
  a session or with `claude mcp login hippowiki`.

Accepted trade-off: tokens are not bound to a client. A person who approves a product leaves a token with that product
that is valid for their whole account, also on REST. The admin is not affected, because the admin can not approve a
product.

Whether this works with the real clients is not shown yet, see [Connector Test](roadmap.md#connector-test).

## Why OAuth

Hosted MCP connectors log in with OAuth 2.1 and PKCE, because the clients named in [Goals](goals.md) need it.

- ChatGPT needs OAuth for an authenticated server: protected resource metadata, an authorization server with discovery
  metadata, and the authorization code flow with PKCE and S256. It can not present API keys or customer mTLS
  certificates, and does not support machine-to-machine grants
  ([OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)). Its documentation has tools declare
  `securitySchemes`, which is [still to check](roadmap.md#connector-test), and the `resource` parameter sets the
  audience of the tokens ([OpenAI: full documentation](https://developers.openai.com/plugins/llms-full.txt)).
- Claude documents OAuth with discovery from a 401 carrying `WWW-Authenticate: Bearer resource_metadata=...`
  ([Claude: connector authentication](https://claude.com/docs/connectors/building/authentication.md),
  [Claude: custom connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)).
  It also lists authless servers, which [Goals](goals.md) rules out, and `static_headers` (beta), an API key or bearer
  token sent on every call, which HippoWiki does not use.
