// How a submitted form is read, for the forms modules of every feature: the text of a field, the result of a parse
// and the state of a form between submissions. No imports, so Client Components and the services can use it.

/**
 * The text of a field of a submitted form. A missing field and a file count as empty, so that a schema reports the
 * field as missing: only a crafted request sends a file where a form has a text field.
 */
export function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The result of the parse of a submitted form: the input, or the messages of the schema per field. */
export type ParseResult<Data, FieldErrors> =
  { success: true; data: Data } | { success: false; fieldErrors: FieldErrors };

/** The state of a form between submissions: the errors of the last attempt, if any. */
export type FormState<FieldErrors> = {
  fieldErrors?: FieldErrors;
  /** An error that is not about a single field, e.g. when the database is unreachable. */
  message?: string;
};
