// What only the forms of folders and tabs need, and the form state of a name, which the forms of pages share. No
// server-only imports, so Client Components can use it.

import { z } from "zod";

import { folderInputSchema, tabInputSchema, type FolderInput, type TabInput } from "@/features/folders/schema";
import { textField, type FormState, type ParseResult } from "@/lib/forms";
import { NAME_TAKEN_MESSAGE, type NameFieldErrors } from "@/lib/names";

/** State of a form that asks for a name, between submissions: errors from the last attempt, if any. */
export type NameFormState = FormState<NameFieldErrors>;

/** A Server Action behind a form that asks for a name; it returns the errors to show, or redirects on success. */
export type NameFormAction = (prevState: NameFormState, formData: FormData) => Promise<NameFormState>;

/** The form state that shows "Name is already in use" at the name field. */
export const NAME_TAKEN_STATE = { fieldErrors: { name: [NAME_TAKEN_MESSAGE] } } satisfies NameFormState;

/** What a form of a folder, tab or page shows when its folder no longer exists, also for a malformed id. */
export const FOLDER_GONE_MESSAGE = "This folder no longer exists.";

/** What a form of a tab or page shows when its tab no longer exists, also for a malformed id. */
export const TAB_GONE_MESSAGE = "This tab no longer exists.";

/** Validates the name of a submitted folder form. A missing field and a file count as empty. */
export function parseFolderFormData(formData: FormData): ParseResult<FolderInput, NameFieldErrors> {
  const result = folderInputSchema.safeParse({ name: textField(formData, "name") });
  if (result.success) return { success: true, data: result.data };
  return { success: false, fieldErrors: z.flattenError(result.error).fieldErrors };
}

/** Validates the name of a submitted tab form. A missing field and a file count as empty. */
export function parseTabFormData(formData: FormData): ParseResult<TabInput, NameFieldErrors> {
  const result = tabInputSchema.safeParse({ name: textField(formData, "name") });
  if (result.success) return { success: true, data: result.data };
  return { success: false, fieldErrors: z.flattenError(result.error).fieldErrors };
}

/** The state of the "Delete tab" dialog after a submit that did not delete the tab. */
export type TabDeleteFormState = {
  /** Why the tab could not be deleted, e.g. when it no longer exists. */
  message?: string;
  /** The tab no longer exists: the dialog offers only the way back to the folder. */
  tabGone?: boolean;
};

/**
 * A Server Action that deletes a tab, with its ids bound: it returns the state to show, or redirects to the folder on
 * success. The form submits no field, so it takes neither the previous state nor the form data.
 */
export type TabDeleteFormAction = () => Promise<TabDeleteFormState>;
