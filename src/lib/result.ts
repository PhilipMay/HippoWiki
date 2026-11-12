// The result of a service write that can fail. No server-only imports, so every caller of a service can use it.

/**
 * What a write of a service returns: the value on success, or an error whose `code` says what went wrong. Expected
 * failures, such as a taken name, are returned this way instead of thrown, so that a caller has to handle them.
 */
export type Result<Value, Error> = { ok: true; value: Value } | { ok: false; error: Error };
