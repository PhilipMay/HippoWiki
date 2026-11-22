import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DeletedFileView from "@/features/files/components/DeletedFileView";
import { deletedFileAddressOf } from "@/features/files/file-query";
import { getDeletedFile } from "@/features/files/queries";
import DeletedPageView from "@/features/pages/components/DeletedPageView";
import HistoryAddress from "@/features/pages/components/HistoryAddress";
import { deletedPageHistoryPlace } from "@/features/pages/components/history-place";
import { requireUser } from "@/features/auth/session";
import { deletedPageAddressOf } from "@/features/pages/page-query";
import { getDeletedPage } from "@/features/pages/queries";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/deleted-items/[folder]/[id]">;

/**
 * What the address shows: the deleted page with its action or a view of its history, or the deleted file with its
 * action, and the browser title, or `null` for the not-found page (see `deletedPageAddressOf()` and
 * `deletedFileAddressOf()`). Pages and files have ids of their own, so the id names one of them. The title and the
 * page both use it.
 */
async function resolve({ params, searchParams }: Props) {
  const { folder, id } = await params;
  const page = await getDeletedPage(folder, id);
  if (page) {
    const address = deletedPageAddressOf(page, await searchParams);
    return address && { kind: "page" as const, page, ...address };
  }
  const file = await getDeletedFile(folder, id);
  const address = file && deletedFileAddressOf(file, await searchParams);
  return address && { kind: "file" as const, file, ...address };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { title: pageTitle((await resolve(props))?.title) };
}

/**
 * A deleted page of a folder, read-only, with the "Restore page" dialog for `?action=restore`, or a view of its
 * history: the list of revisions, a revision or a comparison, without "Revert"; or a deleted file, read-only, with the
 * "Restore file" dialog for `?action=restore`.
 */
export default async function DeletedPageAddress(props: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  const resolved = (await resolve(props)) ?? notFound();
  if (resolved.kind === "file") return <DeletedFileView file={resolved.file} action={resolved.action} />;
  const { page, action, view } = resolved;
  if (view !== null) {
    return <HistoryAddress pageId={page.id} title={page.title} place={deletedPageHistoryPlace(page)} view={view} />;
  }
  return <DeletedPageView page={page} action={action} />;
}
