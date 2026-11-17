import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { mayDo, type FolderFunction, type Role } from "@/features/folder-roles/roles";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { listTabs } from "@/features/folders/queries";
import { deletePage, moveOrRenamePage, updatePageContent } from "@/features/pages/actions";
import DeletePageDialog from "@/features/pages/components/DeletePageDialog";
import MarkdownContent from "@/features/pages/components/MarkdownContent";
import MoveOrRenamePageDialog from "@/features/pages/components/MoveOrRenamePageDialog";
import PageForm from "@/features/pages/components/PageForm";
import type { PageWithPlace } from "@/features/pages/service";
import { editorWithChannel } from "@/features/users/records";
import { parseRevisionNumber } from "@/features/pages/schema";
import {
  PAGE_NOTICES,
  pagePath,
  pageHistoryPath,
  parseAction,
  parseChoice,
  parseView,
  type PageNotice,
  type SearchParams,
} from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

/**
 * The actions of a page address: `edit` opens the edit form, `move-or-rename` the "Move or rename page" dialog and
 * `delete` the "Delete page" dialog.
 */
export const PAGE_ACTIONS = ["edit", "move-or-rename", "delete"] as const;

export type PageAction = (typeof PAGE_ACTIONS)[number];

/** The function of each action of a page, whose lowest role the user needs; one beyond the role does not exist. */
const PAGE_ACTION_FUNCTIONS: Record<PageAction, FolderFunction> = {
  edit: "editPage",
  "move-or-rename": "moveOrRenamePage",
  delete: "deletePage",
};

/**
 * Whether the role includes the action of a page address; no action, the page itself, needs only a role. A route
 * checks it before the page view is shown, so that an action beyond the role answers like an unknown one.
 */
export function mayDoPageAction(role: Role | null, action: PageAction | null): boolean {
  return action === null || mayDo(role, PAGE_ACTION_FUNCTIONS[action]);
}

/**
 * Reads the notice of a page address from its query string `?notice=<notice>`: `null` without a notice, the notice if
 * it is known and the address has an action as well, and `"invalid"` for anything else, a notice without an action
 * included. Routes show the not-found page for `"invalid"`.
 */
export function parsePageNotice(
  searchParams: SearchParams,
  action: PageAction | null | "invalid",
): PageNotice | null | "invalid" {
  const notice = parseChoice(searchParams, "notice", PAGE_NOTICES);
  return notice !== null && action === null ? "invalid" : notice;
}

/** The views of a page address: `history` lists the revisions of the page. */
export const PAGE_VIEWS = ["history"] as const;

/** The view of a page address with its parameters, already checked. */
export type PageAddressView = { name: "history"; before: number | null };

/** What the query string of a page address asks for, already checked: an action with its notice, or a view. */
export type PageQuery = { action: PageAction | null; notice: PageNotice | null; view: PageAddressView | null };

/**
 * The search parameters that belong to a view or an action of the history of a page, besides `view`, `action` and
 * `notice`; each is allowed only with its own view or action.
 */
const PAGE_QUERY_PARAMS = ["before", "revision", "format", "from", "to"] as const;

/** The parameters each view of a page address allows. */
const PAGE_VIEW_PARAMS: Record<(typeof PAGE_VIEWS)[number], readonly string[]> = { history: ["before"] };

/**
 * Reads what the query string of a page address asks for: at most one action, with its notice, or one view, with its
 * parameters. `"invalid"` for an unknown, empty or repeated action, notice or view, an action together with a view, a
 * parameter of a view or action that the address does not have, and a malformed parameter: `before` of the history
 * must be a revision number from 2 up (whether the page has it, the route checks). Routes show the not-found page for
 * `"invalid"`; both page routes and their `generateMetadata` share it.
 */
export function parsePageQuery(searchParams: SearchParams): PageQuery | "invalid" {
  const action = parseAction(searchParams, PAGE_ACTIONS);
  const notice = parsePageNotice(searchParams, action);
  const view = parseView(searchParams, PAGE_VIEWS);
  if (action === "invalid" || notice === "invalid" || view === "invalid") return "invalid";
  if (action !== null && view !== null) return "invalid";
  const allowed: readonly string[] = view === null ? [] : PAGE_VIEW_PARAMS[view];
  if (PAGE_QUERY_PARAMS.some((key) => searchParams[key] !== undefined && !allowed.includes(key))) return "invalid";
  if (view === null) return { action, notice, view: null };

  let before: number | null = null;
  if (searchParams.before !== undefined) {
    before = parseRevisionNumber(searchParams.before);
    if (before === null || before < 2) return "invalid";
  }
  return { action: null, notice: null, view: { name: "history", before } };
}

/**
 * The message of the notice `changed`: who changed the page last, how and when, as the page view shows them. The editor or
 * dialog shows it after a change was refused, because the page was changed after it was opened.
 */
function changedMessage(page: PageWithPlace): string {
  return `This page was changed by ${editorWithChannel(page.lastEditedBy)} at ${formatDateTime(page.updatedAt)} after you opened it.`;
}

/** The browser title of a page address with what its query string asks for. */
export function pageViewTitle(page: PageWithPlace, query: PageQuery | "invalid"): string {
  if (query === "invalid") return page.title;
  if (query.view?.name === "history") return `History of ${page.title}`;
  return query.action === "edit" ? `Edit ${page.title}` : page.title;
}

type PageViewProps = {
  page: PageWithPlace;
  /** The action of the address, already checked. */
  action: PageAction | null;
  /** The notice of the address, already checked; only with an action. */
  notice: PageNotice | null;
};

/**
 * What a page address shows, for pages placed directly in a folder and for pages in a tab: the rendered page with its
 * breadcrumb, with the "Move or rename page" dialog on top for `move-or-rename` and the "Delete page" dialog for
 * `delete`, or the edit form for `edit`.
 */
export default async function PageView({ page, action, notice }: PageViewProps) {
  const folderName = page.folder.name;
  const tabName = page.tab?.name ?? null;
  const address = pagePath(folderName, tabName, page.name);
  const message = notice === "changed" ? changedMessage(page) : undefined;
  // A new key after a refused change starts the editor or dialog anew with the page as stored, instead of keeping the
  // input of the user: the version changes with every change of the page, the notice when no version was submitted.
  const formKey = `${page.version}-${notice ?? ""}`;

  if (action === "edit") {
    return (
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          Edit page
        </Typography>
        <PageForm
          key={formKey}
          action={updatePageContent.bind(null, page.id)}
          initialContent={page.content}
          version={page.version}
          changedMessage={message}
          cancelHref={address}
        />
      </Stack>
    );
  }

  // Only the "Move or rename page" dialog needs the tabs of the folder.
  const tabs = action === "move-or-rename" ? ((await listTabs(page.folder.id)) ?? notFound()) : [];

  return (
    <Stack spacing={2}>
      <FolderBreadcrumbs folderName={folderName} tabName={tabName} current={`${page.name}.md`} />
      <Paper component="article" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Last updated <time dateTime={page.updatedAt.toISOString()}>{formatDateTime(page.updatedAt)}</time> by{" "}
            {editorWithChannel(page.lastEditedBy)}
          </Typography>
          {/* Only what the role includes is offered; a Reader gets only "History". The buttons wrap on narrow screens. */}
          <Stack direction="row" useFlexGap sx={{ pt: 1, flexWrap: "wrap", gap: 2 }}>
            {mayDo(page.role, "editPage") && (
              <Button component={Link} href={pagePath(folderName, tabName, page.name, "edit")} variant="outlined">
                Edit
              </Button>
            )}
            {mayDo(page.role, "moveOrRenamePage") && (
              <Button
                component={Link}
                href={pagePath(folderName, tabName, page.name, "move-or-rename")}
                variant="outlined"
              >
                Move or rename
              </Button>
            )}
            {mayDo(page.role, "deletePage") && (
              <Button component={Link} href={pagePath(folderName, tabName, page.name, "delete")} variant="outlined">
                Delete
              </Button>
            )}
            <Button component={Link} href={pageHistoryPath(folderName, tabName, page.name)} variant="outlined">
              History
            </Button>
          </Stack>
        </Stack>
        <Divider sx={{ mb: 3 }} />
        <MarkdownContent>{page.content}</MarkdownContent>
      </Paper>
      {action === "move-or-rename" && (
        <MoveOrRenamePageDialog
          key={formKey}
          action={moveOrRenamePage.bind(null, page.id)}
          folderName={folderName}
          tabs={tabs}
          currentTabId={page.tab?.id ?? null}
          initialName={page.name}
          version={page.version}
          changedMessage={message}
          closeHref={address}
        />
      )}
      {action === "delete" && (
        <DeletePageDialog
          key={formKey}
          action={deletePage.bind(null, page.id)}
          pageLabel={`${page.name}.md`}
          version={page.version}
          changedMessage={message}
          closeHref={address}
        />
      )}
    </Stack>
  );
}
