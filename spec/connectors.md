# Connectors

This document defines how AI agents, people and scripts log in, and why HippoWiki uses OAuth. How tokens are checked is
in [Authentication](authentication.md).

## AI Agents

An AI agent acts as the account it logged in with. There are no tokens with fewer rights than their user.

- A person can log a connector in with their own account, unless it is the admin account.
- The admin account can log in at Keycloak, but [MCP rejects it](mcp.md#admin-account). The person who is the admin uses
  a separate account for connectors.
- A separate account, such as `alice-claude`, is a normal user: it gets its own folder rights, such as read-only, and
  shows up separately in the revision history.

## People

REST accepts the same OAuth tokens as MCP. Admins and normal users log in the same way, and what they can do depends
only on their account.

- **Web GUI**, which comes [later](roadmap.md#later): the normal way for a person to use REST.
  - Its server part is a separate confidential Keycloak client, which logs in with the authorization code flow and S256
    PKCE and keeps the tokens. It adds the bearer token when it calls REST.
  - The browser only gets a session cookie that scripts can not read. The GUI displays Markdown written by other users,
    so a script that runs through a rendering bug must not be able to take the tokens away.
  - Cookies end at this server, so REST stays bearer only, and HippoWiki itself keeps no login routes or stored tokens.
- **CLI client**: until the Web GUI exists, and for work in a terminal afterwards, a person logs in through the public
  client `hippowiki-cli` with the device flow. They approve a code in any browser and use the token with `curl` or a
  similar tool, see the [guide](../doc/nixos-keycloak-setup.md#logging-in-on-the-command-line).

## Scripts

There are no API tokens for now.

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
  port fixed by `--callback-port 38765`. Its client is confidential like the others, so it also needs `--client-secret`,
  which asks for the secret and works only when the server is added
  ([Claude Code: MCP](https://code.claude.com/docs/en/mcp)).
- The audience of the tokens comes from a fixed Audience mapper set to the MCP URL, on a default client scope. One
  audience covers both MCP and REST.
- Each product client has "Consent required" on, so a connector can not log in silently through a Keycloak session that
  is already open in the browser, such as the admin's. The clients of the [Web GUI and the CLI](#people) belong to
  HippoWiki and ask for no consent.

These stay off:

- Client ID Metadata Documents (the `cimd` feature): experimental in Keycloak, and Keycloak rejects the document of
  ChatGPT ([Keycloak: MCP](https://www.keycloak.org/securing-apps/mcp-authz-server)).
- Anonymous dynamic client registration: the MCP specification is deprecating it, it would let anyone on the internet
  create clients, and Claude would register a new client on every fresh connection.
- Resource indicators (the `resource-indicators` feature): experimental in Keycloak. Without it Keycloak does not
  recognize the `resource` parameter that ChatGPT sends, so the audience comes from the mapper instead.

Accepted trade-off: everyone who adds a connector themselves uses the same client secret, and replacing it means
entering it again. In Claude the authentication settings can not be edited, so this means removing the connector, adding
it again and reconnecting ([Claude: unlisted connectors](https://claude.com/docs/connectors/custom/add-unlisted.md)).
The secret only identifies the product, and each person still has to log in.

Accepted trade-off: tokens are not bound to a client. A person who accepts the consent screen of a product leaves a
token with that product that is valid for their whole account, also on REST. If the person logged in with the admin
account, MCP rejects it, but the token still works for every admin operation on REST. So the admin account must not be
used for a connector, see [AI Agents](#ai-agents).

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
