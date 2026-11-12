// The input of the login and of the password change. No server-only imports, so Client Components can use it.

import { z } from "zod";

import { PASSWORD_MAX_LENGTH, passwordSchemaFor, userNameSchema } from "@/features/users/schema";

/**
 * What a login needs to be worth a look at the stored password: a name that follows the name rule and a password of
 * at most 128 characters. Anything else cannot belong to a user, so the service answers it like a wrong password,
 * without computing a hash. The lower limit of a password is not checked: it is a rule for new passwords.
 */
export const loginInputSchema = z.object({
  name: userNameSchema,
  password: z
    .string()
    .min(1)
    // The length of the string, as Better Auth counts it; `.max()` of Zod counts code points.
    .refine((password) => password.length <= PASSWORD_MAX_LENGTH),
});

/** A user name and a password that may belong to a user. */
export type LoginInput = z.output<typeof loginInputSchema>;

export const NEW_PASSWORD_IS_CURRENT_MESSAGE = "New password must differ from the current one";
export const PASSWORDS_DIFFER_MESSAGE = "The two new passwords do not match";

/**
 * The input of a password change for the user with the given name: the current password, the new one and its
 * repetition. The new password follows the password rules, including "not the user name", differs from the current one
 * and is entered twice. Whether the current password is right is not a rule of the input: Better Auth checks it.
 */
export function passwordChangeInputSchema(userName: string) {
  return z
    .object({
      currentPassword: z.string().min(1, "Current password is required"),
      newPassword: passwordSchemaFor(userName),
      repeatPassword: z.string(),
    })
    .refine(({ currentPassword, newPassword }) => newPassword !== currentPassword, {
      path: ["newPassword"],
      error: NEW_PASSWORD_IS_CURRENT_MESSAGE,
    })
    .refine(({ newPassword, repeatPassword }) => repeatPassword === newPassword, {
      path: ["repeatPassword"],
      error: PASSWORDS_DIFFER_MESSAGE,
    });
}

/** The three passwords of a password change, as entered. */
export type PasswordChangeInput = { currentPassword: string; newPassword: string; repeatPassword: string };

export type PasswordChangeFieldErrors = {
  currentPassword?: string[];
  newPassword?: string[];
  repeatPassword?: string[];
};
