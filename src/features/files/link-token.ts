// The token of a signed link to a file, for a download or for an upload: the data of the link and its signature,
// `<data>.<signature>`, as a JWT writes them. The data is the JSON of exactly the fields of its kind in base64url
// without padding; the signature is the HMAC-SHA256 of exactly that encoded string with the key of the links, also
// base64url without padding. Both kinds share the key, the shape and the checks; the field `use` of the data tells them
// apart, so that a token of one kind fails the data check of the other. The data is only encoded, not encrypted: it
// holds ids, a name and numbers, never a secret. A pure module: the key, the time and the lifetime come from the caller
// (`link-service.ts`, `upload-link-service.ts`). Uses `node:crypto`, so only the server imports it.

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { NAME_MAX_LENGTH } from "@/lib/name-limits";
import { parseFileName } from "@/lib/names";

/**
 * What the data of a download link says it is for, so that a signature of this key never passes for another purpose.
 */
const LINK_USE = "file-link";

/** What the data of an upload link says it is for; a download link never passes for one, nor the other way round. */
const UPLOAD_LINK_USE = "file-upload-link";

/** The format of the data, so that a link of a later format never passes for this one. */
const LINK_FORMAT = 1;

/**
 * The longest data part that is checked further. A download link that the wiki makes has about 160 characters, an
 * upload link with the longest name about 460; the bound keeps a long value from being hashed at all.
 */
const DATA_MAX_LENGTH = 512;

/** The longest name of a file: a name of the length limit and the longest extension, `.webp`. */
const FILE_NAME_MAX_LENGTH = NAME_MAX_LENGTH + ".webp".length;

/** The signature part: 32 bytes of HMAC-SHA256 in base64url without padding are 43 characters. */
const SIGNATURE_LENGTH = 43;

/**
 * The shape of a token: both parts only of the alphabet of base64url, without padding. The decoder of Node.js skips
 * characters outside that alphabet, so without this check one link would have many spellings.
 */
const TOKEN_PATTERN = new RegExp(`^([A-Za-z0-9_-]{1,${DATA_MAX_LENGTH}})\\.([A-Za-z0-9_-]{${SIGNATURE_LENGTH}})$`);

/** The data of a link: exactly these five fields, and no other. */
const linkDataSchema = z.strictObject({
  use: z.literal(LINK_USE),
  v: z.literal(LINK_FORMAT),
  /** The id of the grant of the connection that got the link. */
  grant: z.guid(),
  /** The id of the version of the file that was current when the link was made. */
  version: z.guid(),
  /** When the link expires, in whole seconds since 1970. */
  exp: z.int(),
});

/** The checked data of a link. */
export type LinkData = z.infer<typeof linkDataSchema>;

/**
 * The data of an upload link: exactly these fields, and no other. The file and its lock version are both `null` for a
 * new file, and both set for a new version of a file.
 */
const uploadLinkDataSchema = z
  .strictObject({
    use: z.literal(UPLOAD_LINK_USE),
    v: z.literal(LINK_FORMAT),
    /** The id of the grant of the connection that got the link; the folder is the folder of the grant. */
    grant: z.guid(),
    /** The id of the tab of the file, or `null` for a file placed directly in the folder. */
    tab: z.guid().nullable(),
    /** The name of the file with its extension, exactly as the rule of file names writes it. */
    name: z
      .string()
      .max(FILE_NAME_MAX_LENGTH)
      .refine((name) => parseFileName(name) !== null),
    /** The exact size of the file in bytes, as the app stated it. */
    size: z.int().min(1),
    /** Whether an image is written again without its location and camera data. */
    strip: z.boolean(),
    /** The id of the file that a new version is for, or `null` for a new file. */
    file: z.guid().nullable(),
    /** The lock version of the file that a new version is based on, or `null` for a new file. */
    lockVersion: z.int().min(1).nullable(),
    /** When the link expires, in whole seconds since 1970. */
    exp: z.int(),
  })
  .refine((data) => (data.file === null) === (data.lockVersion === null));

/** The checked data of an upload link. */
export type UploadLinkData = z.infer<typeof uploadLinkDataSchema>;

/** What an upload link is made of: its data without its use and format. */
export type UploadLink = Omit<UploadLinkData, "use" | "v">;

/** Why a token was refused before its data was read: its shape, its signature, or data that is no data of a link. */
type TokenRefusal = "malformed" | "bad-signature" | "bad-data";

/** The signature part of the given data part with the key. */
function signatureOf(key: Buffer, dataPart: string): string {
  return createHmac("sha256", key).update(dataPart).digest("base64url");
}

/** The token of the given data, encoded and signed with the key. */
function signed(key: Buffer, data: LinkData | UploadLinkData): string {
  const dataPart = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${dataPart}.${signatureOf(key, dataPart)}`;
}

/** The token of a link to the given version for the given grant, expiring at `exp` (whole seconds since 1970). */
export function signLinkToken(key: Buffer, link: { grant: string; version: string; exp: number }): string {
  return signed(key, { use: LINK_USE, v: LINK_FORMAT, grant: link.grant, version: link.version, exp: link.exp });
}

/** The token of an upload link with the given fields, expiring at `exp` (whole seconds since 1970). */
export function signUploadLinkToken(key: Buffer, link: UploadLink): string {
  return signed(key, {
    use: UPLOAD_LINK_USE,
    v: LINK_FORMAT,
    grant: link.grant,
    tab: link.tab,
    name: link.name,
    size: link.size,
    strip: link.strip,
    file: link.file,
    lockVersion: link.lockVersion,
    exp: link.exp,
  });
}

/** The result of the check of a token: its data, or why it was refused. */
type Checked<Data> = { ok: true; data: Data } | { ok: false; reason: TokenRefusal };

/** The data of a download token signed with the key, or the reason of its refusal (`checkToken()`). */
export function checkLinkToken(key: Buffer, token: string): Checked<LinkData> {
  return checkToken(key, token, linkDataSchema);
}

/** The data of an upload token signed with the key, or the reason of its refusal (`checkToken()`). */
export function checkUploadLinkToken(key: Buffer, token: string): Checked<UploadLinkData> {
  return checkToken(key, token, uploadLinkDataSchema);
}

/**
 * The data of a token signed with the key, of the kind of the schema, or the reason of its refusal. The checks run in
 * this order: the shape, the signature, compared in constant time on bytes of the same length, and only after a match
 * the data. The signature is compared as the string it is, not as the bytes it decodes to, because the last character
 * of 43 also carries two unused bits, so that comparing the bytes would accept four spellings of one signature.
 */
function checkToken<Data>(key: Buffer, token: string, schema: z.ZodType<Data>): Checked<Data> {
  const match = TOKEN_PATTERN.exec(token);
  const [dataPart, signaturePart] = [match?.[1], match?.[2]];
  if (dataPart === undefined || signaturePart === undefined) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(signatureOf(key, dataPart));
  const given = Buffer.from(signaturePart);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad-signature" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(dataPart, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "bad-data" };
  }
  const data = schema.safeParse(decoded);
  return data.success ? { ok: true, data: data.data } : { ok: false, reason: "bad-data" };
}

/**
 * Whether a link with the expiry `exp` (whole seconds since 1970) is still within its time at `now`: it has not
 * expired, and its expiry is at most `lifetime` seconds away, so that a lowered lifetime also shortens the links
 * handed out before it.
 */
export function isWithinLifetime(exp: number, now: Date, lifetime: number): boolean {
  const nowSeconds = now.getTime() / 1000;
  return exp > nowSeconds && exp - nowSeconds <= lifetime;
}

/** The expiry of a link made at `now` with the given lifetime in seconds, in whole seconds since 1970. */
export function expiryOf(now: Date, lifetime: number): number {
  return Math.floor(now.getTime() / 1000) + lifetime;
}
