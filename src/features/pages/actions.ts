"use server";

// The writes of pages for forms: thin adapters that translate between a form and the service. Every action calls
// `requireUser()` first, which redirects to the login page without a logged-in user: a Server Action is a public
// endpoint, whatever page shows its form. The call stands outside every `try` block, because the redirect throws.

import { redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { parseFolderId } from "@/features/folders/schema";
import {
  parseNewPageFormData,
  parsePageContentFormData,
  parsePageMoveOrRenameFormData,
  parsePageRestoreFormData,
  type PageDeleteFormState,
  type PageFormState,
  type PageMoveOrRenameFormState,
  type PageRestoreFormState,
} from "@/features/pages/forms";
import { parsePageId } from "@/features/pages/schema";
import * as pageService from "@/features/pages/service";
import { folderPath, pagePath, tabPath } from "@/lib/addresses";
import { NAME_TAKEN_MESSAGE } from "@/lib/names";
import { revalidateContent } from "@/lib/revalidate";

const SAVE_FAILED_MESSAGE = "The page could not be saved. Please try again.";
const DELETE_FAILED_MESSAGE = "The page could not be deleted. Please try again.";
const RESTORE_FAILED_MESSAGE = "The page could not be restored. Please try again.";
const PAGE_GONE_MESSAGE = "This page no longer exists.";
const FOLDER_GONE_MESSAGE = "This folder no longer exists.";
const TAB_GONE_MESSAGE = "This tab no longer exists.";

/** The form state that shows "Name is already in use" at the name field. */
const nameTakenState = { fieldErrors: { name: [NAME_TAKEN_MESSAGE] } };

/** The address of a page as stored. Actions redirect to it, never to an address built from submitted values. */
function addressOf({ name, folder, tab }: pageService.StoredPage): string {
  return pagePath(folder.name, tab?.name ?? null, name);
}

/**
 * Creates a page from the submitted editor content, name and place and redirects to its address. The page is placed in
 * the chosen tab or, without one, directly in the folder with the given id; the tab must be one of that folder.
 * Returns the errors to show in the form if the input is invalid, the place is no tab id, the name is taken there, the
 * folder or tab no longer exists or the page cannot be stored. Bind the id with `createPage.bind(null, folderId)`.
 */
export async function createPage(
  folderId: string,
  _prevState: PageFormState,
  formData: FormData,
): Promise<PageFormState> {
  await requireUser();

  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return { message: FOLDER_GONE_MESSAGE };

  const input = parseNewPageFormData(formData);
  if (!input.success) {
    const hasFieldErrors = Object.keys(input.fieldErrors).length > 0;
    return {
      ...(hasFieldErrors && { fieldErrors: input.fieldErrors }),
      ...(input.placeInvalid && { message: TAB_GONE_MESSAGE }),
    };
  }
  const { name, content, tabId } = input.data;

  const result = await pageService.createPage(parsedFolderId, { name, content, tabId });
  if (!result.ok) {
    switch (result.error.code) {
      case "folder-not-found":
        return { message: FOLDER_GONE_MESSAGE };
      case "tab-not-found":
        return { message: TAB_GONE_MESSAGE };
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "name-taken":
        return nameTakenState;
      case "failed":
        return { message: SAVE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  // `redirect` throws; it comes last.
  redirect(addressOf(result.value));
}

/**
 * Stores the submitted content of the page with the given id, with the title derived from it, and redirects to the
 * page. Returns the errors to show in the form if the content is invalid, the page no longer exists or is deleted, or
 * it cannot be stored. Bind the id with `updatePageContent.bind(null, id)`.
 */
export async function updatePageContent(
  id: string,
  _prevState: PageFormState,
  formData: FormData,
): Promise<PageFormState> {
  await requireUser();

  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const input = parsePageContentFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  const result = await pageService.updatePageContent(pageId, { content: input.data.content });
  if (!result.ok) {
    switch (result.error.code) {
      case "page-not-found":
        return { message: PAGE_GONE_MESSAGE };
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "failed":
        return { message: SAVE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  redirect(addressOf(result.value));
}

/**
 * Stores the submitted name and place of the page with the given id and redirects to its new address. The page is
 * placed in the chosen tab of its folder or, without one, directly in the folder. The content is neither validated nor
 * touched, so the content limit never blocks a save. Returns the errors to show in the form if the name is invalid or
 * taken at the target, the tab does not exist or belongs to another folder, the page no longer exists or is deleted,
 * or it cannot be stored. Bind the id with `moveOrRenamePage.bind(null, id)`.
 */
export async function moveOrRenamePage(
  id: string,
  _prevState: PageMoveOrRenameFormState,
  formData: FormData,
): Promise<PageMoveOrRenameFormState> {
  await requireUser();

  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const input = parsePageMoveOrRenameFormData(formData);
  if (!input.success) {
    return {
      ...(input.fieldErrors.name && { fieldErrors: input.fieldErrors }),
      ...(input.placeInvalid && { message: TAB_GONE_MESSAGE }),
    };
  }

  const result = await pageService.moveOrRenamePage(pageId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      case "page-not-found":
        return { message: PAGE_GONE_MESSAGE };
      case "tab-not-found":
        return { message: TAB_GONE_MESSAGE };
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "name-taken":
        return nameTakenState;
      case "failed":
        return { message: SAVE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  redirect(addressOf(result.value));
}

/**
 * Deletes the page with the given id and redirects to the folder or tab it was in. The page can be restored from the
 * deleted pages of its folder. Returns the error to show in the dialog if the page no longer exists or is already
 * deleted, or it cannot be deleted. The form submits nothing; its previous state and data are ignored. Bind the id with
 * `deletePage.bind(null, id)`.
 */
export async function deletePage(id: string): Promise<PageDeleteFormState> {
  await requireUser();

  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const result = await pageService.deletePage(pageId);
  if (!result.ok) {
    switch (result.error.code) {
      case "page-not-found":
        return { message: PAGE_GONE_MESSAGE };
      case "failed":
        return { message: DELETE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  const { folder, tab } = result.value;
  redirect(tab ? tabPath(folder.name, tab.name) : folderPath(folder.name));
}

/**
 * Restores the deleted page with the given id into its folder, under the submitted name, at the chosen place: the tab
 * of its folder or, without one, directly in the folder. It redirects to the page's new address. The content is
 * neither validated nor touched. Returns the errors to show in the form if the name is invalid or taken at the target,
 * no place is chosen, the tab does not exist or belongs to another folder, the page no longer exists or is not
 * deleted, or it cannot be stored. Bind the id with `restorePage.bind(null, id)`.
 */
export async function restorePage(
  id: string,
  _prevState: PageRestoreFormState,
  formData: FormData,
): Promise<PageRestoreFormState> {
  await requireUser();

  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const input = parsePageRestoreFormData(formData);
  if (!input.success) {
    const hasFieldErrors = Object.keys(input.fieldErrors).length > 0;
    return {
      ...(hasFieldErrors && { fieldErrors: input.fieldErrors }),
      ...(input.placeInvalid && { message: TAB_GONE_MESSAGE }),
    };
  }

  const result = await pageService.restorePage(pageId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      case "page-not-found":
        return { message: PAGE_GONE_MESSAGE };
      case "tab-not-found":
        return { message: TAB_GONE_MESSAGE };
      case "invalid-input":
        return { fieldErrors: result.error.fieldErrors };
      case "name-taken":
        return nameTakenState;
      case "failed":
        return { message: RESTORE_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  redirect(addressOf(result.value));
}
