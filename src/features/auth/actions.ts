"use server";

// Login, logout and the password changes for forms: thin adapters that translate between a form and the auth service.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requestClientAddressGroup } from "@/features/auth/client-address";
import {
  parseLoginFormData,
  type LogOutOthersFormState,
  readDisconnectApps,
  readNextPath,
  readPasswordChangeFormData,
  type LoginFormState,
  type PasswordChangeFormState,
} from "@/features/auth/forms";
import * as authService from "@/features/auth/service";
import { requireSession, requireUser } from "@/features/auth/session";
import {
  accountNoticePath,
  accountPath,
  APPS_DISCONNECTED_NOTICE,
  APPS_NOT_DISCONNECTED_NOTICE,
  OTHER_BROWSERS_LOGGED_OUT_NOTICE,
  changePasswordPath,
  homePath,
  landingPath,
  loginPath,
  PASSWORD_CHANGED_NOTICE,
  type AccountNotice,
} from "@/lib/addresses";

const INVALID_CREDENTIALS_MESSAGE = "Invalid user name or password";
const BUSY_MESSAGE = "Too many logins at the moment, please try again";

/** The minutes of a wait that are left, rounded up and at least 1, with their unit: "1 minute", "4 minutes". */
function waitMinutes(waitMs: number): string {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * The message of the wait after failed logins, with the minutes that are left. It is the same for known and unknown
 * user names.
 */
function waitMessage(waitMs: number): string {
  return `Too many failed logins. Please try again in ${waitMinutes(waitMs)}.`;
}

/**
 * The message of the wait at a check of the own password, such as a password change: its own wording, because it is
 * not a login, but the same wait.
 */
function wrongPasswordsWaitMessage(waitMs: number): string {
  return `Too many wrong passwords. Please try again in ${waitMinutes(waitMs)}.`;
}
const LOGIN_FAILED_MESSAGE = "The login failed. Please try again.";
const WRONG_PASSWORD_MESSAGE = "Current password is wrong";
const CHANGE_FAILED_MESSAGE = "The password could not be changed. Please try again.";

/**
 * After a login or a logout every page belongs to another session: the header shows another user, and what the
 * browser has cached of the pages must not be shown again.
 */
function revalidateEverything(): void {
  revalidatePath(homePath(), "layout");
}

/**
 * Logs in with the submitted user name and password and leads to the address the form names as the way back, or to
 * the folders. Returns the errors to show in the form if the login is refused.
 */
export async function logIn(_prevState: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const input = parseLoginFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  const requestHeaders = await headers();
  // `/login` does not pass the proxy of Next.js, so the action reads the client address itself; the service only gets
  // the group.
  const group = requestClientAddressGroup(requestHeaders, "login");

  // Better Auth sets the session cookie on the response of this action (`nextCookies()` in `src/lib/auth.ts`).
  const result = await authService.logIn(input.data, requestHeaders, group);
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
  // Who logged in with a first password sets a password of their own before anything else, and goes on from there.
  const next = readNextPath(formData);
  const { user } = result.value;
  redirect(user.mustChangePassword ? changePasswordPath(next) : landingPath(next, user));
}

/**
 * Replaces the first password of the logged-in user by the submitted one and leads to the address the form names as
 * the way back, or to the folders. Returns the errors to show in the form if a rule is broken, the current password is
 * wrong or the password cannot be changed.
 */
export async function changeFirstPassword(
  _prevState: PasswordChangeFormState,
  formData: FormData,
): Promise<PasswordChangeFormState> {
  // Not `requireUser()`, which would send the user back to the password change.
  const user = await requireSession();
  const next = readNextPath(formData);

  const requestHeaders = await headers();
  // Better Auth ends all sessions of the user and sets the cookie of a new one on the response of this action.
  const result = await authService.changeFirstPassword(
    readPasswordChangeFormData(formData),
    requestHeaders,
    requestClientAddressGroup(requestHeaders, "password-change"),
  );
  if (!result.ok) {
    switch (result.error.code) {
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "wrong-password":
        return { fieldErrors: { currentPassword: [WRONG_PASSWORD_MESSAGE] }, passwordRefused: true };
      case "wait":
        return {
          fieldErrors: { currentPassword: [wrongPasswordsWaitMessage(result.error.waitMs)] },
          passwordRefused: true,
        };
      case "not-logged-in":
        redirect(loginPath(next));
      // The change is done already, e.g. in another tab: there is nothing left to do here.
      case "not-required":
        redirect(landingPath(next, user));
      case "busy":
        return { message: BUSY_MESSAGE };
      case "failed":
        return { message: CHANGE_FAILED_MESSAGE };
    }
  }

  revalidateEverything();
  redirect(landingPath(next, result.value.user));
}

/** The notice of the account after an own password change, by what was done with the connected apps. */
const OWN_CHANGE_NOTICES: Record<authService.AppsAtPasswordChange["status"], AccountNotice> = {
  kept: PASSWORD_CHANGED_NOTICE,
  disconnected: APPS_DISCONNECTED_NOTICE,
  failed: APPS_NOT_DISCONNECTED_NOTICE,
};

/**
 * Changes the own password of the logged-in user to the submitted one, ends the other sessions of the user, and
 * disconnects all connected apps as well if the form says so. Leads to the account with the notice that names what
 * happened; the browser stays logged in with a new session. Returns the errors to show in the dialog if a rule is
 * broken, the current password is wrong or has to wait, or the password cannot be changed.
 */
export async function changeOwnPassword(
  _prevState: PasswordChangeFormState,
  formData: FormData,
): Promise<PasswordChangeFormState> {
  await requireUser();

  const requestHeaders = await headers();
  // Better Auth ends all sessions of the user and sets the cookie of a new one on the response of this action.
  const result = await authService.changeOwnPassword(
    readPasswordChangeFormData(formData),
    requestHeaders,
    requestClientAddressGroup(requestHeaders, "password-change"),
    readDisconnectApps(formData),
  );
  if (!result.ok) {
    switch (result.error.code) {
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "wrong-password":
        return { fieldErrors: { currentPassword: [WRONG_PASSWORD_MESSAGE] }, passwordRefused: true };
      case "wait":
        return {
          fieldErrors: { currentPassword: [wrongPasswordsWaitMessage(result.error.waitMs)] },
          passwordRefused: true,
        };
      // The session ended, or the first password came back, since `requireUser()`: the same ways as there.
      case "not-logged-in":
        redirect(loginPath());
      case "first-password-pending":
        redirect(changePasswordPath());
      case "busy":
        return { message: BUSY_MESSAGE };
      case "failed":
        return { message: CHANGE_FAILED_MESSAGE };
    }
  }

  revalidatePath(accountPath());
  redirect(accountNoticePath(OWN_CHANGE_NOTICES[result.value.apps.status]));
}

const LOG_OUT_OTHERS_FAILED_MESSAGE =
  "The other browsers could not be logged out and may still be logged in. Please try again.";

/**
 * Ends all other sessions of the logged-in user, without changing the password, and leads to the account with the
 * notice that the other browsers were logged out, also when there was no other one. The browser stays logged in.
 * Returns the error to show in the dialog if the sessions could not be ended: the current browser is still logged in
 * and can try again, and nothing claims success. It takes no parameters: the form of the dialog has no fields.
 */
export async function logOutOtherBrowsers(): Promise<LogOutOthersFormState> {
  await requireUser();

  const result = await authService.logOutOtherSessions(await headers());
  if (!result.ok) {
    switch (result.error.code) {
      // The session ended since `requireUser()`.
      case "not-logged-in":
        redirect(loginPath());
      case "failed":
        return { message: LOG_OUT_OTHERS_FAILED_MESSAGE };
    }
  }

  revalidatePath(accountPath());
  redirect(accountNoticePath(OTHER_BROWSERS_LOGGED_OUT_NOTICE));
}

/** Ends the session of the browser and leads to the login page. */
export async function logOut(): Promise<void> {
  const result = await authService.logOut(await headers());
  // The button has no place for a message, and a session that could not be ended must not look ended: the error page
  // offers to try again.
  if (!result.ok) throw new Error("The logout failed.");

  revalidateEverything();
  redirect(loginPath());
}
