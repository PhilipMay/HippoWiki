import { z } from "zod";

import { nameSchema } from "@/lib/names";

/** A folder id: a UUID in its canonical 8-4-4-4-12 hex form, as PostgreSQL generates it. */
export const folderIdSchema = z.guid();

/**
 * Returns the id if it is a well-formed folder id, otherwise `null`. Malformed ids must not reach the database,
 * because PostgreSQL rejects them with an error instead of returning no row.
 */
export function parseFolderId(id: string): string | null {
  const result = folderIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

/** Input for creating or renaming a folder: its name. */
export const folderInputSchema = z.object({ name: nameSchema });

/** A validated folder name. */
export type FolderInput = z.output<typeof folderInputSchema>;

/** A tab id: a UUID, like a folder id. */
export const tabIdSchema = z.guid();

/** Returns the id if it is a well-formed tab id, otherwise `null`, so that malformed ids never reach the database. */
export function parseTabId(id: string): string | null {
  const result = tabIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

/** Input for creating or renaming a tab: its name. */
export const tabInputSchema = z.object({ name: nameSchema });

/** A validated tab name. */
export type TabInput = z.output<typeof tabInputSchema>;
