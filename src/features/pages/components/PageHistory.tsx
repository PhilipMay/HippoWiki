import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import HistoryBreadcrumbs from "@/features/pages/components/HistoryBreadcrumbs";
import type { HistoryPlace } from "@/features/pages/components/history-place";
import { REVISIONS_PER_PAGE } from "@/features/pages/limits";
import type { PageRevisions } from "@/features/pages/service";
import { editorWithChannel } from "@/features/users/records";
import { formatDateTime } from "@/lib/format";

type PageHistoryProps = {
  /** Where the page lives, for the breadcrumb and the links. */
  place: HistoryPlace;
  /** The title of the page as it is now. */
  title: string;
  /** The revisions to list, newest first, and the number of the newest revision of the page. */
  history: PageRevisions;
  /** The revision before which the list starts, from the address; `null` for the newest revisions. */
  before: number | null;
};

/**
 * The history of a page: its revisions newest first, at most `REVISIONS_PER_PAGE` at a time, each with its number as
 * a link to the revision, the time, the user and the channel, the title and, for a revision a revert recorded, the
 * revision it went back to. Links lead to the newer and the older revisions, where there are any.
 */
export default function PageHistory({ place, title, history, before }: PageHistoryProps) {
  const { newest, revisions } = history;
  const first = revisions[0]?.number;
  const last = revisions.at(-1)?.number;
  // The page of newer revisions starts `REVISIONS_PER_PAGE` after this one; without a revision before which to start,
  // it is the first page.
  const newerBefore = before === null ? null : before + REVISIONS_PER_PAGE;
  const newerHref =
    before === null ? null : place.historyHref(newerBefore !== null && newerBefore <= newest ? newerBefore : undefined);
  const olderHref = last !== undefined && last > 1 ? place.historyHref(last) : null;

  return (
    <Stack spacing={3}>
      <HistoryBreadcrumbs place={place} current="History" />
      <Stack spacing={1}>
        <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {first === undefined || last === undefined
            ? "No revisions"
            : `History: revisions ${first} to ${last} of ${newest}`}
        </Typography>
      </Stack>
      <Paper variant="outlined">
        <List disablePadding aria-label="Revisions">
          {revisions.map((revision, index) => (
            <ListItem key={revision.number} disablePadding divider={index < revisions.length - 1}>
              <ListItemButton component={Link} href={place.revisionHref(revision.number)}>
                <ListItemText
                  primary={`Revision ${revision.number}`}
                  secondary={
                    <>
                      <time dateTime={revision.createdAt.toISOString()}>{formatDateTime(revision.createdAt)}</time> by{" "}
                      {editorWithChannel(revision.madeBy)} · {revision.title}
                      {revision.revertedTo !== null && ` · Reverted to revision ${revision.revertedTo}`}
                    </>
                  }
                  slotProps={{ secondary: { sx: { overflowWrap: "anywhere" } } }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Paper>
      {(newerHref !== null || olderHref !== null) && (
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 2 }}>
          {newerHref !== null && (
            <Button component={Link} href={newerHref} variant="outlined">
              Newer revisions
            </Button>
          )}
          {olderHref !== null && (
            <Button component={Link} href={olderHref} variant="outlined">
              Older revisions
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}
