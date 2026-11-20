// The length limit and the pattern of the names of folders, tabs and pages. A module without imports, so that a Client
// Component that shows the limit, and the module of wiki link targets that the editor loads, do not load the schema of
// a name, with Zod, into the browser (see "UI" in `architecture.md`).

export const NAME_MAX_LENGTH = 80;

/** Lowercase letters and digits in groups joined by single hyphens, e.g. `release-notes`. */
export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
