/**
 * Formats a point in time for display, e.g. "Nov 10, 2026, 4:34 PM". Without `timeZone`, the time zone of the server
 * is used; call it only in Server Components so that server and browser never render different text.
 */
export function formatDateTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}
