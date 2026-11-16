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
import { PAGE_NOTICES, pagePath, parseChoice, type PageNotice, type SearchParams } from "@/lib/addresses";
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

/**
 * The message of the notice `changed`: who changed the page last and when, as the page view shows them. The editor or
 * dialog shows it after a change was refused, because the page was changed after it was opened.
 */
function changedMessage(page: PageWithPlace): string {
  return `This page was changed by ${page.lastEditedBy.name} at ${formatDateTime(page.updatedAt)} after you opened it.`;
}

/** The browser title of a page address with the given action. */
export function pageViewTitle(page: PageWithPlace, action: PageAction | null | "invalid"): string {
  return action === "edit" ? `Edit ${page.title}` : page.title;
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
            {page.lastEditedBy.name}
          </Typography>
          {/* Only what the role includes is offered; a Reader gets no buttons at all. */}
          {mayDo(page.role, "editPage") && (
            <Stack direction="row" spacing={2} sx={{ pt: 1 }}>
              <Button component={Link} href={pagePath(folderName, tabName, page.name, "edit")} variant="outlined">
                Edit
              </Button>
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
            </Stack>
          )}
        </Stack>
        <Divider sx={{ mb: 3 }} />
        <MarkdownContent>{page.content}</MarkdownContent>
      </Paper>
      {action === "move-or-rename" && (
        <MoveOrRenamePageDialog
          action={moveOrRenamePage.bind(null, page.id)}
          folderName={folderName}
          tabs={tabs}
          currentTabId={page.tab?.id ?? null}
          initialName={page.name}
          closeHref={address}
        />
      )}
      {action === "delete" && (
        <DeletePageDialog action={deletePage.bind(null, page.id)} pageLabel={`${page.name}.md`} closeHref={address} />
      )}
    </Stack>
  );
}
