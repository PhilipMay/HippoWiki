// The length limit of the names of folders, tabs and pages. A module without imports, so that a Client Component that
// shows the limit does not load the schema of a name, with Zod, into the browser (see "UI" in `architecture.md`).

export const NAME_MAX_LENGTH = 80;
