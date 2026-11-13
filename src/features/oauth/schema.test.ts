import { describe, expect, it } from "vitest";

import {
  CLIENT_NAME_MAX_LENGTH,
  clientNameOf,
  clientRegistrationSchema,
  GRANT_SCOPES,
  isCodeChallenge,
  isCodeVerifier,
  isRedirectUriOf,
  metadataCacheSeconds,
  OAUTH_ERRORS,
  parseClientRowId,
  parseMetadataDocument,
  parseMetadataUrl,
  parseRedirectUri,
  redirectTargetOf,
} from "@/features/oauth/schema";

describe("parseRedirectUri", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://client.example:8443/callback?tenant=a",
    "https://client.example",
    "http://localhost/callback",
    "http://localhost:6274/oauth/callback",
    "http://127.0.0.1:33418/callback",
    "http://[::1]:8080/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback",
    "vscode://vscode.github-authentication/did-authenticate",
    "com.example.app:/oauth2redirect",
    "claude://callback",
  ])("accepts %s and keeps it as it was written", (uri) => {
    expect(parseRedirectUri(uri)).toBe(uri);
  });

  it.each([
    ["http on a host that is not a loopback address", "http://client.example/callback"],
    ["http on a private address", "http://192.168.1.10/callback"],
    ["http on a host that only starts like localhost", "http://localhost.evil.example/callback"],
    ["http on another address of the loopback network", "http://127.0.0.2/callback"],
    ["a script", "javascript:alert(document.cookie)"],
    ["a script in upper case", "JavaScript:alert(1)"],
    ["a data address", "data:text/html,<script>alert(1)</script>"],
    ["a file", "file:///etc/passwd"],
    ["a blob", "blob:https://client.example/1234"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["about", "about:blank"],
    ["a browser page", "chrome://settings"],
    ["a web socket", "wss://client.example/callback"],
    ["ftp", "ftp://client.example/callback"],
    ["mail", "mailto:someone@client.example"],
    ["a fragment", "https://client.example/callback#token"],
    ["an empty fragment", "https://client.example/callback#"],
    ["a user name", "https://user@client.example/callback"],
    ["a user name and a password", "https://user:secret@client.example/callback"],
    ["a space", "https://client.example/call back"],
    ["a tab that the URL parser drops", "java\tscript:alert(1)"],
    ["a line break", "https://client.example/\ncallback"],
    ["a relative address", "/callback"],
    ["an address without a scheme", "client.example/callback"],
    ["an empty text", ""],
    ["a scheme that starts with a digit", "1app://callback"],
    ["https with three slashes", "https:///client.example/callback"],
    ["https with one slash", "https:/client.example/callback"],
    ["https with backslashes", "https:\\\\client.example\\callback"],
    ["http with three slashes on a loopback address", "http:///127.0.0.1/callback"],
  ])("refuses %s", (_case, uri) => {
    expect(parseRedirectUri(uri)).toBeNull();
  });

  it.each([null, undefined, 5, {}, ["https://client.example/callback"]])("refuses %j, which is no text", (value) => {
    expect(parseRedirectUri(value)).toBeNull();
  });

  it("accepts an address of 2048 characters and refuses a longer one", () => {
    const longest = `https://client.example/${"a".repeat(2048 - 23)}`;

    expect(longest).toHaveLength(2048);
    expect(parseRedirectUri(longest)).toBe(longest);
    expect(parseRedirectUri(`${longest}a`)).toBeNull();
  });
});

describe("isRedirectUriOf", () => {
  const registered = ["https://client.example/callback", "http://127.0.0.1/callback", "cursor://app/callback"];

  it("accepts an address that is the same text as a registered one", () => {
    for (const uri of registered) expect(isRedirectUriOf(registered, uri)).toBe(true);
  });

  it.each([
    ["another path", "https://client.example/other"],
    ["a longer path", "https://client.example/callback/more"],
    ["a query", "https://client.example/callback?next=1"],
    ["another host", "https://evil.example/callback"],
    ["a host that ends like the registered one", "https://evilclient.example/callback"],
    ["another scheme", "http://client.example/callback"],
    ["a port on a host that is no loopback address", "https://client.example:8443/callback"],
    ["a trailing slash", "https://client.example/callback/"],
    ["upper case in the path", "https://client.example/Callback"],
    ["another path of the own scheme", "cursor://app/other"],
    ["a port on the own scheme", "cursor://app:1/callback"],
  ])("refuses %s", (_case, uri) => {
    expect(isRedirectUriOf(registered, uri)).toBe(false);
  });

  it("ignores the port of http on a loopback address, because a native client picks a free one", () => {
    expect(isRedirectUriOf(registered, "http://127.0.0.1:53124/callback")).toBe(true);
    expect(isRedirectUriOf(["http://localhost:3000/cb"], "http://localhost:49152/cb")).toBe(true);
    expect(isRedirectUriOf(["http://[::1]:3000/cb"], "http://[::1]/cb")).toBe(true);
  });

  it.each([
    ["another path", "http://127.0.0.1:53124/other"],
    ["a query", "http://127.0.0.1:53124/callback?x=1"],
    ["another loopback host", "http://localhost:53124/callback"],
    ["https", "https://127.0.0.1:53124/callback"],
  ])("still refuses %s on a loopback address", (_case, uri) => {
    expect(isRedirectUriOf(registered, uri)).toBe(false);
  });

  it("refuses everything for a client without addresses and for a text that is no address", () => {
    expect(isRedirectUriOf([], "https://client.example/callback")).toBe(false);
    expect(isRedirectUriOf(registered, "not an address")).toBe(false);
  });
});

describe("redirectTargetOf", () => {
  it.each([
    ["https://claude.ai/api/mcp/auth_callback", "claude.ai"],
    ["https://client.example:8443/callback", "client.example:8443"],
    ["http://127.0.0.1:33418/callback", "127.0.0.1:33418"],
    ["cursor://anysphere.cursor-mcp/oauth/callback", "cursor://"],
    ["com.example.app:/oauth2redirect", "com.example.app://"],
  ])("shows %s as %s", (uri, target) => {
    expect(redirectTargetOf(uri)).toBe(target);
  });
});

describe("clientNameOf", () => {
  it("trims the name", () => {
    expect(clientNameOf("  Claude  ")).toBe("Claude");
  });

  it("cuts the name to 50 characters", () => {
    expect(CLIENT_NAME_MAX_LENGTH).toBe(50);
    expect(clientNameOf("a".repeat(80))).toBe("a".repeat(50));
    expect(clientNameOf(`${"a".repeat(49)}   more`)).toBe("a".repeat(49));
  });

  it("does not cut a character in half", () => {
    expect(clientNameOf("😀".repeat(60))).toBe("😀".repeat(50));
  });

  it.each(["", "   ", undefined, null, 5, { name: "Claude" }])("is Connected app for %j", (value) => {
    expect(clientNameOf(value)).toBe("Connected app");
  });
});

describe("clientRegistrationSchema", () => {
  it("reads the redirect addresses and the name, and nothing else", () => {
    const result = clientRegistrationSchema.safeParse({
      redirect_uris: ["https://client.example/callback", "http://127.0.0.1/callback"],
      client_name: " Example ",
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["client_credentials"],
      client_secret: "ignored",
    });

    expect(result.success && result.data).toEqual({
      redirect_uris: ["https://client.example/callback", "http://127.0.0.1/callback"],
      client_name: "Example",
    });
  });

  it("names a client without a name Connected app", () => {
    const result = clientRegistrationSchema.safeParse({ redirect_uris: ["https://client.example/callback"] });

    expect(result.success && result.data.client_name).toBe("Connected app");
  });

  it("keeps an address that is listed twice only once", () => {
    const result = clientRegistrationSchema.safeParse({
      redirect_uris: ["https://client.example/callback", "https://client.example/callback"],
    });

    expect(result.success && result.data.redirect_uris).toEqual(["https://client.example/callback"]);
  });

  it("accepts 10 addresses and refuses 11", () => {
    const uris = Array.from({ length: 11 }, (_, index) => `https://client.example/callback/${index}`);

    expect(clientRegistrationSchema.safeParse({ redirect_uris: uris.slice(0, 10) }).success).toBe(true);
    expect(clientRegistrationSchema.safeParse({ redirect_uris: uris }).success).toBe(false);
  });

  it.each([
    ["no addresses", {}],
    ["an empty list", { redirect_uris: [] }],
    ["a text instead of a list", { redirect_uris: "https://client.example/callback" }],
    [
      "an address that is not allowed among allowed ones",
      { redirect_uris: ["https://a.example/cb", "javascript:alert(1)"] },
    ],
    ["an address that is no text", { redirect_uris: [5] }],
    ["http on another host", { redirect_uris: ["http://client.example/callback"] }],
  ])("refuses %s", (_case, metadata) => {
    expect(clientRegistrationSchema.safeParse(metadata).success).toBe(false);
  });
});

describe("PKCE", () => {
  it("accepts a challenge of 43 base64url characters, the SHA-256 of a verifier", () => {
    expect(isCodeChallenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(isCodeChallenge(`${"A".repeat(42)}_`)).toBe(true);
  });

  it.each([
    ["an empty text", ""],
    ["42 characters", "A".repeat(42)],
    ["44 characters", "A".repeat(44)],
    ["padding", `${"A".repeat(42)}=`],
    ["a character of base64 that base64url does not have", `${"A".repeat(42)}+`],
    ["a verifier in plain", "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk.~"],
  ])("refuses %s as a challenge", (_case, value) => {
    expect(isCodeChallenge(value)).toBe(false);
  });

  it("accepts a verifier of 43 to 128 unreserved characters", () => {
    expect(isCodeVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(true);
    expect(isCodeVerifier("a".repeat(43))).toBe(true);
    expect(isCodeVerifier(`${"a".repeat(124)}-._~`)).toBe(true);
  });

  it.each([
    ["42 characters", "a".repeat(42)],
    ["129 characters", "a".repeat(129)],
    ["a space", `${"a".repeat(43)} `],
    ["a character that is not unreserved", `${"a".repeat(43)}+`],
    ["an empty text", ""],
  ])("refuses %s as a verifier", (_case, value) => {
    expect(isCodeVerifier(value)).toBe(false);
  });
});

describe("the ids, scopes and error codes", () => {
  it("parses the id of a client row and refuses everything else", () => {
    const id = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";

    expect(parseClientRowId(id)).toBe(id);
    for (const value of ["", "not-a-uuid", `${id}x`, "https://client.example/meta.json"]) {
      expect(parseClientRowId(value)).toBeNull();
    }
  });

  it("gives a grant only the scope read", () => {
    expect(GRANT_SCOPES).toEqual(["read"]);
  });

  it("knows the error codes of RFC 6749, RFC 7591 and RFC 8707 that it answers with", () => {
    expect(OAUTH_ERRORS).toEqual(
      expect.arrayContaining([
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
        "invalid_target",
        "invalid_redirect_uri",
        "invalid_client_metadata",
      ]),
    );
    // The codes are sent as they are: lower case with underscores.
    for (const error of OAUTH_ERRORS) expect(error).toMatch(/^[a-z_]+$/);
  });
});

describe("parseMetadataUrl", () => {
  it.each([
    "https://claude.ai/oauth/claude-code-client-metadata",
    "https://client.example/metadata.json",
    "https://client.example/a/b/c",
    "https://client.example/metadata.json?v=2",
    "https://sub.client.example/.well-known/oauth-client",
  ])("accepts %s as the client id of a metadata document", (url) => {
    expect(parseMetadataUrl(url)).toBe(url);
  });

  it.each([
    ["http", "http://client.example/metadata.json"],
    ["http on a loopback address", "http://127.0.0.1/metadata.json"],
    ["no path", "https://client.example"],
    ["only a slash as its path", "https://client.example/"],
    ["a port", "https://client.example:8443/metadata.json"],
    ["the port 443 written out", "https://client.example:443/metadata.json"],
    ["a user name", "https://user@client.example/metadata.json"],
    ["a user name and a password", "https://user:secret@client.example/metadata.json"],
    ["a fragment", "https://client.example/metadata.json#top"],
    ["a path with ..", "https://client.example/a/../metadata.json"],
    ["a path with .", "https://client.example/./metadata.json"],
    ["upper case in the host", "https://Client.Example/metadata.json"],
    ["upper case in the scheme", "HTTPS://client.example/metadata.json"],
    ["a space", "https://client.example/meta data.json"],
    ["three slashes", "https:///client.example/metadata.json"],
    ["a client id that is an id", "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10"],
    ["an empty text", ""],
  ])("refuses a URL with %s", (_case, url) => {
    expect(parseMetadataUrl(url)).toBeNull();
  });

  it("accepts a URL of 2048 characters and refuses a longer one", () => {
    const longest = `https://client.example/${"a".repeat(2048 - 23)}`;

    expect(parseMetadataUrl(longest)).toBe(longest);
    expect(parseMetadataUrl(`${longest}a`)).toBeNull();
  });
});

describe("metadataCacheSeconds", () => {
  it.each([
    ["no header", null, 3600],
    ["an empty header", "", 3600],
    ["a header without max-age", "public", 3600],
    ["max-age of an hour and a half", "max-age=5400", 5400],
    ["max-age among other directives", "public, max-age=7200, must-revalidate", 7200],
    ["max-age in upper case with spaces", "Public,  Max-Age = 600", 600],
    ["max-age in quotes", 'max-age="900"', 900],
    ["max-age below five minutes", "max-age=60", 300],
    ["max-age of zero", "max-age=0", 300],
    ["max-age above a day", "max-age=604800", 86400],
    ["a huge max-age", "max-age=999999999999", 86400],
    ["no-store", "no-store", 300],
    ["no-cache with a max-age", "no-cache, max-age=7200", 300],
    ["a max-age that is no number", "max-age=soon", 3600],
    ["a negative max-age", "max-age=-5", 3600],
    ["s-maxage only, which is for shared caches", "s-maxage=7200", 3600],
  ])("is right for %s", (_case, header, seconds) => {
    expect(metadataCacheSeconds(header)).toBe(seconds);
  });

  it("is an hour for a missing header", () => {
    expect(metadataCacheSeconds(undefined)).toBe(3600);
  });
});

describe("parseMetadataDocument", () => {
  const URL_OF_DOCUMENT = "https://client.example/metadata.json";
  const DOCUMENT = {
    client_id: URL_OF_DOCUMENT,
    client_name: "Example",
    redirect_uris: ["https://client.example/callback", "http://127.0.0.1/callback"],
  };

  it("accepts a document of a public client and keeps its name and redirect addresses", () => {
    expect(parseMetadataDocument(URL_OF_DOCUMENT, DOCUMENT)).toEqual({
      ok: true,
      metadata: { name: "Example", redirectUris: ["https://client.example/callback", "http://127.0.0.1/callback"] },
    });
  });

  it("accepts the auth method none and ignores what else the document says", () => {
    const document = {
      ...DOCUMENT,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_uri: "https://client.example",
      logo_uri: "https://client.example/logo.png",
      scope: "read write",
    };

    expect(parseMetadataDocument(URL_OF_DOCUMENT, document).ok).toBe(true);
  });

  it("trims a name and cuts it to 50 characters", () => {
    const result = parseMetadataDocument(URL_OF_DOCUMENT, { ...DOCUMENT, client_name: `  ${"a".repeat(80)}  ` });

    expect(result).toMatchObject({ ok: true, metadata: { name: "a".repeat(50) } });
  });

  it.each([
    ["a text", "client", "not-an-object"],
    ["a list", [DOCUMENT], "not-an-object"],
    ["null", null, "not-an-object"],
    ["no client id", { ...DOCUMENT, client_id: undefined }, "client-id-mismatch"],
    [
      "the client id of another document",
      { ...DOCUMENT, client_id: "https://evil.example/metadata.json" },
      "client-id-mismatch",
    ],
    ["a client id that differs by a slash", { ...DOCUMENT, client_id: `${URL_OF_DOCUMENT}/` }, "client-id-mismatch"],
    [
      "a client id that differs in case",
      { ...DOCUMENT, client_id: URL_OF_DOCUMENT.toUpperCase() },
      "client-id-mismatch",
    ],
    ["no name", { ...DOCUMENT, client_name: undefined }, "missing-client-name"],
    ["an empty name", { ...DOCUMENT, client_name: "   " }, "missing-client-name"],
    ["a name that is no text", { ...DOCUMENT, client_name: 5 }, "missing-client-name"],
    [
      "a client secret method",
      { ...DOCUMENT, token_endpoint_auth_method: "client_secret_basic" },
      "not-a-public-client",
    ],
    ["a private key method", { ...DOCUMENT, token_endpoint_auth_method: "private_key_jwt" }, "not-a-public-client"],
    ["an auth method that is no text", { ...DOCUMENT, token_endpoint_auth_method: null }, "not-a-public-client"],
    ["no redirect addresses", { ...DOCUMENT, redirect_uris: undefined }, "invalid-redirect-uris"],
    ["an empty list of redirect addresses", { ...DOCUMENT, redirect_uris: [] }, "invalid-redirect-uris"],
    [
      "a script as a redirect address",
      { ...DOCUMENT, redirect_uris: ["javascript:alert(1)"] },
      "invalid-redirect-uris",
    ],
    [
      "http on another host as a redirect address",
      { ...DOCUMENT, redirect_uris: ["http://client.example/cb"] },
      "invalid-redirect-uris",
    ],
    [
      "11 redirect addresses",
      { ...DOCUMENT, redirect_uris: Array.from({ length: 11 }, (_, i) => `https://client.example/${i}`) },
      "invalid-redirect-uris",
    ],
  ])("refuses %s", (_case, document, reason) => {
    expect(parseMetadataDocument(URL_OF_DOCUMENT, document)).toEqual({ ok: false, reason });
  });
});
