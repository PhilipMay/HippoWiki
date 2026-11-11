import Breadcrumbs from "@mui/material/Breadcrumbs";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import { folderPath, foldersPath } from "@/lib/addresses";

type PageBreadcrumbsProps = {
  folderName: string;
  pageName: string;
};

/** The way to a page: the folder list, the page's folder and the page name with `.md`, as in its address. */
export default function PageBreadcrumbs({ folderName, pageName }: PageBreadcrumbsProps) {
  return (
    <Breadcrumbs aria-label="Breadcrumb" sx={{ overflowWrap: "anywhere" }}>
      <MuiLink component={Link} href={foldersPath()} underline="hover" color="inherit">
        Folders
      </MuiLink>
      <MuiLink component={Link} href={folderPath(folderName)} underline="hover" color="inherit">
        {folderName}
      </MuiLink>
      <Typography aria-current="page" sx={{ color: "text.primary" }}>
        {pageName}.md
      </Typography>
    </Breadcrumbs>
  );
}
