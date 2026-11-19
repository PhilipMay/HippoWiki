import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import NoticeAlert from "@/components/NoticeAlert";
import { changeOwnPassword, logOutOtherBrowsers } from "@/features/auth/actions";
import ChangeOwnPasswordDialog from "@/features/auth/components/ChangeOwnPasswordDialog";
import LogOutOtherBrowsersDialog from "@/features/auth/components/LogOutOtherBrowsersDialog";
import { requireUser } from "@/features/auth/session";
import { revokeGrant } from "@/features/grants/actions";
import RevokeAppDialog from "@/features/grants/components/RevokeAppDialog";
import ConnectedAppList from "@/features/grants/components/ConnectedAppList";
import { listGrants } from "@/features/grants/queries";
import {
  accountPath,
  parseAccountNotice,
  parseAction,
  parseChoice,
  parseView,
  type AccountNotice,
} from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Account"),
};

/** The heading of the account: the user name. */
function AccountHeading({ name }: { name: string }) {
  return (
    <Stack spacing={1}>
      <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
        {name}
      </Typography>
      <Typography color="text.secondary">Your account</Typography>
    </Stack>
  );
}

/** What each notice of the account reports, and whether it asks the user to do something. */
const NOTICES: Record<AccountNotice, { message: string; severity: "success" | "warning" }> = {
  "password-changed": {
    message: "Your password was changed, and your other browsers were logged out.",
    severity: "success",
  },
  "password-changed-apps-disconnected": {
    message: "Your password was changed, your other browsers were logged out, and all your apps were disconnected.",
    severity: "success",
  },
  "password-changed-apps-not-disconnected": {
    message:
      "Your password was changed and your other browsers were logged out, but your apps could not be disconnected. " +
      "Please revoke them in the list below.",
    severity: "warning",
  },
  "other-browsers-logged-out": {
    message: "Your other browsers were logged out.",
    severity: "success",
  },
};

/** The buttons of the account that every account has: they open the dialogs of the account. */
function AccountButtons() {
  return (
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
      <Button component={Link} href={accountPath("change-password")} variant="outlined">
        Change password
      </Button>
      <Button component={Link} href={accountPath("log-out-others")} variant="outlined">
        Log out other browsers
      </Button>
    </Stack>
  );
}

/**
 * The actions of the account: `revoke` opens the "Revoke app" dialog, `change-password` the "Change password" dialog
 * and `log-out-others` the "Log out other browsers" dialog.
 */
const ACTIONS = ["revoke", "change-password", "log-out-others"] as const;

/**
 * The own account of the logged-in user: the user name, the buttons "Change password" and "Log out other browsers",
 * and the apps the user connected through OAuth. `?action=change-password` opens the dialog of the password change
 * and `?action=log-out-others` the one that ends the other sessions, for every account; a user with apps can choose in
 * the first to disconnect them all.
 * `?action=revoke` needs the parameter `app` with the id of one of the user's apps; every other address with an app,
 * the parameter `token`, an unknown action or a view is not found. `?notice=<notice>` reports what an action did, only
 * without an action. An admin has no apps, and while `HIPPOWIKI_PUBLIC_URL` is not set no app can connect or be used:
 * then the account shows no list of apps, and `revoke` and `app` are not found.
 */
export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  const user = await requireUser();
  const apps = await listGrants();
  // The time of the request, to mark expired apps. The page is rendered on demand, so it is the time of the request.
  const now = new Date();

  const query = await searchParams;
  const action = parseAction(query, ACTIONS);
  const notice = parseAccountNotice(query);
  // The account has no views, and the parameter of the revoke dialog is `app`.
  if (action === "invalid" || notice === "invalid" || parseView(query) !== null || query.token !== undefined) {
    notFound();
  }

  const top = (
    <>
      <AccountHeading name={user.name} />
      {notice && (
        <NoticeAlert param="notice" severity={NOTICES[notice].severity}>
          {NOTICES[notice].message}
        </NoticeAlert>
      )}
      <AccountButtons />
      {action === "change-password" && (
        <ChangeOwnPasswordDialog
          action={changeOwnPassword}
          closeHref={accountPath()}
          // The list the page reads anyway: `null` for an admin and while OAuth is off.
          offerDisconnectApps={(apps?.length ?? 0) > 0}
        />
      )}
      {action === "log-out-others" && (
        <LogOutOtherBrowsersDialog action={logOutOtherBrowsers} closeHref={accountPath()} />
      )}
    </>
  );

  // `null` for an admin and while OAuth is off.
  if (!apps) {
    if (action === "revoke" || query.app !== undefined) notFound();
    return <Stack spacing={3}>{top}</Stack>;
  }
  // Only the user's own apps can be chosen; a malformed id, an unknown one and another user's app are not found.
  const appId = parseChoice(
    query,
    "app",
    apps.map((app) => app.id),
  );
  if (appId === "invalid" || (appId === null) !== (action !== "revoke")) notFound();
  const appToRevoke = apps.find((app) => app.id === appId);

  return (
    <Stack spacing={3}>
      {top}
      <Typography variant="h5" component="h2">
        Connected apps
      </Typography>
      <ConnectedAppList apps={apps} now={now} />
      {appToRevoke && (
        <RevokeAppDialog
          action={revokeGrant.bind(null, appToRevoke.id)}
          appName={appToRevoke.name}
          closeHref={accountPath()}
        />
      )}
    </Stack>
  );
}
