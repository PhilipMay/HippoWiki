// What only the forms of pages need: the parsers of submitted forms, the form states, the types of the form actions
// and the names of form fields. No server-only imports, so Client Components can use it.

import { z } from "zod";

import { parseTabId } from "@/features/folders/schema";
import {
  newPageInputSchema,
  pageContentInputSchema,
  pageNameInputSchema,
  parsePageVersion,
  type NewPageInput,
  type PageContentInput,
  type PageFieldErrors,
  type PageMoveOrRenameInput,
  type PageRestoreInput,
} from "@/features/pages/schema";
import { textField, type FormState, type ParseResult } from "@/lib/forms";
import type { NameFieldErrors } from "@/lib/names";

/** State of a page form between submissions: errors from the last attempt, if any. */
export type PageFormState = FormState<PageFieldErrors>;

/** A Server Action behind a page form; it returns the errors to show, or redirects on success. */
export type PageFormAction = (prevState: PageFormState, formData: FormData) => Promise<PageFormState>;

/**
 * Name of the hidden form field that holds the version of the page that the editor or dialog was opened with: the
 * state of the page the change is based on.
 */
export const VERSION_FIELD = "version";

/**
 * Reads the version of the page from the submitted form, or `null` if it is missing or malformed, such as a file, an
 * empty value or anything but the digits of a version. That is no error of the form: the service refuses a change
 * without a version as one based on an older state, so that the current page is shown.
 */
function parseVersion(formData: FormData): number | null {
  const version = formData.get(VERSION_FIELD);
  if (typeof version !== "string" || !/^[0-9]+$/.test(version)) return null;
  return parsePageVersion(Number(version));
}

/**
 * Validates the content of a submitted page form, derives the title from it and reads the version of the page. A
 * missing content field and a file count as empty; submitted `title` and `name` fields are ignored.
 */
export function parsePageContentFormData(
  formData: FormData,
): ParseResult<PageContentInput & { version: number | null }, PageFieldErrors> {
  const result = pageContentInputSchema.safeParse({ content: textField(formData, "content") });
  if (result.success) return { success: true, data: { ...result.data, version: parseVersion(formData) } };
  return { success: false, fieldErrors: z.flattenError(result.error).fieldErrors };
}

/** Name of the form field that holds the place of a page: a tab id, or empty for the folder itself. */
export const PLACE_FIELD = "place";

/**
 * Reads the place of a page from the submitted form: the id of a tab, or `null` for the folder itself when the field
 * is empty or missing. A malformed tab id or a file is not a place.
 */
function parsePlace(formData: FormData): { success: true; tabId: string | null } | { success: false } {
  const place = formData.get(PLACE_FIELD) ?? "";
  if (typeof place !== "string") return { success: false };
  if (place === "") return { success: true, tabId: null };
  const tabId = parseTabId(place);
  return tabId ? { success: true, tabId } : { success: false };
}

/**
 * Validates name and content of a submitted new page form, derives the title from the content and reads the place.
 * Missing name and content and a file count as empty; an empty or missing place is the folder itself, a malformed tab id or a file
 * is no place; a submitted `title` field is ignored. On failure, returns the errors of name and content and whether the
 * place is invalid; all are reported together.
 */
export function parseNewPageFormData(
  formData: FormData,
): { success: true; data: NewPageInput } | { success: false; fieldErrors: PageFieldErrors; placeInvalid: boolean } {
  const result = newPageInputSchema.safeParse({
    name: textField(formData, "name"),
    content: textField(formData, "content"),
  });
  const place = parsePlace(formData);
  if (result.success && place.success) return { success: true, data: { ...result.data, tabId: place.tabId } };
  return {
    success: false,
    fieldErrors: result.success ? {} : z.flattenError(result.error).fieldErrors,
    placeInvalid: !place.success,
  };
}

/**
 * State of the "Move or rename page" form between submissions: errors from the last attempt, if any; the message is
 * one that is not about the name, e.g. when the chosen tab or the page no longer exists.
 */
export type PageMoveOrRenameFormState = FormState<NameFieldErrors>;

/** A Server Action behind the "Move or rename page" form; it returns the errors to show, or redirects on success. */
export type PageMoveOrRenameFormAction = (
  prevState: PageMoveOrRenameFormState,
  formData: FormData,
) => Promise<PageMoveOrRenameFormState>;

/**
 * Validates the name and reads the place and the version of the page of a submitted "Move or rename page" form. A
 * missing name and a file count as empty; an empty or missing place is the folder itself, a malformed tab id or a file is no
 * place; a missing or malformed version is `null`, which is no error of the form. Other fields, the content in
 * particular, are ignored, so no content rule can block a save. On failure, returns the errors of the name field and
 * whether the place is invalid; both are reported together.
 */
export function parsePageMoveOrRenameFormData(
  formData: FormData,
):
  | { success: true; data: PageMoveOrRenameInput & { version: number | null } }
  | { success: false; fieldErrors: NameFieldErrors; placeInvalid: boolean } {
  const name = pageNameInputSchema.safeParse({ name: textField(formData, "name") });
  const place = parsePlace(formData);
  if (name.success && place.success) {
    return { success: true, data: { name: name.data.name, tabId: place.tabId, version: parseVersion(formData) } };
  }
  return {
    success: false,
    fieldErrors: name.success ? {} : z.flattenError(name.error).fieldErrors,
    placeInvalid: !place.success,
  };
}

/** State of the "Delete page" form between submissions: the error of the last attempt, if any. */
export type PageDeleteFormState = {
  /** Why the page could not be deleted, e.g. when it no longer exists. */
  message?: string;
};

/** A Server Action behind the "Delete page" form; it returns the error to show, or redirects on success. */
export type PageDeleteFormAction = (prevState: PageDeleteFormState, formData: FormData) => Promise<PageDeleteFormState>;

/**
 * Reads the version of the page from a submitted "Delete page" form, the only field it has: `null` if it is missing
 * or malformed, which the service refuses like a delete based on an older state.
 */
export function parsePageDeleteFormData(formData: FormData): { version: number | null } {
  return { version: parseVersion(formData) };
}

/** State of the "Revert page" form between submissions: the error of the last attempt, if any. */
export type PageRevertFormState = {
  /** Why the page could not be reverted, e.g. when the content of the revision breaks a limit of pages now. */
  message?: string;
};

/** A Server Action behind the "Revert page" form; it returns the error to show, or redirects on success. */
export type PageRevertFormAction = (prevState: PageRevertFormState, formData: FormData) => Promise<PageRevertFormState>;

/**
 * Reads the version of the page from a submitted "Revert page" form, the only field it has: `null` if it is missing or
 * malformed, which the service refuses like a revert based on an older state.
 */
export function parsePageRevertFormData(formData: FormData): { version: number | null } {
  return { version: parseVersion(formData) };
}

/** Shown at the place field of the "Restore page" form when no place is chosen. */
export const CHOOSE_PLACE_MESSAGE = "Choose a place";

export type PageRestoreFieldErrors = { name?: string[]; place?: string[] };

/** State of the "Restore page" form between submissions: errors from the last attempt, if any. */
export type PageRestoreFormState = FormState<PageRestoreFieldErrors>;

/** A Server Action behind the "Restore page" form; it returns the errors to show, or redirects on success. */
export type PageRestoreFormAction = (
  prevState: PageRestoreFormState,
  formData: FormData,
) => Promise<PageRestoreFormState>;

/**
 * Validates the name and reads the place of a submitted "Restore page" form. The name is checked as for moving or
 * renaming; a missing name and a file count as empty. No place is preselected, so a missing place is reported as "Choose a place"
 * at the place field; an empty place is the folder itself, a malformed tab id or a file is no place. Other fields are
 * ignored. On failure, returns the errors of name and place and whether the place is invalid; all are reported
 * together.
 */
export function parsePageRestoreFormData(
  formData: FormData,
):
  | { success: true; data: PageRestoreInput }
  | { success: false; fieldErrors: PageRestoreFieldErrors; placeInvalid: boolean } {
  const name = pageNameInputSchema.safeParse({ name: textField(formData, "name") });
  const placeMissing = formData.get(PLACE_FIELD) === null;
  const place = parsePlace(formData);
  if (name.success && !placeMissing && place.success) {
    return { success: true, data: { name: name.data.name, tabId: place.tabId } };
  }
  return {
    success: false,
    fieldErrors: {
      ...(!name.success && z.flattenError(name.error).fieldErrors),
      ...(placeMissing && { place: [CHOOSE_PLACE_MESSAGE] }),
    },
    placeInvalid: !placeMissing && !place.success,
  };
}
