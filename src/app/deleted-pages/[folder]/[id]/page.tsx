import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DeletedPageView, {
  DELETED_PAGE_ACTIONS,
  deletedPageViewTitle,
} from "@/features/pages/components/DeletedPageView";
import HistoryAddress from "@/features/pages/components/HistoryAddress";
import { historyViewTitle, parseHistoryView } from "@/features/pages/components/PageView";
import { deletedPageHistoryPlace } from "@/features/pages/components/history-place";
import { requireUser } from "@/features/auth/session";
import { getDeletedPage } from "@/features/pages/queries";
import { parseAction, type SearchParams } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/deleted-pages/[folder]/[id]">;

/**
 * What the query string asks for: the action of the address or a view of the history, with the same parameters as at
 * a page address, or `"invalid"` for an action or view that a deleted page does not have, both together, and a
 * parameter that belongs to neither. A deleted page has no "Revert".
 */
function parseQuery(searchParams: SearchParams) {
  const action = parseAction(searchParams, DELETED_PAGE_ACTIONS);
  const view = parseHistoryView(searchParams);
  if (action === "invalid" || view === "invalid" || (action !== null && view !== null)) return "invalid";
  return { action, view };
}

async function findDeletedPage(params: Props["params"]) {
  const { folder, id } = await params;
  return getDeletedPage(folder, id);
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = await findDeletedPage(params);
  const query = parseQuery(await searchParams);
  if (!page || query === "invalid") return { title: pageTitle() };
  const title = deletedPageViewTitle(page);
  return { title: pageTitle(query.view === null ? title : historyViewTitle(query.view, title)) };
}

/**
 * A deleted page of a folder, read-only, with the "Restore page" dialog for `?action=restore`, or a view of its
 * history: the list of revisions, a revision or a comparison, without "Revert".
 */
export default async function DeletedPageAddress({ params, searchParams }: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  await requireUser();

  const page = await findDeletedPage(params);
  if (!page) notFound();

  const query = parseQuery(await searchParams);
  if (query === "invalid") notFound();

  if (query.view !== null) {
    return (
      <HistoryAddress pageId={page.id} title={page.title} place={deletedPageHistoryPlace(page)} view={query.view} />
    );
  }
  return <DeletedPageView page={page} action={query.action} />;
}
