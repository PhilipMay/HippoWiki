// Login, logout and the session of a request. The service is the only code that uses Better Auth, through `getAuth()`.
// It knows nothing about Next.js, forms or addresses, so that the GUI (through `session.ts` and `actions.ts`) and any
// other caller can use it, also outside a request of Next.js. The session lives in a cookie, so every function takes
// the `Headers` of the request, a web standard; the functions that change the session return the response headers
// that set or clear the cookie. In a Server Action Better Auth has already applied them (`nextCookies()`); any other
// caller passes them on itself. The service never logs a password.

import { isAPIError } from "better-auth/api";

import { loginInputSchema } from "@/features/auth/schema";
import { getAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { PasswordHashBusyError } from "@/lib/password-hash";
import type { Result } from "@/lib/result";

/** The user of a session, as far as the application needs it. */
export type SessionUser = {
  id: string;
  /** The user name. */
  name: string;
  /** Whether the user still has to replace the first password by an own one. */
  mustChangePassword: boolean;
};

/** A login that succeeded: the user, and the response headers that set the session cookie. */
export type LoggedIn = { user: SessionUser; headers: Headers };

/** A logout: the response headers that clear the session cookie. */
export type LoggedOut = { headers: Headers };

/** The name is unknown or the password is wrong; the two are never told apart. */
type InvalidCredentials = { code: "invalid-credentials" };
/** Too many password hashes are running; the password was not checked. */
type Busy = { code: "busy" };
/** An unexpected error; it has been logged. */
type Failed = { code: "failed" };

export type LogInError = InvalidCredentials | Busy | Failed;
export type LogOutError = Failed;

/**
 * The HTTP status codes with which Better Auth refuses a sign-in because of what was submitted: a malformed body, an
 * unknown name or a wrong password, and a name that breaks its rules. All of them are answered the same way.
 */
const REFUSED_STATUS_CODES: readonly number[] = [400, 401, 422];

/** The fields of a Better Auth user that make up a `SessionUser`. */
type AuthUser = { id: string; name: string; username?: string | null; mustChangePassword?: boolean | null };

function toSessionUser(user: AuthUser): SessionUser {
  // A user without the flag would be one that Better Auth created; treating it as pending is the safe side.
  return { id: user.id, name: user.username ?? user.name, mustChangePassword: user.mustChangePassword ?? true };
}

/**
 * Logs in with a user name and a password and starts a session. An unknown name and a wrong password give the same
 * code. A name that breaks the name rule and a password of more than 128 characters cannot belong to a user; they are
 * answered like a wrong password, without a hash.
 */
export async function logIn(
  input: { name: string; password: string },
  headers: Headers,
): Promise<Result<LoggedIn, LogInError>> {
  const parsed = loginInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid-credentials" } };
  const { name, password } = parsed.data;

  try {
    const auth = await getAuth();
    const { headers: responseHeaders, response } = await auth.api.signInUsername({
      body: { username: name, password },
      headers,
      returnHeaders: true,
    });
    const user = toSessionUser(response.user);
    logger.info({ userId: user.id }, "user logged in");
    return { ok: true, value: { user, headers: responseHeaders } };
  } catch (err) {
    if (err instanceof PasswordHashBusyError) {
      logger.warn({ name }, "too many password hashes are running, login not checked");
      return { ok: false, error: { code: "busy" } };
    }
    if (isAPIError(err) && REFUSED_STATUS_CODES.includes(err.statusCode)) {
      logger.warn({ name }, "login refused: unknown name or wrong password");
      return { ok: false, error: { code: "invalid-credentials" } };
    }
    logger.error({ err, name }, "login failed");
    return { ok: false, error: { code: "failed" } };
  }
}

/** Ends the session of the request; the other sessions of the user stay. Without a session it changes nothing. */
export async function logOut(headers: Headers): Promise<Result<LoggedOut, LogOutError>> {
  try {
    const auth = await getAuth();
    const { headers: responseHeaders } = await auth.api.signOut({ headers, returnHeaders: true });
    logger.info("session ended");
    return { ok: true, value: { headers: responseHeaders } };
  } catch (err) {
    logger.error({ err }, "logout failed");
    return { ok: false, error: { code: "failed" } };
  }
}

/**
 * The user of the session of the request, or `null` without a valid session: no session cookie, one that the server
 * does not know, or a session that has ended. It reads the session from the database and does not extend it.
 */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers });
  return session ? toSessionUser(session.user) : null;
}
