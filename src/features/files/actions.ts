"use server";

// The Server Actions of files: thin adapters between the browser and the service. The upload itself is no Server
// Action: its body is the file, which the upload address takes (`http.ts`).

import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { inBrowser } from "@/features/folder-roles/actors";
import {
  FOLDER_GONE_MESSAGE,
  parseLockVersionFormData,
  TAB_GONE_MESSAGE,
  uploadedFileState,
  UPLOAD_FAILED_MESSAGE,
  type FileRevertFormState,
  type NameCheck,
} from "@/features/files/forms";
import { parseFileId } from "@/features/files/schema";
import * as fileService from "@/features/files/service";
import { CHANGED_NOTICE, filePath, fileRevertPath } from "@/lib/addresses";
import { revalidateContent } from "@/lib/revalidate";

/** The message of a change of a file that no longer exists or is deleted. */
const FILE_GONE_MESSAGE = "This file no longer exists.";

/** The message of a revert that failed. */
const REVERT_FAILED_MESSAGE = "The file could not be reverted. Please try again.";

/**
 * Checks the name of an upload into the tab with the id `tabId` or, with `null`, directly into the folder with the id
 * `folderId`, before the upload dialog sends the file: whether the name follows the rule, and whether a file of that
 * name exists at the place, with that file as it is now, so that the dialog can ask whether to store a new version of
 * it. Nothing is stored. Bind the place with `checkUploadName.bind(null, folderId, tabId)`.
 */
export async function checkUploadName(folderId: string, tabId: string | null, name: string): Promise<NameCheck> {
  const user = await requireUser();

  const result = await fileService.checkUploadName(inBrowser(user), { folderId, tabId }, name);
  if (!result.ok) {
    switch (result.error.code) {
      case "not-allowed":
        notFound();
      case "folder-not-found":
        return { ok: false, field: null, message: FOLDER_GONE_MESSAGE };
      case "tab-not-found":
        return { ok: false, field: null, message: TAB_GONE_MESSAGE };
      case "invalid-input":
        return { ok: false, field: "name", message: result.error.fieldErrors.name?.[0] ?? "The name is not valid." };
      case "failed":
        return { ok: false, field: null, message: UPLOAD_FAILED_MESSAGE };
    }
  }
  return { ok: true, file: result.value && uploadedFileState(result.value) };
}

/**
 * Reverts the file with the given id to the version with the given number, based on the lock version in the form, and
 * redirects to its details page. Returns the error to show in the dialog if the file no longer exists or the revert
 * cannot be stored. If the file was changed after the dialog was opened, the dialog is shown again with the file as
 * it is now and the notice that says so. Bind the id and the version with `revertFile.bind(null, id, version)`.
 */
export async function revertFile(
  id: string,
  version: number,
  _prevState: FileRevertFormState,
  formData: FormData,
): Promise<FileRevertFormState> {
  const user = await requireUser();

  const fileId = parseFileId(id);
  if (!fileId) return { message: FILE_GONE_MESSAGE };

  const result = await fileService.revertFile(inBrowser(user), fileId, {
    version,
    lockVersion: parseLockVersionFormData(formData),
  });
  if (!result.ok) {
    switch (result.error.code) {
      case "not-allowed":
      // A revert to the current version, which would change nothing, is not offered.
      case "version-not-found":
        notFound();
      case "file-not-found":
        return { message: FILE_GONE_MESSAGE };
      case "file-changed": {
        const { folder, tab, name } = result.error.file;
        revalidateContent();
        redirect(fileRevertPath(folder.name, tab?.name ?? null, name, version, CHANGED_NOTICE));
      }
      case "failed":
        return { message: REVERT_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  const { folder, tab, name } = result.value;
  redirect(filePath(folder.name, tab?.name ?? null, name));
}
