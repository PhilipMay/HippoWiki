"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parsePageFormData, parsePageId, type PageFormState } from "@/features/pages/schema";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

const SAVE_FAILED_MESSAGE = "The page could not be saved. Please try again.";
const DELETE_FAILED_MESSAGE = "The page could not be deleted. Please try again.";
const PAGE_GONE_MESSAGE = "This page no longer exists. It may have been deleted.";

/** Revalidates the routes that show a page: the list and, if given, the page itself. */
function revalidatePage(id?: string): void {
  revalidatePath("/pages");
  if (id) revalidatePath(`/pages/${id}`);
}

/**
 * Creates a page from the submitted page form and redirects to it. Returns the errors to show in the form if the input
 * is invalid or the page cannot be stored.
 */
export async function createPage(_prevState: PageFormState, formData: FormData): Promise<PageFormState> {
  const input = parsePageFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  let id: string;
  try {
    ({ id } = await getDb().page.create({ data: input.data, select: { id: true } }));
  } catch (err) {
    logger.error({ err }, "failed to create page");
    return { message: SAVE_FAILED_MESSAGE };
  }

  logger.info({ pageId: id }, "page created");
  revalidatePage();
  // `redirect` throws, so it must stay outside the try block above.
  redirect(`/pages/${id}`);
}

/**
 * Updates the page with the given id from the submitted page form and redirects to it. Returns the errors to show in
 * the form if the input is invalid, the page no longer exists or it cannot be stored. Bind the id with
 * `updatePage.bind(null, id)`.
 */
export async function updatePage(id: string, _prevState: PageFormState, formData: FormData): Promise<PageFormState> {
  const pageId = parsePageId(id);
  if (!pageId) return { message: PAGE_GONE_MESSAGE };

  const input = parsePageFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  let count: number;
  try {
    // `updateMany` reports a missing page as a count of 0 instead of throwing; it sets `updatedAt` as well.
    ({ count } = await getDb().page.updateMany({ where: { id: pageId }, data: input.data }));
  } catch (err) {
    logger.error({ err, pageId }, "failed to update page");
    return { message: SAVE_FAILED_MESSAGE };
  }
  if (count === 0) {
    logger.warn({ pageId }, "page to update not found");
    return { message: PAGE_GONE_MESSAGE };
  }

  logger.info({ pageId }, "page updated");
  revalidatePage(pageId);
  redirect(`/pages/${pageId}`);
}

/**
 * Deletes the page with the given id and redirects to the list. A page that no longer exists counts as deleted.
 * Returns an error message if the page cannot be deleted. Bind the id with `deletePage.bind(null, id)`.
 */
export async function deletePage(id: string): Promise<PageFormState> {
  const pageId = parsePageId(id);
  if (pageId) {
    let count: number;
    try {
      ({ count } = await getDb().page.deleteMany({ where: { id: pageId } }));
    } catch (err) {
      logger.error({ err, pageId }, "failed to delete page");
      return { message: DELETE_FAILED_MESSAGE };
    }
    if (count === 0) logger.warn({ pageId }, "page to delete not found");
    else logger.info({ pageId }, "page deleted");
    revalidatePage(pageId);
  } else {
    logger.warn({ pageId: id }, "page to delete has a malformed id");
  }

  redirect("/pages");
}
