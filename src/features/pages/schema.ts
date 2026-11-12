import { z } from "zod";

import { titleFromContent } from "@/features/pages/derive";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { nameSchema } from "@/lib/names";

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

/** The name of a page as given when it is moved, renamed or restored. */
export const pageNameInputSchema = z.object({ name: nameSchema });

/** A validated move or rename of a page: its name and its tab, or `null` for a page placed directly in its folder. */
export type PageMoveOrRenameInput = { name: string; tabId: string | null };

/** A validated restore of a deleted page: its name and its tab, or `null` for a page placed directly in its folder. */
export type PageRestoreInput = { name: string; tabId: string | null };
