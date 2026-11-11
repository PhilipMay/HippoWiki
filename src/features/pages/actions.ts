"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parsePageFormData, parsePageId, type PageFormState } from "@/features/pages/schema";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

const SAVE_FAILED_MESSAGE = "The page could not be saved. Please try again.";
const DELETE_FAILED_MESSAGE = "The page could not be deleted. Please try again.";
const PAGE_GONE_MESSAGE = "This page no longer exists. It may have been deleted.";
const SLUG_TAKEN_MESSAGE = "Slug is already in use";

/** Name of the unique index on `Page.slug`, as Prisma creates it for `@unique`. */
const SLUG_INDEX = "Page_slug_key";

/**
 * Whether the error is a unique violation on the page slug. With a driver adapter, Prisma reports the violated
 * constraint in `meta.driverAdapterError.cause.constraint`: as the index name or, if that is unknown, as the fields.
 */
function isSlugTaken(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const adapterError = err.meta?.driverAdapterError as
    { cause?: { constraint?: { index?: string; fields?: string[] } } } | undefined;
  const constraint = adapterError?.cause?.constraint;
  return constraint?.index === SLUG_INDEX || (constraint?.fields?.includes("slug") ?? false);
}

/** The form state that shows "Slug is already in use" at the slug field. */
const slugTakenState: PageFormState = { fieldErrors: { slug: [SLUG_TAKEN_MESSAGE] } };

/**
 * Revalidates every route under `/pages`: the list and the view and edit routes of all slugs, so that a renamed page's
 * old and new address are both covered.
 */
function revalidatePages(): void {
  revalidatePath("/pages", "layout");
}

/**
 * Creates a page from the submitted page form and redirects to its address `/pages/<slug>`. Returns the errors to show
 * in the form if the input is invalid, the slug is taken or the page cannot be stored.
 */
export async function createPage(_prevState: PageFormState, formData: FormData): Promise<PageFormState> {
  const input = parsePageFormData(formData);
  if (!input.success) return { fieldErrors: input.fieldErrors };

  let id: string;
  let slug: string;
  try {
    ({ id, slug } = await getDb().page.create({ data: input.data, select: { id: true, slug: true } }));
  } catch (err) {
    if (isSlugTaken(err)) {
      logger.warn({ slug: input.data.slug }, "slug of new page already in use");
      return slugTakenState;
    }
    logger.error({ err }, "failed to create page");
    return { message: SAVE_FAILED_MESSAGE };
  }

  logger.info({ pageId: id }, "page created");
  revalidatePages();
  // `redirect` throws, so it must stay outside the try block above.
  redirect(`/pages/${slug}`);
}

/**
 * Updates the page with the given id from the submitted page form and redirects to its address with the stored, possibly
 * changed slug. Returns the errors to show in the form if the input is invalid, the slug is taken, the page no longer
 * exists or it cannot be stored. Bind the id with `updatePage.bind(null, id)`.
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
    if (isSlugTaken(err)) {
      logger.warn({ pageId, slug: input.data.slug }, "slug of updated page already in use");
      return slugTakenState;
    }
    logger.error({ err, pageId }, "failed to update page");
    return { message: SAVE_FAILED_MESSAGE };
  }
  if (count === 0) {
    logger.warn({ pageId }, "page to update not found");
    return { message: PAGE_GONE_MESSAGE };
  }

  logger.info({ pageId }, "page updated");
  revalidatePages();
  redirect(`/pages/${input.data.slug}`);
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
    revalidatePages();
  } else {
    logger.warn({ pageId: id }, "page to delete has a malformed id");
  }

  redirect("/pages");
}
