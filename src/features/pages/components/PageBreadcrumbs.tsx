import Breadcrumbs from "@mui/material/Breadcrumbs";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import { folderPath, foldersPath, tabPath } from "@/lib/addresses";

type PageBreadcrumbsProps = {
  folderName: string;
  /** Name of the page's tab, or `null` for a page placed directly in its folder. */
  tabName: string | null;
  pageName: string;
};

/**
 * The way to a page: the folder list, the page's folder, its tab if it has one, and the page name with `.md`, as in
 * its address.
 */
export default function PageBreadcrumbs({ folderName, tabName, pageName }: PageBreadcrumbsProps) {
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
        {pageName}.md
      </Typography>
    </Breadcrumbs>
  );
}
