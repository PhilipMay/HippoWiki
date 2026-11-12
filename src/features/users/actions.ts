"use server";

// The writes of users for forms: thin adapters that translate between a form and the service. Every action calls
// `requireUser()` first, which redirects to the login page without a logged-in user, and passes that user to the
// service as the actor: the service decides whether the user may do it.

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { parseUserFormData, type CreateUserFormState } from "@/features/users/forms";
import * as userService from "@/features/users/service";
import { usersPath } from "@/lib/addresses";
import { NAME_TAKEN_MESSAGE } from "@/lib/names";

const BUSY_MESSAGE = "Too many logins at the moment, please try again";
const CREATE_FAILED_MESSAGE = "The user could not be created. Please try again.";

/**
 * Creates a user from the submitted name, with a generated first password. On success it returns the name and the
 * password in its form state and does not redirect: the password is shown exactly once and must not be part of an
 * address or of a stored page. Returns the errors to show in the form if the name is invalid or taken or the user
 * cannot be stored.
 */
export async function createUser(_prevState: CreateUserFormState, formData: FormData): Promise<CreateUserFormState> {
  const actor = await requireUser();

  const input = parseUserFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  const result = await userService.createUser(actor, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      // For everyone but the admin there are no users to manage: like the user list, the action is not found.
      case "not-allowed":
        notFound();
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "name-taken":
        return { fieldErrors: { name: [NAME_TAKEN_MESSAGE] } };
      case "busy":
        return { message: BUSY_MESSAGE };
      case "failed":
        return { message: CREATE_FAILED_MESSAGE };
    }
  }

  // The list behind the dialog shows the new user.
  revalidatePath(usersPath());
  return { created: { name: result.value.user.name, password: result.value.password } };
}
