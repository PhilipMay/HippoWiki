// What the OAuth authorization server is called from outside: its issuer and the protected resource it gives access
// to. Both come from `HIPPOWIKI_PUBLIC_URL`; without it there is no OAuth. No import of `next`, so the service and the
// adapters share it.

import { mcpPath } from "@/lib/addresses";
import { getServerEnv } from "@/lib/env";

/**
 * The issuer of the authorization server: exactly `HIPPOWIKI_PUBLIC_URL`, the origin without a trailing slash. `null`
 * while the variable is not set, which switches OAuth off.
 */
export function issuer(): string | null {
  return getServerEnv().HIPPOWIKI_PUBLIC_URL ?? null;
}

/**
 * The protected resource that a grant gives access to: the address of the MCP endpoint. It is what a client sends as
 * the `resource` parameter (RFC 8707). `null` while OAuth is off.
 */
export function mcpResource(): string | null {
  const publicUrl = issuer();
  return publicUrl === null ? null : `${publicUrl}${mcpPath()}`;
}
