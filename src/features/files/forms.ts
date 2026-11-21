// What the dialogs of files need: the answer of the upload address, which the upload dialogs read after their `fetch()`,
// the answer of the check of a name, and the form of a revert. No server-only imports, so Client Components can use its
// types; a Client Component takes the names of fields from `fields.ts`, which brings no Zod.

import { LOCK_VERSION_FIELD } from "@/features/files/fields";
import { parseLockVersion } from "@/features/files/schema";
import type { LastEditor } from "@/features/users/records";

/** The field of the upload dialog that a refusal belongs to: the name, the chosen file, or the dialog as a whole. */
export type UploadField = "name" | "file" | null;

/** The file of a refused upload as it is now: what the dialog says of it and the lock version a new version states. */
export type UploadedFileState = { lockVersion: number; updatedAt: string; lastEditedBy: LastEditor };

/**
 * The JSON answer of the upload address: the address of the details page of the stored file, or why the upload was
 * refused, with the message to show at its field. A taken name (`name-taken`) and a file changed meanwhile
 * (`file-changed`) carry the file as it is now, so that the dialog can ask whether to store a new version of it.
 */
export type UploadAnswer =
  | { ok: true; address: string }
  | { ok: false; code: string; field: UploadField; message: string; file?: UploadedFileState };

/**
 * The answer of the check of a name before an upload: whether the name is taken at the place, with the file of that
 * name as it is now, or why the name or the place was refused, with the message to show at its field.
 */
export type NameCheck =
  { ok: true; file: UploadedFileState | null } | { ok: false; field: UploadField; message: string };

/** The message of an upload into a folder that no longer exists. */
export const FOLDER_GONE_MESSAGE = "This folder no longer exists.";

/** The message of an upload into a tab that no longer exists. */
export const TAB_GONE_MESSAGE = "This tab no longer exists.";

/** The message of an upload that failed, also of an answer of the server that could not be read. */
export const UPLOAD_FAILED_MESSAGE = "The file could not be uploaded. Please try again.";

/** What the dialog shows of the file of a taken name or of a file changed meanwhile. */
export function uploadedFileState(file: {
  lockVersion: number;
  updatedAt: Date;
  lastEditedBy: LastEditor;
}): UploadedFileState {
  return { lockVersion: file.lockVersion, updatedAt: file.updatedAt.toISOString(), lastEditedBy: file.lastEditedBy };
}

/** The state of the "Revert file" dialog: the error of the last submission. */
export type FileRevertFormState = { message?: string };

/** The Server Action of the "Revert file" dialog, with the file and the version bound. */
export type FileRevertFormAction = (state: FileRevertFormState, formData: FormData) => Promise<FileRevertFormState>;

/**
 * Reads the lock version of the file from a submitted form, or `null` if it is missing or malformed. That is no error
 * of the form: the service refuses a change without a lock version as one based on an older state, so that the current
 * file is shown.
 */
export function parseLockVersionFormData(formData: FormData): number | null {
  const value = formData.get(LOCK_VERSION_FIELD);
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  return parseLockVersion(Number(value));
}
