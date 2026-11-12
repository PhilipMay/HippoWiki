// The rules for user names and passwords. No server-only imports, so Client Components can use it.

import { z } from "zod";

import { NAME_PATTERN } from "@/lib/names";

/** The name of the one admin account. The admin is the user with this name; there is no role column. */
export const ADMIN_NAME = "admin";

export const USER_NAME_MIN_LENGTH = 3;
export const USER_NAME_MAX_LENGTH = 30;

/**
 * The name of a user: the name rule of folders, tabs and pages, so that it can be part of an address as it is, with
 * the length limits of the `username` plugin of Better Auth.
 */
export const userNameSchema = z
  .string()
  .trim()
  // Abort here, so that an empty name reports only this error and not also the other ones.
  .min(1, { error: "Name is required", abort: true })
  .min(USER_NAME_MIN_LENGTH, `Name must be at least ${USER_NAME_MIN_LENGTH} characters`)
  .max(USER_NAME_MAX_LENGTH, `Name must be at most ${USER_NAME_MAX_LENGTH} characters`)
  .regex(NAME_PATTERN, "Use lowercase letters, digits and single hyphens");

/**
 * Returns the name if it is a valid user name exactly as given, otherwise `null`. Surrounding whitespace makes a name
 * invalid here, so that every name a caller passes stands for at most one user.
 */
export function parseUserName(name: string): string | null {
  const result = userNameSchema.safeParse(name);
  return result.success && result.data === name ? result.data : null;
}

/** Input for creating a user: the name. */
export const userInputSchema = z.object({ name: userNameSchema });

/** A validated user name. */
export type UserInput = z.output<typeof userInputSchema>;

export type UserFieldErrors = { name?: string[] };

export const PASSWORD_MIN_LENGTH = 8;
/** The upper limit protects the password hashing from very long inputs. */
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_IS_USER_NAME_MESSAGE = "Password must not be the same as the user name";

/**
 * A password: 8 to 128 characters, counted as Better Auth counts them (the length of the string). Any characters are
 * allowed and nothing is trimmed; there are no composition rules.
 */
export const passwordSchema = z
  .string()
  // Abort here, so that an empty password reports only this error and not also the length error.
  .min(1, { error: "Password is required", abort: true })
  // Not `.min()` and `.max()`: Zod counts code points, Better Auth the length of the string. With two measures a
  // password of 100 emoji would pass here and be refused by Better Auth.
  .refine(
    (password) => password.length >= PASSWORD_MIN_LENGTH,
    `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  )
  .refine(
    (password) => password.length <= PASSWORD_MAX_LENGTH,
    `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  );

/** The password rules for the user with the given name: a password, and not the same as the user name. */
export function passwordSchemaFor(userName: string) {
  return passwordSchema.refine((password) => password !== userName, PASSWORD_IS_USER_NAME_MESSAGE);
}

export type PasswordFieldErrors = { password?: string[] };
