// The processing of uploaded images with sharp: the decode that proves an image is one of its type, its width and
// height upright, and, unless the uploader keeps it, the image written again without the metadata of a photo. Every
// image is untrusted input, so the decode has the limits of untrusted input, and at most two images are processed at
// the same time per server process. Server only: sharp runs native code.

import sharp, { type Metadata, type Sharp } from "sharp";

import type { FileType } from "@/features/files/types";
import { createLimiter, type Limiter } from "@/lib/limiter";
import type { Result } from "@/lib/result";

/** The types of files that are images, which this module processes; a PDF is stored as it was uploaded. */
export type ImageType = Exclude<FileType, "pdf">;

/** The most pixels an image may have, all frames of an animated image together: 100 megapixels. */
export const MAX_IMAGE_PIXELS = 100_000_000;

/** How many images one server process processes at the same time. */
const MAX_CONCURRENT_IMAGES = 2;
/** How long an image waits for a free slot before it gives up. */
const MAX_IMAGE_WAIT_MS = 60_000;

/** The format that sharp reports for each type of image. */
const SHARP_FORMATS: Readonly<Record<ImageType, string>> = { png: "png", jpeg: "jpeg", gif: "gif", webp: "webp" };

/**
 * The loaders of libvips that stay on: those of the four types, each with its variants for a file, a buffer and a
 * stream. Every other loader, such as those of SVG, PDF, TIFF and HEIF, is blocked, so that no content reaches the
 * parser of a format the wiki does not accept.
 */
const ALLOWED_LOADERS = ["VipsForeignLoadPng", "VipsForeignLoadJpeg", "VipsForeignLoadNsgif", "VipsForeignLoadWebp"];

/** An image did not get a free slot in time: too many images are being processed. The service answers `failed`. */
class ImageBusyError extends Error {
  constructor() {
    super("too many images are being processed");
    this.name = "ImageBusyError";
  }
}

// One limiter per process, and the settings of sharp once. Both live on `globalThis`, so that a module evaluated twice
// (a hot reload in development, or two bundles of the server) still shares them.
const globalForImages = globalThis as typeof globalThis & { hippowikiImageLimiter?: Limiter };

/** The limiter of the images, with sharp set up for untrusted input on first use. */
function imageLimiter(): Limiter {
  if (!globalForImages.hippowikiImageLimiter) {
    // No cache of decoded images: every upload is read once, and a cache would keep untrusted input in memory.
    sharp.cache(false);
    // The threads of libvips per image; two images at a time keep at most four cores busy.
    sharp.concurrency(2);
    sharp.block({ operation: ["VipsForeignLoad"] });
    sharp.unblock({ operation: ALLOWED_LOADERS });
    globalForImages.hippowikiImageLimiter = createLimiter({
      maxConcurrent: MAX_CONCURRENT_IMAGES,
      maxWaitMs: MAX_IMAGE_WAIT_MS,
      busyError: () => new ImageBusyError(),
    });
  }
  return globalForImages.hippowikiImageLimiter;
}

/** A processed image: its width and height upright, and its bytes written again, or `null` when they stay as uploaded. */
export type ProcessedImage = { width: number; height: number; bytes: Buffer | null };

/** Why an image was refused: it does not decode as an image of its type, or it has more pixels than allowed. */
export type ImageError = { code: "unreadable" } | { code: "too-many-pixels" };

/** The options of every read of an untrusted image: the pixel limit, a stop at the first error, and all frames. */
const INPUT_OPTIONS = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", animated: true } as const;

/** Whether the EXIF orientation turns the image by 90 degrees, so that its width and height swap upright. */
function isTurned(orientation: number | undefined): boolean {
  return orientation !== undefined && orientation >= 5 && orientation <= 8;
}

/**
 * Processes the stored image at the path, whose signature showed the type. It decodes the whole image, frames
 * included, with the limits of untrusted input, and refuses one that does not decode, whose format differs from its
 * signature or that has more than `MAX_IMAGE_PIXELS`. It returns the width and height of a frame, upright by its EXIF
 * orientation. With `stripMetadata` it writes the image again in its own format, turned upright, without EXIF, XMP and
 * IPTC (the position, the camera and the time of a photo) but with its colour profile, and with every frame of an
 * animated GIF or WebP; otherwise the bytes stay as uploaded. Rejects with `ImageBusyError` when no slot gets free in
 * time.
 */
export function processImage(
  path: string,
  type: ImageType,
  { stripMetadata }: { stripMetadata: boolean },
): Promise<Result<ProcessedImage, ImageError>> {
  return imageLimiter()(async () => {
    let metadata: Metadata;
    try {
      // Only the header is read here; without the pixel limit, so that an image over it is told apart from a broken one.
      metadata = await sharp(path, { ...INPUT_OPTIONS, limitInputPixels: false }).metadata();
    } catch {
      return { ok: false, error: { code: "unreadable" } };
    }
    const { format, width, height, pages = 1, pageHeight, orientation } = metadata;
    if (format !== SHARP_FORMATS[type] || !width || !height) return { ok: false, error: { code: "unreadable" } };
    if (width * height > MAX_IMAGE_PIXELS) return { ok: false, error: { code: "too-many-pixels" } };

    // An animated image is one tall strip of its frames; one frame is as high as a page.
    const frameHeight = pages > 1 && pageHeight ? pageHeight : height;
    // Only a single frame is turned: the orientation of a photo, which an animation does not have.
    const turned = pages === 1 && isTurned(orientation);
    const upright = turned ? { width: frameHeight, height: width } : { width, height: frameHeight };

    try {
      if (!stripMetadata) {
        // The statistics read every pixel, so a cut or broken image fails here without a copy in memory.
        await sharp(path, INPUT_OPTIONS).stats();
        return { ok: true, value: { ...upright, bytes: null } };
      }
      let image = sharp(path, INPUT_OPTIONS);
      if (pages === 1) image = image.autoOrient();
      // The output of sharp carries no metadata unless asked; the colour profile is kept so the colours stay.
      image = image.keepIccProfile();
      const bytes = await written(image, type).toBuffer();
      return { ok: true, value: { ...upright, bytes } };
    } catch {
      return { ok: false, error: { code: "unreadable" } };
    }
  });
}

/** The image written in the format of its type; JPEG and WebP at a quality that keeps a photo as it was. */
function written(image: Sharp, type: ImageType): Sharp {
  switch (type) {
    case "png":
      return image.png();
    case "jpeg":
      return image.jpeg({ quality: 90 });
    case "gif":
      return image.gif();
    case "webp":
      return image.webp({ quality: 90 });
  }
}
