# Connectors

This document defines how AI agents, scripts and web clients log in, and why HippoWiki uses OAuth. How tokens are
checked is in [Authentication](authentication.md).

## AI Agents

An AI agent acts as the account it logged in with. There are no tokens with fewer rights than their user.

- A person can log a connector in with their own account, unless it is the admin account.
- The admin account can log in at Keycloak, but [MCP rejects it](mcp.md#admin-account). The person who is the admin uses
  a separate account for connectors.
- A separate account, such as `alice-claude`, is a normal user: it gets its own folder rights, such as read-only, and
  shows up separately in the revision history.

## Scripts and Web Clients

REST accepts the same OAuth tokens as MCP, and there are no API tokens for now.

- Each script gets its own Keycloak client with a service account, and uses the client credentials grant.
- The service account is linked to a HippoWiki user like any other account.
- A script that administers the system has to use the one [admin](users.md#admin) account, which has one link.

## Client Registration

Each product gets one confidential client, created by hand in Keycloak, with S256 PKCE required. Its client ID and
secret are entered in the connector dialog of the product.

- ChatGPT: the redirect URI comes from the management page, see [Why OAuth](#why-oauth).
- Claude: the redirect URI is `https://claude.ai/api/mcp/auth_callback`, and the connector uses the option "Use your own
  OAuth client".
- Claude Code: the redirect URI is `http://localhost:38765/callback`, with the client ID given by `--client-id` and the
  port fixed by `--callback-port 38765`. Its client starts as confidential like the others, and the
  [Connector Test](roadmap.md#connector-test) shows whether it needs a secret.
- The audience of the tokens comes from a fixed Audience mapper set to the MCP URL, on a default client scope. One
  audience covers both MCP and REST.

These stay off:

- Client ID Metadata Documents (the `cimd` feature): experimental in Keycloak, and Keycloak rejects the document of
  ChatGPT ([Keycloak: MCP](https://www.keycloak.org/securing-apps/mcp-authz-server)).
- Anonymous dynamic client registration: the MCP specification is deprecating it, it would let anyone on the internet
  create clients, and Claude would register a new client on every fresh connection.
- Resource indicators (the `resource-indicators` feature): experimental in Keycloak. Without it Keycloak does not
  recognize the `resource` parameter that ChatGPT sends, so the audience comes from the mapper instead.

Accepted trade-off: everyone who adds a connector themselves uses the same client secret, and replacing it means
entering it again. The secret only identifies the product, and each person still has to log in.

Whether this works with the real clients is not shown yet, see [Connector Test](roadmap.md#connector-test).

## Why OAuth

Hosted MCP connectors log in with OAuth 2.1 and PKCE, because the clients named in [Goals](goals.md) need it.

- ChatGPT needs OAuth for an authenticated server: protected resource metadata, an authorization server with discovery
  metadata, and the authorization code flow with PKCE and S256. It can not present API keys or customer mTLS
  certificates, and does not support machine-to-machine grants
  ([OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)). The tools declare `securitySchemes`, and
  the `resource` parameter sets the audience of the tokens
  ([OpenAI: full documentation](https://developers.openai.com/plugins/llms-full.txt)).
- The redirect URI of ChatGPT depends on the authorization server:
  `https://chatgpt.com/connector_platform_oauth_redirect` with RFC 9207 issuer identification, otherwise
  `https://chatgpt.com/connector/oauth/{callback_id}`. Copy the exact value from the management page when setting this
  up ([OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)).
- Claude documents OAuth with discovery from a 401 carrying `WWW-Authenticate: Bearer resource_metadata=...`
  ([Claude: connector authentication](https://claude.com/docs/connectors/building/authentication.md),
  [Claude: custom connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)).
  It also lists authless servers, which [Goals](goals.md) rules out, and `static_headers` (beta), an API key or bearer
  token sent on every call, which HippoWiki does not use.
