// What the consent page of OAuth reads: an adapter between the page and the OAuth service. It decides what the page
// shows for an authorization request, so that the decision can be tested without rendering the page.

import { connection } from "next/server";

import { requireUser } from "@/features/auth/session";
import { authorizeAddress, readAuthorizationParams } from "@/features/oauth/forms";
import { issuer } from "@/features/oauth/issuer";
import { authorizationResponseUrl, redirectTargetOf, type AuthorizationParams } from "@/features/oauth/schema";
import * as oauthService from "@/features/oauth/service";
import type { McpRole } from "@/features/folder-roles/roles";
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
  /**
   * The request is wrong in another way, the user is an admin, who connects no apps, or no app can be connected to
   * its MCP address: the reason is shown, and the client is told at its redirect address only when the user follows
   * the link there.
   */
  | { kind: "refused"; redirectTo: string; target: string; description: string }
  /** The request is valid: the user is asked. */
  | {
      kind: "consent";
      /** The name the client gave itself. */
      clientName: string;
      /** Where the code goes: the host of the redirect address, or the scheme of a native app. */
      target: string;
      /** The logged-in user who is asked. */
      userName: string;
      /** The name of the folder of the MCP address the app connects to. */
      folderName: string;
      /** The role of the MCP address: the most the app may do on the folder. */
      role: McpRole;
      /** Whether the user holds the most connected apps allowed, the grants this one would replace not counted. */
      limitReached: boolean;
      /** The parameters of the request, which the form submits again. */
      params: AuthorizationParams;
    };

/** What the consent page shows for a request that the client is told about at its redirect address. */
function refused(
  base: string,
  {
    redirectUri,
    state,
    error,
    description,
  }: Pick<oauthService.AuthorizationRequest, "redirectUri" | "state"> & {
    error: string;
    description: string;
  },
): Consent {
  return {
    kind: "refused",
    target: redirectTargetOf(redirectUri),
    // Written by the wiki itself, so it can be shown.
    description,
    redirectTo: authorizationResponseUrl(redirectUri, { error, error_description: description, state, iss: base }),
  };
}

/**
 * Decides what the consent page shows for the authorization request in the search parameters of its address. Without
 * a session it leads to the login page and back here with the whole query, as `requireUser()` does with a way back.
 * The service checks the request for the user: an admin, who connects no apps, and a user who may not connect to its
 * MCP address are told so, with the way back to the client and the error `access_denied`; an unknown client or a
 * foreign redirect address is answered as for every other user.
 */
export async function loadConsent(searchParams: SearchParams): Promise<Consent> {
  await connection();
  const user = await requireUser(authorizeAddress(searchParams));

  const base = issuer();
  if (base === null) return { kind: "not-found" };

  const params = readAuthorizationParams(searchParams);
  const checked = await oauthService.checkAuthorizationRequest(user, params);
  if (!checked.ok) {
    const { error } = checked;
    switch (error.code) {
      case "invalid-client":
      case "invalid-redirect-uri":
      case "failed":
        return { kind: "untrusted", reason: error.code };
      case "refused":
        return refused(base, error);
    }
  }

  const { client, redirectUri, address } = checked.value;
  let limitReached: boolean;
  try {
    limitReached = await oauthService.isGrantLimitReached(user, client.id, {
      folderId: address.folder.id,
      role: address.role,
    });
  } catch (err) {
    logger.error({ err, userId: user.id, clientId: client.id }, "failed to count the grants for the consent page");
    return { kind: "untrusted", reason: "failed" };
  }
  return {
    kind: "consent",
    clientName: client.name,
    target: redirectTargetOf(redirectUri),
    userName: user.name,
    folderName: address.folder.name,
    role: address.role,
    limitReached,
    params,
  };
}
