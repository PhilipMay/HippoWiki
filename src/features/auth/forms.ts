// What only the forms of the login and of the password change need. No server-only imports, so Client Components can
// use it.

import type { PasswordChangeFieldErrors, PasswordChangeInput } from "@/features/auth/schema";

export type LoginFieldErrors = { name?: string[]; password?: string[] };

/** State of the login form between submissions: errors from the last attempt, if any. */
export type LoginFormState = {
  fieldErrors?: LoginFieldErrors;
  /** An error that is not about one field, e.g. a wrong password, which is never told apart from an unknown name. */
  message?: string;
};

/** The Server Action behind the login form; it returns the errors to show, or redirects on success. */
export type LoginFormAction = (prevState: LoginFormState, formData: FormData) => Promise<LoginFormState>;

/** The Server Action behind the "Log out" button; it redirects to the login page. */
export type LogoutFormAction = () => Promise<void>;

export type ParseLoginResult =
  { success: true; data: { name: string; password: string } } | { success: false; fieldErrors: LoginFieldErrors };

/** The text of a form field; a missing field and a file count as empty. */
function textOf(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Reads a submitted login form. It only asks for both fields to be filled; whether the name and the password can
 * belong to a user is decided by the service, which answers everything else like a wrong password. The password is
 * passed on as it is, with its spaces.
 */
export function parseLoginFormData(formData: FormData): ParseLoginResult {
  const name = textOf(formData, "name");
  const password = textOf(formData, "password");

  const fieldErrors: LoginFieldErrors = {};
  if (name.trim() === "") fieldErrors.name = ["User name is required"];
  if (password === "") fieldErrors.password = ["Password is required"];
  if (fieldErrors.name || fieldErrors.password) return { success: false, fieldErrors };
  return { success: true, data: { name, password } };
}

/** State of the password change form between submissions: errors from the last attempt, if any. */
export type PasswordChangeFormState = {
  fieldErrors?: PasswordChangeFieldErrors;
  /** An error that is not about one field, e.g. when the database is unreachable. */
  message?: string;
};

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
    currentPassword: textOf(formData, "currentPassword"),
    newPassword: textOf(formData, "newPassword"),
    repeatPassword: textOf(formData, "repeatPassword"),
  };
}
