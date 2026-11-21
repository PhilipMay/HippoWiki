import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants, crc32, createDeflate } from "node:zlib";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_IMAGE_PIXELS, processImage } from "@/features/files/images";

// Wall-clock budgets: this file runs in the Vitest project `cost`, never under coverage and never next to other test
// files. Every uploaded image is decoded with the limits of untrusted input, so the largest image the limit allows
// must be processed, and a decompression bomb refused, within a budget that keeps an upload from tying up the server.

/** The budget of the largest image the pixel limit allows, its metadata removed and written again. */
const LARGEST_BUDGET_MS = 10_000;
/** The budget of a refused decompression bomb, which must never be decoded. */
const BOMB_BUDGET_MS = 500;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "hippowiki-images-cost-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
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

/** The rows of a grey image of zeros, each with its filter byte, deflated as a stream to keep the memory low. */
async function deflatedZeroRows(width: number, height: number): Promise<Buffer> {
  const deflate = createDeflate({ level: constants.Z_BEST_COMPRESSION });
  const parts: Buffer[] = [];
  deflate.on("data", (part: Buffer) => parts.push(part));
  const done = new Promise((resolve) => deflate.on("end", resolve));
  const row = Buffer.alloc(width + 1);
  for (let index = 0; index < height; index += 1) {
    if (!deflate.write(row)) await new Promise((resolve) => deflate.once("drain", resolve));
  }
  deflate.end();
  await done;
  return Buffer.concat(parts);
}

/**
 * A decompression bomb: a complete grey PNG of 12,000 × 12,000 pixels, 144 megapixels, all zero, which compresses to a
 * few hundred kilobytes and would take 144 MB once decoded.
 */
async function decompressionBomb(): Promise<Buffer> {
  const [width, height] = [12_000, 12_000];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", await deflatedZeroRows(width, height)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

describe("the cost of processing an image", () => {
  it("processes a JPEG just under the pixel limit within its budget", async () => {
    const [width, height] = [10_000, 9_999];
    expect(width * height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    const path = join(dir, "largest.jpg");
    await writeFile(
      path,
      // Noise, as in a photo, so that the decoder and the encoder have work on every pixel.
      await sharp({
        create: { width, height, channels: 3, background: "black", noise: { type: "gaussian", mean: 128, sigma: 30 } },
      })
        .jpeg()
        .toBuffer(),
    );

    const started = performance.now();
    const result = await processImage(path, "jpeg", { stripMetadata: true });
    const elapsed = performance.now() - started;

    expect(result).toMatchObject({ ok: true, value: { width, height } });
    expect(elapsed).toBeLessThan(LARGEST_BUDGET_MS);
  }, 120_000);

  it("refuses a decompression bomb within its budget", async () => {
    const bomb = await decompressionBomb();
    expect(bomb.length).toBeLessThan(1_000_000);
    const path = join(dir, "bomb.png");
    await writeFile(path, bomb);

    for (const stripMetadata of [true, false]) {
      const started = performance.now();
      const result = await processImage(path, "png", { stripMetadata });
      const elapsed = performance.now() - started;

      expect(result).toEqual({ ok: false, error: { code: "too-many-pixels" } });
      expect(elapsed).toBeLessThan(BOMB_BUDGET_MS);
    }
  }, 120_000);
});
