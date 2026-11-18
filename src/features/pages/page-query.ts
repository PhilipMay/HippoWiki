// What the query string of a page address and of the address of a deleted page asks for: the actions and views of
// these addresses, the lowest role of each action, and the browser titles. The routes, their `generateMetadata` and the
// page views share it, so that the title and the page decide in one place what an address shows. No server-only
// imports.

import { mayDo, type FolderFunction, type Role } from "@/features/folder-roles/roles";
import { parseRevisionNumber } from "@/features/pages/schema";
import { PAGE_NOTICES, parseAction, parseChoice, parseView, type PageNotice, type SearchParams } from "@/lib/addresses";

/**
 * The actions of a page address: `edit` opens the edit form, `move-or-rename` the "Move or rename page" dialog,
 * `delete` the "Delete page" dialog and `revert` the "Revert page" dialog over the revision `revision`.
 */
const PAGE_ACTIONS = ["edit", "move-or-rename", "delete", "revert"] as const;

export type PageAction = (typeof PAGE_ACTIONS)[number];

/** The function of each action of a page, whose lowest role the user needs; one beyond the role does not exist. */
const PAGE_ACTION_FUNCTIONS: Record<PageAction, FolderFunction> = {
  edit: "editPage",
  "move-or-rename": "moveOrRenamePage",
  delete: "deletePage",
  // A revert is a content save.
  revert: "editPage",
};

/**
 * Whether the role includes the action of a page address; no action, the page itself, needs only a role. The buttons
 * that link to an action ask it as well, so that a button is offered exactly where its address exists.
 */
export function mayDoPageAction(role: Role | null, action: PageAction | null): boolean {
  return action === null || mayDo(role, PAGE_ACTION_FUNCTIONS[action]);
}

/**
 * Reads the notice of a page address from its query string `?notice=<notice>`: `null` without a notice, the notice if
 * it is known and the address has an action as well, and `"invalid"` for anything else, a notice without an action
 * included.
 */
function parsePageNotice(
  searchParams: SearchParams,
  action: PageAction | null | "invalid",
): PageNotice | null | "invalid" {
  const notice = parseChoice(searchParams, "notice", PAGE_NOTICES);
  return notice !== null && action === null ? "invalid" : notice;
}

/**
 * The views of a page address: `history` lists the revisions of the page, `revision` shows one of them, rendered or
 * with `format=raw` as its Markdown source, and `compare` compares two of them.
 */
const PAGE_VIEWS = ["history", "revision", "compare"] as const;

/** The forms of a revision besides the rendered one, in the query string `format=<format>`. */
const REVISION_FORMATS = ["raw"] as const;

/** The view of a page address with its parameters, already checked. */
export type PageAddressView =
  | { name: "history"; before: number | null }
  | { name: "revision"; revision: number; raw: boolean }
  | { name: "compare"; from: number; to: number };

/**
 * What the query string of a page address asks for, already checked: an action with its notice, or a view; for the
 * action `revert` the number of the revision to revert to, `null` otherwise.
 */
export type PageQuery = {
  action: PageAction | null;
  notice: PageNotice | null;
  view: PageAddressView | null;
  revision: number | null;
};

/**
 * The search parameters that belong to a view or an action of the history of a page, besides `view`, `action` and
 * `notice`; each is allowed only with its own view or action.
 */
const PAGE_QUERY_PARAMS = ["before", "revision", "format", "from", "to"] as const;

/** The parameters each view of a page address allows. */
const PAGE_VIEW_PARAMS: Record<(typeof PAGE_VIEWS)[number], readonly string[]> = {
  history: ["before"],
  revision: ["revision", "format"],
  compare: ["from", "to"],
};

/**
 * Reads the parameters of a view of a page address, already known to belong to it: `"invalid"` for a missing or
 * malformed one.
 */
function parseViewParams(view: (typeof PAGE_VIEWS)[number], searchParams: SearchParams): PageAddressView | "invalid" {
  switch (view) {
    case "history": {
      if (searchParams.before === undefined) return { name: "history", before: null };
      const before = parseRevisionNumber(searchParams.before);
      return before === null || before < 2 ? "invalid" : { name: "history", before };
    }
    case "revision": {
      const revision = parseRevisionNumber(searchParams.revision);
      const format = parseChoice(searchParams, "format", REVISION_FORMATS);
      if (revision === null || format === "invalid") return "invalid";
      return { name: "revision", revision, raw: format === "raw" };
    }
    case "compare": {
      const from = parseRevisionNumber(searchParams.from);
      const to = parseRevisionNumber(searchParams.to);
      return from === null || to === null ? "invalid" : { name: "compare", from, to };
    }
  }
}

/**
 * Reads the view of the history of a page from a query string, with its parameters: `null` without a view, and
 * `"invalid"` for an unknown, empty or repeated view, a missing or malformed parameter, and a parameter of a view or
 * action of the history (`before`, `revision`, `format`, `from`, `to`) that belongs to no view of the address. The
 * parameters in `allowed` belong to an action of the address instead. The page address and the address of a deleted
 * page share it.
 */
function parseHistoryView(
  searchParams: SearchParams,
  allowed: readonly string[] = [],
): PageAddressView | null | "invalid" {
  const view = parseView(searchParams, PAGE_VIEWS);
  if (view === "invalid") return "invalid";
  const params: readonly string[] = view === null ? allowed : PAGE_VIEW_PARAMS[view];
  if (PAGE_QUERY_PARAMS.some((key) => searchParams[key] !== undefined && !params.includes(key))) return "invalid";
  return view === null ? null : parseViewParams(view, searchParams);
}

/**
 * Reads what the query string of a page address asks for: at most one action, with its notice, or one view, with its
 * parameters. `"invalid"` for an unknown, empty or repeated action, notice or view, an action together with a view, a
 * parameter of a view or action that the address does not have, and a missing or malformed parameter: `before` of the
 * history must be a revision number from 2 up, `revision` of the view `revision` and of the action `revert`, `from` and
 * `to` revision numbers and `format` only `raw` (whether the page has the revisions, the history reads check).
 */
function parsePageQuery(searchParams: SearchParams): PageQuery | "invalid" {
  const action = parseAction(searchParams, PAGE_ACTIONS);
  const notice = parsePageNotice(searchParams, action);
  const view = parseHistoryView(searchParams, action === "revert" ? ["revision"] : []);
  if (action === "invalid" || notice === "invalid" || view === "invalid") return "invalid";
  if (action !== null && view !== null) return "invalid";
  if (action === "revert") {
    const revision = parseRevisionNumber(searchParams.revision);
    return revision === null ? "invalid" : { action, notice, view: null, revision };
  }
  return { action, notice, view, revision: null };
}

/** The browser title of a view of the history of a page with the given title. */
function historyViewTitle(view: PageAddressView, title: string): string {
  switch (view.name) {
    case "history":
      return `History of ${title}`;
    case "revision":
      return `Revision ${view.revision} of ${title}`;
    case "compare":
      return `Revisions ${Math.min(view.from, view.to)} and ${Math.max(view.from, view.to)} of ${title}`;
  }
}

/** The browser title of a page with the given title and what its query string asks for, already checked. */
function pageViewTitle(title: string, query: PageQuery): string {
  if (query.view !== null) return historyViewTitle(query.view, title);
  if (query.action === "revert") return `Revert ${title}`;
  return query.action === "edit" ? `Edit ${title}` : title;
}

/**
 * What a page address shows, and its browser title: `null` for a query string that `parsePageQuery()` refuses and for
 * an action beyond the role of the user, which answer like an unknown address. The route uses it for the title and for
 * the page, so that both decide alike. Whether the page has the revisions a view names, the history reads decide.
 */
export function pageAddressOf(
  page: { title: string; role: Role | null },
  searchParams: SearchParams,
): { query: PageQuery; title: string } | null {
  const query = parsePageQuery(searchParams);
  if (query === "invalid" || !mayDoPageAction(page.role, query.action)) return null;
  return { query, title: pageViewTitle(page.title, query) };
}

/** The actions of the address of a deleted page: `restore` opens the "Restore page" dialog. */
const DELETED_PAGE_ACTIONS = ["restore"] as const;

export type DeletedPageAction = (typeof DELETED_PAGE_ACTIONS)[number];

/**
 * What the address of a deleted page shows, and its browser title: the action of the address or a view of the history,
 * with the same parameters as at a page address. `null` for an action or view that a deleted page does not have, both
 * together, and a parameter that belongs to neither; a deleted page has no "Revert". The title shows that the page is
 * a deleted copy.
 */
export function deletedPageAddressOf(
  page: { title: string },
  searchParams: SearchParams,
): { action: DeletedPageAction | null; view: PageAddressView | null; title: string } | null {
  const action = parseAction(searchParams, DELETED_PAGE_ACTIONS);
  const view = parseHistoryView(searchParams);
  if (action === "invalid" || view === "invalid" || (action !== null && view !== null)) return null;
  const title = `Deleted: ${page.title}`;
  return { action, view, title: view === null ? title : historyViewTitle(view, title) };
}
