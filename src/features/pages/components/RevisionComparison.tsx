import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Link from "@/components/Link";
import HistoryBreadcrumbs from "@/features/pages/components/HistoryBreadcrumbs";
import RevisionLine from "@/features/pages/components/RevisionLine";
import type { HistoryPlace } from "@/features/pages/components/history-place";
import SearchField from "@/features/search/components/SearchField";
import { diffRevisions, type DiffLine } from "@/features/pages/diff";
import type { RevisionComparison as Comparison } from "@/features/pages/history-service";

type RevisionComparisonProps = {
  /** Where the page lives, for the breadcrumb and the links. */
  place: HistoryPlace;
  /** The two revisions, the older first. */
  comparison: Comparison;
};

/** The mark in front of a line, so that added and removed lines are told apart without their color. */
const MARKS: Record<DiffLine["kind"], string> = { added: "+", removed: "−", unchanged: " " };

/** The background of a line; the colors of the theme, faint enough for the text on them. */
const BACKGROUNDS: Record<DiffLine["kind"], string> = {
  added: "rgba(var(--mui-palette-success-mainChannel) / 0.14)",
  removed: "rgba(var(--mui-palette-error-mainChannel) / 0.14)",
  unchanged: "transparent",
};

/** What the accessibility tree says of a line besides its text. */
const LABELS: Record<DiffLine["kind"], string | undefined> = {
  added: "Added",
  removed: "Removed",
  unchanged: undefined,
};

/**
 * The comparison of two revisions of a page, from the older to the newer one: a heading that names both with links to
 * their views, their revision lines, and the Markdown lines of both in one column, the added and removed ones marked
 * by color and by a `+` or `−` in front. Equal content says "No differences", and revisions that differ too much to
 * be compared quickly say so instead of showing a diff.
 */
export default function RevisionComparison({ place, comparison }: RevisionComparisonProps) {
  const { older, newer, newest } = comparison;
  const diff = diffRevisions(older.content, newer.content);

  return (
    <Stack spacing={3}>
      {place.searchFolderName !== null && <SearchField folderName={place.searchFolderName} />}
      <HistoryBreadcrumbs place={place} current={`Revisions ${older.number} and ${newer.number}`} />
      <Stack spacing={1}>
        <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
          Changes from{" "}
          <MuiLink component={Link} href={place.revisionHref(older.number)}>
            revision {older.number}
          </MuiLink>{" "}
          to{" "}
          <MuiLink component={Link} href={place.revisionHref(newer.number)}>
            revision {newer.number}
          </MuiLink>
        </Typography>
        <RevisionLine revision={older} newest={newest} />
        <RevisionLine revision={newer} newest={newest} />
      </Stack>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        {diff.kind === "same" && <Typography>No differences</Typography>}
        {diff.kind === "too-different" && (
          <Typography>These revisions are too different to compare. Open each of them to see its content.</Typography>
        )}
        {diff.kind === "lines" && (
          <Box
            component="ol"
            aria-label="Changes"
            sx={{ m: 0, p: 0, listStyle: "none", fontFamily: "monospace", fontSize: "0.875rem" }}
          >
            {diff.lines.map((line, index) => (
              <Box
                component="li"
                key={index}
                aria-label={LABELS[line.kind] && `${LABELS[line.kind]}: ${line.text}`}
                data-change={line.kind}
                sx={{
                  display: "flex",
                  gap: 1,
                  px: 1,
                  backgroundColor: BACKGROUNDS[line.kind],
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                <Box component="span" sx={{ flex: "none", width: "1ch", userSelect: "none" }}>
                  {MARKS[line.kind]}
                </Box>
                {/* An empty line keeps its height. */}
                <Box component="span">{line.text === "" ? " " : line.text}</Box>
              </Box>
            ))}
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
