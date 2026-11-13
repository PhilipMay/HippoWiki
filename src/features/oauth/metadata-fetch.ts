// Fetches the metadata document of an OAuth client (Client ID Metadata Document). The URL comes from whoever sends an
// authorization request, so the fetch must not be a way to make the server ask an address of its own network:
//
// - `https` only, port 443 only, no redirects followed, no credentials in the URL (`parseMetadataUrl()` checks the
//   URL; this module checks it again).
// - The host is resolved first and refused when any of its addresses is not a public one. The connection then goes to
//   the address that was checked, so a host name that resolves to another address a moment later (DNS rebinding)
//   cannot change it.
// - A timeout of five seconds for everything, at most 10 KB of response body, and only `application/json`.
//
// It is a module of its own so that the tests of the service can replace it. Uses `node:dns` and `node:https`, so
// only the server imports it.

import { lookup } from "node:dns/promises";
import { request } from "node:https";
import type { LookupFunction } from "node:net";

import { isPublicAddress } from "@/features/oauth/public-address";
import { parseMetadataUrl } from "@/features/oauth/schema";

/** How long the whole fetch may take: resolving, connecting and reading. */
export const METADATA_TIMEOUT_MS = 5000;

/** The most bytes of a response body that are read. */
export const METADATA_MAX_BYTES = 10 * 1024;

/** A fetched document as parsed JSON with the `Cache-Control` header of its response, or why there is none. */
export type MetadataFetchResult =
  { ok: true; document: unknown; cacheControl: string | null } | { ok: false; reason: string };

/** An address of a host as `dns.lookup()` returns it. */
type ResolvedAddress = { address: string; family: number };

/**
 * A `lookup` for the connection that knows only the address that was checked: whatever host it is asked for, it
 * answers with that address, in the shape the caller asks for.
 */
function pinnedLookup({ address, family }: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/** The media type of a `Content-Type` header, without its parameters, in lower case. */
function mediaTypeOf(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Fetches the metadata document at the given URL. It never throws: a URL that is not allowed, a host with an address
 * that is not public, a redirect, another status than 200, another content type than `application/json`, a body of
 * more than 10 KB or one that is not JSON, and a fetch that takes longer than five seconds all give a reason.
 */
export async function fetchMetadataDocument(metadataUrl: string): Promise<MetadataFetchResult> {
  if (parseMetadataUrl(metadataUrl) === null) return { ok: false, reason: "url-not-allowed" };
  // One clock for everything: resolving the host, connecting and reading the body.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), METADATA_TIMEOUT_MS);
  try {
    return await fetchWithin(new URL(metadataUrl), timeout.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches the document at the URL, which has been checked, until the signal says that the time is over. */
async function fetchWithin(url: URL, signal: AbortSignal): Promise<MetadataFetchResult> {
  let addresses: ResolvedAddress[];
  try {
    // An IPv6 address in a URL is in square brackets; `lookup()` takes it without them.
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
    addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
      }),
    ]);
  } catch {
    return { ok: false, reason: signal.aborted ? "timeout" : "host-not-resolved" };
  }
  const target = addresses[0];
  if (!target) return { ok: false, reason: "host-not-resolved" };
  // Every address must be public, not only the one that is used: a host that also has a private address is refused.
  if (!addresses.every(({ address }) => isPublicAddress(address))) return { ok: false, reason: "address-not-public" };

  return new Promise<MetadataFetchResult>((resolve) => {
    const outgoing = request(
      {
        protocol: "https:",
        // The host name stays, for the certificate and the `Host` header; only its address is fixed.
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { accept: "application/json", "user-agent": "HippoWiki" },
        lookup: pinnedLookup(target),
        // No connection is kept for a later request.
        agent: false,
        // Node ends the request with an error when the time is over.
        signal,
      },
      (response) => {
        const fail = (reason: string) => {
          response.destroy();
          resolve({ ok: false, reason });
        };
        // A redirect is not followed: its target would not have been checked.
        if (response.statusCode !== 200) return fail(`status-${response.statusCode ?? "unknown"}`);
        if (mediaTypeOf(response.headers["content-type"]) !== "application/json") return fail("not-json");
        if (Number(response.headers["content-length"] ?? 0) > METADATA_MAX_BYTES) return fail("too-large");

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > METADATA_MAX_BYTES) fail("too-large");
          else chunks.push(chunk);
        });
        response.on("error", () => resolve({ ok: false, reason: signal.aborted ? "timeout" : "response-failed" }));
        response.on("end", () => {
          if (size > METADATA_MAX_BYTES) return;
          let document: unknown;
          try {
            document = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return resolve({ ok: false, reason: "not-json" });
          }
          const cacheControl = response.headers["cache-control"];
          resolve({ ok: true, document, cacheControl: cacheControl ?? null });
        });
      },
    );
    outgoing.on("error", () => resolve({ ok: false, reason: signal.aborted ? "timeout" : "request-failed" }));
    outgoing.end();
  });
}
