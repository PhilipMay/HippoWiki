"use server";

// The writes of pages for forms: thin adapters that translate between a form and the service. Every action calls
// `requireUser()` first, which redirects to the login page without a logged-in user: a Server Action is a public
// endpoint, whatever page shows its form. The call stands outside every `try` block, because the redirect throws. The
// user it returns is passed to the service write as the actor of the browser, who becomes the last editor.

import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { inBrowser } from "@/features/folder-roles/service";
import { parseFolderId } from "@/features/folders/schema";
import {
  parseNewPageFormData,
  parsePageContentFormData,
  parsePageDeleteFormData,
  parsePageMoveOrRenameFormData,
  parsePageRestoreFormData,
  parsePageRevertFormData,
  type PageDeleteFormState,
  type PageFormState,
  type PageMoveOrRenameFormState,
  type PageRestoreFormState,
  type PageRevertFormState,
} from "@/features/pages/forms";
import { parsePageId, revisionNumberSchema } from "@/features/pages/schema";
import * as pageService from "@/features/pages/service";
import { CHANGED_NOTICE, folderPath, pagePath, pageRevertPath, tabPath, type PageNotice } from "@/lib/addresses";
import { NAME_TAKEN_MESSAGE } from "@/lib/names";
import { revalidateContent } from "@/lib/revalidate";

const SAVE_FAILED_MESSAGE = "The page could not be saved. Please try again.";
const DELETE_FAILED_MESSAGE = "The page could not be deleted. Please try again.";
const RESTORE_FAILED_MESSAGE = "The page could not be restored. Please try again.";
const REVERT_FAILED_MESSAGE = "The page could not be reverted. Please try again.";
/** The start of the message of a revert whose revision breaks a limit of pages now; the broken limits follow it. */
const REVERT_INVALID_MESSAGE =
  "This revision breaks a limit of pages and cannot be restored. Copy its raw form into the editor to fix it:";
const PAGE_GONE_MESSAGE = "This page no longer exists.";
const FOLDER_GONE_MESSAGE = "This folder no longer exists.";
const TAB_GONE_MESSAGE = "This tab no longer exists.";

/** The form state that shows "Name is already in use" at the name field. */
const nameTakenState = { fieldErrors: { name: [NAME_TAKEN_MESSAGE] } };

/**
 * The address of a page as stored, optionally with an action and a notice. Actions redirect to it, never to an address
 * built from submitted values.
 */
function addressOf({ name, folder, tab }: pageService.StoredPage, action?: string, notice?: PageNotice): string {
  return pagePath(folder.name, tab?.name ?? null, name, action, notice);
}

/**
 * Shows the editor or dialog of the action again for a change that was refused because the page was changed after it
 * was opened: at the page's address as stored, which can be a new one, with the notice that says so. The content is
 * revalidated first, so that the address shows the page as stored.
 */
function showChanged(page: pageService.StoredPage, action: string): never {
  revalidateContent();
  redirect(addressOf(page, action, CHANGED_NOTICE));
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
  const user = await requireUser();

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

  const result = await pageService.createPage(inBrowser(user), parsedFolderId, { name, content, tabId });
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
        notFound();
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
 * it cannot be stored. If the page was changed after the submitted version, or the form submits none, the editor is
 * shown again with the page as stored and the notice. Bind the id with `updatePageContent.bind(null, id)`.
 */
export async function updatePageContent(
  id: string,
  _prevState: PageFormState,
  formData: FormData,
): Promise<PageFormState> {
  const user = await requireUser();

  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const input = parsePageContentFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  const { content, version } = input.data;
  const result = await pageService.updatePageContent(inBrowser(user), pageId, { content, version });
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
        notFound();
      case "page-not-found":
        return { message: PAGE_GONE_MESSAGE };
      case "page-changed":
        showChanged(result.error.page, "edit");
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
 * or it cannot be stored. If the page was changed after the submitted version, or the form submits none, the dialog is
 * shown again with the page as stored and the notice. Bind the id with `moveOrRenamePage.bind(null, id)`.
 */
export async function moveOrRenamePage(
  id: string,
  _prevState: PageMoveOrRenameFormState,
  formData: FormData,
): Promise<PageMoveOrRenameFormState> {
  const user = await requireUser();

  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const input = parsePageMoveOrRenameFormData(formData);
  if (!input.success) {
    return {
      ...(input.fieldErrors.name && { fieldErrors: input.fieldErrors }),
      ...(input.placeInvalid && { message: TAB_GONE_MESSAGE }),
    };
  }

  const result = await pageService.moveOrRenamePage(inBrowser(user), pageId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
        notFound();
      case "page-not-found":
        return { message: PAGE_GONE_MESSAGE };
      case "page-changed":
        showChanged(result.error.page, "move-or-rename");
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
 * deleted, or it cannot be deleted. If the page was changed after the submitted version, or the form submits none, the
 * dialog is shown again at the page's address as stored, with the notice. The form submits only the version; its
 * previous state is ignored. Bind the id with `deletePage.bind(null, id)`.
 */
export async function deletePage(
  id: string,
  _prevState: PageDeleteFormState,
  formData: FormData,
): Promise<PageDeleteFormState> {
  const user = await requireUser();

  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const { version } = parsePageDeleteFormData(formData);
  const result = await pageService.deletePage(inBrowser(user), pageId, { version });
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
        notFound();
      case "page-not-found":
        return { message: PAGE_GONE_MESSAGE };
      case "page-changed":
        showChanged(result.error.page, "delete");
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
  const user = await requireUser();

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

  const result = await pageService.restorePage(inBrowser(user), pageId, input.data);
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
        notFound();
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

/**
 * Sets the page with the given id back to its revision with the given number and redirects to the page, which then
 * shows the content of the revision. Returns the error to show in the dialog if the content of the revision breaks a
 * limit of pages now, naming the limit, if the page no longer exists or is deleted, or if it cannot be stored. If the
 * page was changed after the submitted version, or the form submits none, the dialog is shown again at the page's
 * address as stored, with the notice. A revision that does not exist or whose content is the content of the page now
 * has no revert, so it shows the not-found page. The form submits only the version. Bind the id and the number with
 * `revertPage.bind(null, id, revision)`.
 */
export async function revertPage(
  id: string,
  revision: number,
  _prevState: PageRevertFormState,
  formData: FormData,
): Promise<PageRevertFormState> {
  const user = await requireUser();

  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };
  if (!revisionNumberSchema.safeParse(revision).success) notFound();

  const { version } = parsePageRevertFormData(formData);
  const result = await pageService.revertPage(inBrowser(user), pageId, { revision, version });
  if (!result.ok) {
    switch (result.error.code) {
      // An admin changes no content, and for an admin no content exists; nor does a folder without a role of the user.
      case "not-allowed":
      // A revert that would change nothing is not offered.
      case "revision-not-found":
        notFound();
      case "page-not-found":
        return { message: PAGE_GONE_MESSAGE };
      case "page-changed": {
        const { folder, tab, name } = result.error.page;
        revalidateContent();
        redirect(pageRevertPath(folder.name, tab?.name ?? null, name, revision, CHANGED_NOTICE));
      }
      case "invalid-input":
        return {
          message: `${REVERT_INVALID_MESSAGE} ${(result.error.fieldErrors.content ?? []).join(". ")}.`,
        };
      case "failed":
        return { message: REVERT_FAILED_MESSAGE };
    }
  }

  revalidateContent();
  redirect(addressOf(result.value));
}
