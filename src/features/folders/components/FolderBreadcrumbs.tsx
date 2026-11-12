import Breadcrumbs from "@mui/material/Breadcrumbs";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import { deletedPagesPath, folderPath, foldersPath, tabPath } from "@/lib/addresses";

type FolderBreadcrumbsProps = {
  folderName: string;
  /** Name of the tab to link to between the folder and the current entry, or `null` for none. */
  tabName?: string | null;
  /** Whether to link to the deleted pages of the folder between the folder and the current entry, for a deleted page. */
  deletedPages?: boolean;
  /** The entry that is shown, e.g. a tab name, "All pages" or a page name with `.md`. */
  current: string;
};

/**
 * The way back from an entry of a folder: links to the folder list, the folder and the tab or the deleted pages if
 * given, followed by the current entry as text. Shown on tab addresses, the lists of all pages and of deleted pages,
 * page addresses and deleted pages.
 */
export default function FolderBreadcrumbs({
  folderName,
  tabName = null,
  deletedPages = false,
  current,
}: FolderBreadcrumbsProps) {
  return (
    <Breadcrumbs aria-label="Breadcrumb" sx={{ overflowWrap: "anywhere" }}>
      <MuiLink component={Link} href={foldersPath()} underline="hover" color="inherit">
        Folders
      </MuiLink>
      <MuiLink component={Link} href={folderPath(folderName)} underline="hover" color="inherit">
        {folderName}
      </MuiLink>
      {tabName !== null && (
        <MuiLink component={Link} href={tabPath(folderName, tabName)} underline="hover" color="inherit">
          {tabName}
        </MuiLink>
      )}
      {deletedPages && (
        <MuiLink component={Link} href={deletedPagesPath(folderName)} underline="hover" color="inherit">
          Deleted pages
        </MuiLink>
      )}
      <Typography aria-current="page" sx={{ color: "text.primary" }}>
        {current}
      </Typography>
    </Breadcrumbs>
  );
}
