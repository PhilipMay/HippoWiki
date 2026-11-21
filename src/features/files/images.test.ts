import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import sharp, { type Sharp } from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_IMAGE_PIXELS, processImage } from "@/features/files/images";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hippowiki-images-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Writes the bytes into a file of the test and returns its path. */
async function stored(bytes: Uint8Array, name = "upload"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

/** A plain image of the given size, red. */
function plain(width: number, height: number): Sharp {
  return sharp({ create: { width, height, channels: 3, background: "red" } });
}

/**
 * A JPEG of 40 × 30 pixels as a phone stores it: turned by its EXIF orientation 6 (90 degrees), with the make of the
 * camera and a GPS position in its EXIF.
 */
function phonePhoto(): Promise<Buffer> {
  return plain(40, 30)
    .jpeg()
    .withExif({
      IFD0: { Make: "PhoneMaker", Model: "Phone 15" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 31/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "13/1 24/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe("processImage", () => {
  it("turns a phone photo upright and removes its EXIF, the GPS position included", async () => {
    const photo = await phonePhoto();
    const before = await sharp(photo).metadata();
    expect([before.width, before.height, before.orientation]).toEqual([40, 30, 6]);
    expect(before.exif?.toString("latin1")).toContain("PhoneMaker");

    const result = await processImage(await stored(photo), "jpeg", { stripMetadata: true });

    if (!result.ok || !result.value.bytes) throw new Error("not processed");
    expect([result.value.width, result.value.height]).toEqual([30, 40]);
    const after = await sharp(result.value.bytes).metadata();
    expect([after.format, after.width, after.height]).toEqual(["jpeg", 30, 40]);
    expect(after.orientation).toBeUndefined();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(result.value.bytes.toString("latin1")).not.toContain("PhoneMaker");
  });

  it("keeps the bytes of a photo as uploaded, and still reports its size upright", async () => {
    const photo = await phonePhoto();
    const path = await stored(photo);

    const result = await processImage(path, "jpeg", { stripMetadata: false });

    expect(result).toEqual({ ok: true, value: { width: 30, height: 40, bytes: null } });
    expect(new Uint8Array(await readFile(path))).toEqual(new Uint8Array(photo));
  });

  it("keeps the colour profile of an image", async () => {
    const withProfile = await plain(20, 10).withIccProfile("p3").png().toBuffer();

    const result = await processImage(await stored(withProfile), "png", { stripMetadata: true });

    if (!result.ok || !result.value.bytes) throw new Error("not processed");
    expect((await sharp(result.value.bytes).metadata()).icc).toBeDefined();
  });

  it("keeps every frame of an animated GIF and of an animated WebP", async () => {
    const frames = await Promise.all(
      ["red", "green", "blue"].map((colour) =>
        sharp({ create: { width: 12, height: 8, channels: 4, background: colour } })
          .png()
          .toBuffer(),
      ),
    );
    const gif = await sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer();
    const webp = await sharp(frames, { join: { animated: true } })
      .webp()
      .toBuffer();

    for (const [bytes, type] of [
      [gif, "gif"],
      [webp, "webp"],
    ] as const) {
      const result = await processImage(await stored(bytes, type), type, { stripMetadata: true });

      if (!result.ok || !result.value.bytes) throw new Error(`${type} not processed`);
      expect([result.value.width, result.value.height]).toEqual([12, 8]);
      const after = await sharp(result.value.bytes, { animated: true }).metadata();
      expect([after.format, after.pages, after.pageHeight]).toEqual([type, 3, 8]);
    }
  });

  it("writes a PNG and a WebP again in their own format", async () => {
    for (const type of ["png", "webp"] as const) {
      const bytes = await plain(16, 9)[type]().toBuffer();

      const result = await processImage(await stored(bytes, type), type, { stripMetadata: true });

      if (!result.ok || !result.value.bytes) throw new Error(`${type} not processed`);
      expect((await sharp(result.value.bytes).metadata()).format).toBe(type);
      expect([result.value.width, result.value.height]).toEqual([16, 9]);
    }
  });

  it("refuses a PNG whose bytes are cut, with and without the metadata removed", async () => {
    const png = await plain(200, 200).png({ compressionLevel: 0 }).toBuffer();
    const path = await stored(png.subarray(0, png.length - 4000));

    await expect(processImage(path, "png", { stripMetadata: true })).resolves.toEqual({
      ok: false,
      error: { code: "unreadable" },
    });
    await expect(processImage(path, "png", { stripMetadata: false })).resolves.toEqual({
      ok: false,
      error: { code: "unreadable" },
    });
  });

  it("refuses an image whose format is not the type of its signature", async () => {
    const png = await plain(4, 4).png().toBuffer();

    await expect(processImage(await stored(png), "jpeg", { stripMetadata: false })).resolves.toEqual({
      ok: false,
      error: { code: "unreadable" },
    });
  });

  it("refuses content of another format, which no loader reads", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>');
    const tiff = await plain(4, 4).tiff().toBuffer();

    for (const bytes of [svg, tiff]) {
      await expect(processImage(await stored(bytes), "png", { stripMetadata: true })).resolves.toEqual({
        ok: false,
        error: { code: "unreadable" },
      });
    }
  });

  it("refuses an image over the pixel limit before it decodes it", async () => {
    const [width, height] = [10_001, 10_000];
    expect(width * height).toBeGreaterThan(MAX_IMAGE_PIXELS);

    await expect(
      processImage(await stored(pngOfSize(width, height)), "png", { stripMetadata: false }),
    ).resolves.toEqual({ ok: false, error: { code: "too-many-pixels" } });
  });
});

/** A chunk of a PNG: its length, type, data and CRC. */
function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * A grey PNG whose header names the size and whose data holds only its first row: a file of a few bytes that would
 * take width × height bytes of memory once decoded, the shape of a decompression bomb.
 */
function pngOfSize(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.alloc(width + 1))),
    pngChunk("IEND", new Uint8Array()),
  ]);
}
