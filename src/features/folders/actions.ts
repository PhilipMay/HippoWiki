"use server";

// The writes of folders and tabs for forms: thin adapters that translate between a form and the service. Every action
// calls `requireUser()` first, which redirects to the login page without a logged-in user: a Server Action is a
// public endpoint, whatever page shows its form. The call stands outside every `try` block, because the redirect
// throws. The user it returns is passed to the service write as the actor of the browser, who becomes the last editor.

import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { inBrowser } from "@/features/folder-roles/actors";
import { parseFolderFormData, parseTabFormData, type TabDeleteFormState } from "@/features/folders/forms";
import { parseFolderId, parseTabId } from "@/features/folders/schema";
import * as folderService from "@/features/folders/service";
import { folderPath, tabPath } from "@/lib/addresses";
import { NAME_TAKEN_MESSAGE, type NameFormState } from "@/lib/names";
import { revalidateContent } from "@/lib/revalidate";

const SAVE_FAILED_MESSAGE = "The folder could not be saved. Please try again.";
const FOLDER_GONE_MESSAGE = "This folder no longer exists.";
const TAB_SAVE_FAILED_MESSAGE = "The tab could not be saved. Please try again.";
const TAB_GONE_MESSAGE = "This tab no longer exists.";
const TAB_DELETE_FAILED_MESSAGE = "The tab could not be deleted. Please try again.";

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

  const result = await folderService.createFolder(inBrowser(user), input.data);
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
        notFound();
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

  const result = await folderService.renameFolder(inBrowser(user), folderId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
        notFound();
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

  const result = await folderService.createTab(inBrowser(user), parsedFolderId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
        notFound();
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

  const result = await folderService.renameTab(inBrowser(user), tabId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
        notFound();
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

/** The state of the "Delete tab" dialog for a tab that no longer exists. */
const tabGoneState: TabDeleteFormState = { message: TAB_GONE_MESSAGE, tabGone: true };

/**
 * Deletes the tab with the given id in the folder with the given id, together with its pages, and redirects to the
 * folder. Returns the message to show in the dialog if the tab no longer exists or cannot be deleted. The form submits
 * no field, so the action takes neither the previous state nor the form data: the pages that are in the tab when it is
 * deleted go with it, without a version to check. Bind the ids with `deleteTab.bind(null, folderId, id)`.
 */
export async function deleteTab(folderId: string, id: string): Promise<TabDeleteFormState> {
  const user = await requireUser();

  const parsedFolderId = parseFolderId(folderId);
  const tabId = parseTabId(id);
  if (!parsedFolderId || !tabId) return tabGoneState;

  const result = await folderService.deleteTab(inBrowser(user), parsedFolderId, tabId);
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
        notFound();
      case "tab-not-found":
        return tabGoneState;
      case "failed":
        return { message: TAB_DELETE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  // The address is built from the stored folder, never from submitted values.
  redirect(folderPath(result.value.folder.name));
}
