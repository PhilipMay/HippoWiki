"use server";

// The writes of API tokens for forms: thin adapters that translate between a form and the service. Every action calls
// `requireUser()` first, which redirects to the login page without a logged-in user, and passes that user to the
// service as the actor: the service only ever touches the actor's own tokens.

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { parseTokenFormData, type CreateTokenFormState, type RevokeTokenFormState } from "@/features/tokens/forms";
import { parseTokenId } from "@/features/tokens/schema";
import * as tokenService from "@/features/tokens/service";
import { accountPath } from "@/lib/addresses";

const LIMIT_REACHED_MESSAGE = `You already have ${tokenService.MAX_TOKENS_PER_USER} tokens, the most allowed. Revoke one to create a new one.`;
const CREATE_FAILED_MESSAGE = "The token could not be created. Please try again.";
const REVOKE_FAILED_MESSAGE = "The token could not be revoked. Please try again.";

/**
 * Creates a token for the logged-in user from the submitted name, scopes and expiry choice. On success it returns the
 * name and the token in its form state and does not redirect: the token is shown exactly once and must not be part of
 * an address or of a stored page. Returns the errors to show in the form if the input is invalid, the user holds the
 * most tokens allowed or the token cannot be stored.
 */
export async function createToken(_prevState: CreateTokenFormState, formData: FormData): Promise<CreateTokenFormState> {
  const user = await requireUser();

  const input = parseTokenFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  const result = await tokenService.createToken(user, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "limit-reached":
        return { message: LIMIT_REACHED_MESSAGE };
      case "failed":
        return { message: CREATE_FAILED_MESSAGE };
    }
  }

  // The list behind the dialog shows the new token.
  revalidatePath(accountPath());
  return { created: { name: result.value.token.name, secret: result.value.secret } };
}

/**
 * Revokes the logged-in user's token with the given id and redirects to the account. A malformed id, an unknown token
 * and the token of another user show the not-found page, like the address of the dialog would. Returns the error to
 * show if the token cannot be revoked. Bind the id with `revokeToken.bind(null, id)`.
 */
export async function revokeToken(id: string): Promise<RevokeTokenFormState> {
  const user = await requireUser();

  const tokenId = parseTokenId(id);
  if (!tokenId) notFound();

  const result = await tokenService.revokeToken(user, tokenId);
  if (!result.ok) {
    switch (result.error.code) {
      case "token-not-found":
        notFound();
      case "failed":
        return { message: REVOKE_FAILED_MESSAGE };
    }
  }

  revalidatePath(accountPath());
  redirect(accountPath());
}
