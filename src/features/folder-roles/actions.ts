"use server";

// The writes of folder roles for forms: thin adapters that translate between a form and the service. Every action calls
// `requireUser()` first, which redirects to the login page without a logged-in user: a Server Action is a public
// endpoint, whatever page shows its form. The call stands outside every `try` block, because the redirect throws. The
// user it returns is passed to the service as the actor: the service decides whether the user may do it.

import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { parseGiveRoleFormData, type GiveRoleFormState } from "@/features/folder-roles/forms";
import * as folderRoleService from "@/features/folder-roles/service";
import { parseFolderId } from "@/features/folders/schema";
import { folderPath } from "@/lib/addresses";
import { revalidateContent } from "@/lib/revalidate";

const GIVE_FAILED_MESSAGE = "The role could not be given. Please try again.";
const USER_NOT_FOUND_MESSAGE = "There is no such user";
const ROLE_TAKEN_MESSAGE = "This user already has a role on the folder";

/**
 * Gives the chosen user the chosen role on the folder with the given id and redirects to the folder, like every dialog.
 * Returns the errors to show in the form if the input is invalid, the user does not exist or already has a role, or
 * the role cannot be stored. Bind the id with `giveRole.bind(null, folderId)`.
 */
export async function giveRole(
  folderId: string,
  _prevState: GiveRoleFormState,
  formData: FormData,
): Promise<GiveRoleFormState> {
  const user = await requireUser();

  // A malformed id is no folder the user could have a role on.
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) notFound();

  const input = parseGiveRoleFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  const result = await folderRoleService.giveRole(user, parsedFolderId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      // Only an Owner gives roles: for anyone else, like the dialog, the action is not found.
      case "not-allowed":
        notFound();
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "user-not-found":
        return { fieldErrors: { user: [USER_NOT_FOUND_MESSAGE] } };
      case "role-taken":
        return { fieldErrors: { user: [ROLE_TAKEN_MESSAGE] } };
      case "failed":
        return { message: GIVE_FAILED_MESSAGE };
    }
  }

  // A role decides what the user sees in every address of the folder.
  revalidateContent();
  // The address is built from the stored folder, never from submitted values.
  redirect(folderPath(result.value.folder.name));
}
