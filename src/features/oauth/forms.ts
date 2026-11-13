// What only the consent page of OAuth and its form need: reading the parameters of an authorization request from an
// address or a form, the address of the consent page with them, and the state of the form. No server-only imports, so
// Client Components can use it.

import { AUTHORIZATION_PARAMS, type AuthorizationParams } from "@/features/oauth/schema";
import { oauthAuthorizePath, type SearchParams } from "@/lib/addresses";

/** The name of the field of the consent form with the lifetime of the grant. */
export const LIFETIME_FIELD = "lifetime";

/**
 * The parameters of an authorization request from the search parameters of `/oauth/authorize`. A parameter that is
 * sent more than once counts as missing: OAuth allows each one only once.
 */
export function readAuthorizationParams(searchParams: SearchParams): AuthorizationParams {
  const params: AuthorizationParams = {};
  for (const name of AUTHORIZATION_PARAMS) {
    const value = searchParams[name];
    if (typeof value === "string") params[name] = value;
  }
  return params;
}

/**
 * The parameters of an authorization request from the hidden fields of the consent form. They are what the page
 * showed; the actions check them again, because a crafted request can submit anything. A file counts as missing.
 */
export function readAuthorizationFormData(formData: FormData): AuthorizationParams {
  const params: AuthorizationParams = {};
  for (const name of AUTHORIZATION_PARAMS) {
    const values = formData.getAll(name);
    const value = values[0];
    if (values.length === 1 && typeof value === "string") params[name] = value;
  }
  return params;
}

/** The lifetime that the consent form submitted; a missing field and a file count as empty. */
export function readLifetime(formData: FormData): string {
  const value = formData.get(LIFETIME_FIELD);
  return typeof value === "string" ? value : "";
}

/**
 * The address of the consent page with all its search parameters, as it was asked for: where a user comes back to
 * after the login.
 */
export function authorizeAddress(searchParams: SearchParams): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    for (const each of typeof value === "string" ? [value] : (value ?? [])) query.append(name, each);
  }
  const text = query.toString();
  return text === "" ? oauthAuthorizePath() : `${oauthAuthorizePath()}?${text}`;
}

/**
 * State of the consent form after "Approve" or "Deny": where the browser goes next, the address of the client with
 * the answer, or why there is no answer.
 */
export type ConsentFormState = {
  /** The redirect address of the client with the code or the error; the form opens it. */
  redirectTo?: string;
  /** An error that is shown instead, e.g. when the request is no longer valid. */
  message?: string;
};

/** A Server Action behind the consent form: "Approve" or "Deny". It returns where to go, or the error to show. */
export type ConsentFormAction = (formData: FormData) => Promise<ConsentFormState>;
