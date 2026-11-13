// The client address group of a request: the address of the client as the reverse proxies in front of the server saw
// it, for the wait after failed logins. Next.js never shows the application the address of the connecting peer, so
// the only source is `X-Forwarded-For`, and it is read only when `HIPPOWIKI_TRUSTED_PROXIES` says how many reverse
// proxies added an entry to it. The leftmost entry is never used, because a client can write it. A pure helper, no
// server-only imports; it does not log, its caller does.

import { isIP } from "node:net";

/**
 * The group of every client whose address is not known: all of them count together. A login never goes uncounted
 * because its address is unknown; it only shares its count with the other unknown ones.
 */
export const SHARED_CLIENT_ADDRESS = "shared";

/**
 * Why a request fell into `SHARED_CLIENT_ADDRESS` although a header was to be read: `X-Forwarded-For` is missing or
 * empty, it has fewer entries than there are trusted proxies, or the entry of the last trusted proxy is not an address.
 */
export type ClientAddressFallback = "missing-header" | "too-few-entries" | "not-an-address";

/** The group of a request, and why it is `SHARED_CLIENT_ADDRESS` when it fell back to it (`null` otherwise). */
export type ClientAddress = { group: string; fallback: ClientAddressFallback | null };

/**
 * The client address group of a request with the given headers, behind the given number of trusted reverse proxies.
 *
 * - With 0 trusted proxies no header is read, and every request is in `SHARED_CLIENT_ADDRESS`.
 * - With n, the group comes from the n-th entry from the right of `X-Forwarded-For`: the address that the outermost
 *   trusted proxy saw. `Headers.get()` joins several header lines with commas, so all lines count as one list.
 * - `X-Real-Ip` and `Forwarded` are never read.
 */
export function clientAddressGroup(headers: Headers, trustedProxies: number): ClientAddress {
  if (trustedProxies <= 0) return { group: SHARED_CLIENT_ADDRESS, fallback: null };
  const value = headers.get("x-forwarded-for");
  if (value === null || value.trim() === "") return { group: SHARED_CLIENT_ADDRESS, fallback: "missing-header" };
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.length < trustedProxies) return { group: SHARED_CLIENT_ADDRESS, fallback: "too-few-entries" };
  const group = addressGroup(entries[entries.length - trustedProxies] ?? "");
  return group === null ? { group: SHARED_CLIENT_ADDRESS, fallback: "not-an-address" } : { group, fallback: null };
}

/** An IPv4 address with a port, such as `203.0.113.7:51234`. */
const IPV4_WITH_PORT = /^([^:]+):\d{1,5}$/;
/** An IPv6 address in square brackets, with or without a port, such as `[2001:db8::1]:443`. */
const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d{1,5})?$/;

/**
 * The group of an entry of `X-Forwarded-For`, or `null` if it is not an address: an IPv4 address is its own group, an
 * IPv6 address is in the group of its /64, because one customer of a provider controls at least that many addresses
 * and could otherwise get a fresh wait with every new address. A port, the square brackets around an IPv6 address and
 * a zone id are dropped; an IPv4-mapped IPv6 address counts as its IPv4 address.
 */
function addressGroup(entry: string): string | null {
  let address = BRACKETED_IPV6.exec(entry)?.[1] ?? IPV4_WITH_PORT.exec(entry)?.[1] ?? entry;
  if (address.includes(":")) address = address.replace(/%[^%]*$/, "");
  switch (isIP(address)) {
    case 4:
      return address;
    case 6:
      return ipv6Group(ipv6Blocks(address));
    default:
      return null;
  }
}

/** The eight 16-bit blocks of an IPv6 address that `isIP()` has accepted, with an IPv4 part at the end resolved. */
function ipv6Blocks(address: string): number[] {
  let text = address.toLowerCase();
  const ipv4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (ipv4Tail) {
    const bytes = ipv4Bytes(ipv4Tail[0]);
    text = `${text.slice(0, ipv4Tail.index)}${(bytes[0] * 256 + bytes[1]).toString(16)}:${(bytes[2] * 256 + bytes[3]).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const headBlocks = head ? head.split(":") : [];
  const tailBlocks = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : Array<string>(8 - headBlocks.length - tailBlocks.length).fill("0");
  return [...headBlocks, ...zeros, ...tailBlocks].map((block) => Number.parseInt(block, 16));
}

/** The four bytes of a dotted IPv4 address that `isIP()` has accepted. */
function ipv4Bytes(address: string): [number, number, number, number] {
  const [a = 0, b = 0, c = 0, d = 0] = address.split(".").map(Number);
  return [a, b, c, d];
}

/** The group of an IPv6 address given as its eight blocks: its /64, or its IPv4 address if it is IPv4-mapped. */
function ipv6Group(blocks: number[]): string {
  const ipv4Mapped = blocks.slice(0, 5).every((block) => block === 0) && blocks[5] === 0xffff;
  if (ipv4Mapped) {
    return blocks
      .slice(6)
      .flatMap((block) => [block >> 8, block & 0xff])
      .join(".");
  }
  return `${blocks
    .slice(0, 4)
    .map((block) => block.toString(16))
    .join(":")}::/64`;
}

/** A /64 as `ipv6Group()` writes it: four blocks in lower case without leading zeros, then `::/64`. */
const IPV6_GROUP = /^(?:(?:0|[1-9a-f][0-9a-f]{0,3}):){4}:\/64$/;

/**
 * Whether the value is a client address group as this module writes them: `SHARED_CLIENT_ADDRESS`, an IPv4 address
 * or a /64 in the spelling of `clientAddressGroup()`.
 */
export function isClientAddressGroup(value: string): boolean {
  return value === SHARED_CLIENT_ADDRESS || isIP(value) === 4 || IPV6_GROUP.test(value);
}
