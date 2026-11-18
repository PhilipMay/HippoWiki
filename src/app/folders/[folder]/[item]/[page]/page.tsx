import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import PageAddress from "@/features/pages/components/PageAddress";
import { pageAddressOf } from "@/features/pages/page-query";
import { getPage } from "@/features/pages/queries";
import { parsePageSegment } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/folders/[folder]/[item]/[page]">;

/**
 * What the address shows, with its browser title, or `null` for the not-found page: the middle segment names a tab of
 * the folder, the last one a page in it, followed by `.md` (see `pageAddressOf()` for the query string). The title and
 * the page both use it.
 */
async function resolve({ params, searchParams }: Props) {
  const { folder, item, page: segment } = await params;
  const pageName = parsePageSegment(segment);
  const page = pageName === null ? null : await getPage(folder, item, pageName);
  const address = page && pageAddressOf(page, await searchParams);
  return address && { page, ...address };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { title: pageTitle((await resolve(props))?.title) };
}

export default async function TabPageView(props: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  // An action that the role does not include answers like an unknown one.
  const { page, query } = (await resolve(props)) ?? notFound();
  return <PageAddress page={page} query={query} />;
}
