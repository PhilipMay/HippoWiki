// The roles a user can have on a folder, and what each of them may do. No server-only imports, so that Client
// Components, the routes and the services can use it: the services and the routes ask for a function ("delete a
// page") with `mayDo()` instead of repeating roles, so that both always agree.

/** The roles on a folder, from the lowest to the highest. Each role includes everything of the roles before it. */
export const ROLES = ["reader", "writer", "manager", "owner"] as const;

/** A role of a user on a folder. */
export type Role = (typeof ROLES)[number];

/** The label of each role, as the pages show it. */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  reader: "Reader",
  writer: "Writer",
  manager: "Manager",
  owner: "Owner",
};

/** Whether the text is a role. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Whether the role includes everything of the needed role: whether it is the same role or a higher one. */
export function includesRole(role: Role, needed: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(needed);
}

/**
 * The functions of a folder, each with the lowest role that may do it (the matrix of the requirements). Creating a
 * folder is no function of a folder: every user may do it.
 */
export const FUNCTION_ROLES = {
  /** See the folder in the folder list, open it, its tabs and "All pages", read its pages and its roles. */
  read: "reader",
  /** Create a page and edit its content. */
  editPage: "writer",
  /** Move or rename a page. */
  moveOrRenamePage: "writer",
  /** Delete a page. */
  deletePage: "manager",
  /** See the deleted pages of the folder, read and restore one. */
  deletedPages: "manager",
  /** Create or rename a tab. */
  editTab: "manager",
  /** Rename the folder. */
  renameFolder: "owner",
  /** Give, change and remove roles on the folder. */
  manageRoles: "owner",
} as const satisfies Record<string, Role>;

/** A function of a folder. */
export type FolderFunction = keyof typeof FUNCTION_ROLES;

/** Whether a user with the given role on a folder may do the function; without a role, nothing. */
export function mayDo(role: Role | null | undefined, fn: FolderFunction): boolean {
  return role != null && includesRole(role, FUNCTION_ROLES[fn]);
}

/** The roles that may do the function: its lowest role and every role above it. */
export function rolesFor(fn: FolderFunction): Role[] {
  return ROLES.filter((role) => mayDo(role, fn));
}
