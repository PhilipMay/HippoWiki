import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import EmptyState from "@/components/EmptyState";
import Link from "@/components/Link";
import Time from "@/components/Time";
import type { ExcerptPart } from "@/features/search/excerpt";
import { SEARCH_MAX_RESULTS } from "@/features/search/limits";
import type { SearchResult } from "@/features/search/service";
import { editorWithChannel } from "@/features/users/records";
import { pageLabel, pagePath } from "@/lib/addresses";

/** The one line on the syntax of the search words, shown when a search finds nothing. */
const SEARCH_SYNTAX_HINT =
  "All words must match. Put words in quotes for a phrase, write -word to leave out the pages with a word, and or between two words to find either.";

type SearchResultListProps = {
  /** The results of the search, in the order of the best match. */
  results: SearchResult[];
  /** Whether more pages match than the list shows. */
  more: boolean;
  folderName: string;
  /** The words of the search as typed, for the message when nothing matches. */
  words: string;
};

/**
 * The piece of text of a result: plain text, with the matched words in `mark` elements. The parts are React text,
 * never HTML, so text of the page that looks like markup is shown as it is.
 */
function Excerpt({ parts }: { parts: ExcerptPart[] }) {
  return (
    <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
      {parts.map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : part.text))}
    </Typography>
  );
}

/**
 * The results of a search as one list, in the order of the service: each with its title linking to the page, its name
 * and tab, the piece of its text around the match and its last update. When more pages match, a line says so; when
 * none match, a message with the words and a hint on the syntax.
 */
export default function SearchResultList({ results, more, folderName, words }: SearchResultListProps) {
  if (results.length === 0) {
    return <EmptyState title={`No pages in this folder match ${words}`} text={SEARCH_SYNTAX_HINT} />;
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined">
        <List disablePadding aria-label="Search results">
          {results.map((result, index) => (
            <ListItem key={result.id} divider={index < results.length - 1} sx={{ display: "block", py: 1.5 }}>
              <Stack spacing={0.5}>
                <MuiLink
                  component={Link}
                  href={pagePath(folderName, result.tab?.name ?? null, result.name)}
                  variant="subtitle1"
                  sx={{ overflowWrap: "anywhere" }}
                >
                  {result.title}
                </MuiLink>
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                  {/* A page placed directly in the folder has no tab. */}
                  {result.tab === null ? pageLabel(result.name) : `${result.tab.name} / ${pageLabel(result.name)}`}
                </Typography>
                {result.excerpt.length > 0 && <Excerpt parts={result.excerpt} />}
                <Typography variant="body2" color="text.secondary">
                  Updated <Time date={result.updatedAt} /> by {editorWithChannel(result.lastEditedBy)}
                </Typography>
              </Stack>
            </ListItem>
          ))}
        </List>
      </Paper>
      {more && (
        <Typography color="text.secondary">
          More than {SEARCH_MAX_RESULTS} pages match. Use more precise words to find fewer pages.
        </Typography>
      )}
    </Stack>
  );
}
