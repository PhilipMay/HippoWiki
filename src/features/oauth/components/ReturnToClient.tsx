import Alert from "@mui/material/Alert";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";

type ReturnToClientProps = {
  /** The redirect address of the app with the answer to its request. */
  redirectTo: string;
  /** What is shown of that address: its host, or the scheme of a native app. */
  target: string;
  /** Why the request cannot be answered, as the wiki tells the app. */
  description: string;
};

/**
 * Shows why the request of an app cannot be answered, with a link back to the app that carries the error. The browser
 * goes there only when the user clicks: anyone can register a client with any redirect address, so going there by
 * itself would make the wiki an open redirect. The link works without JavaScript.
 */
export default function ReturnToClient({ redirectTo, target, description }: ReturnToClientProps) {
  return (
    <Stack spacing={2}>
      <Alert severity="error" sx={{ overflowWrap: "anywhere" }}>
        The request of the app cannot be answered: {description}.
      </Alert>
      {/* A plain link, not the router's: the address is on another site. */}
      <MuiLink href={redirectTo} sx={{ overflowWrap: "anywhere" }}>
        Return to {target}
      </MuiLink>
    </Stack>
  );
}
