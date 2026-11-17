import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { requireUser } from "@/features/auth/session";
import { deleteTab, renameTab } from "@/features/folders/actions";
import DeleteTabDialog from "@/features/folders/components/DeleteTabDialog";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import NameDialog from "@/features/folders/components/NameDialog";
import { getTab, listTabs } from "@/features/folders/queries";
import { createPage } from "@/features/pages/actions";
import NewPageForm from "@/features/pages/components/NewPageForm";
import PageList from "@/features/pages/components/PageList";
import { mayDo, type FolderFunction } from "@/features/folder-roles/roles";
import PageAddress from "@/features/pages/components/PageAddress";
import { mayDoPageAction, pageViewTitle, parsePageQuery } from "@/features/pages/components/PageView";
import { getPage, listTabPages } from "@/features/pages/queries";
import { folderPath, parseAction, parsePageSegment, parseView, tabPath } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/folders/[folder]/[item]">;

/**
 * The actions of a tab address: `new` opens the editor for a new page, with the tab as the preselected place, `rename`
 * the "Rename tab" dialog, `delete` the "Delete tab" dialog.
 */
const TAB_ACTIONS = ["new", "rename", "delete"] as const;

/** The function of each action of a tab, whose lowest role the user needs; one beyond the role does not exist. */
const TAB_ACTION_FUNCTIONS: Record<(typeof TAB_ACTIONS)[number], FolderFunction> = {
  new: "editPage",
  rename: "editTab",
  delete: "deleteTab",
};

/**
 * What the address names. A last segment that ends in `.md` is a page placed directly in the folder, any other is a
 * tab of the folder; `null` if there is no such page or tab.
 */
async function findItem(params: Props["params"]) {
  const { folder, item } = await params;
  const pageName = parsePageSegment(item);
  if (pageName) {
    const page = await getPage(folder, null, pageName);
    return page && ({ kind: "page", page } as const);
  }
  const tab = await getTab(folder, item);
  return tab && ({ kind: "tab", tab } as const);
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const item = await findItem(params);
  if (!item) return { title: pageTitle() };
  if (item.kind === "page") {
    return { title: pageTitle(pageViewTitle(item.page, parsePageQuery(await searchParams))) };
  }
  const action = parseAction(await searchParams, TAB_ACTIONS);
  return { title: pageTitle(action === "new" ? "New page" : `${item.tab.name} – ${item.tab.folder.name}`) };
}

export default async function FolderItemPage({ params, searchParams }: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  const item = await findItem(params);
  if (!item) notFound();

  const query = await searchParams;

  if (item.kind === "page") {
    const pageQuery = parsePageQuery(query);
    if (pageQuery === "invalid" || !mayDoPageAction(item.page.role, pageQuery.action)) notFound();
    return <PageAddress page={item.page} query={pageQuery} />;
  }

  // A tab has no views.
  if (parseView(query) !== null) notFound();

  const { tab } = item;
  const { folder, role } = tab;
  const action = parseAction(query, TAB_ACTIONS);
  // An action that the role does not include answers like an unknown one, before the content is read.
  if (action === "invalid" || (action !== null && !mayDo(role, TAB_ACTION_FUNCTIONS[action]))) notFound();

  if (action === "new") {
    return (
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          New page
        </Typography>
        <NewPageForm
          action={createPage.bind(null, folder.id)}
          folderName={folder.name}
          tabs={(await listTabs(folder.id)) ?? notFound()}
          tabName={tab.name}
          initialTabId={tab.id}
        />
      </Stack>
    );
  }

  const pages = (await listTabPages(tab.id)) ?? notFound();

  return (
    <Stack spacing={3}>
      <FolderBreadcrumbs folderName={folder.name} current={tab.name} />
      {/* The buttons move below the heading and wrap on narrow screens instead of overflowing. */}
      <Stack
        direction="row"
        useFlexGap
        sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}
      >
        <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
          {tab.name}
        </Typography>
        {/* Only what the role includes is offered. */}
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 2 }}>
          {mayDo(role, "editTab") && (
            <Button component={Link} href={tabPath(folder.name, tab.name, "rename")} variant="outlined">
              Rename
            </Button>
          )}
          {mayDo(role, "deleteTab") && (
            <Button component={Link} href={tabPath(folder.name, tab.name, "delete")} variant="outlined">
              Delete
            </Button>
          )}
          {mayDo(role, "editPage") && (
            <Button component={Link} href={tabPath(folder.name, tab.name, "new")} variant="contained">
              New page
            </Button>
          )}
        </Stack>
      </Stack>
      <PageList pages={pages} folderName={folder.name} tabName={tab.name} />
      {action === "rename" && (
        <NameDialog
          title="Rename tab"
          action={renameTab.bind(null, tab.id)}
          initialName={tab.name}
          closeHref={tabPath(folder.name, tab.name)}
        />
      )}
      {action === "delete" && (
        <DeleteTabDialog
          action={deleteTab.bind(null, folder.id, tab.id)}
          tabName={tab.name}
          pageCount={pages.length}
          closeHref={tabPath(folder.name, tab.name)}
          folderHref={folderPath(folder.name)}
        />
      )}
    </Stack>
  );
}
