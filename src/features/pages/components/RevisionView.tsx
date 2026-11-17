import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";

import Link from "@/components/Link";
import HistoryBreadcrumbs from "@/features/pages/components/HistoryBreadcrumbs";
import MarkdownContent from "@/features/pages/components/MarkdownContent";
import RevisionLine from "@/features/pages/components/RevisionLine";
import type { HistoryPlace } from "@/features/pages/components/history-place";
import type { RevisionDetail } from "@/features/pages/service";

type RevisionViewProps = {
  /** Where the page lives, for the breadcrumb and the links. */
  place: HistoryPlace;
  revision: RevisionDetail;
  /** Whether the address asks for the Markdown source instead of the rendered content. */
  raw: boolean;
};

/**
 * "Compare" on a revision: a form that works without JavaScript, with a number field "Compare with revision", preset
 * to the revision right before the open one and limited to the earlier ones, that leads to the comparison of the
 * chosen revision with the open one. A number field instead of a list keeps the view fast for pages with thousands of
 * revisions.
 */
function CompareForm({ place, number }: { place: HistoryPlace; number: number }) {
  return (
    <Stack
      component="form"
      action={place.pageHref}
      method="get"
      direction="row"
      useFlexGap
      sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}
    >
      <input type="hidden" name="view" value="compare" />
      <TextField
        name="from"
        type="number"
        label="Compare with revision"
        defaultValue={number - 1}
        required
        size="small"
        slotProps={{ htmlInput: { min: 1, max: number - 1, step: 1 } }}
        sx={{ width: "13rem" }}
      />
      <input type="hidden" name="to" value={number} />
      <Button type="submit" variant="outlined">
        Compare
      </Button>
    </Stack>
  );
}

/**
 * One revision of a page: the revision line with its number, time, user and channel, for an old revision a notice with
 * a link to the current page, the switch "Rendered | Raw", which is part of the address, "Compare" for every revision
 * but the first, and the content in the chosen form.
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
          <RevisionLine revision={revision} newest={revision.newest} />
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
            {/* The first revision has no earlier one to compare with. */}
            {revision.number > 1 && <CompareForm place={place} number={revision.number} />}
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
