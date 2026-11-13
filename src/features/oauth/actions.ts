"use server";

// "Approve" and "Deny" of the consent page of OAuth: thin adapters between its form and the OAuth service. Both check
// the request again from the submitted values, because the hidden fields of a form can hold anything. Neither
// redirects: they return the address of the client with the answer, and the form opens it. Next.js passes the address
// of a redirect to another site in a header that it splits at `;`, which a redirect address may contain.

import { requireUser } from "@/features/auth/session";
import { readAuthorizationFormData, readLifetime, type ConsentFormState } from "@/features/oauth/forms";
import { issuer } from "@/features/oauth/issuer";
import { authorizationResponseUrl } from "@/features/oauth/schema";
import * as oauthService from "@/features/oauth/service";
import { MAX_TOKENS_PER_USER } from "@/features/tokens/service";

const NOT_VALID_MESSAGE = "This request is no longer valid. Go back to the app and connect again.";
const LIFETIME_MESSAGE = "Choose how long the app keeps its access.";
const LIMIT_MESSAGE = `You already have ${MAX_TOKENS_PER_USER} tokens, the most allowed. Revoke one on your account page first.`;
const APPROVE_FAILED_MESSAGE = "The app could not be connected. Please try again.";
const DENY_FAILED_MESSAGE = "The answer could not be sent. Please try again.";
const OFF_MESSAGE = "Connecting apps is switched off in this wiki.";

/** The address of the client with an error that the service found in the request. */
function refusal(
  base: string,
  error: { redirectUri: string; state: string | null; error: string; description: string },
): ConsentFormState {
  return {
    redirectTo: authorizationResponseUrl(error.redirectUri, {
      error: error.error,
      error_description: error.description,
      state: error.state,
      iss: base,
    }),
  };
}

/**
 * Approves the request of the consent form: creates a code for the logged-in user with the chosen lifetime and
 * returns the address of the client with `code`, `state` and `iss`. Returns the error to show if the request is no
 * longer valid, the user holds the most tokens allowed or the code could not be created.
 */
export async function approve(formData: FormData): Promise<ConsentFormState> {
  const user = await requireUser();
  const base = issuer();
  if (base === null) return { message: OFF_MESSAGE };

  const result = await oauthService.createCode(user, readAuthorizationFormData(formData), readLifetime(formData));
  if (!result.ok) {
    const { error } = result;
    switch (error.code) {
      case "invalid-client":
      case "invalid-redirect-uri":
        return { message: NOT_VALID_MESSAGE };
      case "refused":
        return refusal(base, error);
      case "invalid-lifetime":
        return { message: LIFETIME_MESSAGE };
      case "limit-reached":
        return { message: LIMIT_MESSAGE };
      case "failed":
        return { message: APPROVE_FAILED_MESSAGE };
    }
  }

  const { code, request } = result.value;
  return { redirectTo: authorizationResponseUrl(request.redirectUri, { code, state: request.state, iss: base }) };
}

/**
 * Denies the request of the consent form: returns the address of the client with the error `access_denied`, `state`
 * and `iss`. Nothing is written. Returns the error to show if the request is no longer valid.
 */
export async function deny(formData: FormData): Promise<ConsentFormState> {
  await requireUser();
  const base = issuer();
  if (base === null) return { message: OFF_MESSAGE };

  const result = await oauthService.checkAuthorizationRequest(readAuthorizationFormData(formData));
  if (!result.ok) {
    const { error } = result;
    switch (error.code) {
      case "invalid-client":
      case "invalid-redirect-uri":
        return { message: NOT_VALID_MESSAGE };
      case "refused":
        return refusal(base, error);
      case "failed":
        return { message: DENY_FAILED_MESSAGE };
    }
  }

  const { redirectUri, state } = result.value;
  return {
    redirectTo: authorizationResponseUrl(redirectUri, {
      error: "access_denied",
      error_description: "The user denied the request",
      state,
      iss: base,
    }),
  };
}
