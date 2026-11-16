import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { revokeToken } from "@/features/tokens/actions";
import RevokeTokenDialog from "@/features/tokens/components/RevokeTokenDialog";
import TokenList from "@/features/tokens/components/TokenList";
import { listTokens } from "@/features/tokens/queries";
import { accountPath, parseAction, parseChoice, parseView } from "@/lib/addresses";
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

/** The actions of the account: `revoke` opens the "Revoke app" dialog. */
const ACTIONS = ["revoke"] as const;

/**
 * The own account of the logged-in user: the user name and the apps the user connected through OAuth.
 * `?action=revoke` needs the parameter `app` with the id of one of the user's apps; every other address with an app,
 * the parameter `token`, an unknown action or a view is not found. An admin has no apps, and while
 * `HIPPOWIKI_PUBLIC_URL` is not set no app can connect or be used: then the account shows the user name only, and
 * every action is not found.
 */
export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  const user = await requireUser();
  const apps = await listTokens();
  // The time of the request, to mark expired apps. The page is rendered on demand, so it is the time of the request.
  const now = new Date();

  const query = await searchParams;
  const action = parseAction(query, ACTIONS);
  // The account has no views, and the parameter of the revoke dialog is `app`.
  if (action === "invalid" || parseView(query) !== null || query.token !== undefined) notFound();

  // `null` for an admin and while OAuth is off.
  if (!apps) {
    if (action !== null || query.app !== undefined) notFound();
    return <AccountHeading name={user.name} />;
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
      <AccountHeading name={user.name} />
      <Typography variant="h5" component="h2">
        Connected apps
      </Typography>
      <TokenList apps={apps} now={now} />
      {appToRevoke && (
        <RevokeTokenDialog
          action={revokeToken.bind(null, appToRevoke.id)}
          appName={appToRevoke.name}
          closeHref={accountPath()}
        />
      )}
    </Stack>
  );
}
