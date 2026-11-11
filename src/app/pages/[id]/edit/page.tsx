import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { updatePage } from "@/features/pages/actions";
import PageForm from "@/features/pages/components/PageForm";
import { getPage } from "@/features/pages/queries";
import { pageTitle } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/pages/[id]/edit">): Promise<Metadata> {
  const page = await getPage((await params).id);
  return { title: pageTitle(page ? `Edit ${page.title}` : undefined) };
}

export default async function EditPagePage({ params }: PageProps<"/pages/[id]/edit">) {
  const page = await getPage((await params).id);
  if (!page) notFound();

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        Edit page
      </Typography>
      <PageForm
        action={updatePage.bind(null, page.id)}
        initialValues={{ title: page.title, slug: page.slug, content: page.content }}
        cancelHref={`/pages/${page.id}`}
      />
    </Stack>
  );
}
