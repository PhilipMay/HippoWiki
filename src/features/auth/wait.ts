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

/** At most this many logins for a user name are counted per hour, from all client addresses together. */
export const MAX_ATTEMPTS_PER_WINDOW = 20;
/** How long the window of a user name lasts, from the first login counted in it. */
export const NAME_WINDOW_MS = 60 * 60_000;

/** The window of a user name: how many logins were counted in it, and when the first of them was. */
export type NameWindow = { attempts: number; startedAt: Date };

/** Whether the hour of the window is over at the given time, so that the next login starts a new one. */
export function isWindowOver(window: NameWindow, now: Date): boolean {
  return now.getTime() >= window.startedAt.getTime() + NAME_WINDOW_MS;
}

/**
 * How long the next login for a user name has to wait for its window, in milliseconds: nothing without a window, for a
 * window whose hour is over and for one with fewer than 20 logins; otherwise the time until the hour is over.
 */
export function waitForWindow(window: NameWindow | null, now: Date): number {
  if (!window || isWindowOver(window, now) || window.attempts < MAX_ATTEMPTS_PER_WINDOW) return 0;
  return window.startedAt.getTime() + NAME_WINDOW_MS - now.getTime();
}
