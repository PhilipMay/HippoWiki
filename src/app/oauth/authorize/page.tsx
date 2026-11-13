import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { approve, deny } from "@/features/oauth/actions";
import ConsentForm from "@/features/oauth/components/ConsentForm";
import ReturnToClient from "@/features/oauth/components/ReturnToClient";
import { authorizeAddress } from "@/features/oauth/forms";
import { loadConsent } from "@/features/oauth/queries";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Connect an app"),
};

/** Why a request cannot be answered and the browser is not sent anywhere. */
const UNTRUSTED_MESSAGES = {
  "invalid-client": "This app is not known to the wiki. Go back to the app and connect again.",
  "invalid-redirect-uri":
    "The address this app wants to be sent back to is not one of its own, so the request was stopped here.",
  failed: "The request could not be checked. Please try again.",
} as const;

/**
 * The consent page of OAuth, the authorization endpoint: a logged-in user approves or denies an app, such as the
 * connector of an AI assistant, that asks for access to the wiki. The parameters of the request are the search
 * parameters of the address, as OAuth defines them; the page has no actions and no views.
 */
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const query = await searchParams;
  // First, and with the address of this page as the way back: after the login the user is asked here again.
  await requireUser(authorizeAddress(query));

  const consent = await loadConsent(query);
  if (consent.kind === "not-found") notFound();

  return (
    <Stack spacing={3} sx={{ maxWidth: 560, mx: "auto" }}>
      <Typography variant="h4" component="h1">
        Connect an app
      </Typography>
      {consent.kind === "untrusted" && <Alert severity="error">{UNTRUSTED_MESSAGES[consent.reason]}</Alert>}
      {consent.kind === "refused" && <ReturnToClient redirectTo={consent.redirectTo} target={consent.target} />}
      {consent.kind === "consent" && (
        <>
          {/* Where the access goes is what the user can check; the name is whatever the app calls itself. */}
          <Typography variant="h6" component="p" sx={{ overflowWrap: "anywhere" }}>
            An app at <strong>{consent.target}</strong> asks for access to this wiki.
          </Typography>
          <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            It calls itself “{consent.clientName}”. The app chose this name itself; only approve if you started this
            from an app you trust and the address above is the one you expect.
          </Typography>
          <Typography>
            If you approve, the app acts as <strong>{consent.userName}</strong> and can read the wiki: list the folders,
            tabs and pages and read every page you can read. It cannot change anything. You can revoke the access on
            your account page at any time.
          </Typography>
          <ConsentForm
            params={consent.params}
            limitReached={consent.limitReached}
            approveAction={approve}
            denyAction={deny}
          />
        </>
      )}
    </Stack>
  );
}
