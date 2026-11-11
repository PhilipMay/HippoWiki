"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseFolderFormData, parseFolderId } from "@/features/folders/schema";
import { folderPath } from "@/lib/addresses";
import { getDb } from "@/lib/db";
import { isUniqueViolation, type UniqueConstraint } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { NAME_TAKEN_MESSAGE, type NameFormState } from "@/lib/names";

const SAVE_FAILED_MESSAGE = "The folder could not be saved. Please try again.";
const FOLDER_GONE_MESSAGE = "This folder no longer exists.";

/** The unique index on `Folder.name`, as Prisma creates it for `@unique`. */
const FOLDER_NAME: UniqueConstraint = { indexes: ["Folder_name_key"], field: "name" };

/** The form state that shows "Name is already in use" at the name field. */
const nameTakenState: NameFormState = { fieldErrors: { name: [NAME_TAKEN_MESSAGE] } };

/** Revalidates every address under `/folders`, so that a renamed item's old and new address are both covered. */
function revalidateFolders(): void {
  revalidatePath("/folders", "layout");
}

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
  revalidateFolders();
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
  revalidateFolders();
  redirect(folderPath(input.data.name));
}
