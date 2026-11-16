// The metadata of the protected resource at an MCP address of a folder (RFC 9728), at
// `/.well-known/oauth-protected-resource/mcp/<folder-uuid>/<role>`. Public: a client reads it after the 401 of the MCP
// address, before it has a token.

import { protectedResourceMetadata } from "@/features/oauth/http";

/** The metadata document, or 404 for another path and while `HIPPOWIKI_PUBLIC_URL` is not set. */
export async function GET(
  _request: Request,
  context: RouteContext<"/.well-known/oauth-protected-resource/[[...path]]">,
): Promise<Response> {
  const { path } = await context.params;
  return protectedResourceMetadata(path);
}
