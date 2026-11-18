// The rules for grants: their ids. The MCP address and the lifetimes of a grant are rules of OAuth
// (`src/features/oauth/schema.ts`). No server-only imports, so Client Components can use it.

import { z } from "zod";

/** A grant id: a UUID, like the ids of users, folders, tabs and pages. */
const grantIdSchema = z.guid();

/** Returns the id if it is a well-formed grant id, otherwise `null`, so that malformed ids never reach the database. */
export function parseGrantId(id: string): string | null {
  const result = grantIdSchema.safeParse(id);
  return result.success ? result.data : null;
}
