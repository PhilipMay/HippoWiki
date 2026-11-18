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
import { mayDoTabAction, tabAddressOf } from "@/features/folders/folder-query";
import { getTab, listTabs } from "@/features/folders/queries";
import { createPage } from "@/features/pages/actions";
import NewPageForm from "@/features/pages/components/NewPageForm";
import PageList from "@/features/pages/components/PageList";
import PageAddress from "@/features/pages/components/PageAddress";
import { pageAddressOf } from "@/features/pages/page-query";
import { getPage, listTabPages } from "@/features/pages/queries";
import { folderPath, parsePageSegment, tabPath } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/folders/[folder]/[item]">;

/**
 * What the address shows, with its browser title, or `null` for the not-found page. A last segment that ends in `.md`
 * is a page placed directly in the folder (see `pageAddressOf()`), any other is a tab of the folder (see
 * `tabAddressOf()`). The title and the page both use it.
 */
async function resolve({ params, searchParams }: Props) {
  const { folder, item } = await params;
  const query = await searchParams;
  const pageName = parsePageSegment(item);
  if (pageName) {
    const page = await getPage(folder, null, pageName);
    const address = page && pageAddressOf(page, query);
    return address && ({ kind: "page", page, ...address } as const);
  }
  const tab = await getTab(folder, item);
  const address = tab && tabAddressOf(tab, query);
  return address && ({ kind: "tab", tab, ...address } as const);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { title: pageTitle((await resolve(props))?.title) };
}

export default async function FolderItemPage(props: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  // An action that the role does not include answers like an unknown one, before the content is read.
  const resolved = (await resolve(props)) ?? notFound();
  if (resolved.kind === "page") return <PageAddress page={resolved.page} query={resolved.query} />;

  const { tab, action } = resolved;
  const { folder, role } = tab;
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
        </Stack>
      </Stack>
      <PageList pages={pages} folderName={folder.name} tabName={tab.name} />
      {action === "rename" && (
        <NameDialog
          title="Rename tab"
          action={renameTab.bind(null, tab.id)}
          currentName={tab.name}
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
