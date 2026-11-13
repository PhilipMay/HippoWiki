// A diagnostic for the setup of a reverse proxy: with `HIPPOWIKI_LOG_CLIENT_ADDRESS=true` every request that passes
// the proxy of Next.js, and every login, logs the headers that say where the request came from. Next.js never shows
// the application the address of the connecting peer, so these headers are all it can know about the client. The log
// shows whether the reverse proxy writes them, whether a client can forge them and whether the container network
// keeps the real source address.

import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * The only headers that are logged. Cookies, `authorization` and the body are never read: they carry the session and
 * the password.
 */
export const PROBE_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-forwarded-port",
  "host",
] as const;

/** The longest value logged per header; a client could otherwise send a header of any size into the log. */
export const MAX_PROBE_VALUE_LENGTH = 200;

export type ProbeHeaders = Record<(typeof PROBE_HEADERS)[number], string | null>;

/** Where the probe was taken: in the proxy of Next.js, with the method and the path, or in the login action. */
export type ProbeSource = { source: "proxy"; method: string; path: string } | { source: "login" };

/** The probed headers of a request, `null` for a missing one, each value cut to `MAX_PROBE_VALUE_LENGTH`. */
export function readProbeHeaders(headers: Headers): ProbeHeaders {
  return Object.fromEntries(
    PROBE_HEADERS.map((name) => [name, headers.get(name)?.slice(0, MAX_PROBE_VALUE_LENGTH) ?? null]),
  ) as ProbeHeaders;
}

/** Logs the probed headers of a request, but only while `HIPPOWIKI_LOG_CLIENT_ADDRESS` is `true`. */
export function logClientAddressProbe(headers: Headers, where: ProbeSource): void {
  if (!getServerEnv().HIPPOWIKI_LOG_CLIENT_ADDRESS) return;
  // `info`, because the logger of a production server leaves out `debug`.
  logger.info({ ...where, headers: readProbeHeaders(headers) }, "client address probe");
}
