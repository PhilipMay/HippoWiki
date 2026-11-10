import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import { siteName } from "@/lib/site";

export default function AppHeader() {
  return (
    <AppBar position="static" elevation={0}>
      <Toolbar>
        <Typography
          variant="h6"
          component={Link}
          href="/"
          sx={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
        >
          {siteName}
        </Typography>
      </Toolbar>
    </AppBar>
  );
}
