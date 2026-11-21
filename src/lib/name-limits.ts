// The length limit and the patterns of the names of folders, tabs, pages and files. A module without imports, so that
// a Client Component that shows the limit, and the module of wiki link targets that the editor loads, do not load the
// schema of a name, with Zod, into the browser (see "UI" in `architecture.md`).

export const NAME_MAX_LENGTH = 80;

/** Lowercase letters and digits in groups joined by single hyphens, e.g. `release-notes`. */
export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The extensions of the names of files, one per type of file: `jpg` for a JPEG, never `jpeg`, so that a link has one
 * spelling. The types themselves are in `src/features/files/types.ts`.
 */
export const FILE_EXTENSIONS = ["png", "jpg", "gif", "webp", "pdf"] as const;

/** The extension of the name of a file, which fixes its type. */
export type FileExtension = (typeof FILE_EXTENSIONS)[number];

/**
 * The name of a file: a name of the name rule, a dot and the lowercase extension of its type, e.g. `network-diagram.png`.
 * The part before the dot has the length limit of a name.
 */
export const FILE_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*\.(png|jpg|gif|webp|pdf)$/;
