"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseFolderId } from "@/features/folders/schema";
import {
  parseNewPageFormData,
  parsePageContentFormData,
  parsePageId,
  parsePageMoveOrRenameFormData,
  type PageFormState,
  type PageMoveOrRenameFormState,
} from "@/features/pages/schema";
import { pagePath } from "@/lib/addresses";
import { getDb } from "@/lib/db";
import { isForeignKeyViolation, isUniqueViolation, PAGE_NAME } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { NAME_TAKEN_MESSAGE } from "@/lib/names";

const SAVE_FAILED_MESSAGE = "The page could not be saved. Please try again.";
const PAGE_GONE_MESSAGE = "This page no longer exists.";
const FOLDER_GONE_MESSAGE = "This folder no longer exists.";
const TAB_GONE_MESSAGE = "This tab no longer exists.";

/** The form state that shows "Name is already in use" at the name field. */
const nameTakenState = { fieldErrors: { name: [NAME_TAKEN_MESSAGE] } };

/** Revalidates every address under `/folders`, so that a renamed page's old and new address are both covered. */
function revalidateFolders(): void {
  revalidatePath("/folders", "layout");
}

/** What an address is built from: the name of the page, of its folder and of its tab, if it has one. */
const ADDRESS_SELECT = {
  name: true,
  folder: { select: { name: true } },
  tab: { select: { name: true } },
} as const;

type AddressParts = { name: string; folder: { name: string }; tab: { name: string } | null };

function addressOf({ name, folder, tab }: AddressParts): string {
  return pagePath(folder.name, tab?.name ?? null, name);
}

/**
 * The address of the page with the given id as stored, or `null` if it does not exist. Actions redirect to the stored
 * address, never to one built from submitted values.
 */
async function findPageAddress(pageId: string): Promise<string | null> {
  const page = await getDb().page.findUnique({ where: { id: pageId }, select: ADDRESS_SELECT });
  return page && addressOf(page);
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
  const { tabId } = input.data;

  let page: AddressParts & { id: string };
  try {
    page = await getDb().page.create({
      data: { ...input.data, folderId: parsedFolderId },
      select: { id: true, ...ADDRESS_SELECT },
    });
  } catch (err) {
    if (isUniqueViolation(err, PAGE_NAME)) {
      logger.warn({ folderId: parsedFolderId, tabId, name: input.data.name }, "name of new page already in use");
      return nameTakenState;
    }
    if (isForeignKeyViolation(err)) {
      // A missing folder, a missing tab or a tab of another folder: the composite foreign key refuses all of them.
      logger.warn({ folderId: parsedFolderId, tabId }, "folder or tab of new page not found");
      return { message: tabId ? TAB_GONE_MESSAGE : FOLDER_GONE_MESSAGE };
    }
    logger.error({ err, folderId: parsedFolderId, tabId }, "failed to create page");
    return { message: SAVE_FAILED_MESSAGE };
  }

  logger.info({ pageId: page.id }, "page created");
  revalidateFolders();
  // `redirect` throws, so it must stay outside the try block above.
  redirect(addressOf(page));
}

/**
 * Stores the submitted content of the page with the given id, with the title derived from it, and redirects to the
 * page. Returns the errors to show in the form if the content is invalid, the page no longer exists or it cannot be
 * stored. Bind the id with `updatePageContent.bind(null, id)`.
 */
export async function updatePageContent(
  id: string,
  _prevState: PageFormState,
  formData: FormData,
): Promise<PageFormState> {
  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const input = parsePageContentFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  let address: string | null;
  try {
    // `updateMany` reports a missing page as a count of 0 instead of throwing; it sets `updatedAt` as well.
    const { count } = await getDb().page.updateMany({ where: { id: pageId }, data: input.data });
    address = count === 0 ? null : await findPageAddress(pageId);
  } catch (err) {
    logger.error({ err, pageId }, "failed to update page");
    return { message: SAVE_FAILED_MESSAGE };
  }
  if (address === null) {
    logger.warn({ pageId }, "page to update not found");
    return { message: PAGE_GONE_MESSAGE };
  }

  logger.info({ pageId }, "page updated");
  revalidateFolders();
  redirect(address);
}

/**
 * Stores the submitted name and place of the page with the given id in one update and redirects to its new address.
 * The page is placed in the chosen tab of its folder or, without one, directly in the folder. The content is neither
 * validated nor touched, so the content limit never blocks a save. Returns the errors to show in the form if the name
 * is invalid or taken at the target, the tab does not exist or belongs to another folder (the composite foreign key
 * refuses it), the page no longer exists or it cannot be stored. Bind the id with `moveOrRenamePage.bind(null, id)`.
 */
export async function moveOrRenamePage(
  id: string,
  _prevState: PageMoveOrRenameFormState,
  formData: FormData,
): Promise<PageMoveOrRenameFormState> {
  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const input = parsePageMoveOrRenameFormData(formData);
  if (!input.success) {
    return {
      ...(input.fieldErrors.name && { fieldErrors: input.fieldErrors }),
      ...(input.placeInvalid && { message: TAB_GONE_MESSAGE }),
    };
  }
  const { name, tabId } = input.data;

  let address: string | null;
  try {
    const { count } = await getDb().page.updateMany({ where: { id: pageId }, data: { name, tabId } });
    address = count === 0 ? null : await findPageAddress(pageId);
  } catch (err) {
    if (isUniqueViolation(err, PAGE_NAME)) {
      logger.warn({ pageId, tabId, name }, "name of moved or renamed page already in use at the target");
      return nameTakenState;
    }
    if (isForeignKeyViolation(err)) {
      logger.warn({ pageId, tabId }, "target tab of moved or renamed page not found in the page's folder");
      return { message: TAB_GONE_MESSAGE };
    }
    logger.error({ err, pageId, tabId }, "failed to move or rename page");
    return { message: SAVE_FAILED_MESSAGE };
  }
  if (address === null) {
    logger.warn({ pageId }, "page to move or rename not found");
    return { message: PAGE_GONE_MESSAGE };
  }

  logger.info({ pageId, tabId }, "page moved or renamed");
  revalidateFolders();
  redirect(address);
}
