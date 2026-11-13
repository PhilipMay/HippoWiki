// Addresses of folders, tabs and pages under `/folders`, of deleted pages under `/deleted-pages`, of the users, the own
// account, the login and the password change, the actions in their query string and the way back after a login. Pure
// functions used by routes, Server Actions and links; no server-only imports.

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

/** The address of the login page, optionally with the address to go to after the login. */
export function loginPath(next?: string | string[] | null): string {
  return withNext(LOGIN_PATH, next);
}

/** The address of the user list, which only the admin sees. */
const USERS_PATH = "/users";

/** The address of the user list, optionally with an action. */
export function usersPath(action?: string): string {
  return withAction(USERS_PATH, action);
}

/** The address of the own account of the logged-in user, with the API tokens. */
const ACCOUNT_PATH = "/account";

/** The address of the own account, optionally with an action. */
export function accountPath(action?: string): string {
  return withAction(ACCOUNT_PATH, action);
}

/** The address of the dialog that revokes the token with the given id. */
export function revokeTokenPath(id: string): string {
  return `${accountPath("revoke")}&token=${id}`;
}

/** The address of the MCP endpoint, where AI assistants read the wiki with a bearer token. */
const MCP_PATH = "/mcp";

/** The address of the MCP endpoint. */
export function mcpPath(): string {
  return MCP_PATH;
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

/** The address of the metadata of the OAuth authorization server (RFC 8414). */
export function authorizationServerMetadataPath(): string {
  return "/.well-known/oauth-authorization-server";
}

/**
 * The address of the metadata of the protected resource `/mcp` (RFC 9728): the well-known prefix followed by the path
 * of the resource.
 */
export function protectedResourceMetadataPath(): string {
  return `/.well-known/oauth-protected-resource${MCP_PATH}`;
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
