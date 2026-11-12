// Who is calling: the user of the session of the current request. For Server Components, queries and Server Actions;
// it reads the session cookie from the headers of the request and asks the auth service.

import { headers } from "next/headers";
import { cache } from "react";

import * as authService from "@/features/auth/service";

/**
 * The logged-in user of the current request, or `null`. The session is checked in the database. Cached per request, so
 * that the header, the page and its queries share one check.
 */
export const getCurrentUser = cache(async (): Promise<authService.SessionUser | null> => {
  return authService.getSessionUser(await headers());
});
