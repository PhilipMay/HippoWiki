// The registration endpoint of OAuth (dynamic client registration, RFC 7591). Public: a client registers before a
// user is involved. The route only hands the request to the adapter, which limits how often a client address group
// may register.

import { handleRegister } from "@/features/oauth/http";

/** Registers a client from the JSON metadata of the request. */
export function POST(request: Request): Promise<Response> {
  return handleRegister(request);
}
