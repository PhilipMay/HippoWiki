import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import HistoryBreadcrumbs from "@/features/pages/components/HistoryBreadcrumbs";
import MarkdownContent from "@/features/pages/components/MarkdownContent";
import type { HistoryPlace } from "@/features/pages/components/history-place";
import type { RevisionDetail } from "@/features/pages/service";
import { editorWithChannel } from "@/features/users/records";
import { formatDateTime } from "@/lib/format";

type RevisionViewProps = {
  /** Where the page lives, for the breadcrumb and the links. */
  place: HistoryPlace;
  revision: RevisionDetail;
  /** Whether the address asks for the Markdown source instead of the rendered content. */
  raw: boolean;
};

/**
 * One revision of a page: the revision line with its number, time, user and channel, for an old revision a notice with
 * a link to the current page, the switch "Rendered | Raw", which is part of the address, and the content in the chosen
 * form.
 */
export default function RevisionView({ place, revision, raw }: RevisionViewProps) {
  const forms = [
    { label: "Rendered", href: place.revisionHref(revision.number), current: !raw },
    { label: "Raw", href: place.revisionHref(revision.number, true), current: raw },
  ];

  return (
    <Stack spacing={2}>
      <HistoryBreadcrumbs place={place} current={`Revision ${revision.number}`} />
      <Paper component="article" variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
        <Stack spacing={2} sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            Revision {revision.number} of {revision.newest} ·{" "}
            <time dateTime={revision.createdAt.toISOString()}>{formatDateTime(revision.createdAt)}</time> by{" "}
            {editorWithChannel(revision.madeBy)}
            {revision.revertedTo !== null && ` · Reverted to revision ${revision.revertedTo}`}
          </Typography>
          {revision.number !== revision.newest && (
            <Alert severity="info">
              This is an old revision of the page.{" "}
              <MuiLink component={Link} href={place.pageHref}>
                {place.deleted ? "Show the deleted page" : "Show the current page"}
              </MuiLink>
            </Alert>
          )}
          {/* The actions on the revision join the switch here and wrap on narrow screens. */}
          <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 2, alignItems: "center" }}>
            <Stack component="nav" aria-label="Form of the revision" direction="row" spacing={1}>
              {forms.map(({ label, href, current }) => (
                <Button
                  key={label}
                  component={Link}
                  href={href}
                  variant={current ? "contained" : "outlined"}
                  aria-current={current ? "page" : undefined}
                >
                  {label}
                </Button>
              ))}
            </Stack>
          </Stack>
        </Stack>
        <Divider sx={{ mb: 3 }} />
        {raw ? (
          <Box
            component="pre"
            aria-label="Markdown source"
            sx={{ m: 0, fontFamily: "monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {revision.content}
          </Box>
        ) : (
          <MarkdownContent>{revision.content}</MarkdownContent>
        )}
      </Paper>
    </Stack>
  );
}
