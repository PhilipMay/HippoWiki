// The reads of search for Server Components: thin adapters on top of the service.

import { connection } from "next/server";

import { requireUser } from "@/features/auth/session";
import { inBrowser } from "@/features/folder-roles/actors";
import * as searchService from "@/features/search/service";
import type { Result } from "@/lib/result";

// Every query starts with `connection()`: without a request-time API, Next.js would prerender the calling route at
// build time and serve a stale snapshot of the database. Then it calls `requireUser()`, which redirects to the login
// page without a logged-in user: nothing is read without a login, whoever calls the query. That user is the actor of
// the service, with the channel `browser`, and the service decides what the user may see.

/**
 * The best pages of the folder for the words of the search, as typed, each with a piece of its text, or why there are
 * none. `null` for an admin and for a folder the user may not read, which the route shows as the not-found page.
 */
export async function searchPages(
  folderId: string,
  words: string,
): Promise<Result<searchService.SearchResults, searchService.SearchError> | null> {
  await connection();
  const user = await requireUser();
  return searchService.searchPages(inBrowser(user), folderId, words);
}
