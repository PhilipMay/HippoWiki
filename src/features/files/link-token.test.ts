import { createHmac, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  checkLinkToken,
  checkUploadLinkToken,
  expiryOf,
  isWithinLifetime,
  signLinkToken,
  signUploadLinkToken,
  type UploadLink,
} from "@/features/files/link-token";
import { NAME_MAX_LENGTH } from "@/lib/name-limits";

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

describe("an upload link", () => {
  const TAB = "3b2a1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d";
  const FILE = "9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6e";
  /** An upload link for a new version of a file in a tab, as the wiki makes it. */
  const LINK: UploadLink = {
    grant: GRANT,
    tab: TAB,
    name: "diagram.png",
    size: 4096,
    strip: true,
    file: FILE,
    lockVersion: 3,
    exp: EXP,
  };
  const uploadToken = signUploadLinkToken(KEY, LINK);
  const [uploadDataPart = "", uploadSignature = ""] = uploadToken.split(".");

  /** The data of an upload link as the wiki makes it, with the given fields changed. */
  function uploadData(changes: Record<string, unknown> = {}): Record<string, unknown> {
    return { use: "file-upload-link", v: 1, ...LINK, ...changes };
  }

  it("encodes exactly the fields of the link and its own use, signed like a download link", () => {
    expect(JSON.parse(Buffer.from(uploadDataPart, "base64url").toString("utf8"))).toStrictEqual(uploadData());
    expect(uploadSignature).toBe(createHmac("sha256", KEY).update(uploadDataPart).digest("base64url"));
  });

  it("gives the data of a token signed with the key, for a new version and for a new file directly in the folder", () => {
    expect(checkUploadLinkToken(KEY, uploadToken)).toStrictEqual({ ok: true, data: uploadData() });
    const newFile = { ...LINK, tab: null, file: null, lockVersion: null, strip: false };
    expect(checkUploadLinkToken(KEY, signUploadLinkToken(KEY, newFile))).toStrictEqual({
      ok: true,
      data: { use: "file-upload-link", v: 1, ...newFile },
    });
  });

  it("refuses a download token as an upload token, and an upload token as a download token", () => {
    expect(checkUploadLinkToken(KEY, token)).toStrictEqual({ ok: false, reason: "bad-data" });
    expect(checkLinkToken(KEY, uploadToken)).toStrictEqual({ ok: false, reason: "bad-data" });
  });

  it("refuses a token signed with another key, a changed signature and another spelling of it", () => {
    expect(checkUploadLinkToken(randomBytes(32), uploadToken)).toStrictEqual({ ok: false, reason: "bad-signature" });
    const last = uploadSignature.at(-1) === "A" ? "B" : "A";
    expect(checkUploadLinkToken(KEY, `${uploadDataPart}.${uploadSignature.slice(0, -1)}${last}`)).toStrictEqual({
      ok: false,
      reason: "bad-signature",
    });
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const other = alphabet[alphabet.indexOf(uploadSignature.at(-1) ?? "") ^ 1] ?? "";
    expect(checkUploadLinkToken(KEY, `${uploadDataPart}.${uploadSignature.slice(0, -1)}${other}`)).toStrictEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it.each([
    ["a data part with =", `${uploadDataPart}=.${uploadSignature}`],
    ["a data part with +", `+${uploadDataPart.slice(1)}.${uploadSignature}`],
    ["a signature with /", `${uploadDataPart}./${uploadSignature.slice(1)}`],
    ["a token without a dot", `${uploadDataPart}${uploadSignature}`],
    ["a data part of 10,000 characters", `${"A".repeat(10_000)}.${uploadSignature}`],
  ])("refuses %s by its shape", (_, value) => {
    expect(checkUploadLinkToken(KEY, value)).toStrictEqual({ ok: false, reason: "malformed" });
  });

  it.each<[string, unknown]>([
    ["the use of a download link", uploadData({ use: "file-link" })],
    ["another format", uploadData({ v: 2 })],
    ["an extra field", uploadData({ folder: "handbook" })],
    ["an extra field replace", uploadData({ replace: 3 })],
    ...(["grant", "tab", "name", "size", "strip", "file", "lockVersion", "exp", "use", "v"] as const).map(
      (field): [string, unknown] => [`a missing ${field}`, uploadData({ [field]: undefined })],
    ),
    ["a grant that is no UUID", uploadData({ grant: "not-a-grant" })],
    ["a tab that is no UUID", uploadData({ tab: "guides" })],
    ["a name against the rule", uploadData({ name: "Diagram.PNG" })],
    ["a name with a space around it", uploadData({ name: " diagram.png" })],
    ["a name without an extension", uploadData({ name: "diagram" })],
    ["a name longer than the limit", uploadData({ name: `${"a".repeat(NAME_MAX_LENGTH + 1)}.png` })],
    ["a name as a number", uploadData({ name: 3 })],
    ["the size as a string", uploadData({ size: "4096" })],
    ["the size as a fraction", uploadData({ size: 4096.5 })],
    ["a size of 0", uploadData({ size: 0 })],
    ["strip as a string", uploadData({ strip: "true" })],
    ["strip as a number", uploadData({ strip: 1 })],
    ["a file that is no UUID", uploadData({ file: "diagram.png" })],
    ["the lock version as a string", uploadData({ lockVersion: "3" })],
    ["a lock version of 0", uploadData({ lockVersion: 0 })],
    ["a file without a lock version", uploadData({ lockVersion: null })],
    ["a lock version without a file", uploadData({ file: null })],
    ["exp as a string", uploadData({ exp: String(EXP) })],
    ["an array", [uploadData()]],
    ["null", null],
  ])("refuses correctly signed data with %s", (_, data) => {
    expect(checkUploadLinkToken(KEY, signedData(data))).toStrictEqual({ ok: false, reason: "bad-data" });
  });

  it("fits the data of the longest name with the largest numbers into the bound of a token", () => {
    const longest = signUploadLinkToken(KEY, {
      ...LINK,
      name: `${"a".repeat(NAME_MAX_LENGTH)}.webp`,
      size: Number.MAX_SAFE_INTEGER,
      strip: false,
      lockVersion: 2_147_483_647,
      exp: 9_999_999_999,
    });
    expect(checkUploadLinkToken(KEY, longest)).toMatchObject({ ok: true });
    // The bound of the data part, 512 characters, which a download link keeps as well.
    expect(longest.split(".")[0]?.length).toBeLessThanOrEqual(512);
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
