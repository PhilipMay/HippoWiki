// What the consent page of OAuth reads: an adapter between the page and the OAuth service. It decides what the page
// shows for an authorization request, so that the decision can be tested without rendering the page.

import { connection } from "next/server";

import { requireUser } from "@/features/auth/session";
import { authorizeAddress, readAuthorizationParams } from "@/features/oauth/forms";
import { issuer } from "@/features/oauth/issuer";
import { authorizationResponseUrl, redirectTargetOf, type AuthorizationParams } from "@/features/oauth/schema";
import * as oauthService from "@/features/oauth/service";
import type { SearchParams } from "@/lib/addresses";
import { logger } from "@/lib/logger";

/** What the consent page shows for an authorization request. */
export type Consent =
  /** OAuth is off: there is no consent page. */
  | { kind: "not-found" }
  /**
   * The client is unknown or the redirect address is not one of its own: the reason is shown, and the browser is not
   * sent anywhere, because the address cannot be trusted.
   */
  | { kind: "untrusted"; reason: "invalid-client" | "invalid-redirect-uri" | "failed" }
  /** The request is wrong in another way: the client is told, at its redirect address. */
  | { kind: "refused"; redirectTo: string; target: string }
  /** The request is valid: the user is asked. */
  | {
      kind: "consent";
      /** The name the client gave itself. */
      clientName: string;
      /** Where the code goes: the host of the redirect address, or the scheme of a native app. */
      target: string;
      /** The logged-in user who is asked. */
      userName: string;
      /** Whether the user holds the most tokens allowed, the grants this one would replace not counted. */
      limitReached: boolean;
      /** The parameters of the request, which the form submits again. */
      params: AuthorizationParams;
    };

/**
 * Decides what the consent page shows for the authorization request in the search parameters of its address. Without
 * a session it leads to the login page and back here with the whole query, as `requireUser()` does with a way back.
 */
export async function loadConsent(searchParams: SearchParams): Promise<Consent> {
  await connection();
  const user = await requireUser(authorizeAddress(searchParams));

  const base = issuer();
  if (base === null) return { kind: "not-found" };

  const params = readAuthorizationParams(searchParams);
  const checked = await oauthService.checkAuthorizationRequest(params);
  if (!checked.ok) {
    const { error } = checked;
    switch (error.code) {
      case "invalid-client":
      case "invalid-redirect-uri":
      case "failed":
        return { kind: "untrusted", reason: error.code };
      case "refused":
        return {
          kind: "refused",
          target: redirectTargetOf(error.redirectUri),
          redirectTo: authorizationResponseUrl(error.redirectUri, {
            error: error.error,
            error_description: error.description,
            state: error.state,
            iss: base,
          }),
        };
    }
  }

  const { client, redirectUri } = checked.value;
  let limitReached: boolean;
  try {
    limitReached = await oauthService.isTokenLimitReached(user, client.id);
  } catch (err) {
    logger.error({ err, userId: user.id, clientId: client.id }, "failed to count the tokens for the consent page");
    return { kind: "untrusted", reason: "failed" };
  }
  return {
    kind: "consent",
    clientName: client.name,
    target: redirectTargetOf(redirectUri),
    userName: user.name,
    limitReached,
    params,
  };
}
