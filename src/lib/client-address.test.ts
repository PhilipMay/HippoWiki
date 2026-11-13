import { describe, expect, it } from "vitest";

import { SHARED_CLIENT_ADDRESS, clientAddressGroup, isClientAddressGroup } from "@/lib/client-address";

/** The headers of a request with the given `X-Forwarded-For`, or without one for `null`. */
function forwardedFor(value: string | null, more: Record<string, string> = {}): Headers {
  const headers = new Headers(more);
  if (value !== null) headers.set("x-forwarded-for", value);
  return headers;
}

/** The group of a request with the given `X-Forwarded-For` behind one trusted proxy. */
function groupOf(value: string): string {
  return clientAddressGroup(forwardedFor(value), 1).group;
}

describe("clientAddressGroup", () => {
  describe("with 0 trusted proxies", () => {
    it.each([null, "203.0.113.7", "198.51.100.9, 203.0.113.7", "unknown"])(
      "puts a request with X-Forwarded-For %j into the shared group without a reason",
      (value) => {
        expect(clientAddressGroup(forwardedFor(value, { "x-real-ip": "192.0.2.1" }), 0)).toEqual({
          group: SHARED_CLIENT_ADDRESS,
          fallback: null,
        });
      },
    );
  });

  describe("with 1 trusted proxy", () => {
    it("takes a single entry as the group", () => {
      expect(clientAddressGroup(forwardedFor("203.0.113.7"), 1)).toEqual({ group: "203.0.113.7", fallback: null });
    });

    it("takes the rightmost of several entries, so a forged entry to its left changes nothing", () => {
      expect(groupOf("198.51.100.9, 203.0.113.7")).toBe("203.0.113.7");
      expect(groupOf("1.1.1.1,2.2.2.2 ,  203.0.113.7")).toBe("203.0.113.7");
    });

    it("reads the lines of a header that was sent several times as one list", () => {
      const headers = new Headers();
      headers.append("x-forwarded-for", "198.51.100.9");
      headers.append("x-forwarded-for", "203.0.113.7");

      expect(clientAddressGroup(headers, 1).group).toBe("203.0.113.7");
    });
  });

  describe("with 2 trusted proxies", () => {
    it("takes the second entry from the right", () => {
      expect(clientAddressGroup(forwardedFor("192.0.2.1, 203.0.113.7, 10.0.0.2"), 2)).toEqual({
        group: "203.0.113.7",
        fallback: null,
      });
    });

    it("falls back to the shared group with a reason when there are fewer than 2 entries", () => {
      expect(clientAddressGroup(forwardedFor("203.0.113.7"), 2)).toEqual({
        group: SHARED_CLIENT_ADDRESS,
        fallback: "too-few-entries",
      });
    });
  });

  it.each([
    [null, "missing-header"],
    ["", "missing-header"],
    ["   ", "missing-header"],
    ["text", "not-an-address"],
    ["unknown", "not-an-address"],
    ["203.0.113.7/path", "not-an-address"],
    ["203.0.113.7, ", "not-an-address"],
    ["203.0.113.7,", "not-an-address"],
    ["203.0.113.007", "not-an-address"],
    ["203.0.113.7:port", "not-an-address"],
  ])("puts X-Forwarded-For %j into the shared group with the reason %s", (value, fallback) => {
    expect(clientAddressGroup(forwardedFor(value), 1)).toEqual({ group: SHARED_CLIENT_ADDRESS, fallback });
  });

  it("never reads X-Real-Ip or Forwarded", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.7", forwarded: "for=203.0.113.7" });

    expect(clientAddressGroup(headers, 1)).toEqual({ group: SHARED_CLIENT_ADDRESS, fallback: "missing-header" });
  });

  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["203.0.113.7:51234", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["[::ffff:203.0.113.7]:443", "203.0.113.7"],
    ["::ffff:cb00:7107", "203.0.113.7"],
    ["2001:db8:0:1::1", "2001:db8:0:1::/64"],
    ["2001:0db8:0000:0001:0000:0000:0000:0001", "2001:db8:0:1::/64"],
    ["2001:DB8:0:1::AB", "2001:db8:0:1::/64"],
    ["[2001:db8:0:1::1]:443", "2001:db8:0:1::/64"],
    ["[2001:db8:0:1::1]", "2001:db8:0:1::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["[fe80::1%25eth0]:8080", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["2001:db8::", "2001:db8:0:0::/64"],
    ["2001:db8:1:2:3:4:192.0.2.1", "2001:db8:1:2::/64"],
  ])("gives the entry %j the group %j", (entry, group) => {
    expect(groupOf(entry)).toBe(group);
  });

  it("gives two addresses of one /64 the same group, and two of different /64 different ones", () => {
    expect(groupOf("2001:db8:0:1::1")).toBe(groupOf("2001:db8:0:1:ffff:ffff:ffff:ffff"));
    expect(groupOf("2001:db8:0:1::1")).not.toBe(groupOf("2001:db8:0:2::1"));
  });
});

describe("isClientAddressGroup", () => {
  it.each([SHARED_CLIENT_ADDRESS, "203.0.113.7", "2001:db8:0:1::/64", "0:0:0:0::/64", "ffff:ffff:ffff:ffff::/64"])(
    "accepts %j",
    (value) => {
      expect(isClientAddressGroup(value)).toBe(true);
    },
  );

  it.each([
    "2001:db8:0:1::1",
    "2001:db8:0:1:0:0:0:1",
    "2001:0db8:0:1::/64",
    "2001:DB8:0:1::/64",
    "2001:db8::1::/64",
    "2001:db8:0:1::/48",
    "2001:db8:1::/64",
    "::ffff:203.0.113.7",
    "203.0.113.007",
    "Shared",
    "",
    "unknown",
  ])("refuses %j", (value) => {
    expect(isClientAddressGroup(value)).toBe(false);
  });

  it("accepts every group that clientAddressGroup() gives", () => {
    for (const entry of ["203.0.113.7", "2001:db8:0:1::1", "::ffff:203.0.113.7", "fe80::1%eth0", "unknown"]) {
      expect(isClientAddressGroup(groupOf(entry))).toBe(true);
    }
  });
});
