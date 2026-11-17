import Breadcrumbs from "@mui/material/Breadcrumbs";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import type { HistoryPlace } from "@/features/pages/components/history-place";
import { deletedPagesPath, folderPath, foldersPath, tabPath } from "@/lib/addresses";

type HistoryBreadcrumbsProps = {
  /** Where the page lives. */
  place: HistoryPlace;
  /** The entry that is shown: "History", or a revision or comparison, which then follow a link to the history. */
  current: string;
};

/**
 * The way back from the history of a page and its revisions: links to the folder list, the folder, the tab or the
 * deleted pages, the page itself and, below the history, to the history, followed by the current entry as text.
 */
export default function HistoryBreadcrumbs({ place, current }: HistoryBreadcrumbsProps) {
  const { folderName, tabName } = place;
  const links: { label: string; href: string }[] = [
    { label: "Folders", href: foldersPath() },
    { label: folderName, href: folderPath(folderName) },
    ...(tabName === null ? [] : [{ label: tabName, href: tabPath(folderName, tabName) }]),
    ...(place.deleted ? [{ label: "Deleted pages", href: deletedPagesPath(folderName) }] : []),
    { label: place.pageLabel, href: place.pageHref },
    ...(current === "History" ? [] : [{ label: "History", href: place.historyHref() }]),
  ];

  return (
    <Breadcrumbs aria-label="Breadcrumb" sx={{ overflowWrap: "anywhere" }}>
      {links.map(({ label, href }) => (
        <MuiLink key={href} component={Link} href={href} underline="hover" color="inherit">
          {label}
        </MuiLink>
      ))}
      <Typography aria-current="page" sx={{ color: "text.primary" }}>
        {current}
      </Typography>
    </Breadcrumbs>
  );
}
