// Addresses of folders, tabs and pages under `/folders`, and the actions in their query string. Pure functions used by
// routes, Server Actions and links; no server-only imports.

import { parseName } from "@/lib/names";

/** The fixed prefix of all content addresses. */
const FOLDERS_PATH = "/folders";

/** The suffix that marks a page in an address. It belongs to the address, not to the page name. */
const PAGE_SUFFIX = ".md";

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

/** The address of a tab of a folder, optionally with an action. */
export function tabPath(folder: string, tab: string, action?: string): string {
  return withAction(`${FOLDERS_PATH}/${folder}/${tab}`, action);
}

/** The address of a page in a tab or, with `tab` `null`, placed directly in the folder; optionally with an action. */
export function pagePath(folder: string, tab: string | null, page: string, action?: string): string {
  const place = tab === null ? `${FOLDERS_PATH}/${folder}` : `${FOLDERS_PATH}/${folder}/${tab}`;
  return withAction(`${place}/${page}${PAGE_SUFFIX}`, action);
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
