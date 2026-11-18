import AppBar from "@mui/material/AppBar";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import { logOut } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { isAdmin } from "@/features/users/user-type";
import { accountPath, folderRolesOverviewPath, foldersPath, homePath, usersPath } from "@/lib/addresses";
import { siteName } from "@/lib/site";

/**
 * The app bar of every page. For a logged-in user it has the menu, the user name, which links to the own account, and
 * "Log out"; while the user still has to change the first password, only the name as plain text and "Log out". Every
 * account has the menu entry "Users"; only a user has "Folders", because an admin sees no content, and only an admin has
 * "Folder roles", the overview of who has which role on which folder.
 */
export default async function AppHeader() {
  const user = await getCurrentUser();

  return (
    <AppBar position="static" elevation={0}>
      <Toolbar sx={{ gap: 3 }}>
        <Typography
          variant="h6"
          component={Link}
          href={homePath()}
          sx={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
        >
          {siteName}
        </Typography>
        {/* No menu while the first password is still to change: every address of it leads to the password change. */}
        {user && !user.mustChangePassword && (
          <nav aria-label="Main">
            {/* An admin sees no content: for an admin every address of it is not found. */}
            {!isAdmin(user) && (
              <Button component={Link} href={foldersPath()} color="inherit">
                Folders
              </Button>
            )}
            <Button component={Link} href={usersPath()} color="inherit">
              Users
            </Button>
            {/* Only an admin sees which users have which role on which folder. */}
            {isAdmin(user) && (
              <Button component={Link} href={folderRolesOverviewPath()} color="inherit">
                Folder roles
              </Button>
            )}
          </nav>
        )}
        {user && (
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", ml: "auto" }}>
            {/* While the first password is still to change, the account would only lead to the password change. */}
            {user.mustChangePassword ? (
              <Typography variant="body2">{user.name}</Typography>
            ) : (
              <Button component={Link} href={accountPath()} color="inherit" sx={{ textTransform: "none" }}>
                {user.name}
              </Button>
            )}
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
