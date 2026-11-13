// The rules of OAuth: the ids of clients, their redirect addresses, the parameters of an authorization request and of
// a registration, PKCE and the error codes. Pure, with no server-only imports. HippoWiki is an OAuth 2.1 authorization
// server for public clients only: no client has a secret, and every client proves itself with PKCE.

import { z } from "zod";

/** The error codes of OAuth that HippoWiki answers with (RFC 6749, RFC 7591 and RFC 8707). */
export const OAUTH_ERRORS = [
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "unsupported_response_type",
  "invalid_scope",
  "access_denied",
  "server_error",
  "temporarily_unavailable",
  // RFC 8707: the `resource` is not the MCP endpoint.
  "invalid_target",
  // RFC 7591: the errors of a registration.
  "invalid_redirect_uri",
  "invalid_client_metadata",
] as const;

export type OAuthError = (typeof OAUTH_ERRORS)[number];

/** The only scope a grant has: reading. Scopes that a client asks for and that are not known are ignored. */
export const GRANT_SCOPES = ["read"] as const;

/** The id of a row of a client: a UUID, like every other id. It is the `client_id` of a registered client. */
export const clientRowIdSchema = z.guid();

/** Returns the id if it is a well-formed id of a client row, otherwise `null`. */
export function parseClientRowId(id: string): string | null {
  const result = clientRowIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

/** The longest redirect address, metadata URL and `state` that are accepted. */
export const URL_MAX_LENGTH = 2048;

/** How many redirect addresses a client may have. */
export const MAX_REDIRECT_URIS = 10;

/** The longest name of a client; a longer one is cut. */
export const CLIENT_NAME_MAX_LENGTH = 50;

/** The name of a client that gave none. */
export const DEFAULT_CLIENT_NAME = "Connected app";

/** The hosts that are the own machine of the user: a native client listens there for its code. */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Schemes that are never the own scheme of a native app: they run code, show local or embedded content, or belong to
 * the browser itself. `http` and `https` have rules of their own and are not listed.
 */
const FORBIDDEN_SCHEMES = [
  "javascript",
  "data",
  "file",
  "vbscript",
  "blob",
  "about",
  "filesystem",
  "view-source",
  "resource",
  "jar",
  "chrome",
  "chrome-extension",
  "moz-extension",
  "ws",
  "wss",
  "ftp",
  "mailto",
  "tel",
  "sms",
];

/** The scheme of a URL as RFC 3986 writes it, in lower case. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** An `http` or `https` address as it is to be written: the scheme, two slashes and then the host. */
const WEB_ADDRESS = /^https?:\/\/[^/\\?#]/i;

function hasControlCharacterOrSpace(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Whether the URL is `http` on the own machine of the user, where a native client picks any free port. */
function isLoopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
}

/**
 * Returns the redirect address if a client may have it, otherwise `null`. It is `https`, `http` on a loopback
 * address, or the own scheme of a native app (such as `cursor://…`), never a scheme that runs code or shows local
 * content. It has no fragment, no user name or password, no spaces or control characters and at most 2048 characters.
 * The address is kept as the client wrote it, because the client sends the same text again.
 */
export function parseRedirectUri(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > URL_MAX_LENGTH) return null;
  if (hasControlCharacterOrSpace(value) || value.includes("#")) return null;
  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  if (scheme === undefined || FORBIDDEN_SCHEMES.includes(scheme)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  // The URL parser forgives `https:/host` and `https:///host`; a client that writes such an address is refused.
  if ((url.protocol === "https:" || url.protocol === "http:") && !WEB_ADDRESS.test(value)) return null;
  if (url.protocol === "https:") return value;
  if (url.protocol === "http:") return isLoopbackHttp(url) ? value : null;
  return value;
}

/**
 * Whether the redirect address of a request is one of the addresses of the client. It must be the same text. Only for
 * `http` on a loopback address the port is ignored, because a native client listens on whatever port is free
 * (RFC 8252): scheme, host, path and query must still be the same.
 */
export function isRedirectUriOf(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const url = parseUrl(requested);
  if (!url || !isLoopbackHttp(url)) return false;
  return registered.some((candidate) => {
    const other = parseUrl(candidate);
    return (
      other !== null &&
      isLoopbackHttp(other) &&
      other.hostname === url.hostname &&
      other.pathname === url.pathname &&
      other.search === url.search
    );
  });
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** What is shown of a redirect address on the consent page: its host, or its scheme for a native app. */
export function redirectTargetOf(redirectUri: string): string {
  const url = parseUrl(redirectUri);
  if (!url) return redirectUri;
  return url.protocol === "https:" || url.protocol === "http:" ? url.host : url.protocol.replace(/:$/, "://");
}

/** The name of a client as stored: trimmed, cut to 50 characters, "Connected app" when nothing is left. */
export function clientNameOf(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CLIENT_NAME;
  // By code points, so that a character outside the basic plane is not cut in half.
  const name = [...value.trim()].slice(0, CLIENT_NAME_MAX_LENGTH).join("").trim();
  return name === "" ? DEFAULT_CLIENT_NAME : name;
}

/** The redirect addresses of a client: 1 to 10, each one allowed, each one only once. */
export const redirectUrisSchema = z
  .array(z.unknown(), { error: "redirect_uris must be a list of addresses" })
  .min(1, "redirect_uris needs at least one address")
  .max(MAX_REDIRECT_URIS, `redirect_uris may have at most ${MAX_REDIRECT_URIS} addresses`)
  .transform((values, context) => {
    const uris: string[] = [];
    for (const value of values) {
      const uri = parseRedirectUri(value);
      if (uri === null) {
        context.addIssue({ code: "custom", message: "redirect_uris has an address that is not allowed" });
        return z.NEVER;
      }
      if (!uris.includes(uri)) uris.push(uri);
    }
    return uris;
  });

/**
 * The metadata of a client that asks to be registered (RFC 7591). Only the redirect addresses and the name are read:
 * the client is public, whatever else it asked for.
 */
export const clientRegistrationSchema = z.object({
  redirect_uris: redirectUrisSchema,
  client_name: z.unknown().optional().transform(clientNameOf),
});

/** A validated registration. */
export type ClientRegistration = z.output<typeof clientRegistrationSchema>;

/** A PKCE challenge of the method `S256`: the SHA-256 of the verifier in base64url, 43 characters. */
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** A PKCE verifier: 43 to 128 unreserved characters (RFC 7636). */
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** Whether the value is a PKCE challenge of the method `S256`. */
export function isCodeChallenge(value: string): boolean {
  return CODE_CHALLENGE.test(value);
}

/** Whether the value is a PKCE verifier. */
export function isCodeVerifier(value: string): boolean {
  return CODE_VERIFIER.test(value);
}

/**
 * The parameters of an authorization request as they arrive: from the query string of `/oauth/authorize` or from the
 * hidden fields of the consent form. Each is the text that was sent, or `undefined` when it is missing or repeated.
 */
export type AuthorizationParams = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
};

/** The names of the parameters of an authorization request, for reading them from a query string or a form. */
export const AUTHORIZATION_PARAMS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const satisfies readonly (keyof AuthorizationParams)[];

/**
 * Returns the `client_id` if it is the URL of a client's metadata document (Client ID Metadata Document), otherwise
 * `null`: an `https` URL with a path, on port 443, without user name, password or fragment, at most 2048 characters
 * long. It must be written the way a URL parser writes it, so that one document has one `client_id`: no upper case in
 * the host, no `.` or `..` in the path, no port that says 443 again.
 */
export function parseMetadataUrl(value: string): string | null {
  if (value.length > URL_MAX_LENGTH || !value.startsWith("https://") || value.includes("#")) return null;
  const url = parseUrl(value);
  if (!url || url.href !== value) return null;
  if (url.username !== "" || url.password !== "" || url.port !== "") return null;
  // A URL without a path is the address of a site, not of a document.
  return url.pathname === "/" ? null : value;
}

/** How long a fetched metadata document is used when its response does not say: an hour. */
export const METADATA_DEFAULT_CACHE_SECONDS = 60 * 60;
/** The shortest time a fetched metadata document is used, whatever its response says: five minutes. */
export const METADATA_MIN_CACHE_SECONDS = 5 * 60;
/** The longest time a fetched metadata document is used, whatever its response says: a day. */
export const METADATA_MAX_CACHE_SECONDS = 24 * 60 * 60;

/**
 * How many seconds a fetched metadata document is used before it is fetched again, from the `Cache-Control` header of
 * its response: its `max-age`, but at least five minutes and at most a day, and an hour without one. `no-store` and
 * `no-cache` count as the shortest time: the document is not fetched on every request.
 */
export function metadataCacheSeconds(cacheControl: string | null | undefined): number {
  if (!cacheControl) return METADATA_DEFAULT_CACHE_SECONDS;
  const directives = cacheControl.split(",").map((directive) => directive.trim().toLowerCase());
  if (directives.includes("no-store") || directives.includes("no-cache")) return METADATA_MIN_CACHE_SECONDS;
  for (const directive of directives) {
    const maxAge = /^max-age\s*=\s*"?(\d{1,12})"?$/.exec(directive)?.[1];
    if (maxAge !== undefined) {
      return Math.min(METADATA_MAX_CACHE_SECONDS, Math.max(METADATA_MIN_CACHE_SECONDS, Number(maxAge)));
    }
  }
  return METADATA_DEFAULT_CACHE_SECONDS;
}

/** A metadata document that passed the checks: what is stored of it. */
export type ClientMetadata = { name: string; redirectUris: string[] };

/** A metadata document, or why it was refused. */
export type ParseMetadataResult = { ok: true; metadata: ClientMetadata } | { ok: false; reason: string };

/**
 * Checks the metadata document that was fetched from the given URL. It must be a JSON object whose `client_id` is
 * exactly its URL, with a `client_name` and with `redirect_uris` that follow the rules of registered clients, and it
 * must not ask for anything but a public client: `token_endpoint_auth_method` is `none` or missing.
 */
export function parseMetadataDocument(url: string, document: unknown): ParseMetadataResult {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return { ok: false, reason: "not-an-object" };
  }
  const fields = document as Record<string, unknown>;
  if (fields.client_id !== url) return { ok: false, reason: "client-id-mismatch" };
  if (typeof fields.client_name !== "string" || fields.client_name.trim() === "") {
    return { ok: false, reason: "missing-client-name" };
  }
  const authMethod = fields.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") return { ok: false, reason: "not-a-public-client" };
  const redirectUris = redirectUrisSchema.safeParse(fields.redirect_uris);
  if (!redirectUris.success) return { ok: false, reason: "invalid-redirect-uris" };
  return { ok: true, metadata: { name: clientNameOf(fields.client_name), redirectUris: redirectUris.data } };
}
