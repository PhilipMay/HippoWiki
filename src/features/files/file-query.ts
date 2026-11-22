// What the query string of the details page of a file asks for: its actions, the lowest role of each, the version of a
// revert, the notice after a refused change, and the browser title. The routes, their `generateMetadata` and the views
// share it, so that the title and the page decide in one place what an address shows. No server-only imports.

import { mayDo, type FolderFunction, type Role } from "@/features/folder-roles/roles";
import { parseNumberParam } from "@/features/files/schema";
import {
  hasSearchWords,
  PAGE_NOTICES,
  parseAction,
  parseChoice,
  parseView,
  type PageNotice,
  type SearchParams,
} from "@/lib/addresses";

/**
 * The actions of the details page of a file: `upload-version` opens the dialog "Upload new version", which exists only
 * while the files are on, `revert` the dialog "Revert file" for the version in `&version=<n>`, `move-or-rename` the
 * dialog "Move or rename file" and `delete` the dialog "Delete file".
 */
const FILE_ACTIONS = ["upload-version", "revert", "move-or-rename", "delete"] as const;

export type FileAction = (typeof FILE_ACTIONS)[number];

/** The function of each action of a file, whose lowest role the user needs; one beyond the role does not exist. */
const FILE_ACTION_FUNCTIONS: Record<FileAction, FolderFunction> = {
  "upload-version": "editFile",
  revert: "editFile",
  "move-or-rename": "editFile",
  delete: "deleteFile",
};

/**
 * Whether the role includes the action of the details page of a file. The buttons that link to an action ask it as
 * well, so that a button is offered exactly where its address exists.
 */
export function mayDoFileAction(role: Role | null, action: FileAction): boolean {
  return mayDo(role, FILE_ACTION_FUNCTIONS[action]);
}

/** What the details page needs to know of a file to decide what its address shows. */
type FileOfAddress = {
  name: string;
  folder: { name: string };
  role: Role | null;
  /** The versions of the file, newest first; only their numbers count here. */
  versions: { number: number }[];
};

/**
 * What the details page of a file shows, and its browser title: the action, the version of a revert and the notice
 * `changed` after a refused change. `null` for any view (the details page has none), the words of a search, which
 * belong to the folder address, an unknown, empty or repeated action, one beyond the role of the user,
 * `upload-version` while the files are off (`filesOn`), a revert without a version, to a version that does not exist
 * or to the current one, which would change nothing, `version` without `revert`, and a notice without an action or of
 * another kind, which all answer like an unknown address.
 */
export function fileAddressOf(
  file: FileOfAddress,
  searchParams: SearchParams,
  filesOn: boolean,
): { action: FileAction | null; version: number | null; notice: PageNotice | null; title: string } | null {
  if (parseView(searchParams) !== null || hasSearchWords(searchParams)) return null;
  const action = parseAction(searchParams, FILE_ACTIONS);
  if (action === "invalid" || (action !== null && !mayDoFileAction(file.role, action))) return null;
  if (action === "upload-version" && !filesOn) return null;

  const notice = parseChoice(searchParams, "notice", PAGE_NOTICES);
  if (notice === "invalid" || (notice !== null && action === null)) return null;

  let version: number | null = null;
  if (action === "revert") {
    version = parseNumberParam(searchParams.version);
    const current = file.versions[0]?.number;
    if (version === null || version === current || !file.versions.some(({ number }) => number === version)) {
      return null;
    }
  } else if (searchParams.version !== undefined) {
    return null;
  }
  return { action, version, notice, title: `${file.name} – ${file.folder.name}` };
}

/** The actions of the address of a deleted file: `restore` opens the "Restore file" dialog. */
const DELETED_FILE_ACTIONS = ["restore"] as const;

export type DeletedFileAction = (typeof DELETED_FILE_ACTIONS)[number];

/**
 * What the address of a deleted file shows, and its browser title: the file read-only, or the "Restore file" dialog
 * for `restore`. `null` for any other action, any view, the words of a search, a version and a notice: a deleted file
 * has no versions to open and no history. The title shows that the file is a deleted copy.
 */
export function deletedFileAddressOf(
  file: { name: string },
  searchParams: SearchParams,
): { action: DeletedFileAction | null; title: string } | null {
  if (parseView(searchParams) !== null || hasSearchWords(searchParams)) return null;
  if (searchParams.version !== undefined || searchParams.notice !== undefined) return null;
  const action = parseAction(searchParams, DELETED_FILE_ACTIONS);
  if (action === "invalid") return null;
  return { action, title: `Deleted: ${file.name}` };
}
