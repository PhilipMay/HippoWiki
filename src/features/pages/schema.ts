import { z } from "zod";

import {
  CONTENT_MAX_DEPTH,
  CONTENT_MAX_LENGTH,
  CONTENT_MAX_TABLE_CELLS,
  CONTENT_MAX_WIKI_LINKS,
} from "@/features/pages/limits";
import { analyseMarkdown } from "@/features/pages/markdown";
import { nameSchema } from "@/lib/names";

/** A page id: a UUID in its canonical 8-4-4-4-12 hex form, as PostgreSQL generates it. */
const pageIdSchema = z.guid();

/**
 * Returns the id if it is a well-formed page id, otherwise `null`. Malformed ids must not reach the database, because
 * PostgreSQL rejects them with an error instead of returning no row.
 */
export function parsePageId(id: string): string | null {
  const result = pageIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

/** The largest value of a PostgreSQL `integer` column, such as the version of a page and the number of a revision. */
const INTEGER_MAX = 2_147_483_647;

/** The largest version a page can have: the largest value of the column. */
const PAGE_VERSION_MAX = INTEGER_MAX;

/**
 * The version of a page that a change is based on: an integer of at least 1, as the page had it when its editor or
 * dialog was opened.
 */
const pageVersionSchema = z.number().int().min(1).max(PAGE_VERSION_MAX);

/**
 * Returns the value if it is a version of a page, otherwise `null`. A change with `null` is based on no known state of
 * the page and is refused like one based on an older state.
 */
export function parsePageVersion(value: unknown): number | null {
  const result = pageVersionSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** The number of a revision of a page: 1 for the oldest, counted up per page, at most the largest value of the column. */
const revisionNumberSchema = z.number().int().min(1).max(INTEGER_MAX);

/** Whether the value is the number of a revision; a number that is not one never reaches the database. */
export function isRevisionNumber(value: number): boolean {
  return revisionNumberSchema.safeParse(value).success;
}

/**
 * Returns the number of a revision as an address writes it, or `null` for anything else: only a whole number from 1
 * up, written with digits alone, without a sign, leading zeros, spaces or other characters, and small enough for the
 * column. A missing or repeated value counts as missing as well.
 */
export function parseRevisionNumber(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const result = revisionNumberSchema.safeParse(Number(value));
  return result.success ? result.data : null;
}

/** Shown at the content field when the content has no title (see `titleFromTokens` in `markdown.ts`). */
export const TITLE_HEADING_MISSING_MESSAGE = "Content must start with a title heading: # Title";

/** Shown at the content field when the content contains U+0000, which PostgreSQL cannot store in `text`. */
export const CONTENT_NUL_MESSAGE = "Content must not contain NUL characters";

/**
 * The Markdown source of a page, as entered in the content field. Line breaks are normalised before anything is
 * checked: browsers submit textarea line breaks as CRLF, while the `maxLength` of the editor counts each as one
 * character, and the Markdown is stored with plain LF. A NUL character is refused before the length is checked.
 */
const contentSchema = z
  .string()
  .transform((content) => content.replace(/\r\n?/g, "\n"))
  .pipe(
    z
      .string()
      .refine((content) => !content.includes("\u0000"), { message: CONTENT_NUL_MESSAGE, abort: true })
      .max(CONTENT_MAX_LENGTH, `Content must be at most ${CONTENT_MAX_LENGTH.toLocaleString("en-US")} characters`),
  );

/** Shown at the content field when lists and quotes are nested deeper than `CONTENT_MAX_DEPTH`. */
export const CONTENT_DEPTH_MESSAGE = `Lists and quotes must be nested at most ${CONTENT_MAX_DEPTH} levels deep`;

/** Shown at the content field when the tables have more than `CONTENT_MAX_TABLE_CELLS` cells. */
export const CONTENT_TABLE_CELLS_MESSAGE =
  `Tables must have at most ${CONTENT_MAX_TABLE_CELLS.toLocaleString("en-US")} cells in all, counting the empty ` +
  "cells that fill a row up to the columns of its header";

/** Shown at the content field when the content has more than `CONTENT_MAX_WIKI_LINKS` wiki links. */
export const CONTENT_WIKI_LINKS_MESSAGE = `A page may hold at most ${CONTENT_MAX_WIKI_LINKS.toLocaleString("en-US")} wiki links.`;

/**
 * Adds the title derived from the content to validated input, or reports at the content field what is wrong with it:
 * a missing title heading, lists and quotes nested too deep, too many table cells, too many wiki links. Title, depth,
 * cells and wiki links come from one parse. A submitted title is never part of the input; the content is the only source of the title.
 */
function withDerivedTitle<Input extends { content: string }>(input: Input, ctx: z.RefinementCtx) {
  const { title, depth, cells, wikiLinks } = analyseMarkdown(input.content);
  const messages: string[] = [];
  if (title === null) messages.push(TITLE_HEADING_MISSING_MESSAGE);
  if (depth > CONTENT_MAX_DEPTH) messages.push(CONTENT_DEPTH_MESSAGE);
  if (cells > CONTENT_MAX_TABLE_CELLS) messages.push(CONTENT_TABLE_CELLS_MESSAGE);
  if (wikiLinks > CONTENT_MAX_WIKI_LINKS) messages.push(CONTENT_WIKI_LINKS_MESSAGE);
  for (const message of messages) ctx.addIssue({ code: "custom", message, path: ["content"] });
  if (title === null || messages.length > 0) return z.NEVER;
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
