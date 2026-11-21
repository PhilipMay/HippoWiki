"use server";

// The Server Actions of files: thin adapters between the browser and the service. The upload itself is no Server
// Action: its body is the file, which the upload address takes (`http.ts`).

import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { inBrowser } from "@/features/folder-roles/actors";
import {
  FOLDER_GONE_MESSAGE,
  TAB_GONE_MESSAGE,
  uploadedFileState,
  UPLOAD_FAILED_MESSAGE,
} from "@/features/files/forms";
import type { NameCheck } from "@/features/files/forms";
import * as fileService from "@/features/files/service";

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
