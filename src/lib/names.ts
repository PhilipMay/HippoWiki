// The name rule shared by folders, tabs and pages. Used by Client Components, so no server-only imports.

import { z } from "zod";

/** Lowercase letters and digits in groups joined by single hyphens, e.g. `release-notes`. */
export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const NAME_MAX_LENGTH = 80;

/** Shown at the name field when another item already uses the name where it must be unique. */
export const NAME_TAKEN_MESSAGE = "Name is already in use";

/** The name of a folder, tab or page: the part of its address. */
export const nameSchema = z
  .string()
  .trim()
  // Abort here, so that an empty name reports only this error and not also the pattern error.
  .min(1, { error: "Name is required", abort: true })
  .max(NAME_MAX_LENGTH, `Name must be at most ${NAME_MAX_LENGTH} characters`)
  .regex(NAME_PATTERN, "Use lowercase letters, digits and single hyphens");

/**
 * Returns the name if the URL segment is a valid name, otherwise `null`. Surrounding whitespace makes a segment
 * invalid here, so that every address maps to at most one item.
 */
export function parseName(segment: string): string | null {
  const result = nameSchema.safeParse(segment);
  return result.success && result.data === segment ? result.data : null;
}

export type NameFieldErrors = { name?: string[] };

/** State of a form that asks for a name, between submissions: errors from the last attempt, if any. */
export type NameFormState = {
  fieldErrors?: NameFieldErrors;
  /** An error that is not about the name, e.g. when the database is unreachable. */
  message?: string;
};

/** A Server Action behind a form that asks for a name; it returns the errors to show, or redirects on success. */
export type NameFormAction = (prevState: NameFormState, formData: FormData) => Promise<NameFormState>;
