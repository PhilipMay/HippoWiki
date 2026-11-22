// The reads of files for Server Components: thin adapters on top of the service.

import { connection } from "next/server";
import { cache } from "react";

import { requireUser } from "@/features/auth/session";
import { inBrowser } from "@/features/folder-roles/actors";
import * as fileService from "@/features/files/service";

// Every query starts with `connection()`, so that Next.js does not prerender the calling route, and then calls
// `requireUser()`, which redirects to the login page without a logged-in user. That user is the actor of the service,
// with the channel `web`, and the service decides what the user may see: an admin sees no files, and a user sees only
// the files of the folders with a role on them, so every other read returns `null`, and the routes show the not-found
// page.

/** The files placed directly in the folder, by name; deleted files are left out. */
export async function listFolderFiles(folderId: string): Promise<fileService.FileSummary[] | null> {
  await connection();
  const user = await requireUser();
  return fileService.listFolderFiles(inBrowser(user), folderId);
}

/** The files of the tab, by name; deleted files are left out. */
export async function listTabFiles(tabId: string): Promise<fileService.FileSummary[] | null> {
  await connection();
  const user = await requireUser();
  return fileService.listTabFiles(inBrowser(user), tabId);
}

/**
 * The file of the given name in the tab of the given name or, with `null`, placed directly in the folder, with its
 * versions and the role of the user on its folder. Cached per request, because `generateMetadata` and the page both
 * read it.
 */
export const getFile = cache(
  async (folderName: string, tabName: string | null, fileName: string): Promise<fileService.FileWithPlace | null> => {
    await connection();
    const user = await requireUser();
    return fileService.getFile(inBrowser(user), folderName, tabName, fileName);
  },
);

/**
 * Whether files can be uploaded, and their size limit. Without the files directory no "Upload file" is offered. Cached
 * per request, because the route and its views both ask it.
 */
export const getUploadSettings = cache(async (): Promise<fileService.UploadSettings> => {
  await connection();
  await requireUser();
  return fileService.uploadSettings();
});

/** The deleted files of the folder, newest first; `null` for a role below Manager. */
export async function listDeletedFiles(folderId: string): Promise<fileService.DeletedFileSummary[] | null> {
  await connection();
  const user = await requireUser();
  return fileService.listDeletedFiles(inBrowser(user), folderId);
}

/**
 * The deleted file with the given id in the folder of the given name, with its versions. Cached per request, because
 * `generateMetadata` and the page both read it.
 */
export const getDeletedFile = cache(async (folderName: string, id: string): Promise<fileService.DeletedFile | null> => {
  await connection();
  const user = await requireUser();
  return fileService.getDeletedFile(inBrowser(user), folderName, id);
});

/** Every file of the folder that is not deleted, with its tab, for the Markdown editor. */
export async function listAllFolderFiles(folderId: string): Promise<fileService.FolderFile[] | null> {
  await connection();
  const user = await requireUser();
  return fileService.listAllFolderFiles(inBrowser(user), folderId);
}
