// What only the forms of the login and of the password change need. No server-only imports, so Client Components can
// use it.

import type { PasswordChangeFieldErrors, PasswordChangeInput } from "@/features/auth/schema";
import { NEXT_PARAM, safeNextPath } from "@/lib/addresses";
import { textField, type FormState, type ParseResult } from "@/lib/forms";

export type LoginFieldErrors = { name?: string[]; password?: string[] };

/**
 * State of the login form between submissions: errors from the last attempt, if any. Its message is one that is not
 * about one field, e.g. a wrong password, which is never told apart from an unknown name.
 */
export type LoginFormState = FormState<LoginFieldErrors>;

/** The Server Action behind the login form; it returns the errors to show, or redirects on success. */
export type LoginFormAction = (prevState: LoginFormState, formData: FormData) => Promise<LoginFormState>;

/**
 * The address to go to after the login or the password change, from the hidden field of the form: a path on this
 * site, or the folder list for a missing field and for anything `safeNextPath()` refuses. It is checked here again,
 * because a crafted request can submit any value. It is not part of the input of the service.
 */
export function readNextPath(formData: FormData): string {
  return safeNextPath(textField(formData, NEXT_PARAM));
}

/**
 * Reads a submitted login form. It only asks for both fields to be filled; whether the name and the password can
 * belong to a user is decided by the service, which answers everything else like a wrong password. The password is
 * passed on as it is, with its spaces.
 */
export function parseLoginFormData(
  formData: FormData,
): ParseResult<{ name: string; password: string }, LoginFieldErrors> {
  const name = textField(formData, "name");
  const password = textField(formData, "password");

  const fieldErrors: LoginFieldErrors = {};
  if (name.trim() === "") fieldErrors.name = ["User name is required"];
  if (password === "") fieldErrors.password = ["Password is required"];
  if (fieldErrors.name || fieldErrors.password) return { success: false, fieldErrors };
  return { success: true, data: { name, password } };
}

/**
 * State of the password change form between submissions: errors from the last attempt, if any. `passwordRefused` is
 * set when the current password was wrong or had to wait: the form then empties the passwords, so that a refused
 * password is not submitted again by mistake.
 */
export type PasswordChangeFormState = FormState<PasswordChangeFieldErrors> & { passwordRefused?: boolean };

/** The Server Action behind the password change form; it returns the errors to show, or redirects on success. */
export type PasswordChangeFormAction = (
  prevState: PasswordChangeFormState,
  formData: FormData,
) => Promise<PasswordChangeFormState>;

/**
 * Reads a submitted password change form. The three passwords are passed on as they are, with their spaces; a missing
 * field and a file count as empty. The rules are checked by the service, because they depend on the user.
 */
export function readPasswordChangeFormData(formData: FormData): PasswordChangeInput {
  return {
    currentPassword: textField(formData, "currentPassword"),
    newPassword: textField(formData, "newPassword"),
    repeatPassword: textField(formData, "repeatPassword"),
  };
}

/** The name of the checkbox of the own password change that disconnects all connected apps as well. */
export const DISCONNECT_APPS_FIELD = "disconnectApps";

/**
 * Reads the choice of the own password change to disconnect all connected apps as well: on only for the value of a
 * ticked checkbox, `on`; off for a missing field and for anything else.
 */
export function readDisconnectApps(formData: FormData): boolean {
  return formData.get(DISCONNECT_APPS_FIELD) === "on";
}

/** State of the "Log out other browsers" form: why the other browsers could not be logged out. */
export type LogOutOthersFormState = { message?: string };

/** The Server Action behind the "Log out other browsers" form; it returns the error to show, or redirects on success. */
export type LogOutOthersFormAction = (
  prevState: LogOutOthersFormState,
  formData: FormData,
) => Promise<LogOutOthersFormState>;
