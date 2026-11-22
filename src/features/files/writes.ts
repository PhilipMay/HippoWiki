// What the soft delete of a file stores, for the files service and for the delete of a tab in the folders service,
// which deletes the files of the tab inside its own transaction. No database, so that both services build the same data.

import type { Editor } from "@/features/folder-roles/actors";

/**
 * The data of the soft delete of a file: the time of deletion, no tab, because its place inside the folder is
 * forgotten, the actor as its last editor with the channel, and the next lock version. A file deleted alone and the
 * files deleted with their tab get the same data, as `softDeleteData()` of `src/features/pages/writes.ts` gives pages.
 */
export function softDeleteFileData(
  editor: Editor,
  deletedAt: Date = new Date(),
): Editor & { deletedAt: Date; tabId: null; lockVersion: { increment: 1 } } {
  return { deletedAt, tabId: null, ...editor, lockVersion: { increment: 1 } };
}
