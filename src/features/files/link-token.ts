// The token of a signed link to a file: the data of the link and its signature, `<data>.<signature>`, as a JWT writes
// them. The data is the JSON of exactly five fields in base64url without padding; the signature is the HMAC-SHA256 of
// exactly that encoded string with the key of the links, also base64url without padding. The data is only encoded, not
// encrypted: it holds ids, never a secret. A pure module: the key, the time and the lifetime come from the caller
// (`link-service.ts`). Uses `node:crypto`, so only the server imports it.

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/** What the data of every link says it is for, so that a signature of this key never passes for another purpose. */
const LINK_USE = "file-link";

/** The format of the data, so that a link of a later format never passes for this one. */
const LINK_FORMAT = 1;

/**
 * The longest data part that is checked further. A link that the wiki makes has about 160 characters; the bound keeps
 * a long value from being hashed at all.
 */
const DATA_MAX_LENGTH = 512;

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

/** Why a token was refused before its data was read: its shape, its signature, or data that is no data of a link. */
export type TokenRefusal = "malformed" | "bad-signature" | "bad-data";

/** The signature part of the given data part with the key. */
function signatureOf(key: Buffer, dataPart: string): string {
  return createHmac("sha256", key).update(dataPart).digest("base64url");
}

/** The token of a link to the given version for the given grant, expiring at `exp` (whole seconds since 1970). */
export function signLinkToken(key: Buffer, link: { grant: string; version: string; exp: number }): string {
  const data: LinkData = { use: LINK_USE, v: LINK_FORMAT, grant: link.grant, version: link.version, exp: link.exp };
  const dataPart = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${dataPart}.${signatureOf(key, dataPart)}`;
}

/**
 * The data of a token signed with the key, or the reason of its refusal. The checks run in this order: the shape, the
 * signature, compared in constant time on bytes of the same length, and only after a match the data. The signature is
 * compared as the string it is, not as the bytes it decodes to, because the last character of 43 also carries two
 * unused bits, so that comparing the bytes would accept four spellings of one signature.
 */
export function checkLinkToken(
  key: Buffer,
  token: string,
): { ok: true; data: LinkData } | { ok: false; reason: TokenRefusal } {
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
  const data = linkDataSchema.safeParse(decoded);
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
