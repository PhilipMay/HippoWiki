import { z } from "zod";

import { parseTabId } from "@/features/folders/schema";
import { titleFromContent } from "@/features/pages/derive";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { nameSchema, type NameFieldErrors } from "@/lib/names";

/** A page id: a UUID in its canonical 8-4-4-4-12 hex form, as PostgreSQL generates it. */
export const pageIdSchema = z.guid();

/**
 * Returns the id if it is a well-formed page id, otherwise `null`. Malformed ids must not reach the database, because
 * PostgreSQL rejects them with an error instead of returning no row.
 */
export function parsePageId(id: string): string | null {
  const result = pageIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

/** Shown at the content field when the content has no title (see `titleFromContent`). */
export const TITLE_HEADING_MISSING_MESSAGE = "Content must start with a title heading: # Title";

/** The Markdown source of a page, as entered in the content field. */
const contentSchema = z
  .string()
  .max(CONTENT_MAX_LENGTH, `Content must be at most ${CONTENT_MAX_LENGTH.toLocaleString("en-US")} characters`)
  // Browsers submit textarea line breaks as CRLF; store the Markdown with plain LF.
  .transform((content) => content.replace(/\r\n?/g, "\n"));

/**
 * Adds the title derived from the content to validated input, or reports the missing title heading at the content
 * field. A submitted title is never part of the input; the content is the only source of the title.
 */
function withDerivedTitle<Input extends { content: string }>(input: Input, ctx: z.RefinementCtx) {
  const title = titleFromContent(input.content);
  if (title === null) {
    ctx.addIssue({ code: "custom", message: TITLE_HEADING_MISSING_MESSAGE, path: ["content"] });
    return z.NEVER;
  }
  return { ...input, title };
}

/**
 * Input for editing a page: the content as entered in the page form, plus the title derived from it. The name is not
 * part of the form; a page is moved or renamed in its own dialog.
 */
export const pageContentInputSchema = z
  .object({ content: contentSchema })
  // Runs only when the content is valid, so too long content reports only the length error.
  .transform(withDerivedTitle);

/**
 * Input for a new page: the content of the editor and the name asked for in the save dialog, plus the title derived
 * from the content.
 */
export const newPageInputSchema = z
  .object({ name: nameSchema, content: contentSchema })
  // Runs only when name and content are valid, so too long content reports only the length error.
  .transform(withDerivedTitle);

/** A validated edit of a page: the derived title and the content. */
export type PageContentInput = z.output<typeof pageContentInputSchema>;
/**
 * A validated new page: the name, the derived title, the content and its tab, or `null` for a page placed directly in
 * the folder.
 */
export type NewPageInput = z.output<typeof newPageInputSchema> & { tabId: string | null };

export type PageFieldErrors = { name?: string[]; content?: string[] };

/** State of a page form between submissions: errors from the last attempt, if any. */
export type PageFormState = {
  fieldErrors?: PageFieldErrors;
  /** An error that is not about a single field, e.g. when the database is unreachable. */
  message?: string;
};

/** A Server Action behind a page form; it returns the errors to show, or redirects on success. */
export type PageFormAction = (prevState: PageFormState, formData: FormData) => Promise<PageFormState>;

type ParseResult<Data, FieldErrors> = { success: true; data: Data } | { success: false; fieldErrors: FieldErrors };

/**
 * Validates the content of a submitted page form and derives the title from it. A missing field counts as empty;
 * submitted `title` and `name` fields are ignored.
 */
export function parsePageContentFormData(formData: FormData): ParseResult<PageContentInput, PageFieldErrors> {
  const result = pageContentInputSchema.safeParse({ content: formData.get("content") ?? "" });
  if (result.success) return { success: true, data: result.data };
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
 * Missing name and content count as empty; an empty or missing place is the folder itself, a malformed tab id or a file
 * is no place; a submitted `title` field is ignored. On failure, returns the errors of name and content and whether the
 * place is invalid; all are reported together.
 */
export function parseNewPageFormData(
  formData: FormData,
): { success: true; data: NewPageInput } | { success: false; fieldErrors: PageFieldErrors; placeInvalid: boolean } {
  const result = newPageInputSchema.safeParse({
    name: formData.get("name") ?? "",
    content: formData.get("content") ?? "",
  });
  const place = parsePlace(formData);
  if (result.success && place.success) return { success: true, data: { ...result.data, tabId: place.tabId } };
  return {
    success: false,
    fieldErrors: result.success ? {} : z.flattenError(result.error).fieldErrors,
    placeInvalid: !place.success,
  };
}

/** The name of a page as entered in the "Move or rename page" form. */
const pageMoveOrRenameNameSchema = z.object({ name: nameSchema });

/** A validated move or rename of a page: its name and its tab, or `null` for a page placed directly in its folder. */
export type PageMoveOrRenameInput = { name: string; tabId: string | null };

/** State of the "Move or rename page" form between submissions: errors from the last attempt, if any. */
export type PageMoveOrRenameFormState = {
  fieldErrors?: NameFieldErrors;
  /** An error that is not about the name, e.g. when the chosen tab or the page no longer exists. */
  message?: string;
};

/** A Server Action behind the "Move or rename page" form; it returns the errors to show, or redirects on success. */
export type PageMoveOrRenameFormAction = (
  prevState: PageMoveOrRenameFormState,
  formData: FormData,
) => Promise<PageMoveOrRenameFormState>;

/**
 * Validates the name and reads the place of a submitted "Move or rename page" form. A missing name counts as empty;
 * an empty or missing place is the folder itself, a malformed tab id or a file is no place. Other fields, the content
 * in particular, are ignored, so no content rule can block a save. On failure, returns the errors of the name field
 * and whether the place is invalid; both are reported together.
 */
export function parsePageMoveOrRenameFormData(
  formData: FormData,
):
  | { success: true; data: PageMoveOrRenameInput }
  | { success: false; fieldErrors: NameFieldErrors; placeInvalid: boolean } {
  const name = pageMoveOrRenameNameSchema.safeParse({ name: formData.get("name") ?? "" });
  const place = parsePlace(formData);
  if (name.success && place.success) {
    return { success: true, data: { name: name.data.name, tabId: place.tabId } };
  }
  return {
    success: false,
    fieldErrors: name.success ? {} : z.flattenError(name.error).fieldErrors,
    placeInvalid: !place.success,
  };
}
