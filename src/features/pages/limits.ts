// Limits of page fields. A module of its own, so that `schema.ts`, `derive.ts` and `markdown.ts` can all use them
// without importing each other. The limit of the page name is `NAME_MAX_LENGTH` in `src/lib/names.ts`.

export const TITLE_MAX_LENGTH = 200;
export const CONTENT_MAX_LENGTH = 100_000;

/**
 * The deepest nesting of lists and quotes in the content: a list or quote inside another counts one level more. Far
 * more than a page needs, and far below what markdown-it keeps in its tokens (`maxNesting` in `markdown.ts`).
 */
export const CONTENT_MAX_DEPTH = 20;

/**
 * The most table cells the content may have, over all its tables, counting the cells that rows are filled up with to
 * the columns of their header. It bounds the size of the page view, because a small table can have a header of many
 * columns and many short rows.
 */
export const CONTENT_MAX_TABLE_CELLS = 10_000;
