// The token endpoint of OAuth. Public: a client proves itself with the code and its PKCE verifier, or with its refresh
// token, not with a session. The route only hands the request to the adapter.

import { handleToken } from "@/features/oauth/http";

/** Exchanges a code for a grant, or refreshes a grant. */
export function POST(request: Request): Promise<Response> {
  return handleToken(request);
}
