"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseFolderId, parseTabId } from "@/features/folders/schema";
import {
  parseNewPageFormData,
  parsePageContentFormData,
  parsePageId,
  parsePageMoveFormData,
  parsePageNameFormData,
  type PageFormState,
  type PageMoveFormState,
} from "@/features/pages/schema";
import { pagePath } from "@/lib/addresses";
import { getDb } from "@/lib/db";
import { isForeignKeyViolation, isUniqueViolation, PAGE_NAME } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { NAME_TAKEN_MESSAGE, type NameFormState } from "@/lib/names";

const SAVE_FAILED_MESSAGE = "The page could not be saved. Please try again.";
const PAGE_GONE_MESSAGE = "This page no longer exists.";
const FOLDER_GONE_MESSAGE = "This folder no longer exists.";
const TAB_GONE_MESSAGE = "This tab no longer exists.";
const MOVE_FAILED_MESSAGE = "The page could not be moved. Please try again.";
const NAME_TAKEN_AT_TARGET_MESSAGE = "A page with this name already exists there";

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
 * Creates a page from the submitted editor content and name and redirects to its address. The page is placed in the
 * tab with the given id or, with `tabId` `null`, directly in the folder with the given id; the tab must be one of that
 * folder. Returns the errors to show in the form if the input is invalid, the name is taken there, the folder or tab
 * no longer exists or the page cannot be stored. Bind the ids with `createPage.bind(null, folderId, tabId)`.
 */
export async function createPage(
  folderId: string,
  tabId: string | null,
  _prevState: PageFormState,
  formData: FormData,
): Promise<PageFormState> {
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return { message: FOLDER_GONE_MESSAGE };
  const parsedTabId = tabId === null ? null : parseTabId(tabId);
  if (tabId !== null && !parsedTabId) return { message: TAB_GONE_MESSAGE };

  const input = parseNewPageFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  let page: AddressParts & { id: string };
  try {
    page = await getDb().page.create({
      data: { ...input.data, folderId: parsedFolderId, tabId: parsedTabId },
      select: { id: true, ...ADDRESS_SELECT },
    });
  } catch (err) {
    if (isUniqueViolation(err, PAGE_NAME)) {
      logger.warn(
        { folderId: parsedFolderId, tabId: parsedTabId, name: input.data.name },
        "name of new page already in use",
      );
      return nameTakenState;
    }
    if (isForeignKeyViolation(err)) {
      // A missing folder, a missing tab or a tab of another folder: the composite foreign key refuses all of them.
      logger.warn({ folderId: parsedFolderId, tabId: parsedTabId }, "folder or tab of new page not found");
      return { message: parsedTabId ? TAB_GONE_MESSAGE : FOLDER_GONE_MESSAGE };
    }
    logger.error({ err, folderId: parsedFolderId, tabId: parsedTabId }, "failed to create page");
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
 * Renames the page with the given id to the submitted name and redirects to its new address. The content is neither
 * validated nor touched, so the content limit never blocks a rename. Returns the errors to show in the form if the
 * name is invalid or taken, the page no longer exists or it cannot be stored. Bind the id with
 * `renamePage.bind(null, id)`.
 */
export async function renamePage(id: string, _prevState: NameFormState, formData: FormData): Promise<NameFormState> {
  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const input = parsePageNameFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  let address: string | null;
  try {
    const { count } = await getDb().page.updateMany({ where: { id: pageId }, data: input.data });
    address = count === 0 ? null : await findPageAddress(pageId);
  } catch (err) {
    if (isUniqueViolation(err, PAGE_NAME)) {
      logger.warn({ pageId, name: input.data.name }, "name of renamed page already in use");
      return nameTakenState;
    }
    logger.error({ err, pageId }, "failed to rename page");
    return { message: SAVE_FAILED_MESSAGE };
  }
  if (address === null) {
    logger.warn({ pageId }, "page to rename not found");
    return { message: PAGE_GONE_MESSAGE };
  }

  logger.info({ pageId }, "page renamed");
  revalidateFolders();
  redirect(address);
}

/**
 * Moves the page with the given id within its folder: into the tab chosen in the submitted form or, without one,
 * directly into the folder. Redirects to the page's new address. The content is neither validated nor touched, so the
 * content limit never blocks a move. Returns the errors to show in the form if a page with the same name already
 * exists at the target, the tab does not exist or belongs to another folder (the composite foreign key refuses it),
 * the page no longer exists or it cannot be stored. Bind the id with `movePage.bind(null, id)`.
 */
export async function movePage(
  id: string,
  _prevState: PageMoveFormState,
  formData: FormData,
): Promise<PageMoveFormState> {
  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const target = parsePageMoveFormData(formData);
  if (!target.success) return { message: TAB_GONE_MESSAGE };
  const { tabId } = target;

  let address: string | null;
  try {
    const { count } = await getDb().page.updateMany({ where: { id: pageId }, data: { tabId } });
    address = count === 0 ? null : await findPageAddress(pageId);
  } catch (err) {
    if (isUniqueViolation(err, PAGE_NAME)) {
      logger.warn({ pageId, tabId }, "name of moved page already in use at the target");
      return { fieldErrors: { target: [NAME_TAKEN_AT_TARGET_MESSAGE] } };
    }
    if (isForeignKeyViolation(err)) {
      logger.warn({ pageId, tabId }, "target tab of moved page not found in the page's folder");
      return { message: TAB_GONE_MESSAGE };
    }
    logger.error({ err, pageId, tabId }, "failed to move page");
    return { message: MOVE_FAILED_MESSAGE };
  }
  if (address === null) {
    logger.warn({ pageId }, "page to move not found");
    return { message: PAGE_GONE_MESSAGE };
  }

  logger.info({ pageId, tabId }, "page moved");
  revalidateFolders();
  redirect(address);
}
