// The metadata of the OAuth authorization server (RFC 8414). Public: a client reads it before it has a token.

import { authorizationServerMetadata } from "@/features/oauth/http";

/** The metadata document, or 404 while `HIPPOWIKI_PUBLIC_URL` is not set. */
export function GET(): Response {
  return authorizationServerMetadata();
}
