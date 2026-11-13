// The first of the two layers that check the login (see the authentication guide of Next.js): every request without
// a session cookie is sent to the login page before it reaches a route. The proxy only looks whether the cookie is
// there and does not ask the database. Whether the cookie belongs to a session is checked by `requireUser()` in every
// page, every query and every Server Action (`src/features/auth/session.ts`), which is the layer that protects the
// data. With `HIPPOWIKI_LOG_CLIENT_ADDRESS=true` it also logs the forwarding headers of every request it sees
// (`src/lib/client-address-probe.ts`).
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { loginPath } from "@/lib/addresses";
import { logClientAddressProbe } from "@/lib/client-address-probe";

/** The request header with which the client of Next.js calls a Server Action. */
const ACTION_HEADER = "next-action";
/** The response header with which a Server Action tells the client of Next.js where to go. */
const ACTION_REDIRECT_HEADER = "x-action-redirect";

export function proxy(request: NextRequest): NextResponse {
  // Before the cookie check, so that a request without a login is logged as well.
  logClientAddressProbe(request.headers, {
    source: "proxy",
    method: request.method,
    path: request.nextUrl.pathname,
  });

  // The helper of Better Auth knows the name of the cookie, with and without the prefix of `Secure` cookies.
  if (getSessionCookie(request)) return NextResponse.next();

  // A Server Action that the client of Next.js calls, e.g. a form submitted after a logout in another tab. The client
  // does not follow an HTTP redirect here: it would show the error page. It is answered the way Next.js itself
  // answers an action that redirects to another site: no content, and the address in a header, which the client
  // opens with a full page load.
  if (request.headers.has(ACTION_HEADER)) {
    return new NextResponse(null, { status: 303, headers: { [ACTION_REDIRECT_HEADER]: `${loginPath()};push` } });
  }

  // 303 for everything that is not a read, so that the browser asks for the login page with GET instead of sending
  // the request again, with its body, to the login page.
  const read = request.method === "GET" || request.method === "HEAD";
  return NextResponse.redirect(new URL(loginPath(), request.url), read ? 307 : 303);
}

export const config = {
  // Every address except the two public ones, the login page and the health check, and the static files of Next.js,
  // which the login page needs. A Server Action is a POST to the address of its page, so the login itself passes as
  // well. The value must be a constant: Next.js reads it at build time.
  matcher: ["/((?!login$|api/health$|_next/static/).*)"],
};
