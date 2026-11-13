"use client";

import Alert from "@mui/material/Alert";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import { useEffect } from "react";

type ReturnToClientProps = {
  /** The redirect address of the app with the answer to its request. */
  redirectTo: string;
  /** What is shown of that address: its host, or the scheme of a native app. */
  target: string;
};

/**
 * Sends the browser back to the app with an answer that needs no decision of the user: an error in its request. The
 * address is opened once the page has loaded, and shown as a link for a browser without JavaScript.
 */
export default function ReturnToClient({ redirectTo, target }: ReturnToClientProps) {
  useEffect(() => {
    // `replace`, so that the back button does not lead here again and send the answer a second time.
    window.location.replace(redirectTo);
  }, [redirectTo]);

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        The request of the app cannot be answered. Returning to <strong>{target}</strong>…
      </Alert>
      {/* A plain link, not the router's: the address is on another site. */}
      <MuiLink href={redirectTo}>Continue to {target}</MuiLink>
    </Stack>
  );
}
