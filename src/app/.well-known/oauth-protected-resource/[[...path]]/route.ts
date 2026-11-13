// The metadata of the protected resource `/mcp` (RFC 9728), at `/.well-known/oauth-protected-resource` and at the
// same address followed by `/mcp`. Public: a client reads it after the 401 of `/mcp`, before it has a token.

import { protectedResourceMetadata } from "@/features/oauth/http";

/** The metadata document, or 404 for another path and while `HIPPOWIKI_PUBLIC_URL` is not set. */
export async function GET(
  _request: Request,
  context: RouteContext<"/.well-known/oauth-protected-resource/[[...path]]">,
): Promise<Response> {
  const { path } = await context.params;
  return protectedResourceMetadata(path);
}
