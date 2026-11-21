// The name rule shared by folders, tabs, pages and user names: the schema of a name with its limits, and the parse of a
// name that must match exactly; and the name of a file, a name with the extension of its type. Used by Client
// Components, so no server-only imports.

import { z } from "zod";

import { FILE_NAME_PATTERN, NAME_MAX_LENGTH, NAME_PATTERN, type FileExtension } from "@/lib/name-limits";

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

/** The rule of the name of a file, as the name field shows it when a name breaks it. */
export const FILE_NAME_RULE_MESSAGE =
  "Use lowercase letters, digits and single hyphens, then a dot and png, jpg, gif, webp or pdf";

/** The name of a file without its extension: everything before the last dot, or the whole text without one. */
function withoutExtension(text: string): string {
  const dot = text.lastIndexOf(".");
  return dot < 0 ? text : text.slice(0, dot);
}

/**
 * The name of a file, after surrounding whitespace is cut off: a name of the name rule, a dot and the lowercase
 * extension of its type (`FILE_NAME_PATTERN`); the part before the dot has the length limit of a name. Upper case, a
 * space, a second dot and `.jpeg` break the rule.
 */
export const fileNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Name is required", abort: true })
  .refine((text) => withoutExtension(text).length <= NAME_MAX_LENGTH, {
    error: `Name must be at most ${NAME_MAX_LENGTH} characters before its extension`,
  })
  .regex(FILE_NAME_PATTERN, FILE_NAME_RULE_MESSAGE);

/** A file name read with `parseFileName()`: the whole name, the part before the dot and the extension. */
export type FileName = { name: string; base: string; extension: FileExtension };

/**
 * Reads a file name that must match exactly (`parseExact()`), e.g. a segment of an address: its parts, or `null` when
 * it breaks the rule of `fileNameSchema`.
 */
export function parseFileName(text: string): FileName | null {
  const name = parseExact(fileNameSchema, text);
  if (name === null) return null;
  const dot = name.lastIndexOf(".");
  return { name, base: name.slice(0, dot), extension: name.slice(dot + 1) as FileExtension };
}
