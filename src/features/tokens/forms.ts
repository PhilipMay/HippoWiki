// What only the forms of API tokens need. No server-only imports, so Client Components can use it.

import { z } from "zod";

import { tokenInputSchema, type TokenFieldErrors, type TokenInput } from "@/features/tokens/schema";

/** The names of the fields of the "New token" form. */
export const TOKEN_FIELDS = { name: "name", scopes: "scopes", expiry: "expiry" } as const;

/**
 * State of the "New token" form between submissions: the errors of the last attempt, or the token it created. The
 * token reaches the browser only in this state, as the answer to the submission: it is not part of an address or of a
 * page, so it is gone after a reload.
 */
export type CreateTokenFormState = {
  fieldErrors?: TokenFieldErrors;
  /** An error that is not about a field, e.g. when the user holds the most tokens allowed. */
  message?: string;
  /** The token that was created: its name and the token itself, to copy. */
  created?: { name: string; secret: string };
};

/** The Server Action behind the "New token" form; it returns the errors to show, or the created token. */
export type CreateTokenFormAction = (
  prevState: CreateTokenFormState,
  formData: FormData,
) => Promise<CreateTokenFormState>;

/** State of the "Revoke token" form: why the token could not be revoked. */
export type RevokeTokenFormState = { message?: string };

/** The Server Action behind the "Revoke token" form; it returns the error to show, or redirects on success. */
export type RevokeTokenFormAction = (
  prevState: RevokeTokenFormState,
  formData: FormData,
) => Promise<RevokeTokenFormState>;

export type ParseTokenInputResult =
  { success: true; data: TokenInput } | { success: false; fieldErrors: TokenFieldErrors };

/** A text field of the form; a missing field and a file count as empty. */
function textOf(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/**
 * Validates a submitted "New token" form: the name, the ticked scopes (one field per scope) and the expiry choice. A
 * missing name or expiry and a file count as empty, a file among the scopes as an unknown scope.
 */
export function parseTokenFormData(formData: FormData): ParseTokenInputResult {
  const result = tokenInputSchema.safeParse({
    name: textOf(formData.get(TOKEN_FIELDS.name)),
    scopes: formData.getAll(TOKEN_FIELDS.scopes).map(textOf),
    expiry: textOf(formData.get(TOKEN_FIELDS.expiry)),
  });
  if (result.success) return { success: true, data: result.data };
  return { success: false, fieldErrors: z.flattenError(result.error).fieldErrors };
}
