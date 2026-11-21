// What the start of the server checks of the files: whether the store can be used. Without it the wiki works, but files
// are off, and the operator is told once, in the log, why (see "What the environment has to provide" in
// `container-image.md`).

import { getStore, type FilesOffReason } from "@/features/files/store";
import { logger } from "@/lib/logger";

/** Why files are off, as the warning names it. */
const OFF_REASONS: Readonly<Record<FilesOffReason, string>> = {
  "not-set": "HIPPOWIKI_FILES_DIR is not set",
  missing: "the directory of HIPPOWIKI_FILES_DIR does not exist",
  "not-writable": "the server cannot write the directory of HIPPOWIKI_FILES_DIR",
};

/** Checks the store once and logs one warning when files are off, with the reason and the directory. */
export async function warnIfFilesOff(): Promise<void> {
  const store = await getStore();
  if (store.on) {
    logger.info({ dir: store.dir }, "files are kept in the files directory");
    return;
  }
  logger.warn(
    { reason: store.reason, dir: store.dir },
    `files are off: ${OFF_REASONS[store.reason]}; uploads are refused and the content of files is not served`,
  );
}
