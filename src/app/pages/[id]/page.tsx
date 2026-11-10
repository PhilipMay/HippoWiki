import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import MarkdownContent from "@/features/pages/components/MarkdownContent";
import { getPage } from "@/features/pages/queries";
import { formatDateTime } from "@/lib/format";
import { pageTitle } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/pages/[id]">): Promise<Metadata> {
  const page = await getPage((await params).id);
  return { title: pageTitle(page?.title) };
}

export default async function PageView({ params }: PageProps<"/pages/[id]">) {
  const page = await getPage((await params).id);
  if (!page) notFound();

  return (
    <Paper component="article" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="h3" component="h1" sx={{ overflowWrap: "anywhere" }}>
          {page.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Last updated <time dateTime={page.updatedAt.toISOString()}>{formatDateTime(page.updatedAt)}</time>
        </Typography>
      </Stack>
      <Divider sx={{ mb: 3 }} />
      <MarkdownContent>{page.content}</MarkdownContent>
    </Paper>
  );
}
