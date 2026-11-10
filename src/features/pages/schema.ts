import { z } from "zod";

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
