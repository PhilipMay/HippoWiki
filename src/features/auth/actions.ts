"use server";

// Login and logout for forms: thin adapters that translate between a form and the auth service.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  parseLoginFormData,
  readPasswordChangeFormData,
  type LoginFormState,
  type PasswordChangeFormState,
} from "@/features/auth/forms";
import * as authService from "@/features/auth/service";
import { requireSession } from "@/features/auth/session";
import { changePasswordPath, foldersPath, loginPath } from "@/lib/addresses";

const INVALID_CREDENTIALS_MESSAGE = "Invalid user name or password";
const BUSY_MESSAGE = "Too many logins at the moment, please try again";

/**
 * The message of the wait after failed logins, with the minutes that are left, rounded up. It is the same for known
 * and unknown user names.
 */
function waitMessage(waitMs: number): string {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  return `Too many failed logins. Please try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}
const LOGIN_FAILED_MESSAGE = "The login failed. Please try again.";
const WRONG_PASSWORD_MESSAGE = "Current password is wrong";
const CHANGE_FAILED_MESSAGE = "The password could not be changed. Please try again.";

/**
 * After a login or a logout every page belongs to another session: the header shows another user, and what the
 * browser has cached of the pages must not be shown again.
 */
function revalidateEverything(): void {
  revalidatePath("/", "layout");
}

export async function logIn(_prevState: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const input = parseLoginFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  // Better Auth sets the session cookie on the response of this action (`nextCookies()` in `src/lib/auth.ts`).
  const result = await authService.logIn(input.data, await headers());
  if (!result.ok) {
    switch (result.error.code) {
      case "invalid-credentials":
        return { message: INVALID_CREDENTIALS_MESSAGE };
      case "wait":
        return { message: waitMessage(result.error.waitMs) };
      case "busy":
        return { message: BUSY_MESSAGE };
      case "failed":
        return { message: LOGIN_FAILED_MESSAGE };
    }
  }

  revalidateEverything();
  // Who logged in with a first password sets a password of their own before anything else.
  redirect(result.value.user.mustChangePassword ? changePasswordPath() : foldersPath());
}

/**
 * Replaces the first password of the logged-in user by the submitted one and leads to the folders. Returns the errors
 * to show in the form if a rule is broken, the current password is wrong or the password cannot be changed.
 */
export async function changeFirstPassword(
  _prevState: PasswordChangeFormState,
  formData: FormData,
): Promise<PasswordChangeFormState> {
  // Not `requireUser()`, which would send the user back to the password change.
  await requireSession();

  // Better Auth ends all sessions of the user and sets the cookie of a new one on the response of this action.
  const result = await authService.changeFirstPassword(readPasswordChangeFormData(formData), await headers());
  if (!result.ok) {
    switch (result.error.code) {
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "wrong-password":
        return { fieldErrors: { currentPassword: [WRONG_PASSWORD_MESSAGE] } };
      case "not-logged-in":
        redirect(loginPath());
      // The change is done already, e.g. in another tab: there is nothing left to do here.
      case "not-required":
        redirect(foldersPath());
      case "busy":
        return { message: BUSY_MESSAGE };
      case "failed":
        return { message: CHANGE_FAILED_MESSAGE };
    }
  }

  revalidateEverything();
  redirect(foldersPath());
}

export async function logOut(): Promise<void> {
  const result = await authService.logOut(await headers());
  // The button has no place for a message, and a session that could not be ended must not look ended: the error page
  // offers to try again.
  if (!result.ok) throw new Error("The logout failed.");

  revalidateEverything();
  redirect(loginPath());
}
