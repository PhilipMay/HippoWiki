"use server";

// The Server Actions of files: thin adapters between the browser and the service. The upload itself is no Server
// Action: its body is the file, which the upload address takes (`http.ts`).

import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { inBrowser } from "@/features/folder-roles/actors";
import { NAME_TAKEN_STATE } from "@/features/folders/forms";
import {
  FOLDER_GONE_MESSAGE,
  parseFileMoveOrRenameFormData,
  parseFileRestoreFormData,
  parseLockVersionFormData,
  TAB_GONE_MESSAGE,
  uploadedFileState,
  UPLOAD_FAILED_MESSAGE,
  type FileDeleteFormState,
  type FileMoveOrRenameFormState,
  type FileRestoreFormState,
  type FileRevertFormState,
  type NameCheck,
} from "@/features/files/forms";
import { parseFileId } from "@/features/files/schema";
import * as fileService from "@/features/files/service";
import { CHANGED_NOTICE, filePath, fileRevertPath, folderPath, tabPath } from "@/lib/addresses";
import { revalidateContent } from "@/lib/revalidate";

/** The message of a change of a file that no longer exists or is deleted. */
const FILE_GONE_MESSAGE = "This file no longer exists.";

/** The message of a revert that failed. */
const REVERT_FAILED_MESSAGE = "The file could not be reverted. Please try again.";

/** The message of a delete that failed. */
const DELETE_FAILED_MESSAGE = "The file could not be deleted. Please try again.";

/** The message of a restore that failed. */
const RESTORE_FAILED_MESSAGE = "The file could not be restored. Please try again.";

/** The message of a move or rename that failed. */
const MOVE_FAILED_MESSAGE = "The file could not be moved or renamed. Please try again.";

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

/**
 * Stores the name and place of the file with the given id from the submitted "Move or rename file" form, based on the
 * lock version in the form, and redirects to its details page as stored. Returns the errors to show in the dialog if
 * the input is invalid, the name is taken at the place, the tab or the file no longer exists, or the move cannot be
 * stored. If the file was changed after the dialog was opened, the dialog is shown again with the file as it is now
 * and the notice that says so. Bind the id with `moveOrRenameFile.bind(null, id)`.
 */
export async function moveOrRenameFile(
  id: string,
  _prevState: FileMoveOrRenameFormState,
  formData: FormData,
): Promise<FileMoveOrRenameFormState> {
  const user = await requireUser();

  const fileId = parseFileId(id);
  if (!fileId) return { message: FILE_GONE_MESSAGE };

  const input = parseFileMoveOrRenameFormData(formData);
  if (!input.success) {
    return {
      ...(Object.keys(input.fieldErrors).length > 0 && { fieldErrors: input.fieldErrors }),
      ...(input.placeInvalid && { message: TAB_GONE_MESSAGE }),
    };
  }

  const result = await fileService.moveOrRenameFile(inBrowser(user), fileId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      case "not-allowed":
        notFound();
      case "file-not-found":
        return { message: FILE_GONE_MESSAGE };
      case "file-changed": {
        const { folder, tab, name } = result.error.file;
        revalidateContent();
        redirect(filePath(folder.name, tab?.name ?? null, name, "move-or-rename", CHANGED_NOTICE));
      }
      case "tab-not-found":
        return { message: TAB_GONE_MESSAGE };
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "name-taken":
        return NAME_TAKEN_STATE;
      case "failed":
        return { message: MOVE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  const { folder, tab, name } = result.value;
  redirect(filePath(folder.name, tab?.name ?? null, name));
}

/**
 * Deletes the file with the given id, based on the lock version in the form, and redirects to the folder or tab it was
 * in. The file can be restored from the deleted items of its folder. Returns the error to show in the dialog if the
 * file no longer exists or cannot be deleted. If the file was changed after the dialog was opened, the dialog is shown
 * again with the file as it is now and the notice that says so. Bind the id with `deleteFile.bind(null, id)`.
 */
export async function deleteFile(
  id: string,
  _prevState: FileDeleteFormState,
  formData: FormData,
): Promise<FileDeleteFormState> {
  const user = await requireUser();

  const fileId = parseFileId(id);
  if (!fileId) return { message: FILE_GONE_MESSAGE };

  const result = await fileService.deleteFile(inBrowser(user), fileId, {
    lockVersion: parseLockVersionFormData(formData),
  });
  if (!result.ok) {
    switch (result.error.code) {
      case "not-allowed":
        notFound();
      case "file-not-found":
        return { message: FILE_GONE_MESSAGE };
      case "file-changed": {
        const { folder, tab, name } = result.error.file;
        revalidateContent();
        redirect(filePath(folder.name, tab?.name ?? null, name, "delete", CHANGED_NOTICE));
      }
      case "failed":
        return { message: DELETE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  const { folder, tab } = result.value;
  redirect(tab ? tabPath(folder.name, tab.name) : folderPath(folder.name));
}

/**
 * Restores the deleted file with the given id under the submitted name and place, and redirects to its details page.
 * Returns the errors to show in the dialog if the input is invalid, the name is taken at the place, the tab or the
 * file no longer exists, or the restore cannot be stored. Bind the id with `restoreFile.bind(null, id)`.
 */
export async function restoreFile(
  id: string,
  _prevState: FileRestoreFormState,
  formData: FormData,
): Promise<FileRestoreFormState> {
  const user = await requireUser();

  const fileId = parseFileId(id);
  if (!fileId) return { message: FILE_GONE_MESSAGE };

  const input = parseFileRestoreFormData(formData);
  if (!input.success) {
    return {
      ...(Object.keys(input.fieldErrors).length > 0 && { fieldErrors: input.fieldErrors }),
      ...(input.placeInvalid && { message: TAB_GONE_MESSAGE }),
    };
  }

  const result = await fileService.restoreFile(inBrowser(user), fileId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      case "not-allowed":
        notFound();
      case "file-not-found":
        return { message: FILE_GONE_MESSAGE };
      case "tab-not-found":
        return { message: TAB_GONE_MESSAGE };
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "name-taken":
        return NAME_TAKEN_STATE;
      case "failed":
        return { message: RESTORE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  const { folder, tab, name } = result.value;
  redirect(filePath(folder.name, tab?.name ?? null, name));
}
