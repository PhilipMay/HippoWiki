import AppBar from "@mui/material/AppBar";
import Button from "@mui/material/Button";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import { foldersPath } from "@/lib/addresses";
import { siteName } from "@/lib/site";

export default function AppHeader() {
  return (
    <AppBar position="static" elevation={0}>
      <Toolbar sx={{ gap: 3 }}>
        <Typography
          variant="h6"
          component={Link}
          href="/"
          sx={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
        >
          {siteName}
        </Typography>
        <nav aria-label="Main">
          <Button component={Link} href="/pages" color="inherit">
            Pages
          </Button>
          <Button component={Link} href={foldersPath()} color="inherit">
            Folders
          </Button>
        </nav>
      </Toolbar>
    </AppBar>
  );
}
