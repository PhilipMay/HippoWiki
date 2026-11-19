"use server";

// "Approve" and "Deny" of the consent page of OAuth: thin adapters between its form and the OAuth service. Both check
// the request again from the submitted values, because the hidden fields of a form can hold anything; "Approve" asks
// for the password of the user first, "Deny" does not. Neither redirects to the client: they return the address of the
// client with the answer, and the form opens it. Next.js passes the address of a redirect to another site in a header
// that it splits at `;`, which a redirect address may contain.

import { redirect } from "next/navigation";

import { verifyOwnPassword } from "@/features/auth/password-check";
import { requireUser } from "@/features/auth/session";
import { wrongPasswordsWaitMessage } from "@/features/auth/wait-messages";
import { readAuthorizationFormData, readLifetime, readPassword, type ConsentFormState } from "@/features/oauth/forms";
import { MAX_GRANTS_PER_USER } from "@/features/grants/limits";
import * as authorizationService from "@/features/oauth/authorization-service";
import { issuer } from "@/features/oauth/issuer";
import { authorizationErrorUrl, authorizationResponseUrl } from "@/features/oauth/schema";
import { loginPath } from "@/lib/addresses";

const NOT_VALID_MESSAGE = "This request is no longer valid. Go back to the app and connect again.";
const LIFETIME_MESSAGE = "Choose how long the app keeps its access.";
const LIMIT_MESSAGE = `You already have ${MAX_GRANTS_PER_USER} connected apps, the most allowed. Revoke an app on your account page first.`;
const APPROVE_FAILED_MESSAGE = "The app could not be connected. Please try again.";
const DENY_FAILED_MESSAGE = "The answer could not be sent. Please try again.";
const OFF_MESSAGE = "Connecting apps is switched off in this wiki.";
const WRONG_PASSWORD_MESSAGE = "Wrong password";
const BUSY_MESSAGE = "Too many logins at the moment, please try again";
const PASSWORD_CHECK_FAILED_MESSAGE = "The password could not be checked. Please try again.";

/**
 * Checks the password that the consent form submitted, before every approval, whatever the lifetime: `null` when it
 * is right, otherwise the state to show. A wrong password counts as a failed login, and during a wait the password
 * is not checked.
 */
async function checkPassword(formData: FormData): Promise<ConsentFormState | null> {
  const result = await verifyOwnPassword(readPassword(formData), "consent");
  if (result.ok) return null;
  switch (result.error.code) {
    case "wrong-password":
      return { fieldErrors: { password: [WRONG_PASSWORD_MESSAGE] } };
    case "wait":
      return { fieldErrors: { password: [wrongPasswordsWaitMessage(result.error.waitMs)] } };
    // The session ended since `requireUser()`.
    case "not-logged-in":
      redirect(loginPath());
    case "busy":
      return { message: BUSY_MESSAGE };
    case "failed":
      return { message: PASSWORD_CHECK_FAILED_MESSAGE };
  }
}

/** The address of the client with an error that the service found in the request. */
function refusal(
  base: string,
  error: { redirectUri: string; state: string | null; error: string; description: string },
): ConsentFormState {
  return { redirectTo: authorizationErrorUrl(error.redirectUri, { ...error, iss: base }) };
}

/**
 * Approves the request of the consent form: checks the password of the logged-in user, then creates a code for the
 * user with the chosen lifetime and returns the address of the client with `code`, `state` and `iss`. Anything but the
 * right password creates no code and no grant. Returns the error to show if the password is wrong or has to wait, the
 * request is no longer valid, the user holds the most connected apps allowed or the code could not be created.
 */
export async function approve(formData: FormData): Promise<ConsentFormState> {
  const user = await requireUser();
  const base = issuer();
  if (base === null) return { message: OFF_MESSAGE };

  const refused = await checkPassword(formData);
  if (refused) return refused;

  const result = await authorizationService.createCode(
    user,
    readAuthorizationFormData(formData),
    readLifetime(formData),
  );
  if (!result.ok) {
    const { error } = result;
    switch (error.code) {
      case "unknown-client":
      case "foreign-redirect-uri":
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
  const user = await requireUser();
  const base = issuer();
  if (base === null) return { message: OFF_MESSAGE };

  const result = await authorizationService.checkAuthorizationRequest(user, readAuthorizationFormData(formData));
  if (!result.ok) {
    const { error } = result;
    switch (error.code) {
      case "unknown-client":
      case "foreign-redirect-uri":
        return { message: NOT_VALID_MESSAGE };
      case "refused":
        return refusal(base, error);
      case "failed":
        return { message: DENY_FAILED_MESSAGE };
    }
  }

  const { redirectUri, state } = result.value;
  return {
    redirectTo: authorizationErrorUrl(redirectUri, {
      error: "access_denied",
      description: "The user denied the request",
      state,
      iss: base,
    }),
  };
}
