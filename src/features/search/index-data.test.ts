import { expect, it } from "vitest";

import { SEARCH_INDEX_VERSION, searchIndexData } from "@/features/search/index-data";
import { samplePage } from "@/test/language-samples";

it("stores the search text, the language and the version of the derivation", async () => {
  const content = samplePage("german");
  const data = await searchIndexData(content);
  expect(data).toEqual({
    searchText: content.split("\n\n")[1]?.trim(),
    searchLanguage: "german",
    searchIndexVersion: SEARCH_INDEX_VERSION,
  });
});
