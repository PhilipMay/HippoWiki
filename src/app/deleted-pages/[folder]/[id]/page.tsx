import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DeletedPageView, { deletedPageViewTitle } from "@/features/pages/components/DeletedPageView";
import { getDeletedPage } from "@/features/pages/queries";
import { parseAction, parseView, type SearchParams } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/deleted-pages/[folder]/[id]">;

/** A deleted page has neither actions nor views. */
function hasQuery(searchParams: SearchParams): boolean {
  return parseAction(searchParams, []) !== null || parseView(searchParams) !== null;
}

async function findDeletedPage(params: Props["params"]) {
  const { folder, id } = await params;
  return getDeletedPage(folder, id);
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = await findDeletedPage(params);
  if (!page || hasQuery(await searchParams)) return { title: pageTitle() };
  return { title: pageTitle(deletedPageViewTitle(page)) };
}

/** A deleted page of a folder, read-only. */
export default async function DeletedPageAddress({ params, searchParams }: Props) {
  const page = await findDeletedPage(params);
  if (!page || hasQuery(await searchParams)) notFound();

  return <DeletedPageView page={page} />;
}
