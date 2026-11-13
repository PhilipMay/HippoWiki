import { describe, expect, it } from "vitest";

import { isPublicAddress } from "@/features/oauth/public-address";

describe("isPublicAddress", () => {
  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "160.79.104.10",
    "172.15.255.255",
    "172.32.0.0",
    "100.63.255.255",
    "100.128.0.0",
    "192.167.255.255",
    "192.169.0.0",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
    "2001:4860:4860::8888",
    "2600::1",
    "3ffe::1",
  ])("is true for the public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ["this network", "0.0.0.0"],
    ["this network", "0.1.2.3"],
    ["private", "10.0.0.1"],
    ["private", "10.255.255.255"],
    ["shared address space", "100.64.0.1"],
    ["shared address space", "100.127.255.255"],
    ["loopback", "127.0.0.1"],
    ["loopback", "127.255.255.254"],
    ["link-local", "169.254.0.1"],
    ["the metadata service of a cloud provider", "169.254.169.254"],
    ["private", "172.16.0.1"],
    ["private", "172.31.255.255"],
    ["protocol assignments", "192.0.0.1"],
    ["documentation", "192.0.2.1"],
    ["6to4 relays", "192.88.99.1"],
    ["private", "192.168.0.1"],
    ["private", "192.168.255.255"],
    ["benchmarking", "198.18.0.1"],
    ["benchmarking", "198.19.255.255"],
    ["documentation", "198.51.100.1"],
    ["documentation", "203.0.113.1"],
    ["multicast", "224.0.0.1"],
    ["multicast", "239.255.255.255"],
    ["reserved", "240.0.0.1"],
    ["broadcast", "255.255.255.255"],
  ])("is false for the IPv4 address of %s, %s", (_case, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ["the unspecified address", "::"],
    ["loopback", "::1"],
    ["unique-local", "fc00::1"],
    ["unique-local", "fd12:3456:789a::1"],
    ["link-local", "fe80::1"],
    ["site-local", "fec0::1"],
    ["multicast", "ff02::1"],
    ["NAT64, which carries an IPv4 address", "64:ff9b::7f00:1"],
    ["the discard prefix", "100::1"],
    ["Teredo", "2001::1"],
    ["protocol assignments", "2001:1ff::1"],
    ["documentation", "2001:db8::1"],
    ["6to4, which carries an IPv4 address", "2002:7f00:1::1"],
    ["documentation", "3fff::1"],
    ["an address above the global unicast space", "4000::1"],
  ])("is false for the IPv6 address of %s, %s", (_case, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ["a loopback address", "::ffff:127.0.0.1"],
    ["a private address", "::ffff:10.0.0.1"],
    ["a private address in hex", "::ffff:c0a8:1"],
    ["a public address", "::ffff:8.8.8.8"],
    ["an IPv4-compatible address", "::127.0.0.1"],
  ])("is false for an IPv4-mapped IPv6 address with %s, %s", (_case, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "",
    "localhost",
    "wiki.example.com",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "8.8.8.8:443",
    "[2606:4700::1]",
    "fe80::1%eth0",
    " 8.8.8.8",
  ])("is false for %j, which is no address", (text) => {
    expect(isPublicAddress(text)).toBe(false);
  });
});
