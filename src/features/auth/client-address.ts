// The client address group of the request of a Server Action of the auth feature that counts a password: the login,
// the password changes and the approval of an app. `/login` does not pass `src/proxy.ts`, and the counts of the
// passwords are kept per user name and group, so these actions read the group from the headers of their request
// themselves, all in the same way; the auth service gets only the group.

import { clientAddressGroup } from "@/lib/client-address";
import { logClientAddressProbe, type ActionProbeSource } from "@/lib/client-address-probe";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * The client address group of the request with the given headers, by `HIPPOWIKI_TRUSTED_PROXIES`. A missing or bad
 * entry of `X-Forwarded-For` gives the shared group and a warning with the reason, never the value of the header
 * (`HIPPOWIKI_LOG_CLIENT_ADDRESS` shows it). The probe of the headers is logged first, so that it shows whether a
 * Server Action sees the same forwarding headers as the proxy of Next.js.
 */
export function requestClientAddressGroup(requestHeaders: Headers, source: ActionProbeSource): string {
  logClientAddressProbe(requestHeaders, { source });
  const { group, fallback } = clientAddressGroup(requestHeaders, getServerEnv().HIPPOWIKI_TRUSTED_PROXIES);
  if (fallback) {
    logger.warn({ source, reason: fallback }, "no client address in X-Forwarded-For, counted in the shared group");
  }
  return group;
}
