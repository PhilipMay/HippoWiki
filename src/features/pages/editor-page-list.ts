// The page list that the Markdown editor gets when it opens: the pages of the folder and the places that exist, with
// their addresses built here, so that the modules of the editor need no module of addresses.

import type { EditorPageList } from "@/features/pages/editor/wiki-links";
import { newPagePath, pagePath } from "@/lib/addresses";

/**
 * The page list of the editor from the pages of the folder that are not deleted, each with its tab, and the tabs of the
 * folder. The address of a new page in a place is the one of `?action=new` with an empty preset name, to which the
 * editor appends the name.
 */
export function buildEditorPageList(
  folderName: string,
  pages: readonly { name: string; title: string; tab: { name: string } | null }[],
  tabs: readonly { name: string }[],
): EditorPageList {
  return {
    pages: pages.map(({ name, title, tab }) => ({
      tab: tab?.name ?? null,
      name,
      title,
      address: pagePath(folderName, tab?.name ?? null, name),
    })),
    places: [null, ...tabs.map(({ name }) => name)].map((tab) => ({
      tab,
      newPageAddress: newPagePath(folderName, tab, ""),
    })),
  };
}
