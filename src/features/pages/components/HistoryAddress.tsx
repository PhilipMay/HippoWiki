import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import PageHistory from "@/features/pages/components/PageHistory";
import RevisionComparison from "@/features/pages/components/RevisionComparison";
import RevisionView from "@/features/pages/components/RevisionView";
import type { PageAddressView } from "@/features/pages/components/PageView";
import type { HistoryPlace } from "@/features/pages/components/history-place";
import { getPageRevision, getRevisionComparison, listPageRevisions } from "@/features/pages/queries";
import type { RevisionDetail } from "@/features/pages/history-service";

type HistoryAddressProps = {
  pageId: string;
  /** The title of the page as it is now. */
  title: string;
  /** Where the page lives: its page address or the address of the deleted page. */
  place: HistoryPlace;
  /** The view of the history, already checked with `parseHistoryView()`. */
  view: PageAddressView;
  /**
   * For the view of a revision: the address of its "Revert page" dialog, `null` where there is no "Revert", and a
   * dialog to show over it. Without it there is no "Revert", as for a deleted page.
   */
  revert?: (revision: RevisionDetail) => { href: string | null; dialog?: ReactNode };
};

/**
 * A view of the history of a page, for a page address and for the address of a deleted page: the list of revisions, a
 * revision or a comparison. The reads decide who may see them; a page without the role for its history, a revision
 * the page does not have and a `before` past the newest revision show the not-found page.
 */
export default async function HistoryAddress({ pageId, title, place, view, revert }: HistoryAddressProps) {
  switch (view.name) {
    case "history": {
      const history = (await listPageRevisions(pageId, { before: view.before })) ?? notFound();
      // The history starts at most at the newest revision; a later one is no page of it.
      if (view.before !== null && view.before > history.newest) notFound();
      return <PageHistory place={place} title={title} history={history} before={view.before} />;
    }
    case "revision": {
      const revision = (await getPageRevision(pageId, view.revision)) ?? notFound();
      const offered = revert?.(revision);
      return (
        <RevisionView place={place} revision={revision} raw={view.raw} revertHref={offered?.href ?? null}>
          {offered?.dialog}
        </RevisionView>
      );
    }
    case "compare": {
      const comparison = (await getRevisionComparison(pageId, view.from, view.to)) ?? notFound();
      return <RevisionComparison place={place} comparison={comparison} />;
    }
  }
}
