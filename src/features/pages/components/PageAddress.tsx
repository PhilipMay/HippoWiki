import { notFound } from "next/navigation";

import { mayDo } from "@/features/folder-roles/roles";
import { revertPage } from "@/features/pages/actions";
import PageHistory from "@/features/pages/components/PageHistory";
import RevisionComparison from "@/features/pages/components/RevisionComparison";
import RevertPageDialog from "@/features/pages/components/RevertPageDialog";
import RevisionView from "@/features/pages/components/RevisionView";
import PageView, { changedMessage, type PageQuery } from "@/features/pages/components/PageView";
import { pageHistoryPlace } from "@/features/pages/components/history-place";
import { getPageRevision, getRevisionComparison, listPageRevisions } from "@/features/pages/queries";
import type { PageWithPlace } from "@/features/pages/service";
import { editorWithChannel } from "@/features/users/records";
import { pageRevertPath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

type PageAddressProps = {
  page: PageWithPlace;
  /** What the query string asks for, already checked with `parsePageQuery()` and against the role. */
  query: PageQuery;
};

/**
 * What a page address shows, for pages placed directly in a folder and for pages in a tab: the view the query string
 * asks for, such as the history of the page, or the page itself with its action. A view with a revision the page does
 * not have shows the not-found page, and so does the "Revert page" dialog of a revision whose content is the content of
 * the page now, the newest one included: a revert to it would change nothing.
 */
export default async function PageAddress({ page, query }: PageAddressProps) {
  const { view } = query;
  if (view?.name === "history") {
    const history = (await listPageRevisions(page.id, { before: view.before })) ?? notFound();
    // The history starts at most at the newest revision; a later one is no page of it.
    if (view.before !== null && view.before > history.newest) notFound();
    return <PageHistory place={pageHistoryPlace(page)} title={page.title} history={history} before={view.before} />;
  }
  const folderName = page.folder.name;
  const tabName = page.tab?.name ?? null;
  // The revision of the view, or the one of the "Revert page" dialog, which is shown over it.
  const revisionNumber = view?.name === "revision" ? view.revision : query.revision;
  if (revisionNumber !== null) {
    const revision = (await getPageRevision(page.id, revisionNumber)) ?? notFound();
    // The action has been checked against the role; "Revert" is offered only where it would change the content.
    const mayRevert = mayDo(page.role, "editPage") && !revision.isCurrent;
    const revertHref = pageRevertPath(folderName, tabName, page.name, revision.number);
    if (query.action === "revert" && !mayRevert) notFound();
    return (
      <RevisionView
        place={pageHistoryPlace(page)}
        revision={revision}
        raw={view?.name === "revision" && view.raw}
        revertHref={mayRevert ? revertHref : null}
      >
        {query.action === "revert" && (
          <RevertPageDialog
            // A new key after a refused revert starts the dialog anew with the page as stored.
            key={`${page.version}-${query.notice ?? ""}`}
            action={revertPage.bind(null, page.id, revision.number)}
            revisionLabel={`revision ${revision.number} of ${formatDateTime(revision.createdAt)} by ${editorWithChannel(revision.madeBy)}`}
            version={page.version}
            changedMessage={query.notice === "changed" ? changedMessage(page) : undefined}
            closeHref={pageHistoryPlace(page).revisionHref(revision.number)}
          />
        )}
      </RevisionView>
    );
  }
  if (view?.name === "compare") {
    const comparison = (await getRevisionComparison(page.id, view.from, view.to)) ?? notFound();
    return <RevisionComparison place={pageHistoryPlace(page)} comparison={comparison} />;
  }
  return <PageView page={page} action={query.action} notice={query.notice} />;
}
