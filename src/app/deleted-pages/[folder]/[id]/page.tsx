import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DeletedPageView, {
  DELETED_PAGE_ACTIONS,
  deletedPageViewTitle,
} from "@/features/pages/components/DeletedPageView";
import { getDeletedPage } from "@/features/pages/queries";
import { parseAction, parseView, type SearchParams } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/deleted-pages/[folder]/[id]">;

/** The action of the address, or `"invalid"` for an action or a view that a deleted page does not have. */
function parseQuery(searchParams: SearchParams) {
  const action = parseAction(searchParams, DELETED_PAGE_ACTIONS);
  return parseView(searchParams) === null ? action : "invalid";
}

async function findDeletedPage(params: Props["params"]) {
  const { folder, id } = await params;
  return getDeletedPage(folder, id);
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = await findDeletedPage(params);
  if (!page || parseQuery(await searchParams) === "invalid") return { title: pageTitle() };
  return { title: pageTitle(deletedPageViewTitle(page)) };
}

/** A deleted page of a folder, read-only, with the "Restore page" dialog for `?action=restore`. */
export default async function DeletedPageAddress({ params, searchParams }: Props) {
  const page = await findDeletedPage(params);
  if (!page) notFound();

  const action = parseQuery(await searchParams);
  if (action === "invalid") notFound();

  return <DeletedPageView page={page} action={action} />;
}
