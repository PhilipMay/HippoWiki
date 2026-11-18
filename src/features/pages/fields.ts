// The names of the fields of the forms of pages that Client Components render. A module without imports, so that a
// dialog that renders a hidden field does not load the schemas of the pages, with Zod and the Markdown parser, into
// the browser (see "UI" in `architecture.md`).

/**
 * Name of the hidden form field that holds the version of the page that the editor or dialog was opened with: the
 * state of the page the change is based on.
 */
export const VERSION_FIELD = "version";

/** Name of the form field that holds the place of a page: a tab id, or empty for the folder itself. */
export const PLACE_FIELD = "place";
