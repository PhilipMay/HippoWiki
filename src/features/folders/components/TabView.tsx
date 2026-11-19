import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { notFound } from "next/navigation";

import HeadingWithActions from "@/components/HeadingWithActions";
import Link from "@/components/Link";
import { deleteTab, renameTab } from "@/features/folders/actions";
import DeleteTabDialog from "@/features/folders/components/DeleteTabDialog";
import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import NameDialog from "@/features/folders/components/NameDialog";
import { mayDoTabAction, type TabAction } from "@/features/folders/folder-query";
import type { TabWithFolder } from "@/features/folders/service";
import PageList from "@/features/pages/components/PageList";
import { listTabPages } from "@/features/pages/queries";
import SearchField from "@/features/search/components/SearchField";
import { folderPath, tabPath } from "@/lib/addresses";

type TabViewProps = {
  tab: TabWithFolder;
  /** The action of the address, already checked against the role; `new` has a view of its own. */
  action: Exclude<TabAction, "new"> | null;
};

/** What a tab address shows: the pages of the tab, the buttons the role includes, and the dialog of the action on top. */
export default async function TabView({ tab, action }: TabViewProps) {
  const pages = (await listTabPages(tab.id)) ?? notFound();
  const { folder, role } = tab;
  const address = tabPath(folder.name, tab.name);

  return (
    <Stack spacing={3}>
      {/* The search field is left out while a dialog is open, so that a search never discards what was entered. */}
      {action === null && <SearchField folderName={folder.name} />}
      <FolderBreadcrumbs folderName={folder.name} current={tab.name} />
      {/* Only what the role includes is offered. */}
      <HeadingWithActions title={tab.name}>
        {mayDoTabAction(role, "rename") && (
          <Button component={Link} href={tabPath(folder.name, tab.name, "rename")} variant="outlined">
            Rename
          </Button>
        )}
        {mayDoTabAction(role, "delete") && (
          <Button component={Link} href={tabPath(folder.name, tab.name, "delete")} variant="outlined">
            Delete
          </Button>
        )}
        {mayDoTabAction(role, "new") && (
          <Button component={Link} href={tabPath(folder.name, tab.name, "new")} variant="contained">
            New page
          </Button>
        )}
      </HeadingWithActions>
      <PageList pages={pages} folderName={folder.name} tabName={tab.name} />
      {action === "rename" && (
        <NameDialog
          title="Rename tab"
          action={renameTab.bind(null, tab.id)}
          currentName={tab.name}
          closeHref={address}
        />
      )}
      {action === "delete" && (
        <DeleteTabDialog
          action={deleteTab.bind(null, folder.id, tab.id)}
          tabName={tab.name}
          pageCount={pages.length}
          closeHref={address}
          folderHref={folderPath(folder.name)}
        />
      )}
    </Stack>
  );
}
