// Addresses of folders, tabs and pages under `/folders`, of deleted pages under `/deleted-pages`, of the login and the
// password change, and the actions in their query string. Pure functions used by routes, Server Actions and links; no server-only imports.

import { parseName } from "@/lib/names";

/** The fixed prefix of all content addresses. */
const FOLDERS_PATH = "/folders";

/**
 * The fixed prefix of the addresses of deleted pages. It names what it holds, so that deleted tabs and folders can get
 * addresses of their own later.
 */
const DELETED_PAGES_PATH = "/deleted-pages";

/** The suffix that marks a page in an address. It belongs to the address, not to the page name. */
const PAGE_SUFFIX = ".md";

/** The address of the login page, the one page that needs no login. */
const LOGIN_PATH = "/login";

/** The address of the login page. */
export function loginPath(): string {
  return LOGIN_PATH;
}

/** The address where a user who logged in with a first password sets a password of their own. */
const CHANGE_PASSWORD_PATH = "/change-password";

/** The address of the forced password change. */
export function changePasswordPath(): string {
  return CHANGE_PASSWORD_PATH;
}

function withAction(path: string, action?: string): string {
  return action ? `${path}?action=${action}` : path;
}

/** The address of the folder list, optionally with an action. */
export function foldersPath(action?: string): string {
  return withAction(FOLDERS_PATH, action);
}

/** The address of a folder, optionally with an action. */
export function folderPath(folder: string, action?: string): string {
  return withAction(`${FOLDERS_PATH}/${folder}`, action);
}

/** The address of the list of all pages of a folder: the folder address with the view `all`. */
export function allPagesPath(folder: string): string {
  return `${FOLDERS_PATH}/${folder}?view=all`;
}

/** The address of a tab of a folder, optionally with an action. */
export function tabPath(folder: string, tab: string, action?: string): string {
  return withAction(`${FOLDERS_PATH}/${folder}/${tab}`, action);
}

/** The address of a page in a tab or, with `tab` `null`, placed directly in the folder; optionally with an action. */
export function pagePath(folder: string, tab: string | null, page: string, action?: string): string {
  const place = tab === null ? `${FOLDERS_PATH}/${folder}` : `${FOLDERS_PATH}/${folder}/${tab}`;
  return withAction(`${place}/${page}${PAGE_SUFFIX}`, action);
}

/** The address of the list of the deleted pages of a folder. */
export function deletedPagesPath(folder: string): string {
  return `${DELETED_PAGES_PATH}/${folder}`;
}

/**
 * The address of a deleted page of a folder, optionally with an action. Deleted pages are addressed by their id,
 * because their names need not be unique.
 */
export function deletedPagePath(folder: string, id: string, action?: string): string {
  return withAction(`${DELETED_PAGES_PATH}/${folder}/${id}`, action);
}

/**
 * Returns the page name if the URL segment is a valid name followed by `.md`, otherwise `null`. Only the lowercase
 * suffix counts, and names never contain a dot, so `guides.MD` and `guides.md.md` are no pages.
 */
export function parsePageSegment(segment: string): string | null {
  if (!segment.endsWith(PAGE_SUFFIX)) return null;
  return parseName(segment.slice(0, -PAGE_SUFFIX.length));
}

/** The search parameters of a request, as Next.js passes them to a page. */
export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Reads the search parameter `key`, which may only have one of the allowed values: `null` if it is not given, the
 * value if it is allowed, and `"invalid"` for anything else, such as an unknown, empty or repeated value.
 */
export function parseChoice<Choice extends string>(
  searchParams: SearchParams,
  key: string,
  allowed: readonly Choice[],
): Choice | null | "invalid" {
  const value = searchParams[key];
  if (value === undefined) return null;
  if (typeof value !== "string") return "invalid";
  return (allowed as readonly string[]).includes(value) ? (value as Choice) : "invalid";
}

/**
 * Reads the action of an address from its query string `?action=<action>`: `null` without an action, the action if
 * the address allows it, and `"invalid"` for anything else. Routes show the not-found page for `"invalid"`.
 */
export function parseAction<Action extends string>(
  searchParams: SearchParams,
  allowed: readonly Action[],
): Action | null | "invalid" {
  return parseChoice(searchParams, "action", allowed);
}

/**
 * Reads the view of an address from its query string `?view=<view>`, checked like an action: `null` without a view,
 * the view if the address has it, and `"invalid"` for anything else. Addresses without views pass no allowed views.
 */
export function parseView<View extends string>(
  searchParams: SearchParams,
  allowed: readonly View[] = [],
): View | null | "invalid" {
  return parseChoice(searchParams, "view", allowed);
}
