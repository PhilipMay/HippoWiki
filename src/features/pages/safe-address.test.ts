import { describe, expect, it } from "vitest";

import { isSafeAddress } from "@/features/pages/safe-address";

describe("isSafeAddress", () => {
  it("allows only relative addresses and the safe protocols", () => {
    for (const address of [
      "https://a",
      "HTTP://a",
      "mailto:a@b",
      "irc://a",
      "ircs://a",
      "xmpp:a@b",
      "/a:b",
      "a?b:c",
      "#a:b",
      "a",
    ]) {
      expect(isSafeAddress(address)).toBe(true);
    }
    for (const address of [
      "javascript:a",
      "JAVASCRIPT:a",
      "vbscript:a",
      "data:a",
      "file:///a",
      "java%09script:a",
      ":a",
    ]) {
      expect(isSafeAddress(address)).toBe(false);
    }
  });
});
