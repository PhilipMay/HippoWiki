import AppBar from "@mui/material/AppBar";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import { logOut } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { foldersPath } from "@/lib/addresses";
import { siteName } from "@/lib/site";

/** The app bar of every page. For a logged-in user it has the menu, the user name and "Log out". */
export default async function AppHeader() {
  const user = await getCurrentUser();

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
        {user && (
          <nav aria-label="Main">
            <Button component={Link} href={foldersPath()} color="inherit">
              Folders
            </Button>
          </nav>
        )}
        {user && (
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", ml: "auto" }}>
            <Typography variant="body2">{user.name}</Typography>
            {/* A plain form with a Server Action: it works before hydration and without JavaScript. */}
            <form action={logOut}>
              <Button type="submit" color="inherit">
                Log out
              </Button>
            </form>
          </Stack>
        )}
      </Toolbar>
    </AppBar>
  );
}
