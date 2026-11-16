"use server";

// The writes of connected apps for forms: thin adapters that translate between a form and the service. Every action
// calls `requireUser()` first, which redirects to the login page without a logged-in user, and passes that user to the
// service as the actor: the service only ever touches the actor's own grants.

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { issuer } from "@/features/oauth/issuer";
import type { RevokeAppFormState } from "@/features/grants/forms";
import { parseGrantId } from "@/features/grants/schema";
import * as grantService from "@/features/grants/service";
import { accountPath } from "@/lib/addresses";

const REVOKE_FAILED_MESSAGE = "The app could not be revoked. Please try again.";

/**
 * Revokes the logged-in user's connected app with the given id and redirects to the account. While OAuth is off, and
 * for a malformed id, an unknown app and the app of another user, it shows the not-found page, like the address of the
 * dialog would. Returns the error to show if the app cannot be revoked. Bind the id with `revokeGrant.bind(null, id)`.
 */
export async function revokeGrant(id: string): Promise<RevokeAppFormState> {
  const user = await requireUser();

  // Without a public URL the account page lists no apps, so there is none to revoke.
  if (issuer() === null) notFound();
  const grantId = parseGrantId(id);
  if (!grantId) notFound();

  const result = await grantService.revokeGrant(user, grantId);
  if (!result.ok) {
    switch (result.error.code) {
      // An admin has no grants, so no app of an admin is found.
      case "not-allowed":
      case "grant-not-found":
        notFound();
      case "failed":
        return { message: REVOKE_FAILED_MESSAGE };
    }
  }

  revalidatePath(accountPath());
  redirect(accountPath());
}
