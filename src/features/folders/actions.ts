"use server";

// The writes of folders and tabs for forms: thin adapters that translate between a form and the service. Every action
// calls `requireUser()` first, which redirects to the login page without a logged-in user: a Server Action is a
// public endpoint, whatever page shows its form. The call stands outside every `try` block, because the redirect
// throws. The user it returns is passed to the service write as the actor, who becomes the last editor.

import { redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { parseFolderFormData, parseTabFormData } from "@/features/folders/forms";
import { parseFolderId, parseTabId } from "@/features/folders/schema";
import * as folderService from "@/features/folders/service";
import { folderPath, tabPath } from "@/lib/addresses";
import { NAME_TAKEN_MESSAGE, type NameFormState } from "@/lib/names";
import { revalidateContent } from "@/lib/revalidate";

const SAVE_FAILED_MESSAGE = "The folder could not be saved. Please try again.";
const FOLDER_GONE_MESSAGE = "This folder no longer exists.";
const TAB_SAVE_FAILED_MESSAGE = "The tab could not be saved. Please try again.";
const TAB_GONE_MESSAGE = "This tab no longer exists.";

/** The form state that shows "Name is already in use" at the name field. */
const nameTakenState: NameFormState = { fieldErrors: { name: [NAME_TAKEN_MESSAGE] } };

/**
 * Creates a folder from the submitted name and redirects to its address. Returns the errors to show in the form if
 * the name is invalid or taken or the folder cannot be stored.
 */
export async function createFolder(_prevState: NameFormState, formData: FormData): Promise<NameFormState> {
  const user = await requireUser();

  const input = parseFolderFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  const result = await folderService.createFolder(user, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "name-taken":
        return nameTakenState;
      case "failed":
        return { message: SAVE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  // The address is built from the stored folder, never from submitted values.
  redirect(folderPath(result.value.name));
}

/**
 * Renames the folder with the given id to the submitted name and redirects to its new address. Returns the errors to
 * show in the form if the name is invalid or taken, the folder no longer exists or it cannot be stored. Bind the id
 * with `renameFolder.bind(null, id)`.
 */
export async function renameFolder(id: string, _prevState: NameFormState, formData: FormData): Promise<NameFormState> {
  const user = await requireUser();

  const folderId = parseFolderId(id);
  if (!folderId) return { message: FOLDER_GONE_MESSAGE };

  const input = parseFolderFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  const result = await folderService.renameFolder(user, folderId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      case "folder-not-found":
        return { message: FOLDER_GONE_MESSAGE };
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "name-taken":
        return nameTakenState;
      case "failed":
        return { message: SAVE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  redirect(folderPath(result.value.name));
}

/**
 * Creates a tab in the folder with the given id from the submitted name and redirects to its address. Returns the
 * errors to show in the form if the name is invalid or taken in this folder, the folder no longer exists or the tab
 * cannot be stored. Bind the folder id with `createTab.bind(null, folderId)`.
 */
export async function createTab(
  folderId: string,
  _prevState: NameFormState,
  formData: FormData,
): Promise<NameFormState> {
  const user = await requireUser();

  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return { message: FOLDER_GONE_MESSAGE };

  const input = parseTabFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  const result = await folderService.createTab(user, parsedFolderId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      case "folder-not-found":
        return { message: FOLDER_GONE_MESSAGE };
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "name-taken":
        return nameTakenState;
      case "failed":
        return { message: TAB_SAVE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  redirect(tabPath(result.value.folder.name, result.value.name));
}

/**
 * Renames the tab with the given id to the submitted name and redirects to its new address. Returns the errors to
 * show in the form if the name is invalid or taken in the tab's folder, the tab no longer exists or it cannot be
 * stored. Bind the id with `renameTab.bind(null, id)`.
 */
export async function renameTab(id: string, _prevState: NameFormState, formData: FormData): Promise<NameFormState> {
  const user = await requireUser();

  const tabId = parseTabId(id);
  if (!tabId) return { message: TAB_GONE_MESSAGE };

  const input = parseTabFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  const result = await folderService.renameTab(user, tabId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      case "tab-not-found":
        return { message: TAB_GONE_MESSAGE };
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "name-taken":
        return nameTakenState;
      case "failed":
        return { message: TAB_SAVE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  redirect(tabPath(result.value.folder.name, result.value.name));
}
