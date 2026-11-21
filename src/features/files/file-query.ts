// What the query string of the details page of a file asks for, and its browser title. The routes, their
// `generateMetadata` and the views share it, so that the title and the page decide in one place what an address shows.
// No server-only imports.

import type { Role } from "@/features/folder-roles/roles";
import { hasSearchWords, parseAction, parseView, type SearchParams } from "@/lib/addresses";

/**
 * What the details page of a file shows, and its browser title: `null` for any action or view (the details page has
 * neither yet) and for the words of a search, which belong to the folder address, which all answer like an unknown
 * address. The route uses it for the title and for the page, so that both decide alike.
 */
export function fileAddressOf(
  file: { name: string; folder: { name: string }; role: Role | null },
  searchParams: SearchParams,
): { title: string } | null {
  if (parseView(searchParams) !== null || parseAction(searchParams, []) !== null || hasSearchWords(searchParams)) {
    return null;
  }
  return { title: `${file.name} – ${file.folder.name}` };
}
