// Who is calling: the user of the session of the current request. For Server Components, queries and Server Actions;
// it reads the session cookie from the headers of the request and asks the auth service.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import * as authService from "@/features/auth/service";
import { changePasswordPath, loginPath } from "@/lib/addresses";

/**
 * The logged-in user of the current request, or `null`. The session is checked in the database. Cached per request, so
 * that the header, the page and its queries share one check.
 */
export const getCurrentUser = cache(async (): Promise<authService.SessionUser | null> => {
  return authService.getSessionUser(await headers());
});

/**
 * The user of the session of the current request; without a session it redirects to the login page. It does not ask
 * whether the user still has to change the first password, so only the password change itself uses it: its page and
 * its action. Everything else calls `requireUser()`.
 */
export async function requireSession(): Promise<authService.SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath());
  return user;
}

/**
 * The logged-in user of the current request, who may use the wiki. Without a session it redirects to the login page,
 * and while the user still has the first password, to the password change. It is the one place that decides whether a
 * request may go on: every page, every query and every Server Action calls it first. The proxy (`src/proxy.ts`) only
 * looks whether a session cookie is there; this function checks the session in the database. The redirect throws, so
 * a caller keeps the call outside its `try` blocks.
 */
export async function requireUser(): Promise<authService.SessionUser> {
  const user = await requireSession();
  if (user.mustChangePassword) redirect(changePasswordPath());
  return user;
}
