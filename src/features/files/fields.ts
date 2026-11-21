// The names of the fields of the forms of files that Client Components render. A module without imports, so that a
// dialog that renders a hidden field does not load the schemas of the files, with Zod, into the browser (see "UI" in
// `architecture.md`).

/**
 * Name of the hidden form field that holds the lock version of the file that the dialog was opened with: the state of
 * the file the change is based on.
 */
export const LOCK_VERSION_FIELD = "lockVersion";
