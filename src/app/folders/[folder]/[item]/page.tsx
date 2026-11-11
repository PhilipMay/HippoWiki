import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import NameDialog from "@/features/folders/components/NameDialog";
import { renamePage, updatePageContent } from "@/features/pages/actions";
import MarkdownContent from "@/features/pages/components/MarkdownContent";
import PageBreadcrumbs from "@/features/pages/components/PageBreadcrumbs";
import PageForm from "@/features/pages/components/PageForm";
import { getPage } from "@/features/pages/queries";
import { pagePath, parseAction, parsePageSegment } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/folders/[folder]/[item]">;

/** The actions of a page address: `edit` opens the edit form, `rename` the "Rename page" dialog. */
const ACTIONS = ["edit", "rename"] as const;

/**
 * The page of the address, or `null` if there is none. The last segment must be a page name followed by `.md`; any
 * other segment is no page.
 */
async function findPage(params: Props["params"]) {
  const { folder, item } = await params;
  const pageName = parsePageSegment(item);
  if (!pageName) return null;
  return getPage(folder, pageName);
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = await findPage(params);
  if (!page) return { title: pageTitle() };
  const action = parseAction(await searchParams, ACTIONS);
  return { title: pageTitle(action === "edit" ? `Edit ${page.title}` : page.title) };
}

export default async function PageView({ params, searchParams }: Props) {
  const page = await findPage(params);
  if (!page) notFound();

  const action = parseAction(await searchParams, ACTIONS);
  if (action === "invalid") notFound();

  const address = pagePath(page.folder.name, null, page.name);

  if (action === "edit") {
    return (
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          Edit page
        </Typography>
        <PageForm action={updatePageContent.bind(null, page.id)} initialContent={page.content} cancelHref={address} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <PageBreadcrumbs folderName={page.folder.name} pageName={page.name} />
      <Paper component="article" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Last updated <time dateTime={page.updatedAt.toISOString()}>{formatDateTime(page.updatedAt)}</time>
          </Typography>
          <Stack direction="row" spacing={2} sx={{ pt: 1 }}>
            <Button component={Link} href={pagePath(page.folder.name, null, page.name, "edit")} variant="outlined">
              Edit
            </Button>
            <Button component={Link} href={pagePath(page.folder.name, null, page.name, "rename")} variant="outlined">
              Rename
            </Button>
          </Stack>
        </Stack>
        <Divider sx={{ mb: 3 }} />
        <MarkdownContent>{page.content}</MarkdownContent>
      </Paper>
      {action === "rename" && (
        <NameDialog
          title="Rename page"
          action={renamePage.bind(null, page.id)}
          initialName={page.name}
          closeHref={address}
        />
      )}
    </Stack>
  );
}
