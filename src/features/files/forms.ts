// What the upload dialog needs of an upload: the answer of the upload address, which the dialog reads after its
// `fetch()`. No server-only imports, so Client Components can use it.

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

