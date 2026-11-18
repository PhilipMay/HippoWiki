// The rules for user names and passwords. No server-only imports, so the server and the tests can use it anywhere;
// Client Components import the length limits from `limits.ts` instead, so that the list of common passwords stays out
// of the bundle for the browser.

import { z } from "zod";

import { isCommonPassword } from "@/features/users/common-passwords";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USER_NAME_MAX_LENGTH,
  USER_NAME_MIN_LENGTH,
} from "@/features/users/limits";
import { USER_TYPES } from "@/features/users/user-type";
import { nameSchemaWith, parseExact } from "@/lib/names";

/**
 * The name of the first admin, which the admin setup creates. Only its name: what an account may do is decided by its
 * type (`user-type.ts`), and later admins may have any valid name.
 */
export const ADMIN_NAME = "admin";

/** A user id: a UUID, like the ids of folders, tabs and pages. */
const userIdSchema = z.guid();

/** Returns the id if it is a well-formed user id, otherwise `null`, so that malformed ids never reach the database. */
export function parseUserId(id: string): string | null {
  const result = userIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

/**
 * The name of a user: the name rule of folders, tabs and pages, so that it can be part of an address as it is, with
 * the length limits of the `username` plugin of Better Auth.
 */
export const userNameSchema = nameSchemaWith({ minLength: USER_NAME_MIN_LENGTH, maxLength: USER_NAME_MAX_LENGTH });

/** Returns the name if it is a valid user name exactly as given, otherwise `null` (`parseExact()`). */
export function parseUserName(name: string): string | null {
  return parseExact(userNameSchema, name);
}

const USER_TYPE_MESSAGE = "Choose the type of the account";

/**
 * The type of a new account. It has no default: a request without a type or with an unknown one is refused, so that
 * a broken or crafted request is noticed instead of creating a user of a type nobody chose.
 */
const userTypeSchema = z.enum(USER_TYPES, { error: USER_TYPE_MESSAGE });

/** Input for creating a user: the name and the type. */
export const userInputSchema = z.object({ name: userNameSchema, type: userTypeSchema });

/** A validated user name and type. */
export type UserInput = z.output<typeof userInputSchema>;

export type UserFieldErrors = { name?: string[]; type?: string[] };

/**
 * The context words: words that an attacker who targets this wiki tries first, together with the user name. A password
 * built only from them and from digits and symbols is refused (see `isBuiltFromContextWords`).
 */
const PASSWORD_CONTEXT_WORDS = ["hippowiki", "hippo", "wiki", "admin"] as const;

const PASSWORD_IS_CONTEXT_WORD_MESSAGE =
  "Password must not be built only from the user name or the name of the wiki, digits and symbols";

const PASSWORD_IS_COMMON_MESSAGE = "Password is too common, choose another one";

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

/**
 * Whether the password is built only from the user name and the context words, plus digits and symbols: in lower case,
 * with every occurrence of these words removed, longest first, something was removed and no letter is left. So
 * `hippowiki2026` and `Admin-admin!` are refused, while `admin-password` and `wikipedia1` keep letters and pass. A
 * password without any of the words, such as one of digits only, is left to the list of common passwords, so that
 * there is still no composition rule.
 */
function isBuiltFromContextWords(password: string, userName: string): boolean {
  const words = [userName, ...PASSWORD_CONTEXT_WORDS]
    .map((word) => word.toLowerCase())
    .filter((word) => word !== "")
    .sort((a, b) => b.length - a.length);
  let rest = password.toLowerCase();
  for (const word of words) rest = rest.replaceAll(word, "");
  return rest !== password.toLowerCase() && !/\p{L}/u.test(rest);
}

/**
 * The password rules for the user with the given name: a password, not built only from the user name or a context
 * word, and not a common password. All rules report together.
 */
export function passwordSchemaFor(userName: string) {
  return passwordSchema
    .refine((password) => !isBuiltFromContextWords(password, userName), PASSWORD_IS_CONTEXT_WORD_MESSAGE)
    .refine((password) => !isCommonPassword(password), PASSWORD_IS_COMMON_MESSAGE);
}

const PASSWORD_IS_PLACEHOLDER_MESSAGE = "Password must not be a placeholder such as <first password>";

/**
 * The first password of the admin from `HIPPOWIKI_ADMIN_PASSWORD`: the password rules of the admin, and not a
 * placeholder in angle brackets such as the `<first password>` of the README, which is public and could otherwise be
 * copied with its quotes into a deployment.
 */
export const adminPasswordSchema = passwordSchemaFor(ADMIN_NAME).refine(
  (password) => !/^<[\s\S]*>$/.test(password),
  PASSWORD_IS_PLACEHOLDER_MESSAGE,
);

export type PasswordFieldErrors = { password?: string[] };
