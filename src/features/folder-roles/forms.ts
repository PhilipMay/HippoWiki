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

/** State of the controls of the roles view between submissions: the error of the last change, if any. */
export type RoleChangeFormState = { message?: string };

/** The Server Action behind the controls of the roles view; it returns the error to show, or redirects on success. */
export type RoleChangeFormAction = (prevState: RoleChangeFormState, formData: FormData) => Promise<RoleChangeFormState>;

/** What a submission of the roles view asks for: a new role of a user, or the removal of the user's role. */
export type RoleChangeInput = { user: string } & ({ intent: "change"; role: string } | { intent: "remove" });

/**
 * Reads a submission of the roles view: the id of the user, and the new role or the removal. `null` for a submission
 * that asks for neither; the role itself is checked by the service.
 */
export function parseRoleChangeFormData(formData: FormData): RoleChangeInput | null {
  const user = formData.get("user");
  const intent = formData.get("intent");
  const role = formData.get("role");
  if (typeof user !== "string") return null;
  if (intent === "remove") return { user, intent };
  if (intent === "change" && typeof role === "string") return { user, intent, role };
  return null;
}
