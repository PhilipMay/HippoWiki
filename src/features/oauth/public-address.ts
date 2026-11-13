// Whether an IP address is a public one, for the fetch of a client's metadata document: the server must not be made
// to ask an address of its own network (server-side request forgery). Pure, apart from `node:net`.

import { BlockList, isIP } from "node:net";

/** The IPv4 ranges that are not public addresses (the special-purpose registry of IANA). */
const SPECIAL_IPV4: readonly [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space of carriers
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, with the metadata services of cloud providers
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relays
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, with the broadcast address
];

/**
 * The ranges inside the global unicast space of IPv6 (`2000::/3`) that are not public addresses. Everything outside
 * `2000::/3` is refused as a whole: loopback, unique-local, link-local, multicast, IPv4-mapped and NAT64 addresses.
 */
const SPECIAL_IPV6: readonly [string, number][] = [
  ["2001::", 23], // protocol assignments, with Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, which carries an IPv4 address
  ["3fff::", 20], // documentation
];

const specialIpv4 = new BlockList();
for (const [network, prefix] of SPECIAL_IPV4) specialIpv4.addSubnet(network, prefix, "ipv4");

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");

const specialIpv6 = new BlockList();
for (const [network, prefix] of SPECIAL_IPV6) specialIpv6.addSubnet(network, prefix, "ipv6");

/**
 * Whether the text is a public IP address: one that is not loopback, private, link-local, unique-local, multicast,
 * reserved or otherwise special. An IPv4-mapped IPv6 address is never public, whatever IPv4 address it carries, and
 * neither is a text that is no address.
 */
export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !specialIpv4.check(address, "ipv4");
    case 6:
      return globalIpv6.check(address, "ipv6") && !specialIpv6.check(address, "ipv6");
    default:
      return false;
  }
}
