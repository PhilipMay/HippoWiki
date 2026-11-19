// The messages of a wait after wrong passwords, shared by the Server Actions of the login, the password changes and
// the consent page of OAuth: the same rounding of the minutes that are left. A pure helper, no server-only imports.

/** The minutes of a wait that are left, rounded up and at least 1, with their unit: "1 minute", "4 minutes". */
function waitMinutes(waitMs: number): string {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * The message of the wait after failed logins, with the minutes that are left. It is the same for known and unknown
 * user names.
 */
export function loginWaitMessage(waitMs: number): string {
  return `Too many failed logins. Please try again in ${waitMinutes(waitMs)}.`;
}

/**
 * The message of the wait at a check of the own password, such as a password change or the approval of an app: its
 * own wording, because it is not a login, but the same wait.
 */
export function wrongPasswordsWaitMessage(waitMs: number): string {
  return `Too many wrong passwords. Please try again in ${waitMinutes(waitMs)}.`;
}
