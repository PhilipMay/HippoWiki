// Login, logout and the session of a request. The service is the only code that uses Better Auth, through `getAuth()`.
// It knows nothing about Next.js, forms or addresses, so that the GUI (through `session.ts` and `actions.ts`) and any
// other caller can use it, also outside a request of Next.js. The session lives in a cookie, so every function takes
// the `Headers` of the request, a web standard; the functions that change the session return the response headers
// that set or clear the cookie. In a Server Action Better Auth has already applied them (`nextCookies()`); any other
// caller passes them on itself. The service never logs a password.
//
// The service also counts the failed logins per submitted user name, in the database, and makes the next login for a
// name wait after too many of them (see `wait.ts`).

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import {
  loginInputSchema,
  passwordChangeInputSchema,
  type PasswordChangeFieldErrors,
  type PasswordChangeInput,
} from "@/features/auth/schema";
import { waitAfterFailures } from "@/features/auth/wait";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
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
/** Too many logins for the name have failed; the password was not checked. `waitMs` is the time that is left. */
type Wait = { code: "wait"; waitMs: number };
/** Too many password hashes are running; the password was not checked. */
type Busy = { code: "busy" };
/** An unexpected error; it has been logged. */
type Failed = { code: "failed" };

export type LogInError = InvalidCredentials | Wait | Busy | Failed;
export type LogOutError = Failed;

/**
 * A first password that was replaced: the user, now without a pending change, and the response headers that set the
 * cookie of the new session. Better Auth ends all sessions of the user and starts a new one for the request.
 */
export type PasswordChanged = { user: SessionUser; headers: Headers };

type InvalidPasswordChange = { code: "invalid-input"; fieldErrors: PasswordChangeFieldErrors };
/** The current password is not the one of the user. */
type WrongPassword = { code: "wrong-password" };
/** The request has no valid session. */
type NotLoggedIn = { code: "not-logged-in" };
/** The user has no first password to replace: the change is done already. */
type NotRequired = { code: "not-required" };

export type ChangeFirstPasswordError =
  InvalidPasswordChange | WrongPassword | NotLoggedIn | NotRequired | Busy | Failed;

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

/** The current time. The one place the service takes it from, so that tests can set the clock. */
function currentTime(): Date {
  return new Date();
}

/** How long a login for the name still has to wait, in milliseconds; 0 when it may be tried now. */
async function remainingWait(name: string): Promise<number> {
  const attempt = await getDb().loginAttempt.findUnique({
    where: { username: name },
    select: { failures: true, lastFailedAt: true },
  });
  if (!attempt) return 0;
  const waitUntil = attempt.lastFailedAt.getTime() + waitAfterFailures(attempt.failures);
  return Math.max(0, waitUntil - currentTime().getTime());
}

/**
 * Counts a failed login for the name: one more failure in a row, at the current time. One statement, which also
 * creates the row, so that two failures at the same time are both counted. The login has been refused already; a
 * database error here is logged and does not change the answer.
 */
async function countFailure(name: string): Promise<void> {
  const lastFailedAt = currentTime();
  try {
    await getDb().loginAttempt.upsert({
      where: { username: name },
      create: { username: name, failures: 1, lastFailedAt },
      update: { failures: { increment: 1 }, lastFailedAt },
    });
  } catch (err) {
    logger.error({ err, name }, "failed to count the failed login");
  }
}

/** Forgets the failed logins for the name after a successful one. A database error is logged; the login stands. */
async function clearFailures(name: string): Promise<void> {
  try {
    await getDb().loginAttempt.deleteMany({ where: { username: name } });
  } catch (err) {
    logger.error({ err, name }, "failed to reset the failed logins");
  }
}

/**
 * Logs in with a user name and a password and starts a session. An unknown name and a wrong password give the same
 * code and count the same way, so nobody can find out which names exist.
 *
 * - A name that breaks the name rule cannot belong to a user: it is answered like a wrong password, without a hash,
 *   and is not counted, because the table of the failed logins would otherwise take any text.
 * - After 5 failed logins in a row for a name, the next one has to wait (`wait.ts`). During the wait the login is
 *   refused with the code `wait`, without checking the password and without counting the attempt.
 * - A password of more than 128 characters cannot belong to a user either: it counts as a failed login, without a
 *   hash.
 * - A successful login forgets the failed ones.
 */
export async function logIn(
  input: { name: string; password: string },
  headers: Headers,
): Promise<Result<LoggedIn, LogInError>> {
  const parsedName = loginInputSchema.shape.name.safeParse(input.name);
  if (!parsedName.success) return { ok: false, error: { code: "invalid-credentials" } };
  const name = parsedName.data;

  let waitMs: number;
  try {
    waitMs = await remainingWait(name);
  } catch (err) {
    logger.error({ err, name }, "login failed");
    return { ok: false, error: { code: "failed" } };
  }
  if (waitMs > 0) {
    logger.warn({ name, waitMs }, "login refused: waiting after failed logins");
    return { ok: false, error: { code: "wait", waitMs } };
  }

  const parsedPassword = loginInputSchema.shape.password.safeParse(input.password);
  if (!parsedPassword.success) {
    logger.warn({ name }, "login refused: unknown name or wrong password");
    await countFailure(name);
    return { ok: false, error: { code: "invalid-credentials" } };
  }

  let loggedIn: LoggedIn;
  try {
    const auth = await getAuth();
    const { headers: responseHeaders, response } = await auth.api.signInUsername({
      body: { username: name, password: parsedPassword.data },
      headers,
      returnHeaders: true,
    });
    loggedIn = { user: toSessionUser(response.user), headers: responseHeaders };
  } catch (err) {
    if (err instanceof PasswordHashBusyError) {
      logger.warn({ name }, "too many password hashes are running, login not checked");
      return { ok: false, error: { code: "busy" } };
    }
    if (isAPIError(err) && REFUSED_STATUS_CODES.includes(err.statusCode)) {
      logger.warn({ name }, "login refused: unknown name or wrong password");
      await countFailure(name);
      return { ok: false, error: { code: "invalid-credentials" } };
    }
    logger.error({ err, name }, "login failed");
    return { ok: false, error: { code: "failed" } };
  }

  await clearFailures(name);
  logger.info({ userId: loggedIn.user.id }, "user logged in");
  return { ok: true, value: loggedIn };
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

/** The error codes with which Better Auth refuses a password change because of the current password. */
const WRONG_PASSWORD_CODES: readonly string[] = ["INVALID_PASSWORD", "PASSWORD_TOO_LONG"];

/**
 * Replaces the first password of the user of the session by a password of their own and clears the pending password
 * change. It needs a session whose user still has `mustChangePassword` set. Better Auth checks the current password,
 * stores the new one and ends the other sessions of the user. The flag is cleared only after the password has
 * changed: if that fails, the user changes the password once more.
 */
export async function changeFirstPassword(
  input: PasswordChangeInput,
  headers: Headers,
): Promise<Result<PasswordChanged, ChangeFirstPasswordError>> {
  let user: SessionUser | null;
  try {
    user = await getSessionUser(headers);
  } catch (err) {
    logger.error({ err }, "failed to change the first password");
    return { ok: false, error: { code: "failed" } };
  }
  if (!user) return { ok: false, error: { code: "not-logged-in" } };
  if (!user.mustChangePassword) return { ok: false, error: { code: "not-required" } };
  const userId = user.id;

  const parsed = passwordChangeInputSchema(user.name).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-input", fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  const { currentPassword, newPassword } = parsed.data;

  let responseHeaders: Headers;
  try {
    const auth = await getAuth();
    ({ headers: responseHeaders } = await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers,
      returnHeaders: true,
    }));
  } catch (err) {
    if (err instanceof PasswordHashBusyError) {
      logger.warn({ userId }, "too many password hashes are running, first password not changed");
      return { ok: false, error: { code: "busy" } };
    }
    if (isAPIError(err) && err.statusCode === 401) return { ok: false, error: { code: "not-logged-in" } };
    if (isAPIError(err) && err.statusCode === 400 && WRONG_PASSWORD_CODES.includes(err.body?.code ?? "")) {
      logger.warn({ userId }, "first password not changed: wrong current password");
      return { ok: false, error: { code: "wrong-password" } };
    }
    logger.error({ err, userId }, "failed to change the first password");
    return { ok: false, error: { code: "failed" } };
  }

  try {
    const { count } = await getDb().user.updateMany({
      where: { id: userId, mustChangePassword: true },
      data: { mustChangePassword: false },
    });
    if (count === 0) {
      logger.error({ userId }, "first password changed, but the user with the pending change was not found");
      return { ok: false, error: { code: "failed" } };
    }
  } catch (err) {
    logger.error({ err, userId }, "first password changed, but the pending change could not be cleared");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ userId }, "first password changed");
  return { ok: true, value: { user: { ...user, mustChangePassword: false }, headers: responseHeaders } };
}
