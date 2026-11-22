// The page list that the Markdown editor gets when it opens: the pages and files of the folder and the places that
// exist, with their addresses built here, so that the modules of the editor need no module of addresses.

import type { EditorPageList } from "@/features/pages/editor/wiki-links";
import { isImageType, type FileType } from "@/features/files/types";
import { fileContentPath, newPagePath, pagePath, uploadFilePath } from "@/lib/addresses";

/**
 * The page list of the editor from the pages and files of the folder that are not deleted, each with its tab, and the
 * tabs of the folder. The address of a new page in a place is the one of `?action=new` with an empty preset name, and
 * the address of an upload there, with `mayUpload`, the one of `?action=upload` with an empty preset name, to which the
 * editor appends the name. A file has the address of the file itself, and an image its width and height.
 */
export function buildEditorPageList(
  folderName: string,
  pages: readonly { name: string; title: string; tab: { name: string } | null }[],
  tabs: readonly { name: string }[],
  files: readonly {
    name: string;
    type: FileType;
    tab: { name: string } | null;
    width: number | null;
    height: number | null;
  }[] = [],
  mayUpload = false,
): EditorPageList {
  return {
    pages: pages.map(({ name, title, tab }) => ({
      tab: tab?.name ?? null,
      name,
      title,
      address: pagePath(folderName, tab?.name ?? null, name),
    })),
    files: files.map(({ name, type, tab, width, height }) => ({
      tab: tab?.name ?? null,
      name,
      address: fileContentPath(folderName, tab?.name ?? null, name),
      image: isImageType(type) ? { width, height } : null,
    })),
    places: [null, ...tabs.map(({ name }) => name)].map((tab) => ({
      tab,
      newPageAddress: newPagePath(folderName, tab, ""),
      uploadAddress: mayUpload ? uploadFilePath(folderName, tab, "") : null,
    })),
  };
}
