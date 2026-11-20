// Every address of the wiki: the folders, tabs and pages under `/folders` with their views and actions in the query
// string, the deleted pages under `/deleted-pages`, the users, the roles overview, the own account, the login and the
// password change with the way back after a login, the MCP addresses of the folders, and the endpoints of OAuth and
// their metadata under `/.well-known/`. Pure functions used by routes, Server Actions, the adapters of MCP and OAuth
// and links; no server-only imports.

import type { McpRole } from "@/features/folder-roles/roles";
import { isAdmin, type UserType } from "@/features/users/user-type";
import { parseName } from "@/lib/names";

/** The home page of the wiki, which leads on to the start page of the account. */
const HOME_PATH = "/";

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

/** The search parameter and form field with the address to go to after a login: the way back. */
export const NEXT_PARAM = "next";

/** The longest address that is accepted as a way back. */
const NEXT_MAX_LENGTH = 2048;

/** A base that only serves to resolve a path; the reserved domain `.invalid` belongs to nobody. */
const NEXT_BASE = "http://next.invalid";

/**
 * Whether the text has a control character or the delete character. A URL parser drops tabs and line breaks, so
 * `/<tab>/evil.example` would become `//evil.example`, an address on another site.
 */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * The address to go to after a login, taken from a search parameter or a form field. It is accepted only as a path on
 * this site, so that a crafted link to the login page cannot send a user who just logged in to another site (an open
 * redirect): it starts with exactly one `/`, not with `//` or `/\`, which browsers read as the start of a host, has no
 * control characters and is at most 2048 characters long. Anything else, such as a missing or repeated value, gives
 * the folder list.
 */
export function safeNextPath(next: string | string[] | null | undefined): string {
  if (typeof next !== "string" || next.length > NEXT_MAX_LENGTH) return FOLDERS_PATH;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return FOLDERS_PATH;
  if (hasControlCharacter(next)) return FOLDERS_PATH;
  // A second opinion from the parser the browser uses: the address must stay on the site it is resolved against.
  try {
    if (new URL(next, NEXT_BASE).origin !== NEXT_BASE) return FOLDERS_PATH;
  } catch {
    return FOLDERS_PATH;
  }
  return next;
}

/**
 * The path with the way back in its query string. The folder list is where a login leads anyway, so it is left out,
 * and so is everything `safeNextPath()` refuses.
 */
function withNext(path: string, next?: string | string[] | null): string {
  const safe = safeNextPath(next);
  return safe === FOLDERS_PATH ? path : `${path}?${NEXT_PARAM}=${encodeURIComponent(safe)}`;
}

/** Whether the path is the home page or lies under the content: the folders or the deleted pages. */
function isContentPath(path: string): boolean {
  return [FOLDERS_PATH, DELETED_PAGES_PATH].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Where a login or a password change leads the user, given the way back from `safeNextPath()`. An admin sees no
 * content, so for an admin a way back to the home page or to the content, judged by its path and not by its query
 * string, leads to the user list instead of the not-found page. Every other way back, and every way back of a user,
 * stays as it is.
 */
export function landingPath(next: string, user: { type: UserType }): string {
  if (!isAdmin(user)) return next;
  const { pathname } = new URL(next, NEXT_BASE);
  return pathname === HOME_PATH || isContentPath(pathname) ? USERS_PATH : next;
}

/** The address of the login page, optionally with the address to go to after the login. */
export function loginPath(next?: string | string[] | null): string {
  return withNext(LOGIN_PATH, next);
}

/** The address of the user list, which every account sees. */
const USERS_PATH = "/users";

/** The address of the user list, optionally with an action. */
export function usersPath(action?: string): string {
  return withAction(USERS_PATH, action);
}

/** The address of the overview of the folders and their roles, which only admins see. */
const FOLDER_ROLES_PATH = "/folder-roles";

/** The address of the overview of the folders and their roles. */
export function folderRolesOverviewPath(): string {
  return FOLDER_ROLES_PATH;
}

/** The address of the own account of the logged-in user, with the connected apps. */
const ACCOUNT_PATH = "/account";

/** The address of the own account, optionally with an action. */
export function accountPath(action?: string): string {
  return withAction(ACCOUNT_PATH, action);
}

/** The notice of the own account after the own password was changed and the other browsers were logged out. */
export const PASSWORD_CHANGED_NOTICE = "password-changed";

/** The notice of the own account after the own password was changed and all connected apps were disconnected too. */
export const APPS_DISCONNECTED_NOTICE = "password-changed-apps-disconnected";

/**
 * The notice of the own account after the own password was changed, but the connected apps that the user chose to
 * disconnect could not be: the user is asked to revoke them in the list.
 */
export const APPS_NOT_DISCONNECTED_NOTICE = "password-changed-apps-not-disconnected";

/** The notice of the own account after the other browsers were logged out. */
export const OTHER_BROWSERS_LOGGED_OUT_NOTICE = "other-browsers-logged-out";

/**
 * The notices of the own account, in its query string `?notice=<notice>`. A notice reports what an action of the
 * account did; it comes only without an action, is shown once and changes nothing.
 */
const ACCOUNT_NOTICES = [
  PASSWORD_CHANGED_NOTICE,
  APPS_DISCONNECTED_NOTICE,
  APPS_NOT_DISCONNECTED_NOTICE,
  OTHER_BROWSERS_LOGGED_OUT_NOTICE,
] as const;

export type AccountNotice = (typeof ACCOUNT_NOTICES)[number];

/** The address of the own account with a notice. */
export function accountNoticePath(notice: AccountNotice): string {
  return `${ACCOUNT_PATH}?notice=${notice}`;
}

/**
 * Reads the notice of an address of the own account: `null` without a notice, the notice if it is known and the
 * address has no action, and `"invalid"` for anything else, such as an unknown or repeated notice, or one with an
 * action.
 */
export function parseAccountNotice(searchParams: SearchParams): AccountNotice | null | "invalid" {
  const notice = parseChoice(searchParams, "notice", ACCOUNT_NOTICES);
  if (notice !== null && searchParams.action !== undefined) return "invalid";
  return notice;
}

/** The address of the dialog that revokes the connected app with the given id. */
export function revokeAppPath(id: string): string {
  return `${accountPath("revoke")}&app=${id}`;
}

/** The prefix of the MCP addresses of the folders, where AI apps work with the access token of a grant. */
const MCP_PATH = "/mcp";

/**
 * The MCP address of a folder for a role, `/mcp/<folder-uuid>/<role>`: an AI app connected there works only on that
 * folder and may do at most what the role allows. The folder is named by its id, so that the address stays the same
 * when the folder is renamed.
 */
export function mcpFolderPath(folderId: string, role: McpRole): string {
  return `${MCP_PATH}/${folderId}/${role}`;
}

/** The address of the consent page of OAuth, where a logged-in user approves or denies a client. */
const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";

/** The address of the consent page of OAuth, the authorization endpoint. */
export function oauthAuthorizePath(): string {
  return OAUTH_AUTHORIZE_PATH;
}

/** The address of the token endpoint of OAuth, where a client exchanges a code or refreshes a grant. */
export function oauthTokenPath(): string {
  return "/oauth/token";
}

/** The address of the registration endpoint of OAuth, where a client registers itself. */
export function oauthRegisterPath(): string {
  return "/oauth/register";
}

/**
 * The address of the metadata of the protected resource at the MCP address of a folder for a role (RFC 9728): the
 * well-known prefix followed by the path of the resource.
 */
export function protectedResourceMetadataPath(folderId: string, role: McpRole): string {
  return `/.well-known/oauth-protected-resource${mcpFolderPath(folderId, role)}`;
}

/** The address where a user who logged in with a first password sets a password of their own. */
const CHANGE_PASSWORD_PATH = "/change-password";

/** The address of the forced password change, optionally with the address to go to after the change. */
export function changePasswordPath(next?: string | string[] | null): string {
  return withNext(CHANGE_PASSWORD_PATH, next);
}

function withAction(path: string, action?: string): string {
  return action ? `${path}?action=${action}` : path;
}

/** The address with a view in its query string, followed by the parameters of the view that are given, in order. */
function withView(path: string, view: string, parameters: Record<string, string | number | undefined> = {}): string {
  const rest = Object.entries(parameters).flatMap(([name, value]) =>
    value === undefined ? [] : [`&${name}=${value}`],
  );
  return `${path}?view=${view}${rest.join("")}`;
}

/** The address of the home page, `/`, the root of every address. */
export function homePath(): string {
  return HOME_PATH;
}

/** The address of the folder list, optionally with an action; the root of every content address. */
export function foldersPath(action?: string): string {
  return withAction(FOLDERS_PATH, action);
}

/** The root of the addresses of deleted pages, which has no page of its own. */
export function deletedPagesRootPath(): string {
  return DELETED_PAGES_PATH;
}

/** The address of a folder, optionally with an action. */
export function folderPath(folder: string, action?: string): string {
  return withAction(`${FOLDERS_PATH}/${folder}`, action);
}

/** The address of the list of all pages of a folder: the folder address with the view `all`. */
export function allPagesPath(folder: string): string {
  return withView(`${FOLDERS_PATH}/${folder}`, "all");
}

/** The address of the roles of a folder: the folder address with the view `roles`. */
export function folderRolesPath(folder: string): string {
  return withView(`${FOLDERS_PATH}/${folder}`, "roles");
}

/** The address of the MCP addresses of a folder for AI apps: the folder address with the view `mcp`. */
export function folderMcpPath(folder: string): string {
  return withView(`${FOLDERS_PATH}/${folder}`, "mcp");
}

/** The search parameter of the results view of a folder with the words of the search. */
const SEARCH_WORDS_PARAM = "q";

/**
 * The address of the results of a search in a folder: the folder address with the view `search` and the words as
 * typed, encoded, in `q`.
 */
export function searchPath(folder: string, words: string): string {
  return withView(`${FOLDERS_PATH}/${folder}`, "search", { [SEARCH_WORDS_PARAM]: encodeURIComponent(words) });
}

/**
 * Whether the query string holds the words of a search, in any form. They belong only to the view `search` of a folder
 * address; every other address shows the not-found page for them.
 */
export function hasSearchWords(searchParams: SearchParams): boolean {
  return searchParams[SEARCH_WORDS_PARAM] !== undefined;
}

/**
 * Reads the words of a search from the query string, as typed: `null` unless `q` is given once and holds more than
 * spaces.
 */
export function parseSearchWords(searchParams: SearchParams): string | null {
  const words = searchParams[SEARCH_WORDS_PARAM];
  return typeof words === "string" && words.trim() !== "" ? words : null;
}

/** The address of a tab of a folder, optionally with an action. */
export function tabPath(folder: string, tab: string, action?: string): string {
  return withAction(`${FOLDERS_PATH}/${folder}/${tab}`, action);
}

/** The search parameter of the editor of a new page with the name that its "Save page" dialog proposes. */
const NEW_PAGE_NAME_PARAM = "name";

/**
 * The address of the editor of a new page: the folder or, with a tab, the tab address with the action `new`, and with
 * a name, the name that the "Save page" dialog proposes instead of the one derived from the title. The name must
 * follow the name rule, which needs no encoding.
 */
export function newPagePath(folder: string, tab: string | null, name?: string): string {
  const path = tab === null ? folderPath(folder, "new") : tabPath(folder, tab, "new");
  return name === undefined ? path : `${path}&${NEW_PAGE_NAME_PARAM}=${name}`;
}

/** Whether the query string holds a preset name of a new page, in any form. */
export function hasNewPageName(searchParams: SearchParams): boolean {
  return searchParams[NEW_PAGE_NAME_PARAM] !== undefined;
}

/**
 * Reads the preset name of a new page from the query string: `null` without one, the name if it is given once and
 * follows the name rule exactly, and `"invalid"` for anything else, such as an empty, malformed or repeated name.
 */
export function parseNewPageName(searchParams: SearchParams): string | null | "invalid" {
  const name = searchParams[NEW_PAGE_NAME_PARAM];
  if (name === undefined) return null;
  return (typeof name === "string" && parseName(name)) || "invalid";
}

/**
 * The notice of a page address whose editor or dialog is shown again because a change of the page was refused: the
 * page was changed after the editor or dialog was opened.
 */
export const CHANGED_NOTICE = "changed";

/** The notices of a page address, in its query string `?action=<action>&notice=<notice>`. */
export const PAGE_NOTICES = [CHANGED_NOTICE] as const;

export type PageNotice = (typeof PAGE_NOTICES)[number];

/**
 * The address of a page in a tab or, with `tab` `null`, placed directly in the folder; optionally with an action and,
 * after it, a notice. A page address shows a notice only together with an action.
 */
export function pagePath(
  folder: string,
  tab: string | null,
  page: string,
  action?: string,
  notice?: PageNotice,
): string {
  const place = tab === null ? `${FOLDERS_PATH}/${folder}` : `${FOLDERS_PATH}/${folder}/${tab}`;
  const path = withAction(`${place}/${page}${PAGE_SUFFIX}`, action);
  return notice ? `${path}${action ? "&" : "?"}notice=${notice}` : path;
}

/** The address of the history at the given page address or address of a deleted page, with the revisions before `before`. */
function historyPath(address: string, before?: number): string {
  return withView(address, "history", { before });
}

/** The address of a revision at the given address, rendered or, with `raw`, as its Markdown source. */
function revisionPath(address: string, revision: number, raw: boolean): string {
  return withView(address, "revision", { revision, format: raw ? "raw" : undefined });
}

/** The address of the comparison of two revisions at the given address. */
function comparePath(address: string, from: number, to: number): string {
  return withView(address, "compare", { from, to });
}

/** The address of the history of a page: the page address with the view `history`, and the revisions before `before`. */
export function pageHistoryPath(folder: string, tab: string | null, page: string, before?: number): string {
  return historyPath(pagePath(folder, tab, page), before);
}

/**
 * The address of a revision of a page: the page address with the view `revision` and its number, rendered or, with
 * `raw`, as its Markdown source.
 */
export function pageRevisionPath(
  folder: string,
  tab: string | null,
  page: string,
  revision: number,
  raw = false,
): string {
  return revisionPath(pagePath(folder, tab, page), revision, raw);
}

/**
 * The address of the comparison of two revisions of a page: the page address with the view `compare` and the numbers
 * of the two revisions. The comparison goes from the older to the newer one, whatever their order here.
 */
export function pageComparePath(folder: string, tab: string | null, page: string, from: number, to: number): string {
  return comparePath(pagePath(folder, tab, page), from, to);
}

/**
 * The address of the "Revert page" dialog of a page for one of its revisions: the page address with the action `revert`
 * and the number of the revision, optionally with a notice after it.
 */
export function pageRevertPath(
  folder: string,
  tab: string | null,
  page: string,
  revision: number,
  notice?: PageNotice,
): string {
  const path = `${pagePath(folder, tab, page, "revert")}&revision=${revision}`;
  return notice ? `${path}&notice=${notice}` : path;
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

/** The address of the history of a deleted page: its address with the view `history`, as for a page address. */
export function deletedPageHistoryPath(folder: string, id: string, before?: number): string {
  return historyPath(deletedPagePath(folder, id), before);
}

/** The address of a revision of a deleted page, rendered or, with `raw`, as its Markdown source. */
export function deletedPageRevisionPath(folder: string, id: string, revision: number, raw = false): string {
  return revisionPath(deletedPagePath(folder, id), revision, raw);
}

/** The address of the comparison of two revisions of a deleted page. */
export function deletedPageComparePath(folder: string, id: string, from: number, to: number): string {
  return comparePath(deletedPagePath(folder, id), from, to);
}

/** A page as its address names it, with `.md` after its name: how lists, breadcrumbs and dialogs label a page. */
export function pageLabel(name: string): string {
  return `${name}${PAGE_SUFFIX}`;
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
