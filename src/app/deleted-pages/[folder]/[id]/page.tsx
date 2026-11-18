import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DeletedPageView from "@/features/pages/components/DeletedPageView";
import HistoryAddress from "@/features/pages/components/HistoryAddress";
import { deletedPageHistoryPlace } from "@/features/pages/components/history-place";
import { requireUser } from "@/features/auth/session";
import { deletedPageAddressOf } from "@/features/pages/page-query";
import { getDeletedPage } from "@/features/pages/queries";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/deleted-pages/[folder]/[id]">;

/**
 * What the address shows: the deleted page with its action or a view of its history, and the browser title, or `null`
 * for the not-found page (see `deletedPageAddressOf()`). The title and the page both use it.
 */
async function resolve({ params, searchParams }: Props) {
  const { folder, id } = await params;
  const page = await getDeletedPage(folder, id);
  const address = page && deletedPageAddressOf(page, await searchParams);
  return address && { page, ...address };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { title: pageTitle((await resolve(props))?.title) };
}

/**
 * A deleted page of a folder, read-only, with the "Restore page" dialog for `?action=restore`, or a view of its
 * history: the list of revisions, a revision or a comparison, without "Revert".
 */
export default async function DeletedPageAddress(props: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  const { page, action, view } = (await resolve(props)) ?? notFound();
  if (view !== null) {
    return <HistoryAddress pageId={page.id} title={page.title} place={deletedPageHistoryPlace(page)} view={view} />;
  }
  return <DeletedPageView page={page} action={action} />;
}
