// Login, logout and the session of a request. The service is the only code that uses Better Auth, through `getAuth()`.
// It knows nothing about Next.js, forms or addresses, so that the GUI (through `session.ts` and `actions.ts`) and any
// other caller can use it, also outside a request of Next.js. The session lives in a cookie, so every function takes
// the `Headers` of the request, a web standard; the functions that change the session return the response headers
// that set or clear the cookie. In a Server Action Better Auth has already applied them (`nextCookies()`); any other
// caller passes them on itself. The service never logs a password.
//
// The service also counts the logins per submitted user name, in the database: the failed ones in a row, after too
// many of which the next login for the name waits, and all of them within the hour, of which only 20 are checked (see
// `wait.ts`). A login is counted in both before its password is checked, so that logins at the same time get no more
// guesses than logins one after another.

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import {
  loginInputSchema,
  passwordChangeInputSchema,
  type PasswordChangeFieldErrors,
  type PasswordChangeInput,
} from "@/features/auth/schema";
import { MAX_ATTEMPTS_PER_WINDOW, isWindowOver, waitAfterFailures, waitForWindow } from "@/features/auth/wait";
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

/** The count of a name in `LoginAttempt`. */
type AttemptCount = { failures: number; lastFailedAt: Date };

/**
 * A login that is counted in `LoginAttempt` and in `LoginWindow` before its password is checked: the count of
 * `LoginAttempt` before it (`null` without a row) and the count it wrote, the start of the window it counted in, and
 * whether it started that window.
 */
type Reservation = {
  previous: AttemptCount | null;
  reserved: AttemptCount;
  windowStartedAt: Date;
  startedWindow: boolean;
};

/** Which of the two limits asks a login to wait: the failures in a row, or the logins per name and hour. */
type WaitLimit = "failures" | "window";

/** The login may be checked, or it has to wait `waitMs` milliseconds for `limit`. */
type ReserveResult =
  { reserved: true; reservation: Reservation } | { reserved: false; waitMs: number; limit: WaitLimit };

/**
 * How often `reserveAttempt()` reads the counts again after another login changed them. A round is only lost to
 * another login for the name that wrote in between: at most twice per such login, once for its count and once more if
 * it succeeds and deletes the counts. Logins with a wrong password get a wait after a few counts, so they need only a
 * few rounds; the limit is for many logins with the right password at the same moment, whose deletes let the others
 * count again.
 */
const MAX_RESERVE_ROUNDS = 50;

/** Thrown inside the transaction of `reserveAttempt()` when a count is no longer the one that was read: rolls it back. */
class CountChangedError extends Error {}

/**
 * Counts the login for the name, before its password is checked, at the current time: as one more failure in a row in
 * `LoginAttempt` and as one more login of the hour in `LoginWindow`, unless one of the two asks for a wait. Then the
 * longer of the two waits is returned and nothing is written. A wrong password needs no further write; a successful
 * login deletes the counts, and a login that was not checked takes them back (`releaseAttempt()`).
 *
 * Both counts are written in one transaction, so a login is counted in both or in neither. Each write only succeeds
 * if its row is still the one that was read, or, for a running window, if it has not started anew and is not full;
 * otherwise another login got in between, the transaction is rolled back and the counts are read again. So of the
 * logins that arrive at the same time, only as many are checked as would be one after another. Throws when the
 * database fails or the counts keep changing.
 */
async function reserveAttempt(name: string): Promise<ReserveResult> {
  const db = getDb();
  for (let round = 0; round < MAX_RESERVE_ROUNDS; round += 1) {
    const now = currentTime();
    const previous = await db.loginAttempt.findUnique({
      where: { username: name },
      select: { failures: true, lastFailedAt: true },
    });
    const window = await db.loginWindow.findUnique({
      where: { username: name },
      select: { attempts: true, startedAt: true },
    });
    const failuresWaitMs = previous
      ? previous.lastFailedAt.getTime() + waitAfterFailures(previous.failures) - now.getTime()
      : 0;
    const windowWaitMs = waitForWindow(window, now);
    if (failuresWaitMs > 0 || windowWaitMs > 0) {
      return failuresWaitMs >= windowWaitMs
        ? { reserved: false, waitMs: failuresWaitMs, limit: "failures" }
        : { reserved: false, waitMs: windowWaitMs, limit: "window" };
    }

    const reserved = { failures: (previous?.failures ?? 0) + 1, lastFailedAt: now };
    const runningWindow = window && !isWindowOver(window, now) ? window : null;
    try {
      await db.$transaction(async (tx) => {
        const attempt = previous
          ? await tx.loginAttempt.updateMany({
              where: { username: name, failures: previous.failures, lastFailedAt: previous.lastFailedAt },
              data: reserved,
            })
          : // A row that another login created in the meantime is skipped and reported as a count of 0.
            await tx.loginAttempt.createMany({ data: [{ username: name, ...reserved }], skipDuplicates: true });
        if (attempt.count !== 1) throw new CountChangedError();

        const counted = runningWindow
          ? // Only the start and the limit are named, so that logins from different addresses do not make each other
            // read again.
            await tx.loginWindow.updateMany({
              where: {
                username: name,
                startedAt: runningWindow.startedAt,
                attempts: { lt: MAX_ATTEMPTS_PER_WINDOW },
              },
              data: { attempts: { increment: 1 } },
            })
          : window
            ? await tx.loginWindow.updateMany({
                where: { username: name, attempts: window.attempts, startedAt: window.startedAt },
                data: { attempts: 1, startedAt: now },
              })
            : await tx.loginWindow.createMany({
                data: [{ username: name, attempts: 1, startedAt: now }],
                skipDuplicates: true,
              });
        if (counted.count !== 1) throw new CountChangedError();
      });
    } catch (err) {
      if (err instanceof CountChangedError) continue;
      throw err;
    }
    const reservation = {
      previous,
      reserved,
      windowStartedAt: runningWindow?.startedAt ?? now,
      startedWindow: !runningWindow,
    };
    return { reserved: true, reservation };
  }
  throw new Error("the counts of the logins kept changing, the login attempt was not counted");
}

/**
 * Takes back the counts of a login whose password was not checked, because the hashing was busy or something failed.
 * If the row of `LoginAttempt` is still the one the login wrote, it gets the count from before, so that a wait that
 * was over is not started again. If other logins have counted since, only the number goes down by one. The window
 * loses the login as well: a window that the login started and that still has only this login is deleted, any other
 * goes down by one, as long as it has not started anew. A database error here is logged and does not change the
 * answer.
 */
async function releaseAttempt(
  name: string,
  { previous, reserved, windowStartedAt, startedWindow }: Reservation,
): Promise<void> {
  const db = getDb();
  const stillReserved = { username: name, failures: reserved.failures, lastFailedAt: reserved.lastFailedAt };
  try {
    const { count } = previous
      ? await db.loginAttempt.updateMany({
          where: stillReserved,
          data: { failures: previous.failures, lastFailedAt: previous.lastFailedAt },
        })
      : await db.loginAttempt.deleteMany({ where: stillReserved });
    if (count !== 1) {
      await db.loginAttempt.updateMany({
        where: { username: name, failures: { gt: 0 } },
        data: { failures: { decrement: 1 } },
      });
    }
  } catch (err) {
    logger.error({ err, name }, "failed to take back the login attempt");
  }

  try {
    const { count } = startedWindow
      ? await db.loginWindow.deleteMany({ where: { username: name, startedAt: windowStartedAt, attempts: 1 } })
      : { count: 0 };
    if (count !== 1) {
      await db.loginWindow.updateMany({
        where: { username: name, startedAt: windowStartedAt, attempts: { gt: 0 } },
        data: { attempts: { decrement: 1 } },
      });
    }
  } catch (err) {
    logger.error({ err, name }, "failed to take back the login attempt");
  }
}

/**
 * Forgets the failed logins and the window of the name after a successful login. A database error is logged; the
 * login stands.
 */
async function clearFailures(name: string): Promise<void> {
  try {
    const db = getDb();
    await db.loginAttempt.deleteMany({ where: { username: name } });
    await db.loginWindow.deleteMany({ where: { username: name } });
  } catch (err) {
    logger.error({ err, name }, "failed to reset the failed logins");
  }
}

/** The log message of a login that has to wait, per limit. */
const WAIT_LOG_MESSAGES: Record<WaitLimit, string> = {
  failures: "login refused: waiting after failed logins",
  window: "login refused: too many logins for the name within the hour",
};

/**
 * Logs in with a user name and a password and starts a session. An unknown name and a wrong password give the same
 * code and count the same way, so nobody can find out which names exist.
 *
 * - A name that breaks the name rule cannot belong to a user: it is answered like a wrong password, without a hash,
 *   and is not counted, because the table of the failed logins would otherwise take any text.
 * - After 5 failed logins in a row for a name, the next one has to wait, and so does every login after 20 logins for
 *   the name within the hour (`wait.ts`). During a wait the login is refused with the code `wait` and the longer of
 *   the two waits, without checking the password and without counting the attempt.
 * - Every other login is counted as a failure before its password is checked (`reserveAttempt()`), so logins at the
 *   same time cannot get past the wait. If it cannot be counted, the password is not checked.
 * - A password of more than 128 characters cannot belong to a user either: it counts as a failed login, without a
 *   hash.
 * - A successful login forgets the failed ones and the window of the name. A login that was not checked, because the
 *   hashing was busy or something failed, takes its counts back.
 */
export async function logIn(
  input: { name: string; password: string },
  headers: Headers,
): Promise<Result<LoggedIn, LogInError>> {
  const parsedName = loginInputSchema.shape.name.safeParse(input.name);
  if (!parsedName.success) return { ok: false, error: { code: "invalid-credentials" } };
  const name = parsedName.data;

  let attempt: ReserveResult;
  try {
    attempt = await reserveAttempt(name);
  } catch (err) {
    logger.error({ err, name }, "login failed");
    return { ok: false, error: { code: "failed" } };
  }
  if (!attempt.reserved) {
    logger.warn({ name, waitMs: attempt.waitMs }, WAIT_LOG_MESSAGES[attempt.limit]);
    return { ok: false, error: { code: "wait", waitMs: attempt.waitMs } };
  }
  // From here on the login is counted as a failure, unless it succeeds or its count is taken back.
  const { reservation } = attempt;

  const parsedPassword = loginInputSchema.shape.password.safeParse(input.password);
  if (!parsedPassword.success) {
    logger.warn({ name }, "login refused: unknown name or wrong password");
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
    if (isAPIError(err) && REFUSED_STATUS_CODES.includes(err.statusCode)) {
      logger.warn({ name }, "login refused: unknown name or wrong password");
      return { ok: false, error: { code: "invalid-credentials" } };
    }
    // The password was not found wrong, so the attempt is not a failed login.
    await releaseAttempt(name, reservation);
    if (err instanceof PasswordHashBusyError) {
      logger.warn({ name }, "too many password hashes are running, login not checked");
      return { ok: false, error: { code: "busy" } };
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
