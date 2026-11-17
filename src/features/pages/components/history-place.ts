// Where the history of a page lives, so that the views of the history serve the page address and, later, the address
// of a deleted page alike: the components build no addresses themselves.

import type { PageWithPlace } from "@/features/pages/service";
import { pageComparePath, pageHistoryPath, pagePath, pageRevisionPath } from "@/lib/addresses";

/** The place of the history of a page: its breadcrumb and the addresses its views link to. */
export type HistoryPlace = {
  folderName: string;
  /** The tab of the page, or `null` for a page placed directly in its folder and for a deleted page. */
  tabName: string | null;
  /** Whether the page is deleted: its breadcrumb leads through the deleted pages of its folder. */
  deleted: boolean;
  /** The page as its breadcrumb names it: its name with `.md`, or without it for a deleted page. */
  pageLabel: string;
  /** The address of the page as it is now, or of the deleted page. */
  pageHref: string;
  /** The address of the history, with the revisions before the given number, or the newest ones without it. */
  historyHref: (before?: number) => string;
  /** The address of a revision, rendered or, with `raw`, as its Markdown source. */
  revisionHref: (revision: number, raw?: boolean) => string;
  /** The address of the comparison of two revisions. */
  compareHref: (from: number, to: number) => string;
};

/** The place of the history of a page that is not deleted: its page address. */
export function pageHistoryPlace(page: PageWithPlace): HistoryPlace {
  const folder = page.folder.name;
  const tab = page.tab?.name ?? null;
  return {
    folderName: folder,
    tabName: tab,
    deleted: false,
    pageLabel: `${page.name}.md`,
    pageHref: pagePath(folder, tab, page.name),
    historyHref: (before) => pageHistoryPath(folder, tab, page.name, before),
    revisionHref: (revision, raw) => pageRevisionPath(folder, tab, page.name, revision, raw),
    compareHref: (from, to) => pageComparePath(folder, tab, page.name, from, to),
  };
}
