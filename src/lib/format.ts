/**
 * Formats a point in time for display, e.g. "Nov 10, 2026, 4:34 PM". Without `timeZone`, the time zone of the server
 * is used; call it only in Server Components so that server and browser never render different text.
 */
export function formatDateTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}

/** The units of `formatBytes()`, each 1024 times the one before it. */
const BYTE_UNITS = ["B", "KiB", "MiB", "GiB"] as const;

/**
 * Formats a size in bytes for display in binary units, with at most one decimal and none for a whole number, e.g.
 * "512 B", "1.5 KiB" or "25 MiB" for 26,214,400 bytes. The same in the server and the browser.
 */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${BYTE_UNITS[unit]}`;
}
