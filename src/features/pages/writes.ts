// What the writes of a page store, for the pages service and for the delete of a tab in the folders service, which
// deletes the pages of the tab inside its own transaction. No database, so that both services build the same data.

import type { Editor } from "@/features/folder-roles/actors";

/** The data that counts the version of a page up, in the same write that changes the page. */
export const NEXT_VERSION = { version: { increment: 1 } } as const;

/**
 * The data of the soft delete of a page: the time of deletion, no tab, because its place inside the folder is
 * forgotten, the actor as its last editor with the channel, and the next version. A page deleted alone and the pages
 * deleted with their tab get the same data.
 */
export function softDeleteData(
  editor: Editor,
  deletedAt: Date = new Date(),
): Editor & { deletedAt: Date; tabId: null } & typeof NEXT_VERSION {
  return { deletedAt, tabId: null, ...editor, ...NEXT_VERSION };
}
