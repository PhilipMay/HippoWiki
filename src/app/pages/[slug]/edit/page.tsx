import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { updatePage } from "@/features/pages/actions";
import PageForm from "@/features/pages/components/PageForm";
import { getPageBySlug } from "@/features/pages/queries";
import { pageTitle } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/pages/[slug]/edit">): Promise<Metadata> {
  const page = await getPageBySlug((await params).slug);
  return { title: pageTitle(page ? `Edit ${page.title}` : undefined) };
}

export default async function EditPagePage({ params }: PageProps<"/pages/[slug]/edit">) {
  const page = await getPageBySlug((await params).slug);
  if (!page) notFound();

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        Edit page
      </Typography>
      <PageForm
        action={updatePage.bind(null, page.id)}
        initialValues={{ title: page.title, slug: page.slug, content: page.content }}
        cancelHref={`/pages/${page.slug}`}
      />
    </Stack>
  );
}
