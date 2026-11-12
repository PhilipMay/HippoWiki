// The wait after failed logins: guessing the password of a user name gets slow. A pure helper, no server-only imports.

/** After this many failed logins in a row for a user name, the next one has to wait. */
export const FAILURES_BEFORE_WAIT = 5;
/** The wait after the fifth failure. */
export const FIRST_WAIT_MS = 60_000;
/** The longest wait. */
export const MAX_WAIT_MS = 15 * 60_000;

/**
 * How long the next login for a user name has to wait after the given number of failed logins in a row, counted from
 * the last of them, in milliseconds: nothing for fewer than 5 failures, 1 minute for 5, twice as long for each further
 * one, and never more than 15 minutes.
 */
export function waitAfterFailures(failures: number): number {
  if (failures < FAILURES_BEFORE_WAIT) return 0;
  return Math.min(FIRST_WAIT_MS * 2 ** (failures - FAILURES_BEFORE_WAIT), MAX_WAIT_MS);
}
