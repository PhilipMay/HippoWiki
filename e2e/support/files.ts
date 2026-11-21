// The helpers of the tests of files: the contents of the five types, made with sharp, among them a phone photo with a
// GPS position, and `uploadFile()`, which posts a file to the upload address with the cookies of a page, as the upload
// dialog does. It imports nothing of the test database, so that `database.ts` can make the blobs of `createFile()` with
// it.

import type { APIResponse, Page } from "@playwright/test";
import sharp, { type Sharp } from "sharp";

import { uploadPath } from "@/lib/addresses";

import { expect } from "./test";
import { workerUrl, processWorker } from "./workers";

/** The address of the server of the worker of the process, the origin of every upload of a test. */
const ORIGIN = workerUrl(processWorker() ?? 1);

/** A plain image of the given size and colour. */
function plain(width: number, height: number, background: string): Sharp {
  return sharp({ create: { width, height, channels: 3, background } });
}

/** A PNG of the given size, red unless another colour is given. */
export function pngBytes(width = 40, height = 30, background = "red"): Promise<Buffer> {
  return plain(width, height, background).png().toBuffer();
}

/** A JPEG of the given size, blue unless another colour is given. */
export function jpegBytes(width = 40, height = 30, background = "blue"): Promise<Buffer> {
  return plain(width, height, background).jpeg().toBuffer();
}

/** A GIF of the given size, green unless another colour is given. */
export function gifBytes(width = 40, height = 30, background = "green"): Promise<Buffer> {
  return plain(width, height, background).gif().toBuffer();
}

/** A WebP of the given size, yellow unless another colour is given. */
export function webpBytes(width = 40, height = 30, background = "yellow"): Promise<Buffer> {
  return plain(width, height, background).webp().toBuffer();
}

/** The make of the camera in `phonePhoto()`, which a photo without its metadata no longer holds. */
export const PHOTO_CAMERA = "PhoneMaker";

/**
 * A JPEG of 40 × 30 pixels as a phone stores it: turned by its EXIF orientation 6, with the make of the camera and a
 * GPS position in its EXIF. Upright it is 30 × 40.
 */
export function phonePhoto(): Promise<Buffer> {
  return plain(40, 30, "purple")
    .jpeg()
    .withExif({
      IFD0: { Make: PHOTO_CAMERA, Model: "Phone 15" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 31/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "13/1 24/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** A PDF of one empty page with the given text in its content, small and valid. */
export function pdfBytes(text = "HippoWiki test manual"): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** What `uploadFile()` uploads, and where. */
type Upload = {
  folder: string;
  /** The tab, or `null` for a file placed directly in the folder. */
  tab?: string | null;
  /** The name of the file, with its extension. */
  name: string;
  /** The content of the file, the body of the request. */
  bytes: Uint8Array;
  /** Keep the metadata of a photo (`strip=0`). */
  keepMetadata?: boolean;
  /** The lock version of the file of that name that a new version is based on. */
  replace?: number;
  /** Headers instead of those of the page, e.g. another `Origin`. */
  headers?: Record<string, string>;
};

/**
 * Posts a file to the upload address with the cookies of the page, from the origin of the server, as the upload dialog
 * does with `fetch()`; returns the response, whose body is the JSON answer of the upload.
 */
export function uploadFile(
  page: Page,
  { folder, tab = null, name, bytes, keepMetadata, replace, headers = {} }: Upload,
): Promise<APIResponse> {
  return page.request.post(uploadPath(folder, tab, name, { keepMetadata, replace }), {
    data: Buffer.from(bytes),
    headers: { origin: ORIGIN, "content-type": "application/octet-stream", ...headers },
    maxRedirects: 0,
  });
}

/**
 * Expects the answer of a file address that sends no file: 404, with no name of a file and no content of one, the
 * same for every reason, so that nobody learns whether a file exists. A file address answers without the not-found
 * page of the app, which could not run under the headers of the files (`next.config.ts`).
 */
export async function expectFileNotFound(page: Page, address: string): Promise<void> {
  const response = await page.request.get(address, { maxRedirects: 0 });

  expect(response.status(), address).toBe(404);
  expect(response.headers()["content-disposition"], address).toBeUndefined();
  expect(response.headers()["etag"], address).toBeUndefined();
}
