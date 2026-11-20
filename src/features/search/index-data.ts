// What a write of a page stores for search, next to its content: the search text, the language and the version of
// the code that derived them. The pages service, the test helpers and the seed store it with every content they
// write; the trigger of the database builds the vector and the words of the folder from it.

import { detectLanguage, type SearchLanguage } from "@/features/search/language";
import { pageText } from "@/features/search/text";

/**
 * The version of how the search text and the language of a page are derived. Count it up with every change of
 * `text.ts` or `language.ts` that changes what they derive, such as another database of the detector: the server then
 * derives every page whose stored version differs again before it serves.
 */
export const SEARCH_INDEX_VERSION = 2;

/** The search columns of a page. */
export type SearchIndexData = {
  searchText: string;
  searchLanguage: SearchLanguage;
  searchIndexVersion: number;
};

/** The search columns of a page with the given content. */
export async function searchIndexData(content: string): Promise<SearchIndexData> {
  const { searchText, prose } = pageText(content);
  return { searchText, searchLanguage: await detectLanguage(prose), searchIndexVersion: SEARCH_INDEX_VERSION };
}
