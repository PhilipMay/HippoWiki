// What only the forms of folder roles need. No server-only imports, so Client Components can use it.

import { z } from "zod";

import { giveRoleInputSchema, type GiveRoleFieldErrors, type GiveRoleInput } from "@/features/folder-roles/schema";

/** State of the "Give role" form between submissions: the errors of the last attempt. */
export type GiveRoleFormState = {
  fieldErrors?: GiveRoleFieldErrors;
  /** An error that is not about a field, e.g. when the database is unreachable. */
  message?: string;
};

/** The Server Action behind the "Give role" form; it returns the errors to show, or redirects on success. */
export type GiveRoleFormAction = (prevState: GiveRoleFormState, formData: FormData) => Promise<GiveRoleFormState>;

export type ParseGiveRoleResult =
  { success: true; data: GiveRoleInput } | { success: false; fieldErrors: GiveRoleFieldErrors };

/**
 * Validates the user and the role of a submitted "Give role" form. A missing user and a file count as empty; a missing
 * role and a file count as missing, which is refused.
 */
export function parseGiveRoleFormData(formData: FormData): ParseGiveRoleResult {
  const user = formData.get("user");
  const role = formData.get("role");
  const result = giveRoleInputSchema.safeParse({
    user: typeof user === "string" ? user : "",
    role: typeof role === "string" ? role : undefined,
  });
  if (result.success) return { success: true, data: result.data };
  return { success: false, fieldErrors: z.flattenError(result.error).fieldErrors };
}
