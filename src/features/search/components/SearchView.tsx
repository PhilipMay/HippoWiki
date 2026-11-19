import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import SearchResultList from "@/features/search/components/SearchResultList";
import { SEARCH_MAX_CHARACTERS, SEARCH_MAX_WORDS } from "@/features/search/limits";
import { searchPages } from "@/features/search/queries";
import type { SearchError } from "@/features/search/service";

/** The message of a search that returned no results for a reason of its own; `null` for words that find nothing. */
function messageOf(error: SearchError): string | null {
  switch (error.code) {
    case "too-long":
      return `Search at most ${SEARCH_MAX_CHARACTERS} characters and ${SEARCH_MAX_WORDS} words`;
    case "too-broad":
      return "This search is too broad and took too long. Use more precise words.";
    case "busy":
      return "Too many searches are running. Try again in a few seconds.";
    // Words without a letter or a digit, such as `---`, find nothing.
    case "no-words":
      return null;
  }
}

/**
 * The folder view "Search": the results of the search of the whole folder for the words, as typed, or why there are
 * none. A search that is too long, too broad or refused as busy shows its message at the top of the view.
 */
export default async function SearchView({ folder, words }: { folder: { id: string; name: string }; words: string }) {
  const found = (await searchPages(folder.id, words)) ?? notFound();
  const message = found.ok ? null : messageOf(found.error);

  return (
    <Stack spacing={3}>
      {message !== null && <Alert severity="warning">{message}</Alert>}
      <FolderBreadcrumbs folderName={folder.name} current="Search" />
      <Typography variant="h4" component="h1">
        Search
      </Typography>
      {message === null && (
        <SearchResultList
          results={found.ok ? found.value.results : []}
          more={found.ok && found.value.more}
          folderName={folder.name}
          words={words}
        />
      )}
    </Stack>
  );
}
