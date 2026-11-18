import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import EmptyState from "@/components/EmptyState";
import Link from "@/components/Link";
import Time from "@/components/Time";
import { ROLE_LABELS } from "@/features/folder-roles/roles";
import type { GrantSummary } from "@/features/grants/service";
import { revokeAppPath } from "@/lib/addresses";

type ConnectedAppListProps = {
  /** The connected apps of the logged-in user, newest first. */
  apps: GrantSummary[];
  /** The time of the request, to tell expired apps from the others. */
  now: Date;
};

/**
 * The connected apps of the logged-in user, newest first: each with its name, the folder and the role of the MCP
 * address it is connected to, when it was connected, when it expires or that it has expired, and when it was last
 * used, with a link that opens the "Revoke app" dialog. One app connected to two addresses is two entries. Without apps it
 * says so in one short sentence; how to connect one is in the README.
 */
export default function ConnectedAppList({ apps, now }: ConnectedAppListProps) {
  if (apps.length === 0) {
    return <EmptyState text="No app is connected yet." />;
  }

  return (
    <Paper variant="outlined">
      <List disablePadding aria-label="Connected apps">
        {apps.map((app, index) => {
          const expired = app.expiresAt.getTime() <= now.getTime();
          const role = ROLE_LABELS[app.role];
          return (
            <ListItem
              key={app.id}
              divider={index < apps.length - 1}
              secondaryAction={
                <Button
                  component={Link}
                  href={revokeAppPath(app.id)}
                  color="error"
                  aria-label={`Revoke ${app.name} on ${app.folderName} as ${role}`}
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
                    <Typography sx={{ overflowWrap: "anywhere" }}>{app.name}</Typography>
                    {expired && <Chip label="Expired" size="small" color="warning" />}
                  </Stack>
                }
                secondary={
                  <Stack spacing={0.5}>
                    <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                      Folder <strong>{app.folderName}</strong>
                      {" · "}
                      Role <strong>{role}</strong>
                    </Typography>
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
                  </Stack>
                }
              />
            </ListItem>
          );
        })}
      </List>
    </Paper>
  );
}
