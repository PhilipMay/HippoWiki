// The name rule shared by folders, tabs, pages and user names: the schema of a name with its limits, and the parse of a
// name that must match exactly. Used by Client Components, so no server-only imports.

import { z } from "zod";

/** Lowercase letters and digits in groups joined by single hyphens, e.g. `release-notes`. */
export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const NAME_MAX_LENGTH = 80;

/** Shown at the name field when another item already uses the name where it must be unique. */
export const NAME_TAKEN_MESSAGE = "Name is already in use";

/**
 * A schema of a name with the given limits of its length, after surrounding whitespace is cut off. The messages come
 * in this order: required, the lower limit (only above 1), the upper limit, the pattern.
 */
export function nameSchemaWith({ minLength = 1, maxLength }: { minLength?: number; maxLength: number }) {
  // Abort here, so that an empty name reports only this error and not also the other ones.
  let schema = z.string().trim().min(1, { error: "Name is required", abort: true });
  if (minLength > 1) schema = schema.min(minLength, `Name must be at least ${minLength} characters`);
  return schema
    .max(maxLength, `Name must be at most ${maxLength} characters`)
    .regex(NAME_PATTERN, "Use lowercase letters, digits and single hyphens");
}

/** The name of a folder, tab or page: the part of its address. */
export const nameSchema = nameSchemaWith({ maxLength: NAME_MAX_LENGTH });

/**
 * Returns the text if the schema accepts it exactly as given, otherwise `null`. Surrounding whitespace makes a text
 * invalid here, so that every address, or every name a caller passes, stands for at most one item.
 */
export function parseExact(schema: z.ZodType<string, string>, text: string): string | null {
  const result = schema.safeParse(text);
  return result.success && result.data === text ? result.data : null;
}

/** Returns the name if the URL segment is a valid name, otherwise `null` (`parseExact()`). */
export function parseName(segment: string): string | null {
  return parseExact(nameSchema, segment);
}

/** The messages of the name schema at the field of a name, as services return them in `invalid-input`. */
export type NameFieldErrors = { name?: string[] };
