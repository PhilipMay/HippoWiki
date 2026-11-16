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
import { revokeAppPath } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

/** A point in time as a `<time>` element. */
function Time({ date }: { date: Date }) {
  return <time dateTime={date.toISOString()}>{formatDateTime(date)}</time>;
}

type TokenListProps = {
  /** The connected apps of the logged-in user, newest first. */
  apps: TokenSummary[];
  /** The time of the request, to tell expired apps from the others. */
  now: Date;
};

/**
 * The connected apps of the logged-in user, newest first: each with its name, when it was connected, when it expires
 * or that it has expired, and when it was last used, with a link that opens the "Revoke app" dialog. Without apps it
 * says so in one short sentence; how to connect one is in the README.
 */
export default function TokenList({ apps, now }: TokenListProps) {
  if (apps.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography color="text.secondary">No app is connected yet.</Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="Connected apps">
        {apps.map((app, index) => {
          const expired = app.expiresAt.getTime() <= now.getTime();
          return (
            <ListItem
              key={app.id}
              divider={index < apps.length - 1}
              secondaryAction={
                <Button component={Link} href={revokeAppPath(app.id)} color="error" aria-label={`Revoke ${app.name}`}>
                  Revoke
                </Button>
              }
              sx={{ pr: 14 }}
            >
              <ListItemText
                disableTypography
                primary={
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Typography sx={{ overflowWrap: "anywhere" }}>{app.name}</Typography>
                    {expired && <Chip label="Expired" size="small" color="warning" />}
                  </Stack>
                }
                secondary={
                  <Typography variant="body2" color="text.secondary">
                    Connected <Time date={app.createdAt} />
                    {" · "}
                    {expired ? (
                      <>
                        Expired <Time date={app.expiresAt} />
                      </>
                    ) : (
                      <>
                        Expires <Time date={app.expiresAt} />
                      </>
                    )}
                    {" · "}
                    Last used {app.lastUsedAt ? <Time date={app.lastUsedAt} /> : "never"}
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
