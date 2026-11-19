// Login, logout and the session of a request. The service is the only code that uses Better Auth, through `getAuth()`.
// It knows nothing about Next.js, forms or addresses, so that the GUI (through `session.ts` and `actions.ts`) and any
// other caller can use it, also outside a request of Next.js. The session lives in a cookie, so every function takes
// the `Headers` of the request, a web standard; the functions that change the session return the response headers
// that set or clear the cookie. In a Server Action Better Auth has already applied them (`nextCookies()`); any other
// caller passes them on itself. The service never logs a password.
//
// The service also counts every check of a password per user name, in the database: the login, and the current
// password of a password change, which counts as a login of the name of the session user. The failed ones are counted
// in a row per name and client address group, after too many of which the next check for the name from that group
// waits, and all of them per name within the hour, from all groups together, of which only 20 are checked (see
// `wait.ts`). A check is counted in both before its password is checked, so that checks at the same time get no more
// guesses than checks one after another; all of them go through `countedPasswordCheck()`. The caller passes the client
// address group (`src/lib/client-address.ts`); the service knows nothing about the headers it comes from.

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import {
  loginInputSchema,
  passwordChangeInputSchema,
  type PasswordChangeFieldErrors,
  type PasswordChangeInput,
} from "@/features/auth/schema";
import {
  ATTEMPT_RETENTION_MS,
  MAX_ATTEMPTS_PER_WINDOW,
  NAME_WINDOW_MS,
  isWindowOver,
  waitAfterFailures,
  waitForWindow,
} from "@/features/auth/wait";
import * as grantService from "@/features/grants/service";
import { isOAuthOn } from "@/features/oauth/issuer";
import { isAdmin, isUserType, type UserType } from "@/features/users/user-type";
import { getAuth } from "@/lib/auth";
import { isClientAddressGroup, SHARED_CLIENT_ADDRESS } from "@/lib/client-address";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PasswordHashBusyError } from "@/lib/password-hash";
import type { Result } from "@/lib/result";

/** The user of a session, as far as the application needs it. */
export type SessionUser = {
  id: string;
  /** The user name. */
  name: string;
  /** The type of the account, which decides what the user may do. */
  type: UserType;
  /** Whether the user still has to replace the first password by an own one. */
  mustChangePassword: boolean;
};

/** A login that succeeded: the user, and the response headers that set the session cookie. */
export type LoggedIn = { user: SessionUser; headers: Headers };

/** A logout: the response headers that clear the session cookie. */
export type LoggedOut = { headers: Headers };

/** The name is unknown or the password is wrong; the two are never told apart. */
type InvalidCredentials = { code: "invalid-credentials" };
/**
 * Too many checks of a password for the name have failed, or too many were made within the hour; the password was not
 * checked. `waitMs` is the time that is left.
 */
type Wait = { code: "wait"; waitMs: number };
/** Too many password hashes are running; the password was not checked. */
type Busy = { code: "busy" };
/** An unexpected error; it has been logged. */
type Failed = { code: "failed" };

export type LogInError = InvalidCredentials | Wait | Busy | Failed;
export type LogOutError = Failed;

/**
 * A password that was changed: the user, without a pending change, and the response headers that set the cookie of the
 * new session. Better Auth ends all sessions of the user and starts a new one for the request.
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
  InvalidPasswordChange | WrongPassword | NotLoggedIn | NotRequired | Wait | Busy | Failed;

/** The user still has the first password: the forced password change comes first. */
type FirstPasswordPending = { code: "first-password-pending" };

/**
 * What an own password change did with the connected apps of the user: kept them, disconnected `count` of them, or
 * failed to disconnect them after the password was changed.
 */
export type AppsAtPasswordChange =
  { status: "kept" } | { status: "disconnected"; count: number } | { status: "failed" };

/** An own password change: the user and the headers of the new session, and what was done with the apps. */
export type OwnPasswordChanged = PasswordChanged & { apps: AppsAtPasswordChange };

export type ChangeOwnPasswordError =
  InvalidPasswordChange | WrongPassword | NotLoggedIn | FirstPasswordPending | Wait | Busy | Failed;

/**
 * The HTTP status codes with which Better Auth refuses a sign-in because of what was submitted: a malformed body, an
 * unknown name or a wrong password, and a name that breaks its rules. All of them are answered the same way.
 */
const REFUSED_STATUS_CODES: readonly number[] = [400, 401, 422];

/** The fields of a Better Auth user that make up a `SessionUser`. */
type AuthUser = {
  id: string;
  name: string;
  username?: string | null;
  type?: unknown;
  mustChangePassword?: boolean | null;
};

/**
 * The session user of a Better Auth user, or `null` for a user without a known type: such a user may do nothing, so it
 * is treated like a missing session (the safe side). The database requires the type, so this never happens in
 * practice.
 */
function toSessionUser(user: AuthUser): SessionUser | null {
  if (!isUserType(user.type)) {
    logger.error({ userId: user.id }, "user without a known type, treated as not logged in");
    return null;
  }
  return {
    id: user.id,
    name: user.username ?? user.name,
    type: user.type,
    // A user without the flag would be one that Better Auth created; treating it as pending is the safe side.
    mustChangePassword: user.mustChangePassword ?? true,
  };
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
 * Counts the login for the name, before its password is checked, at the current time: as one more failure in a row of
 * the name from the client address group in `LoginAttempt` and as one more login of the hour for the name in
 * `LoginWindow`, unless one of the two asks for a wait. Then the longer of the two waits is returned and nothing is
 * written. A wrong password needs no further write; a successful
 * login deletes the counts, and a login that was not checked takes them back (`releaseAttempt()`).
 *
 * Both counts are written in one transaction, so a login is counted in both or in neither. Each write only succeeds
 * if its row is still the one that was read, or, for a running window, if it has not started anew and is not full;
 * otherwise another login got in between, the transaction is rolled back and the counts are read again. So of the
 * logins that arrive at the same time, only as many are checked as would be one after another. Throws when the
 * database fails or the counts keep changing.
 */
async function reserveAttempt(name: string, clientAddress: string): Promise<ReserveResult> {
  const db = getDb();
  for (let round = 0; round < MAX_RESERVE_ROUNDS; round += 1) {
    const now = currentTime();
    const previous = await db.loginAttempt.findUnique({
      where: { username_clientAddress: { username: name, clientAddress } },
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

    // A row whose last failure is more than a day old is not a failure in a row any more: the count starts again.
    const inARow =
      previous && now.getTime() - previous.lastFailedAt.getTime() <= ATTEMPT_RETENTION_MS ? previous.failures : 0;
    const reserved = { failures: inARow + 1, lastFailedAt: now };
    const runningWindow = window && !isWindowOver(window, now) ? window : null;
    try {
      await db.$transaction(async (tx) => {
        const attempt = previous
          ? await tx.loginAttempt.updateMany({
              where: {
                username: name,
                clientAddress,
                failures: previous.failures,
                lastFailedAt: previous.lastFailedAt,
              },
              data: reserved,
            })
          : // A row that another login created in the meantime is skipped and reported as a count of 0.
            await tx.loginAttempt.createMany({
              data: [{ username: name, clientAddress, ...reserved }],
              skipDuplicates: true,
            });
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
  clientAddress: string,
  { previous, reserved, windowStartedAt, startedWindow }: Reservation,
): Promise<void> {
  const db = getDb();
  const stillReserved = {
    username: name,
    clientAddress,
    failures: reserved.failures,
    lastFailedAt: reserved.lastFailedAt,
  };
  try {
    const { count } = previous
      ? await db.loginAttempt.updateMany({
          where: stillReserved,
          data: { failures: previous.failures, lastFailedAt: previous.lastFailedAt },
        })
      : await db.loginAttempt.deleteMany({ where: stillReserved });
    if (count !== 1) {
      await db.loginAttempt.updateMany({
        where: { username: name, clientAddress, failures: { gt: 0 } },
        data: { failures: { decrement: 1 } },
      });
    }
  } catch (err) {
    logger.error({ err, name, clientAddress }, "failed to take back the login attempt");
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
    logger.error({ err, name, clientAddress }, "failed to take back the login attempt");
  }
}

/**
 * Forgets the failed logins of the name from the client address group and the window of the name after a successful
 * login; the counts of the name from other groups stay. A database error is logged; the login stands.
 */
async function clearFailures(name: string, clientAddress: string): Promise<void> {
  try {
    const db = getDb();
    await db.loginAttempt.deleteMany({ where: { username: name, clientAddress } });
    await db.loginWindow.deleteMany({ where: { username: name } });
  } catch (err) {
    logger.error({ err, name, clientAddress }, "failed to reset the failed logins");
  }
}

/**
 * Deletes the counts that no login needs any more, of all names and groups: the rows of `LoginAttempt` whose last
 * failure is more than a day old, and the windows whose hour is over. So the two tables stay small, although every
 * pair of a name and a client address group gets a row. A database error is logged and does not change the answer.
 */
async function deleteOldCounts(): Promise<void> {
  const now = currentTime().getTime();
  const db = getDb();
  try {
    await db.loginAttempt.deleteMany({ where: { lastFailedAt: { lt: new Date(now - ATTEMPT_RETENTION_MS) } } });
  } catch (err) {
    logger.error({ err }, "failed to delete the old counts of failed logins");
  }
  try {
    await db.loginWindow.deleteMany({ where: { startedAt: { lte: new Date(now - NAME_WINDOW_MS) } } });
  } catch (err) {
    logger.error({ err }, "failed to delete the windows of logins whose hour is over");
  }
}

/** The log message of a login that has to wait, per limit. */
const WAIT_LOG_MESSAGES: Record<WaitLimit, string> = {
  failures: "login refused: waiting after failed logins",
  window: "login refused: too many logins for the name within the hour",
};

/**
 * The client address group to count a check of a password in: the given one if `client-address.ts` would write it,
 * otherwise the shared group, with an error in the log. The service trusts no caller: such a value could be any text.
 */
function countedGroup(clientAddressGroup: string, logContext: Record<string, string>, what: string): string {
  if (isClientAddressGroup(clientAddressGroup)) return clientAddressGroup;
  logger.error(logContext, `${what} with an invalid client address group, counted in the shared group`);
  return SHARED_CLIENT_ADDRESS;
}

/**
 * What a check of a password found: the right password, with what the check returned, or a wrong one. A check that
 * cannot tell, because the hashing is busy or something failed, throws instead.
 */
type PasswordCheck<T> = { right: true; value: T } | { right: false };

/** What a counted check of a password came to. */
type CountedPasswordCheck<T> =
  | { status: "right"; value: T }
  | { status: "wrong" }
  /** The check has to wait `waitMs` milliseconds for `limit`; it was neither run nor counted. */
  | { status: "wait"; waitMs: number; limit: WaitLimit }
  /** The password was not checked: it could not be counted, or the check threw and its count was taken back. */
  | { status: "not-checked"; err: unknown };

/**
 * Runs a check of a password for the name, counted like a login from the client address group, as every check of a
 * password in the service is:
 *
 * - During a wait it returns the wait and its limit, without running the check and without counting it.
 * - Otherwise it counts the check as a failure before the password is checked (`reserveAttempt()`), so that checks at
 *   the same time cannot get past the wait. If it cannot be counted, the password is not checked.
 * - A counted check deletes the old counts of all names (`deleteOldCounts()`), after and outside the transaction of
 *   the count.
 * - A wrong password keeps the count. A right one forgets the failed checks of its name and group, and the window of
 *   the name (`clearFailures()`). A check that throws, because the hashing was busy or something failed, takes its
 *   counts back (`releaseAttempt()`), so that a wait that was over does not start again.
 *
 * The caller logs the outcome; this function logs only its own database errors.
 */
async function countedPasswordCheck<T>(
  name: string,
  clientAddress: string,
  check: () => Promise<PasswordCheck<T>>,
): Promise<CountedPasswordCheck<T>> {
  let attempt: ReserveResult;
  try {
    attempt = await reserveAttempt(name, clientAddress);
  } catch (err) {
    return { status: "not-checked", err };
  }
  if (!attempt.reserved) return { status: "wait", waitMs: attempt.waitMs, limit: attempt.limit };
  // From here on the check is counted as a failure, unless the password is right or its count is taken back.
  const { reservation } = attempt;
  // Only a counted check cleans up, so that checks that are refused at once cost no more than a read.
  await deleteOldCounts();

  let checked: PasswordCheck<T>;
  try {
    checked = await check();
  } catch (err) {
    // The password was not found wrong, so the check is not a failure.
    await releaseAttempt(name, clientAddress, reservation);
    return { status: "not-checked", err };
  }
  if (!checked.right) return { status: "wrong" };
  await clearFailures(name, clientAddress);
  return { status: "right", value: checked.value };
}

/**
 * Logs in with a user name and a password and starts a session. An unknown name and a wrong password give the same
 * code and count the same way, so nobody can find out which names exist.
 *
 * - A name that breaks the name rule cannot belong to a user: it is answered like a wrong password, without a hash,
 *   and is not counted, because the table of the failed logins would otherwise take any text.
 * - The failed logins are counted per name and client address group (`clientAddressGroup`, as
 *   `src/lib/client-address.ts` writes it; any other value counts in the shared group and is logged as an error).
 * - After 5 failed logins in a row for a name from a group, the next one from that group has to wait, and so does
 *   every login after 20 logins for the name within the hour, from all groups together (`wait.ts`). During a wait
 *   the login is refused with the code `wait` and the longer of the two waits, without checking the password and
 *   without counting the attempt; the log line names the limit that asked for the wait.
 * - Every other login is counted as a failure before its password is checked, so logins at the same time cannot get
 *   past the wait; a successful login forgets the failed ones of its name and group, and the window of the name, and a
 *   login that was not checked takes its counts back (`countedPasswordCheck()`).
 * - A password of more than 128 characters cannot belong to a user either: it counts as a failed login, without a
 *   hash.
 */
export async function logIn(
  input: { name: string; password: string },
  headers: Headers,
  clientAddressGroup: string,
): Promise<Result<LoggedIn, LogInError>> {
  const parsedName = loginInputSchema.shape.name.safeParse(input.name);
  if (!parsedName.success) return { ok: false, error: { code: "invalid-credentials" } };
  const name = parsedName.data;

  const clientAddress = countedGroup(clientAddressGroup, { name }, "login");

  const checked = await countedPasswordCheck(name, clientAddress, async (): Promise<PasswordCheck<LoggedIn | null>> => {
    const parsedPassword = loginInputSchema.shape.password.safeParse(input.password);
    if (!parsedPassword.success) return { right: false };
    try {
      const auth = await getAuth();
      const { headers: responseHeaders, response } = await auth.api.signInUsername({
        body: { username: name, password: parsedPassword.data },
        headers,
        returnHeaders: true,
      });
      const user = toSessionUser(response.user);
      // The session it started is refused by every check of a session, like the user.
      return { right: true, value: user && { user, headers: responseHeaders } };
    } catch (err) {
      if (isAPIError(err) && REFUSED_STATUS_CODES.includes(err.statusCode)) return { right: false };
      throw err;
    }
  });

  switch (checked.status) {
    case "wait":
      logger.warn({ name, clientAddress, waitMs: checked.waitMs }, WAIT_LOG_MESSAGES[checked.limit]);
      return { ok: false, error: { code: "wait", waitMs: checked.waitMs } };
    case "wrong":
      logger.warn({ name, clientAddress }, "login refused: unknown name or wrong password");
      return { ok: false, error: { code: "invalid-credentials" } };
    case "not-checked":
      if (checked.err instanceof PasswordHashBusyError) {
        logger.warn({ name, clientAddress }, "too many password hashes are running, login not checked");
        return { ok: false, error: { code: "busy" } };
      }
      logger.error({ err: checked.err, name, clientAddress }, "login failed");
      return { ok: false, error: { code: "failed" } };
    case "right":
      break;
  }
  const loggedIn = checked.value;
  if (!loggedIn) return { ok: false, error: { code: "failed" } };
  logger.info({ userId: loggedIn.user.id, name, clientAddress }, "user logged in");
  return { ok: true, value: loggedIn };
}

/**
 * Ends the session of the request; the other sessions of the user stay. Without a session it changes nothing. The log
 * line names the user of the session, which is read before, because the sign-out of Better Auth returns no user; a
 * logout whose session cannot be read fails like one that cannot end it, so that it never looks done.
 */
export async function logOut(headers: Headers): Promise<Result<LoggedOut, LogOutError>> {
  try {
    const user = await getSessionUser(headers);
    const auth = await getAuth();
    const { headers: responseHeaders } = await auth.api.signOut({ headers, returnHeaders: true });
    if (user) logger.info({ userId: user.id }, "session ended");
    else logger.info("session ended");
    return { ok: true, value: { headers: responseHeaders } };
  } catch (err) {
    logger.error({ err }, "logout failed");
    return { ok: false, error: { code: "failed" } };
  }
}

/** The session of a request: its id and its user. */
type RequestSession = { sessionId: string; user: SessionUser };

/**
 * The session of the request with its user, or `null` without a valid session, as for `getSessionUser()`. Throws when
 * the session cannot be read.
 */
async function getRequestSession(headers: Headers): Promise<RequestSession | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers });
  const user = session && toSessionUser(session.user);
  return session && user ? { sessionId: session.session.id, user } : null;
}

/**
 * The user of the session of the request, or `null` without a valid session: no session cookie, one that the server
 * does not know, or a session that has ended. It reads the session from the database and does not extend it.
 */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  return (await getRequestSession(headers))?.user ?? null;
}

/** The other sessions of the user that were ended. */
export type OtherSessionsEnded = { count: number };

export type LogOutOtherSessionsError = NotLoggedIn | Failed;

/**
 * Ends all other sessions of the user of the request, without changing the password; the session of the request
 * stays. Returns how many sessions were ended, 0 when there was no other one. The password is not asked: ending
 * sessions only protects the account.
 *
 * The sessions are deleted here, in one write that leaves out the session of the request, and not with
 * `revokeOtherSessions` of Better Auth: that returns no number, deletes the sessions one by one, and Better Auth was
 * found to swallow a failed delete at the logout, so a failure could look like success. Every check of a session reads
 * the database, so a deleted session is refused at its next request.
 */
export async function logOutOtherSessions(
  headers: Headers,
): Promise<Result<OtherSessionsEnded, LogOutOtherSessionsError>> {
  let session: RequestSession | null;
  try {
    session = await getRequestSession(headers);
  } catch (err) {
    logger.error({ err }, "failed to end the other sessions");
    return { ok: false, error: { code: "failed" } };
  }
  if (!session) return { ok: false, error: { code: "not-logged-in" } };
  const { sessionId, user } = session;

  let count: number;
  try {
    ({ count } = await getDb().session.deleteMany({ where: { userId: user.id, id: { not: sessionId } } }));
  } catch (err) {
    logger.error({ err, userId: user.id }, "failed to end the other sessions");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ userId: user.id, name: user.name, count }, "other sessions ended");
  return { ok: true, value: { count } };
}

/** The error codes with which Better Auth refuses a password change because of the current password. */
const WRONG_PASSWORD_CODES: readonly string[] = ["INVALID_PASSWORD", "PASSWORD_TOO_LONG"];

/** The log messages of a password change that has to wait, per limit, after the name of the password changed. */
const CHANGE_WAIT_LOG_MESSAGES: Record<WaitLimit, string> = {
  failures: "not changed: waiting after failed logins",
  window: "not changed: too many logins for the name within the hour",
};

type ChangePasswordError = InvalidPasswordChange | WrongPassword | NotLoggedIn | Wait | Busy | Failed;

/**
 * Changes the password of the session user through Better Auth, which checks the current password, stores the new one,
 * ends all sessions of the user and starts a new one for the request; returns the response headers that set its
 * cookie. `label` names the password in the log lines, such as "first password".
 *
 * The input is validated first: input that breaks a rule of the new password is answered with its field errors,
 * without checking the current password and without counting it. Then the current password is counted like a login of
 * the name of the user from the client address group (`countedPasswordCheck()`): a wrong one counts as a failed login,
 * a right one like a successful one, and during a wait the change is refused with `wait` without checking it.
 */
async function changeCountedPassword(
  user: SessionUser,
  input: PasswordChangeInput,
  headers: Headers,
  clientAddressGroup: string,
  label: string,
): Promise<Result<Headers, ChangePasswordError>> {
  const { id: userId, name } = user;
  const parsed = passwordChangeInputSchema(name).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-input", fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  const { currentPassword, newPassword } = parsed.data;
  const clientAddress = countedGroup(clientAddressGroup, { userId, name }, `${label} change`);

  const checked = await countedPasswordCheck(name, clientAddress, async (): Promise<PasswordCheck<Headers>> => {
    try {
      const auth = await getAuth();
      const { headers: responseHeaders } = await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers,
        returnHeaders: true,
      });
      return { right: true, value: responseHeaders };
    } catch (err) {
      if (isAPIError(err) && err.statusCode === 400 && WRONG_PASSWORD_CODES.includes(err.body?.code ?? "")) {
        return { right: false };
      }
      throw err;
    }
  });

  switch (checked.status) {
    case "right":
      return { ok: true, value: checked.value };
    case "wait":
      logger.warn(
        { userId, name, clientAddress, waitMs: checked.waitMs },
        `${label} ${CHANGE_WAIT_LOG_MESSAGES[checked.limit]}`,
      );
      return { ok: false, error: { code: "wait", waitMs: checked.waitMs } };
    case "wrong":
      logger.warn({ userId, name, clientAddress }, `${label} not changed: wrong current password`);
      return { ok: false, error: { code: "wrong-password" } };
    case "not-checked": {
      const { err } = checked;
      if (err instanceof PasswordHashBusyError) {
        logger.warn({ userId }, `too many password hashes are running, ${label} not changed`);
        return { ok: false, error: { code: "busy" } };
      }
      if (isAPIError(err) && err.statusCode === 401) return { ok: false, error: { code: "not-logged-in" } };
      logger.error({ err, userId }, `failed to change the ${label}`);
      return { ok: false, error: { code: "failed" } };
    }
  }
}

/**
 * Replaces the first password of the user of the session by a password of their own and clears the pending password
 * change. It needs a session whose user still has `mustChangePassword` set. The password is changed and counted as
 * `changeCountedPassword()` describes, with the client address group of the request (`clientAddressGroup`, as for
 * `logIn()`). The flag is cleared only after the password has changed: if that fails, the user changes the password
 * once more.
 */
export async function changeFirstPassword(
  input: PasswordChangeInput,
  headers: Headers,
  clientAddressGroup: string,
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

  const changed = await changeCountedPassword(user, input, headers, clientAddressGroup, "first password");
  if (!changed.ok) return changed;

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
  return { ok: true, value: { user: { ...user, mustChangePassword: false }, headers: changed.value } };
}

/**
 * Disconnects all connected apps of the user after an own password change, if the user chose to: for an admin and
 * while OAuth is off there are no apps and the dialog shows no such choice, so the choice is ignored and logged. A
 * failure is logged and reported in the result: the password stays changed.
 */
async function disconnectAppsAfterChange(user: SessionUser, disconnectApps: boolean): Promise<AppsAtPasswordChange> {
  if (!disconnectApps) return { status: "kept" };
  if (isAdmin(user) || !isOAuthOn()) {
    logger.warn({ userId: user.id }, "choice to disconnect the apps ignored: the account has no apps");
    return { status: "kept" };
  }
  const revoked = await grantService.revokeAllGrants(user);
  if (!revoked.ok) {
    logger.error({ userId: user.id }, "password changed, but the apps could not be disconnected");
    return { status: "failed" };
  }
  return { status: "disconnected", count: revoked.value.count };
}

/**
 * Changes the own password of the user of the session, at any time after the forced password change, and ends all
 * other sessions of the user; the request gets a new session. A user who still has the first password is refused
 * with `first-password-pending`: the forced change comes first. The password is changed and counted as
 * `changeCountedPassword()` describes, with the client address group of the request (`clientAddressGroup`, as for
 * `logIn()`).
 *
 * With `disconnectApps`, all connected apps of the user are disconnected as well, but only once the password is
 * changed and the sessions are ended, so that the apps are never lost without a change. When that fails, the change
 * stands and the result says so. Nothing changes unless the password is changed.
 */
export async function changeOwnPassword(
  input: PasswordChangeInput,
  headers: Headers,
  clientAddressGroup: string,
  disconnectApps: boolean,
): Promise<Result<OwnPasswordChanged, ChangeOwnPasswordError>> {
  let user: SessionUser | null;
  try {
    user = await getSessionUser(headers);
  } catch (err) {
    logger.error({ err }, "failed to change the password");
    return { ok: false, error: { code: "failed" } };
  }
  if (!user) return { ok: false, error: { code: "not-logged-in" } };
  if (user.mustChangePassword) return { ok: false, error: { code: "first-password-pending" } };

  const changed = await changeCountedPassword(user, input, headers, clientAddressGroup, "password");
  if (!changed.ok) return changed;

  const apps = await disconnectAppsAfterChange(user, disconnectApps);
  logger.info(
    {
      userId: user.id,
      name: user.name,
      appsDisconnected: apps.status === "disconnected",
      disconnectedApps: apps.status === "disconnected" ? apps.count : 0,
    },
    "password changed",
  );
  return { ok: true, value: { user, headers: changed.value, apps } };
}
