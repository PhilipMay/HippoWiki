// What only the forms of folders and tabs need. No server-only imports, so Client Components can use it.

import { z } from "zod";

import { folderInputSchema, tabInputSchema, type FolderInput, type TabInput } from "@/features/folders/schema";
import type { NameFieldErrors } from "@/lib/names";

export type ParseFolderInputResult =
  { success: true; data: FolderInput } | { success: false; fieldErrors: NameFieldErrors };

/** Validates the name of a submitted folder form. A missing field counts as empty. */
export function parseFolderFormData(formData: FormData): ParseFolderInputResult {
  const result = folderInputSchema.safeParse({ name: formData.get("name") ?? "" });
  if (result.success) return { success: true, data: result.data };
  return { success: false, fieldErrors: z.flattenError(result.error).fieldErrors };
}

export type ParseTabInputResult = { success: true; data: TabInput } | { success: false; fieldErrors: NameFieldErrors };

/** Validates the name of a submitted tab form. A missing field counts as empty. */
export function parseTabFormData(formData: FormData): ParseTabInputResult {
  const result = tabInputSchema.safeParse({ name: formData.get("name") ?? "" });
  if (result.success) return { success: true, data: result.data };
  return { success: false, fieldErrors: z.flattenError(result.error).fieldErrors };
}
