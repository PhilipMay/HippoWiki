// The result of a service write that can fail, and the errors that several services share. No server-only imports, so
// every caller of a service can use it.

import { z } from "zod";

/**
 * What a write of a service returns: the value on success, or an error whose `code` says what went wrong. Expected
 * failures, such as a taken name, are returned this way instead of thrown, so that a caller has to handle them.
 */
export type Result<Value, Error> = { ok: true; value: Value } | { ok: false; error: Error };

/** The actor may not make the write: an admin, or a role that does not allow it; it has been logged. */
export type NotAllowed = { code: "not-allowed" };
/** An unexpected database error, or an actor that is malformed or does not exist; it has been logged. */
export type Failed = { code: "failed" };
/** The input is invalid; `fieldErrors` holds the messages of the schema per field. */
export type InvalidInput<FieldErrors> = { code: "invalid-input"; fieldErrors: FieldErrors };
/** Another item already uses the name where it must be unique. */
export type NameTaken = { code: "name-taken" };
/** The folder does not exist, or its id is malformed. */
export type FolderNotFound = { code: "folder-not-found" };
/** The tab does not exist, is no tab of the folder, or its id is malformed. */
export type TabNotFound = { code: "tab-not-found" };

/** The result of a write whose input the schema refused, with the messages of the schema per field. */
export function invalidInput<Input>(error: z.ZodError<Input>): {
  ok: false;
  error: InvalidInput<z.core.$ZodFlattenedError<Input>["fieldErrors"]>;
} {
  return { ok: false, error: { code: "invalid-input", fieldErrors: z.flattenError(error).fieldErrors } };
}
