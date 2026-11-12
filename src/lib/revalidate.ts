import { revalidatePath } from "next/cache";

/**
 * Revalidates every address under `/folders` and `/deleted-pages`, after any write to folders, tabs or pages. This
 * covers the old and the new address of a renamed or moved item, the addresses of the deleted pages of a renamed
 * folder, and the places offered when a deleted page is restored.
 */
export function revalidateContent(): void {
  revalidatePath("/folders", "layout");
  revalidatePath("/deleted-pages", "layout");
}
