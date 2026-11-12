"use server";

// Login and logout for forms: thin adapters that translate between a form and the auth service.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { parseLoginFormData, type LoginFormState } from "@/features/auth/forms";
import * as authService from "@/features/auth/service";
import { foldersPath, loginPath } from "@/lib/addresses";

const INVALID_CREDENTIALS_MESSAGE = "Invalid user name or password";
const BUSY_MESSAGE = "Too many logins at the moment, please try again";
const LOGIN_FAILED_MESSAGE = "The login failed. Please try again.";

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
      case "busy":
        return { message: BUSY_MESSAGE };
      case "failed":
        return { message: LOGIN_FAILED_MESSAGE };
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
