import { createHmac, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { checkLinkToken, expiryOf, isWithinLifetime, signLinkToken } from "@/features/files/link-token";

const KEY = randomBytes(32);
const GRANT = "6f1c2a7e-0b1d-4c9a-9f3e-2d5b8a1c4e70";
const VERSION = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
const EXP = 1_800_000_000;

/** A token of the given data, as it is encoded, signed correctly with the key. */
function signedData(data: unknown): string {
  const dataPart = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${dataPart}.${createHmac("sha256", KEY).update(dataPart).digest("base64url")}`;
}

/** The data of a link as the wiki makes it, with the given fields changed. */
function linkData(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return { use: "file-link", v: 1, grant: GRANT, version: VERSION, exp: EXP, ...changes };
}

const token = signLinkToken(KEY, { grant: GRANT, version: VERSION, exp: EXP });
const [dataPart = "", signaturePart = ""] = token.split(".");

describe("signLinkToken", () => {
  it("encodes exactly the five fields of the link in base64url without padding", () => {
    expect(dataPart).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(dataPart, "base64url").toString("utf8"))).toStrictEqual({
      use: "file-link",
      v: 1,
      grant: GRANT,
      version: VERSION,
      exp: EXP,
    });
  });

  it("signs the data part with the HMAC-SHA256 of the key, in base64url without padding", () => {
    expect(signaturePart).toBe(createHmac("sha256", KEY).update(dataPart).digest("base64url"));
    expect(signaturePart).toHaveLength(43);
  });
});

describe("checkLinkToken", () => {
  it("gives the data of a token signed with the key", () => {
    expect(checkLinkToken(KEY, token)).toStrictEqual({ ok: true, data: linkData() });
  });

  it("refuses a token signed with another key", () => {
    expect(checkLinkToken(randomBytes(32), token)).toStrictEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses a signature that differs in one character", () => {
    const last = signaturePart.at(-1) === "A" ? "B" : "A";
    expect(checkLinkToken(KEY, `${dataPart}.${signaturePart.slice(0, -1)}${last}`)).toStrictEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("refuses another spelling of the last character of the signature that decodes to the same bytes", () => {
    // The last of 43 characters carries two unused bits, so four characters decode to the same 32 bytes.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const index = alphabet.indexOf(signaturePart.at(-1) ?? "");
    const other = alphabet[index ^ 1] ?? "";
    const spelling = `${signaturePart.slice(0, -1)}${other}`;
    expect(Buffer.from(spelling, "base64url")).toEqual(Buffer.from(signaturePart, "base64url"));

    expect(checkLinkToken(KEY, `${dataPart}.${spelling}`)).toStrictEqual({ ok: false, reason: "bad-signature" });
  });

  it.each([
    ["a token without a dot", `${dataPart}${signaturePart}`],
    ["a token with two dots", `${dataPart}.${signaturePart}.x`],
    ["a data part with =", `${dataPart}=.${signaturePart}`],
    ["a data part with +", `+${dataPart.slice(1)}.${signaturePart}`],
    ["a data part with /", `/${dataPart.slice(1)}.${signaturePart}`],
    ["a signature with =", `${dataPart}.${signaturePart.slice(0, -1)}=`],
    ["a signature with +", `${dataPart}.+${signaturePart.slice(1)}`],
    ["a signature with /", `${dataPart}./${signaturePart.slice(1)}`],
    ["a data part of 10,000 characters", `${"A".repeat(10_000)}.${signaturePart}`],
    ["an empty data part", `.${signaturePart}`],
    ["a signature of 42 characters", `${dataPart}.${signaturePart.slice(0, 42)}`],
    ["a signature of 44 characters", `${dataPart}.${signaturePart}A`],
    ["an empty token", ""],
  ])("refuses %s by its shape", (_, value) => {
    expect(checkLinkToken(KEY, value)).toStrictEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a data part of 10,000 characters even when it is signed with the key", () => {
    const longPart = "A".repeat(10_000);
    const value = `${longPart}.${createHmac("sha256", KEY).update(longPart).digest("base64url")}`;
    expect(checkLinkToken(KEY, value)).toStrictEqual({ ok: false, reason: "malformed" });
  });

  it.each([
    ["another use", linkData({ use: "session" })],
    ["another format", linkData({ v: 2 })],
    ["the format as a string", linkData({ v: "1" })],
    ["an extra field", linkData({ path: "/files/x.png" })],
    ["a missing grant", linkData({ grant: undefined })],
    ["a missing version", linkData({ version: undefined })],
    ["a missing expiry", linkData({ exp: undefined })],
    ["a missing use", linkData({ use: undefined })],
    ["exp as a string", linkData({ exp: String(EXP) })],
    ["exp as a fraction", linkData({ exp: EXP + 0.5 })],
    ["a version that is no UUID", linkData({ version: "3" })],
    ["a grant that is no UUID", linkData({ grant: "not-a-grant" })],
    ["an array", [linkData()]],
    ["a plain number", EXP],
    ["null", null],
  ])("refuses correctly signed data with %s", (_, data) => {
    expect(checkLinkToken(KEY, signedData(data))).toStrictEqual({ ok: false, reason: "bad-data" });
  });

  it("refuses correctly signed data that is no JSON", () => {
    const part = Buffer.from("not json").toString("base64url");
    const value = `${part}.${createHmac("sha256", KEY).update(part).digest("base64url")}`;
    expect(checkLinkToken(KEY, value)).toStrictEqual({ ok: false, reason: "bad-data" });
  });
});

describe("the lifetime of a link", () => {
  const now = new Date("2026-11-23T10:00:00.400Z");
  const nowSeconds = Math.floor(now.getTime() / 1000);

  it("sets the expiry to now plus the lifetime, in whole seconds", () => {
    expect(expiryOf(now, 600)).toBe(nowSeconds + 600);
  });

  it("accepts a link made now with the lifetime", () => {
    expect(isWithinLifetime(expiryOf(now, 600), now, 600)).toBe(true);
  });

  it("accepts a link until its expiry", () => {
    const exp = expiryOf(now, 600);
    expect(isWithinLifetime(exp, new Date((exp - 1) * 1000), 600)).toBe(true);
  });

  it("refuses a link at and past its expiry", () => {
    const exp = expiryOf(now, 600);
    expect(isWithinLifetime(exp, new Date(exp * 1000), 600)).toBe(false);
    expect(isWithinLifetime(exp, new Date((exp + 1) * 1000), 600)).toBe(false);
  });

  it("refuses a link whose expiry lies further away than the lifetime", () => {
    expect(isWithinLifetime(nowSeconds + 601, now, 600)).toBe(false);
  });

  it("refuses a link made with a longer lifetime once the lifetime is lowered", () => {
    const exp = expiryOf(now, 3600);
    expect(isWithinLifetime(exp, now, 3600)).toBe(true);
    expect(isWithinLifetime(exp, now, 600)).toBe(false);
    // Once the time left is within the new lifetime, the link works again until its expiry.
    expect(isWithinLifetime(exp, new Date((exp - 600) * 1000), 600)).toBe(true);
  });
});
