// The check of the own password of the logged-in user for a Server Action of another feature, such as "Approve" on the
// consent page of OAuth: it reads the headers and the client address group of the request, so that only the auth
// feature reads the headers of the request for the session, and asks the auth service. Not a Server Action itself.

import { headers } from "next/headers";

import { requestClientAddressGroup } from "@/features/auth/client-address";
import * as authService from "@/features/auth/service";
import type { ActionProbeSource } from "@/lib/client-address-probe";
import type { Result } from "@/lib/result";

/**
 * Checks the password of the logged-in user of the request, counted like a login (`verifyPassword()` of the auth
 * service). `source` names the action in the client address probe.
 */
export async function verifyOwnPassword(
  password: string,
  source: ActionProbeSource,
): Promise<Result<authService.PasswordVerified, authService.VerifyPasswordError>> {
  const requestHeaders = await headers();
  return authService.verifyPassword(password, requestHeaders, requestClientAddressGroup(requestHeaders, source));
}
