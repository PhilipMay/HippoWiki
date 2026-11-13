import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import type { TokenSummary } from "@/features/tokens/service";
import { revokeTokenPath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

/** A point in time as a `<time>` element. */
function Time({ date }: { date: Date }) {
  return <time dateTime={date.toISOString()}>{formatDateTime(date)}</time>;
}

type TokenListProps = {
  /** The tokens of the logged-in user, newest first. */
  tokens: TokenSummary[];
  /** The time of the request, to tell expired tokens from the others. */
  now: Date;
};

/**
 * The API tokens of the logged-in user, newest first: each with its scopes, when it was created, when it expires or
 * that it has expired, and when it was last used, with a link that opens the "Revoke token" dialog. A grant to an
 * OAuth client is in the same list, marked as a connected app and named after the app. Without tokens it says so.
 */
export default function TokenList({ tokens, now }: TokenListProps) {
  if (tokens.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography color="text.secondary">
          You have no API tokens and no connected apps yet. Create a token for a script or a tool, such as an MCP
          client.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="API tokens">
        {tokens.map((token, index) => {
          const expired = token.expiresAt.getTime() <= now.getTime();
          return (
            <ListItem
              key={token.id}
              divider={index < tokens.length - 1}
              secondaryAction={
                <Button
                  component={Link}
                  href={revokeTokenPath(token.id)}
                  color="error"
                  aria-label={`Revoke ${token.name}`}
                >
                  Revoke
                </Button>
              }
              sx={{ pr: 14 }}
            >
              <ListItemText
                disableTypography
                primary={
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Typography sx={{ overflowWrap: "anywhere" }}>{token.name}</Typography>
                    {token.isGrant && <Chip label="Connected app" size="small" color="primary" variant="outlined" />}
                    {token.scopes.map((scope) => (
                      <Chip key={scope} label={scope} size="small" variant="outlined" />
                    ))}
                    {expired && <Chip label="Expired" size="small" color="warning" />}
                  </Stack>
                }
                secondary={
                  <Typography variant="body2" color="text.secondary">
                    {token.isGrant ? "Connected" : "Created"} <Time date={token.createdAt} />
                    {" · "}
                    {expired ? (
                      <>
                        Expired <Time date={token.expiresAt} />
                      </>
                    ) : (
                      <>
                        Expires <Time date={token.expiresAt} />
                      </>
                    )}
                    {" · "}
                    Last used {token.lastUsedAt ? <Time date={token.lastUsedAt} /> : "never"}
                  </Typography>
                }
              />
            </ListItem>
          );
        })}
      </List>
    </Paper>
  );
}
