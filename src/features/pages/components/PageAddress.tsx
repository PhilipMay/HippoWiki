import { notFound } from "next/navigation";

import PageHistory from "@/features/pages/components/PageHistory";
import RevisionView from "@/features/pages/components/RevisionView";
import PageView, { type PageQuery } from "@/features/pages/components/PageView";
import { pageHistoryPlace } from "@/features/pages/components/history-place";
import { getPageRevision, listPageRevisions } from "@/features/pages/queries";
import type { PageWithPlace } from "@/features/pages/service";

type PageAddressProps = {
  page: PageWithPlace;
  /** What the query string asks for, already checked with `parsePageQuery()` and against the role. */
  query: PageQuery;
};

/**
 * What a page address shows, for pages placed directly in a folder and for pages in a tab: the view the query string
 * asks for, such as the history of the page, or the page itself with its action. A view with a revision the page does
 * not have shows the not-found page.
 */
export default async function PageAddress({ page, query }: PageAddressProps) {
  const { view } = query;
  if (view?.name === "history") {
    const history = (await listPageRevisions(page.id, { before: view.before })) ?? notFound();
    // The history starts at most at the newest revision; a later one is no page of it.
    if (view.before !== null && view.before > history.newest) notFound();
    return <PageHistory place={pageHistoryPlace(page)} title={page.title} history={history} before={view.before} />;
  }
  if (view?.name === "revision") {
    const revision = (await getPageRevision(page.id, view.revision)) ?? notFound();
    return <RevisionView place={pageHistoryPlace(page)} revision={revision} raw={view.raw} />;
  }
  return <PageView page={page} action={query.action} notice={query.notice} />;
}
