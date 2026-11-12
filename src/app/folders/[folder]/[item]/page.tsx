import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { requireUser } from "@/features/auth/session";
import { renameTab } from "@/features/folders/actions";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import NameDialog from "@/features/folders/components/NameDialog";
import { getTab, listTabs } from "@/features/folders/queries";
import { createPage } from "@/features/pages/actions";
import NewPageForm from "@/features/pages/components/NewPageForm";
import PageList from "@/features/pages/components/PageList";
import PageView, { PAGE_ACTIONS, pageViewTitle } from "@/features/pages/components/PageView";
import { getPage, listTabPages } from "@/features/pages/queries";
import { parseAction, parsePageSegment, parseView, tabPath } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/folders/[folder]/[item]">;

/**
 * The actions of a tab address: `new` opens the editor for a new page, with the tab as the preselected place, `rename`
 * the "Rename tab" dialog.
 */
const TAB_ACTIONS = ["new", "rename"] as const;

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
    return { title: pageTitle(pageViewTitle(item.page, parseAction(await searchParams, PAGE_ACTIONS))) };
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
  // Neither a page nor a tab has views.
  if (parseView(query) !== null) notFound();

  if (item.kind === "page") {
    const action = parseAction(query, PAGE_ACTIONS);
    if (action === "invalid") notFound();
    return <PageView page={item.page} action={action} />;
  }

  const { tab } = item;
  const { folder } = tab;
  const action = parseAction(query, TAB_ACTIONS);
  if (action === "invalid") notFound();

  if (action === "new") {
    return (
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          New page
        </Typography>
        <NewPageForm
          action={createPage.bind(null, folder.id)}
          folderName={folder.name}
          tabs={await listTabs(folder.id)}
          tabName={tab.name}
          initialTabId={tab.id}
        />
      </Stack>
    );
  }

  const pages = await listTabPages(tab.id);

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
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 2 }}>
          <Button component={Link} href={tabPath(folder.name, tab.name, "rename")} variant="outlined">
            Rename
          </Button>
          <Button component={Link} href={tabPath(folder.name, tab.name, "new")} variant="contained">
            New page
          </Button>
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
    </Stack>
  );
}
