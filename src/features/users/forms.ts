// What only the forms of users need. No server-only imports, so Client Components can use it.

import { z } from "zod";

import { userInputSchema, type UserFieldErrors, type UserInput } from "@/features/users/schema";
import type { UserType } from "@/features/users/user-type";

/**
 * State of the "New user" form between submissions: the errors of the last attempt, or the user it created with the
 * first password. The password reaches the browser only in this state, as the answer to the submission: it is not part
 * of an address or of a page, so it is gone after a reload.
 */
export type CreateUserFormState = {
  fieldErrors?: UserFieldErrors;
  /** An error that is not about a field, e.g. when the database is unreachable. */
  message?: string;
  /** The user that was created, with its type and the first password to pass on. */
  created?: { name: string; type: UserType; password: string };
};

/** The Server Action behind the "New user" form; it returns the errors to show, or the created user. */
export type CreateUserFormAction = (prevState: CreateUserFormState, formData: FormData) => Promise<CreateUserFormState>;

export type ParseUserInputResult =
  { success: true; data: UserInput } | { success: false; fieldErrors: UserFieldErrors };

/**
 * Validates the name and the type of a submitted "New user" form. A missing name and a file count as empty; a missing
 * type and a file count as missing, which is refused.
 */
export function parseUserFormData(formData: FormData): ParseUserInputResult {
  const name = formData.get("name");
  const type = formData.get("type");
  const result = userInputSchema.safeParse({
    name: typeof name === "string" ? name : "",
    type: typeof type === "string" ? type : undefined,
  });
  if (result.success) return { success: true, data: result.data };
  return { success: false, fieldErrors: z.flattenError(result.error).fieldErrors };
}
