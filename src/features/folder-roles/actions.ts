"use server";

// The writes of folder roles for forms: thin adapters that translate between a form and the service. Every action calls
// `requireUser()` first, which redirects to the login page without a logged-in user: a Server Action is a public
// endpoint, whatever page shows its form. The call stands outside every `try` block, because the redirect throws. The
// user it returns is passed to the service as the actor: the service decides whether the user may do it.

import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import {
  parseGiveRoleFormData,
  parseRoleChangeFormData,
  type GiveRoleFormState,
  type RoleChangeFormState,
} from "@/features/folder-roles/forms";
import * as folderRoleService from "@/features/folder-roles/service";
import { parseFolderId } from "@/features/folders/schema";
import { folderPath, folderRolesPath, foldersPath } from "@/lib/addresses";
import { revalidateContent } from "@/lib/revalidate";

const GIVE_FAILED_MESSAGE = "The role could not be given. Please try again.";
const USER_NOT_FOUND_MESSAGE = "There is no such user";
const ROLE_TAKEN_MESSAGE = "This user already has a role on the folder";
const CHANGE_FAILED_MESSAGE = "The role could not be changed. Please try again.";
const ROLE_GONE_MESSAGE = "This user no longer has a role on the folder.";
const LAST_OWNER_MESSAGE = "A folder needs at least one Owner, so the role of its last Owner stays.";
const INVALID_ROLE_MESSAGE = "Choose a role.";

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

/**
 * Changes or removes the role of a user on the folder with the given id, as the roles view submits it, without a
 * confirmation; the view asks for one only before a change of the own role. Redirects to the roles view, where the
 * change shows, or to the folder list when the Owner removed the own role and so no longer sees the folder. Returns the
 * error to show if the change would leave the folder without an Owner, the user no longer has a role, or the role
 * cannot be changed. Bind the id with `changeRole.bind(null, folderId)`.
 */
export async function changeRole(
  folderId: string,
  _prevState: RoleChangeFormState,
  formData: FormData,
): Promise<RoleChangeFormState> {
  const user = await requireUser();

  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) notFound();

  const input = parseRoleChangeFormData(formData);
  // Only a crafted request asks for neither a change nor a removal.
  if (!input) return { message: INVALID_ROLE_MESSAGE };

  const result =
    input.intent === "remove"
      ? await folderRoleService.removeRole(user, parsedFolderId, input.user)
      : await folderRoleService.changeRole(user, parsedFolderId, input.user, input.role);
  if (!result.ok) {
    switch (result.error.code) {
      // Only an Owner changes roles: for anyone else the controls do not exist.
      case "not-allowed":
        notFound();
      case "invalid-input":
        return { message: INVALID_ROLE_MESSAGE };
      case "role-not-found":
        return { message: ROLE_GONE_MESSAGE };
      case "last-owner":
        return { message: LAST_OWNER_MESSAGE };
      case "failed":
        return { message: CHANGE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  const { folder, actorRole } = result.value;
  // An Owner without a role no longer sees the folder; anyone else stays in the roles view and sees the change there.
  redirect(actorRole ? folderRolesPath(folder.name) : foldersPath());
}
