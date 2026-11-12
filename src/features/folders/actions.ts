"use server";

import { redirect } from "next/navigation";

import { parseFolderFormData, parseFolderId, parseTabFormData, parseTabId } from "@/features/folders/schema";
import { folderPath, tabPath } from "@/lib/addresses";
import { getDb } from "@/lib/db";
import { FOLDER_NAME, isForeignKeyViolation, isUniqueViolation, TAB_NAME } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { revalidateContent } from "@/lib/revalidate";
import { NAME_TAKEN_MESSAGE, type NameFormState } from "@/lib/names";

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
  const input = parseFolderFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  let id: string;
  let name: string;
  try {
    ({ id, name } = await getDb().folder.create({ data: input.data, select: { id: true, name: true } }));
  } catch (err) {
    if (isUniqueViolation(err, FOLDER_NAME)) {
      logger.warn({ name: input.data.name }, "name of new folder already in use");
      return nameTakenState;
    }
    logger.error({ err }, "failed to create folder");
    return { message: SAVE_FAILED_MESSAGE };
  }

  logger.info({ folderId: id }, "folder created");
  revalidateContent();
  // `redirect` throws, so it must stay outside the try block above.
  redirect(folderPath(name));
}

/**
 * Renames the folder with the given id to the submitted name and redirects to its new address. Returns the errors to
 * show in the form if the name is invalid or taken, the folder no longer exists or it cannot be stored. Bind the id
 * with `renameFolder.bind(null, id)`.
 */
export async function renameFolder(id: string, _prevState: NameFormState, formData: FormData): Promise<NameFormState> {
  const folderId = parseFolderId(id);
  if (!folderId) return { message: FOLDER_GONE_MESSAGE };

  const input = parseFolderFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  let count: number;
  try {
    // `updateMany` reports a missing folder as a count of 0 instead of throwing; it sets `updatedAt` as well.
    ({ count } = await getDb().folder.updateMany({ where: { id: folderId }, data: input.data }));
  } catch (err) {
    if (isUniqueViolation(err, FOLDER_NAME)) {
      logger.warn({ folderId, name: input.data.name }, "name of renamed folder already in use");
      return nameTakenState;
    }
    logger.error({ err, folderId }, "failed to rename folder");
    return { message: SAVE_FAILED_MESSAGE };
  }
  if (count === 0) {
    logger.warn({ folderId }, "folder to rename not found");
    return { message: FOLDER_GONE_MESSAGE };
  }

  logger.info({ folderId }, "folder renamed");
  revalidateContent();
  redirect(folderPath(input.data.name));
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
  const parsedFolderId = parseFolderId(folderId);
  if (!parsedFolderId) return { message: FOLDER_GONE_MESSAGE };

  const input = parseTabFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  let tab: { id: string; name: string; folder: { name: string } };
  try {
    tab = await getDb().tab.create({
      data: { ...input.data, folderId: parsedFolderId },
      select: { id: true, name: true, folder: { select: { name: true } } },
    });
  } catch (err) {
    if (isUniqueViolation(err, TAB_NAME)) {
      logger.warn({ folderId: parsedFolderId, name: input.data.name }, "name of new tab already in use");
      return nameTakenState;
    }
    if (isForeignKeyViolation(err)) {
      logger.warn({ folderId: parsedFolderId }, "folder of new tab not found");
      return { message: FOLDER_GONE_MESSAGE };
    }
    logger.error({ err, folderId: parsedFolderId }, "failed to create tab");
    return { message: TAB_SAVE_FAILED_MESSAGE };
  }

  logger.info({ tabId: tab.id }, "tab created");
  revalidateContent();
  redirect(tabPath(tab.folder.name, tab.name));
}

/**
 * Renames the tab with the given id to the submitted name and redirects to its new address. Returns the errors to
 * show in the form if the name is invalid or taken in the tab's folder, the tab no longer exists or it cannot be
 * stored. Bind the id with `renameTab.bind(null, id)`.
 */
export async function renameTab(id: string, _prevState: NameFormState, formData: FormData): Promise<NameFormState> {
  const tabId = parseTabId(id);
  if (!tabId) return { message: TAB_GONE_MESSAGE };

  const input = parseTabFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  let tab: { name: string; folder: { name: string } } | null;
  try {
    const db = getDb();
    const { count } = await db.tab.updateMany({ where: { id: tabId }, data: input.data });
    // The address is built from the stored names, never from submitted values.
    tab =
      count === 0
        ? null
        : await db.tab.findUnique({
            where: { id: tabId },
            select: { name: true, folder: { select: { name: true } } },
          });
  } catch (err) {
    if (isUniqueViolation(err, TAB_NAME)) {
      logger.warn({ tabId, name: input.data.name }, "name of renamed tab already in use");
      return nameTakenState;
    }
    logger.error({ err, tabId }, "failed to rename tab");
    return { message: TAB_SAVE_FAILED_MESSAGE };
  }
  if (tab === null) {
    logger.warn({ tabId }, "tab to rename not found");
    return { message: TAB_GONE_MESSAGE };
  }

  logger.info({ tabId }, "tab renamed");
  revalidateContent();
  redirect(tabPath(tab.folder.name, tab.name));
}
