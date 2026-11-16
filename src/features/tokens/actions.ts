"use server";

// The writes of connected apps for forms: thin adapters that translate between a form and the service. Every action
// calls `requireUser()` first, which redirects to the login page without a logged-in user, and passes that user to the
// service as the actor: the service only ever touches the actor's own grants.

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { issuer } from "@/features/oauth/issuer";
import type { RevokeTokenFormState } from "@/features/tokens/forms";
import { parseTokenId } from "@/features/tokens/schema";
import * as tokenService from "@/features/tokens/service";
import { accountPath } from "@/lib/addresses";

const REVOKE_FAILED_MESSAGE = "The app could not be revoked. Please try again.";

/**
 * Revokes the logged-in user's connected app with the given id and redirects to the account. While OAuth is off, a
 * malformed id, an unknown app and the app of another user show the not-found page, like the address of the dialog
 * would. Returns the error to show if the app cannot be revoked. Bind the id with `revokeToken.bind(null, id)`.
 */
export async function revokeToken(id: string): Promise<RevokeTokenFormState> {
  const user = await requireUser();

  // Without a public URL the account page lists no apps, so there is none to revoke.
  if (issuer() === null) notFound();
  const tokenId = parseTokenId(id);
  if (!tokenId) notFound();

  const result = await tokenService.revokeToken(user, tokenId);
  if (!result.ok) {
    switch (result.error.code) {
      // An admin has no grants, so no app of an admin is found.
      case "not-allowed":
      case "token-not-found":
        notFound();
      case "failed":
        return { message: REVOKE_FAILED_MESSAGE };
    }
  }

  revalidatePath(accountPath());
  redirect(accountPath());
}
