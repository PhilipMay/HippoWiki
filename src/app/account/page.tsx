import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/Link";
import { requireUser } from "@/features/auth/session";
import { createToken, revokeToken } from "@/features/tokens/actions";
import CreateTokenDialog from "@/features/tokens/components/CreateTokenDialog";
import RevokeTokenDialog from "@/features/tokens/components/RevokeTokenDialog";
import TokenList from "@/features/tokens/components/TokenList";
import { listTokens } from "@/features/tokens/queries";
import { accountPath, parseAction, parseChoice, parseView } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Account"),
};

/** The actions of the account: `create` opens the "New token" dialog, `revoke` the "Revoke token" dialog. */
const ACTIONS = ["create", "revoke"] as const;

/**
 * The own account of the logged-in user: the user name and the user's API tokens. `?action=revoke` needs the parameter
 * `token` with the id of one of the user's tokens; every other address with a token, an unknown action or a view is
 * not found.
 */
export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  const user = await requireUser();
  const tokens = await listTokens();
  // The time of the request, to mark expired tokens. The page is rendered on demand, so it is the time of the request.
  const now = new Date();

  const query = await searchParams;
  const action = parseAction(query, ACTIONS);
  // The account has no views.
  if (action === "invalid" || parseView(query) !== null) notFound();
  // Only the user's own tokens can be chosen; a malformed id, an unknown one and another user's token are not found.
  const tokenId = parseChoice(
    query,
    "token",
    tokens.map((token) => token.id),
  );
  if (tokenId === "invalid" || (tokenId === null) !== (action !== "revoke")) notFound();
  const tokenToRevoke = tokens.find((token) => token.id === tokenId);

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
          {user.name}
        </Typography>
        <Typography color="text.secondary">Your account</Typography>
      </Stack>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h5" component="h2">
          API tokens
        </Typography>
        <Button component={Link} href={accountPath("create")} variant="contained">
          New token
        </Button>
      </Stack>
      <Typography color="text.secondary">
        A token lets a script or a tool, such as an MCP client, act as you, limited to its scopes, until it expires or
        you revoke it.
      </Typography>
      <TokenList tokens={tokens} now={now} />
      {action === "create" && <CreateTokenDialog action={createToken} closeHref={accountPath()} />}
      {tokenToRevoke && (
        <RevokeTokenDialog
          action={revokeToken.bind(null, tokenToRevoke.id)}
          tokenName={tokenToRevoke.name}
          closeHref={accountPath()}
        />
      )}
    </Stack>
  );
}
