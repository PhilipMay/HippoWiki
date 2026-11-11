import Breadcrumbs from "@mui/material/Breadcrumbs";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import { folderPath, foldersPath, tabPath } from "@/lib/addresses";

type FolderBreadcrumbsProps = {
  folderName: string;
  /** Name of the tab to link to between the folder and the current entry, or `null` for none. */
  tabName?: string | null;
  /** The entry that is shown, e.g. a tab name, "All pages" or a page name with `.md`. */
  current: string;
};

/**
 * The way back from an entry of a folder: links to the folder list, the folder and the tab if one is given, followed by
 * the current entry as text. Shown on tab addresses, the list of all pages and page addresses.
 */
export default function FolderBreadcrumbs({ folderName, tabName = null, current }: FolderBreadcrumbsProps) {
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
      <Typography aria-current="page" sx={{ color: "text.primary" }}>
        {current}
      </Typography>
    </Breadcrumbs>
  );
}
