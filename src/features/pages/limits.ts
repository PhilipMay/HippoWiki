// Length limits of page fields. A module of its own, so that `schema.ts` and `derive.ts` can both use them without
// importing each other. The limit of the page name is `NAME_MAX_LENGTH` in `src/lib/names.ts`.

export const TITLE_MAX_LENGTH = 200;
export const CONTENT_MAX_LENGTH = 100_000;
