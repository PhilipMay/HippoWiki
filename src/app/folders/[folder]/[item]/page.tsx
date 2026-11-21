import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import TabView from "@/features/folders/components/TabView";
import { tabAddressOf } from "@/features/folders/folder-query";
import { getTab } from "@/features/folders/queries";
import FileDetailsView from "@/features/files/components/FileDetailsView";
import { fileAddressOf } from "@/features/files/file-query";
import { getFile, getUploadSettings } from "@/features/files/queries";
import NewPageView from "@/features/pages/components/NewPageView";
import PageAddress from "@/features/pages/components/PageAddress";
import { pageAddressOf } from "@/features/pages/page-query";
import { getPage } from "@/features/pages/queries";
import { parseFileSegment, parsePageSegment } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/folders/[folder]/[item]">;

/**
 * What the address shows, with its browser title, or `null` for the not-found page. A last segment that ends in `.md`
 * is a page placed directly in the folder (see `pageAddressOf()`), one that is a file name with the extension of its
 * type is the details page of a file placed directly in the folder (see `fileAddressOf()`), any other is a tab of the
 * folder (see `tabAddressOf()`). The title and the page both use it.
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
  const fileName = parseFileSegment(item);
  if (fileName) {
    const file = await getFile(folder, null, fileName);
    const uploads = await getUploadSettings();
    const address = file && fileAddressOf(file, query, uploads.on);
    return address && ({ kind: "file", file, uploads, ...address } as const);
  }
  const tab = await getTab(folder, item);
  const uploads = await getUploadSettings();
  const address = tab && tabAddressOf(tab, query, uploads.on);
  return address && ({ kind: "tab", tab, uploads, ...address } as const);
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
  if (resolved.kind === "file") return <FileDetailsView {...resolved} />;

  const { tab, uploads, action, name } = resolved;
  if (action === "new") return <NewPageView folder={tab.folder} tab={tab} presetName={name} />;
  return <TabView tab={tab} action={action} uploads={uploads} presetName={action === "upload" ? name : null} />;
}
