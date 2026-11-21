// The ids, numbers and names of files and their versions, parsed before they reach the database, and the validated
// input of an upload.

import { z } from "zod";

import { fileNameSchema } from "@/lib/names";

/** The largest value of a PostgreSQL `integer` column, such as the lock version of a file and a version number. */
const INTEGER_MAX = 2_147_483_647;

/** The lock version of a file that a change is based on, as the file had it when its dialog was opened. */
const lockVersionSchema = z.number().int().min(1).max(INTEGER_MAX);

/**
 * Returns the value if it is a lock version of a file, otherwise `null`. A change with `null` is based on no known
 * state of the file and is refused like one based on an older state.
 */
export function parseLockVersion(value: unknown): number | null {
  const result = lockVersionSchema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * Returns a whole number from 1 up as an address writes it, such as the number of a version in `?version=<n>` or the
 * lock version in `?replace=<n>`, or `null` for anything else: digits alone, without a sign, leading zeros, spaces or
 * other characters, small enough for the column. A missing or repeated value counts as missing as well.
 */
export function parseNumberParam(value: string | string[] | null | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const number = Number(value);
  return number <= INTEGER_MAX ? number : null;
}

/** The input of an upload that the schema checks: the name of the file, with the extension of its type. */
export const uploadInputSchema = z.object({ name: fileNameSchema });

/** The messages of the schema at the name field of an upload, as the service returns them in `invalid-input`. */
export type FileFieldErrors = { name?: string[] };
