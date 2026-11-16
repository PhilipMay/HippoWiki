// The reads of connected apps for Server Components: thin adapters on top of the service.

import { connection } from "next/server";

import { requireUser } from "@/features/auth/session";
import * as tokenService from "@/features/tokens/service";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database. Then it calls `requireUser()`, which redirects to the login
// page without a logged-in user, and passes that user to the service as the actor: the service returns only the
// actor's own grants.

/**
 * The connected apps of the logged-in user, newest first; `null` for an admin, who has no grants, and while OAuth is
 * off.
 */
export async function listTokens(): Promise<tokenService.TokenSummary[] | null> {
  await connection();
  const user = await requireUser();
  return tokenService.listTokens(user);
}
