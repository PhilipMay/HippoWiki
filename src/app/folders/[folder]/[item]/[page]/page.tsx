import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import PageView, { PAGE_ACTIONS, pageViewTitle } from "@/features/pages/components/PageView";
import { getPage } from "@/features/pages/queries";
import { parseAction, parsePageSegment, parseView } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/folders/[folder]/[item]/[page]">;

/**
 * The page of the address: the middle segment names a tab of the folder, the last one a page in it, followed by
 * `.md`. `null` if the last segment is no page address or there is no such page in that tab.
 */
async function findPage(params: Props["params"]) {
  const { folder, item, page } = await params;
  const pageName = parsePageSegment(page);
  if (!pageName) return null;
  return getPage(folder, item, pageName);
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = await findPage(params);
  if (!page) return { title: pageTitle() };
  return { title: pageTitle(pageViewTitle(page, parseAction(await searchParams, PAGE_ACTIONS))) };
}

export default async function TabPageView({ params, searchParams }: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  const page = await findPage(params);
  if (!page) notFound();

  const query = await searchParams;
  const action = parseAction(query, PAGE_ACTIONS);
  // A page has no views.
  if (action === "invalid" || parseView(query) !== null) notFound();

  return <PageView page={page} action={action} />;
}
