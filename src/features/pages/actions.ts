"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parsePageFormData, type PageFormState } from "@/features/pages/schema";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

const SAVE_FAILED_MESSAGE = "The page could not be saved. Please try again.";

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
  revalidatePath("/pages");
  // `redirect` throws, so it must stay outside the try block above.
  redirect(`/pages/${id}`);
}
