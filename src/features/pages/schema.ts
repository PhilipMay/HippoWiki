import { z } from "zod";

import { CONTENT_MAX_LENGTH, SLUG_MAX_LENGTH, TITLE_MAX_LENGTH } from "@/features/pages/limits";

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

/** Lowercase letters and digits in groups joined by single hyphens, e.g. `getting-started`. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Slugs that cannot name a page, because the address is a route of its own (`/pages/new`). */
export const RESERVED_SLUGS: readonly string[] = ["new"];

/** The slug of a page: the last part of its address `/pages/<slug>`. */
export const slugSchema = z
  .string()
  .trim()
  // Abort here, so that an empty slug reports only this error and not also the pattern error.
  .min(1, { error: "Slug is required", abort: true })
  .max(SLUG_MAX_LENGTH, `Slug must be at most ${SLUG_MAX_LENGTH} characters`)
  .regex(SLUG_PATTERN, "Use lowercase letters, digits and single hyphens")
  .refine((slug) => !RESERVED_SLUGS.includes(slug), "This slug is reserved");

/**
 * Returns the slug if it is a valid page slug, otherwise `null`. Surrounding whitespace makes a slug invalid here, so
 * that every address maps to at most one page.
 */
export function parsePageSlug(slug: string): string | null {
  const result = slugSchema.safeParse(slug);
  return result.success && result.data === slug ? result.data : null;
}

/** Input for creating or updating a page, as entered in the page form. */
export const pageInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(TITLE_MAX_LENGTH, `Title must be at most ${TITLE_MAX_LENGTH} characters`),
  slug: slugSchema,
  content: z
    .string()
    .max(CONTENT_MAX_LENGTH, `Content must be at most ${CONTENT_MAX_LENGTH.toLocaleString("en-US")} characters`)
    // Browsers submit textarea line breaks as CRLF; store the Markdown with plain LF.
    .transform((content) => content.replace(/\r\n?/g, "\n")),
});

export type PageInput = z.infer<typeof pageInputSchema>;

export type PageFieldErrors = Partial<Record<keyof PageInput, string[]>>;

/** State of the page form between submissions: errors from the last attempt, if any. */
export type PageFormState = {
  fieldErrors?: PageFieldErrors;
  /** An error that is not about a single field, e.g. when the database is unreachable. */
  message?: string;
};

export type ParsePageInputResult =
  { success: true; data: PageInput } | { success: false; fieldErrors: PageFieldErrors };

/** Validates the fields of a submitted page form. Missing fields count as empty. */
export function parsePageFormData(formData: FormData): ParsePageInputResult {
  const result = pageInputSchema.safeParse({
    title: formData.get("title") ?? "",
    slug: formData.get("slug") ?? "",
    content: formData.get("content") ?? "",
  });
  if (result.success) return { success: true, data: result.data };
  return { success: false, fieldErrors: z.flattenError(result.error).fieldErrors };
}
