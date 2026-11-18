import { notFound } from "next/navigation";

import { mayDo } from "@/features/folder-roles/roles";
import { revertPage } from "@/features/pages/actions";
import HistoryAddress from "@/features/pages/components/HistoryAddress";
import RevertPageDialog from "@/features/pages/components/RevertPageDialog";
import PageView, { changedMessage, type PageQuery } from "@/features/pages/components/PageView";
import { pageHistoryPlace } from "@/features/pages/components/history-place";
import type { RevisionDetail } from "@/features/pages/history-service";
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
 * What a page address shows, for pages placed directly in a folder and for pages in a tab: the view of the history the
 * query string asks for, the "Revert page" dialog over the view of its revision, or the page itself with its action.
 * "Revert" is offered to Writer and up on a revision whose content differs from the page now; the dialog of any other
 * revision, the newest one included, shows the not-found page: a revert to it would change nothing.
 */
export default async function PageAddress({ page, query }: PageAddressProps) {
  const place = pageHistoryPlace(page);
  const view =
    query.action === "revert" && query.revision !== null
      ? ({ name: "revision", revision: query.revision, raw: false } as const)
      : query.view;
  if (view === null) return <PageView page={page} action={query.action} notice={query.notice} />;

  const revert = (revision: RevisionDetail) => {
    // The action has been checked against the role.
    const mayRevert = mayDo(page.role, "editPage") && !revision.isCurrent;
    if (query.action === "revert" && !mayRevert) notFound();
    const href = mayRevert ? pageRevertPath(place.folderName, place.tabName, page.name, revision.number) : null;
    const dialog = query.action === "revert" && (
      <RevertPageDialog
        // A new key after a refused revert starts the dialog anew with the page as stored.
        key={`${page.version}-${query.notice ?? ""}`}
        action={revertPage.bind(null, page.id, revision.number)}
        revisionLabel={`revision ${revision.number} of ${formatDateTime(revision.createdAt)} by ${editorWithChannel(revision.madeBy)}`}
        version={page.version}
        changedMessage={query.notice === "changed" ? changedMessage(page) : undefined}
        closeHref={place.revisionHref(revision.number)}
      />
    );
    return { href, dialog };
  };

  return <HistoryAddress pageId={page.id} title={page.title} place={place} view={view} revert={revert} />;
}
