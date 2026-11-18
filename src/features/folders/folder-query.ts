// What the query string of a folder address and of a tab address asks for: their actions and views, the lowest role of
// each action, and the browser titles. The routes, their `generateMetadata` and the views share it, so that the title
// and the page decide in one place what an address shows. No server-only imports.

import { mayDo, type FolderFunction, type Role } from "@/features/folder-roles/roles";
import { parseAction, parseView, type SearchParams } from "@/lib/addresses";

/**
 * The actions of a folder address: `new` opens the editor for a new page, with the folder itself as the preselected
 * place, `rename` the "Rename folder" dialog, `new-tab` the "New tab" dialog and `give-role` the "Give role" dialog.
 */
const FOLDER_ACTIONS = ["new", "rename", "new-tab", "give-role"] as const;

export type FolderAction = (typeof FOLDER_ACTIONS)[number];

/** The function of each action of a folder, whose lowest role the user needs; one beyond the role does not exist. */
const FOLDER_ACTION_FUNCTIONS: Record<FolderAction, FolderFunction> = {
  new: "editPage",
  rename: "renameFolder",
  "new-tab": "editTab",
  "give-role": "manageRoles",
};

/**
 * Whether the role includes the action of a folder address. The buttons that link to an action ask it as well, so that
 * a button is offered exactly where its address exists.
 */
export function mayDoFolderAction(role: Role | null, action: FolderAction): boolean {
  return mayDo(role, FOLDER_ACTION_FUNCTIONS[action]);
}

/**
 * The views of a folder address: `all` lists all pages of the folder, each with its tab, `roles` who has which role on
 * the folder, and `mcp` the MCP addresses of the folder that the user may connect an AI app to. Every role may see all
 * three; `mcp` exists only with `HIPPOWIKI_PUBLIC_URL`.
 */
const FOLDER_VIEWS = ["all", "roles", "mcp"] as const;

export type FolderView = (typeof FOLDER_VIEWS)[number];

/** The browser title of a folder address with its action or view, already checked. */
function folderTitle(name: string, action: FolderAction | null, view: FolderView | null): string {
  if (action === "new") return "New page";
  switch (view) {
    case "all":
      return `All pages – ${name}`;
    case "roles":
      return `Roles – ${name}`;
    case "mcp":
      return `AI apps – ${name}`;
    case null:
      return name;
  }
}

/**
 * What a folder address shows, and its browser title: `null` for an unknown, empty or repeated action or view, an
 * action together with a view (a view has no actions), an action beyond the role of the user, and the view `mcp`
 * without an MCP server (`hasMcp`), which all answer like an unknown address. The route uses it for the title and for
 * the page, so that both decide alike.
 */
export function folderAddressOf(
  folder: { name: string; role: Role | null },
  searchParams: SearchParams,
  hasMcp: boolean,
): { action: FolderAction | null; view: FolderView | null; title: string } | null {
  const action = parseAction(searchParams, FOLDER_ACTIONS);
  const view = parseView(searchParams, FOLDER_VIEWS);
  if (action === "invalid" || view === "invalid" || (action !== null && view !== null)) return null;
  if (action !== null && !mayDoFolderAction(folder.role, action)) return null;
  if (view === "mcp" && !hasMcp) return null;
  return { action, view, title: folderTitle(folder.name, action, view) };
}

/**
 * The actions of a tab address: `new` opens the editor for a new page, with the tab as the preselected place, `rename`
 * the "Rename tab" dialog, `delete` the "Delete tab" dialog.
 */
const TAB_ACTIONS = ["new", "rename", "delete"] as const;

export type TabAction = (typeof TAB_ACTIONS)[number];

/** The function of each action of a tab, whose lowest role the user needs; one beyond the role does not exist. */
const TAB_ACTION_FUNCTIONS: Record<TabAction, FolderFunction> = {
  new: "editPage",
  rename: "editTab",
  delete: "deleteTab",
};

/**
 * Whether the role includes the action of a tab address. The buttons that link to an action ask it as well, so that a
 * button is offered exactly where its address exists.
 */
export function mayDoTabAction(role: Role | null, action: TabAction): boolean {
  return mayDo(role, TAB_ACTION_FUNCTIONS[action]);
}

/**
 * What a tab address shows, and its browser title: `null` for any view (a tab has none), an unknown, empty or repeated
 * action, and an action beyond the role of the user, which all answer like an unknown address. The route uses it for
 * the title and for the page, so that both decide alike.
 */
export function tabAddressOf(
  tab: { name: string; folder: { name: string }; role: Role | null },
  searchParams: SearchParams,
): { action: TabAction | null; title: string } | null {
  if (parseView(searchParams) !== null) return null;
  const action = parseAction(searchParams, TAB_ACTIONS);
  if (action === "invalid" || (action !== null && !mayDoTabAction(tab.role, action))) return null;
  return { action, title: action === "new" ? "New page" : `${tab.name} – ${tab.folder.name}` };
}
