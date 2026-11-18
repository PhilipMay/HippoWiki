// The revalidation of the cached pages after a write, for the Server Actions of the content features. It imports
// `next/cache`, so no service imports it (see "Linting" in `architecture.md`).

import { revalidatePath } from "next/cache";

import { deletedPagesRootPath, foldersPath } from "@/lib/addresses";

/**
 * Revalidates every address under `/folders` and `/deleted-pages`, after any write to folders, tabs or pages. This
 * covers the old and the new address of a renamed or moved item, the addresses of the deleted pages of a renamed
 * folder, and the places offered when a deleted page is restored.
 */
export function revalidateContent(): void {
  revalidatePath(foldersPath(), "layout");
  revalidatePath(deletedPagesRootPath(), "layout");
}
