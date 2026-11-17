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
  /** Delete a tab for good, with its pages, which are soft deleted. */
  deleteTab: "manager",
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

/**
 * The roles of the MCP addresses of a folder (`/mcp/<folder-uuid>/<role>`): the most an AI app connected there may
 * do. Manager and Owner are no roles of MCP.
 */
export const MCP_ROLES = ["reader", "writer"] as const satisfies readonly Role[];

/** The role of an MCP address. */
export type McpRole = (typeof MCP_ROLES)[number];

/** Whether the text is the role of an MCP address. */
export function isMcpRole(value: unknown): value is McpRole {
  return typeof value === "string" && (MCP_ROLES as readonly string[]).includes(value);
}

/**
 * The roles of the MCP addresses that a user with the given role on a folder may connect to: those at most the own
 * role, so Reader for a Reader, and Reader and Writer for a Writer, a Manager and an Owner. None without a role.
 */
export function mcpRolesFor(role: Role | null | undefined): McpRole[] {
  return role == null ? [] : MCP_ROLES.filter((mcpRole) => includesRole(role, mcpRole));
}

/** What a connection with each MCP role may do through MCP, in one sentence, as the consent page and "AI apps" say. */
export const MCP_ROLE_ABILITIES: Readonly<Record<McpRole, string>> = {
  reader: "List the tabs and pages of the folder and read its pages, without changing anything.",
  writer:
    "List the tabs and pages of the folder, read its pages, create pages, replace their content, and move or rename " +
    "them within the folder.",
};

/**
 * The connection of an AI app through MCP: the grant whose access token the request carries, and the folder and the
 * role of the MCP address the grant was approved for.
 */
export type McpConnection = { grantId: string; folderId: string; role: McpRole };
