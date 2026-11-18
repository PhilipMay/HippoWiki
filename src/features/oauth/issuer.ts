// What the OAuth authorization server is called from outside: its issuer and the protected resources it gives access
// to, the MCP addresses of the folders. All come from `HIPPOWIKI_PUBLIC_URL`; without it there is no OAuth. No import
// of `next`, so the service and the adapters share it.

import { parseMcpResource, type McpAddress } from "@/features/oauth/schema";
import { mcpFolderPath, protectedResourceMetadataPath } from "@/lib/addresses";
import { getServerEnv } from "@/lib/env";

/**
 * The issuer of the authorization server: exactly `HIPPOWIKI_PUBLIC_URL`, the origin without a trailing slash. `null`
 * while the variable is not set, which switches OAuth off.
 */
export function issuer(): string | null {
  return getServerEnv().HIPPOWIKI_PUBLIC_URL ?? null;
}

/**
 * Whether OAuth is on: only with `HIPPOWIKI_PUBLIC_URL`. Without it no app can connect, no grant can be used, and
 * there is no MCP server. Where the address itself is needed, `issuer()` gives it.
 */
export function isOAuthOn(): boolean {
  return issuer() !== null;
}

/**
 * The protected resource that a grant to the given MCP address gives access to: the full address
 * `<HIPPOWIKI_PUBLIC_URL>/mcp/<folder-uuid>/<role>`. It is what a client sends as the `resource` parameter
 * (RFC 8707). `null` while OAuth is off.
 */
export function mcpResourceOf({ folderId, role }: McpAddress): string | null {
  const publicUrl = issuer();
  return publicUrl === null ? null : `${publicUrl}${mcpFolderPath(folderId, role)}`;
}

/**
 * The MCP address that a `resource` names, if it is exactly a full MCP address of a folder of this wiki as
 * `mcpResourceOf()` writes it; `null` for anything else and while OAuth is off (`parseMcpResource()`).
 */
export function mcpAddressOf(resource: string | undefined): McpAddress | null {
  const publicUrl = issuer();
  return publicUrl === null ? null : parseMcpResource(resource, publicUrl);
}

/**
 * Where the metadata of the protected resource at the given MCP address is (RFC 9728), for the `resource_metadata` of
 * its `WWW-Authenticate` header: a client that gets a 401 finds the authorization server from there. `null` while
 * OAuth is off.
 */
export function protectedResourceMetadataUrl({ folderId, role }: McpAddress): string | null {
  const publicUrl = issuer();
  return publicUrl === null ? null : `${publicUrl}${protectedResourceMetadataPath(folderId, role)}`;
}
