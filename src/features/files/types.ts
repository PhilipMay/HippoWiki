// The types of files that the wiki accepts, PNG, JPEG, GIF, WebP and PDF, each with the extension of its names, its MIME
// type and its label, and the detection of the type from the first bytes of a file. A pure module without server-only
// imports, so that the upload dialog and the views can use it.

import type { FileExtension } from "@/lib/name-limits";

/** A type of file, as the database stores it. */
export type FileType = "png" | "jpeg" | "gif" | "webp" | "pdf";

/** What the wiki knows about a type of file. */
type FileTypeInfo = {
  /** The extension of the names of files of the type, which fixes the type of a file. */
  extension: FileExtension;
  /** The MIME type that the address of a file sends, decided at the upload from the content. */
  mimeType: string;
  /** The type as the views name it. */
  label: string;
  /** Whether a page shows it as an image with `![[…]]`, and the details page as a preview. */
  image: boolean;
};

/** The types of files in the order the messages name them. */
export const FILE_TYPES: Readonly<Record<FileType, FileTypeInfo>> = {
  png: { extension: "png", mimeType: "image/png", label: "PNG", image: true },
  jpeg: { extension: "jpg", mimeType: "image/jpeg", label: "JPEG", image: true },
  gif: { extension: "gif", mimeType: "image/gif", label: "GIF", image: true },
  webp: { extension: "webp", mimeType: "image/webp", label: "WebP", image: true },
  pdf: { extension: "pdf", mimeType: "application/pdf", label: "PDF", image: false },
};

/** Every type of file, in the order of `FILE_TYPES`. */
export const FILE_TYPE_LIST = Object.keys(FILE_TYPES) as FileType[];

/** The message of an upload whose content is none of the accepted types. */
export const ACCEPTED_TYPES_MESSAGE = "Only PNG, JPEG, GIF, WebP and PDF files can be uploaded.";

/** The type of the files whose names end in each extension. */
const TYPE_OF_EXTENSION: Readonly<Record<FileExtension, FileType>> = {
  png: "png",
  jpg: "jpeg",
  gif: "gif",
  webp: "webp",
  pdf: "pdf",
};

/** The type of file whose names end in the extension. */
export function typeOfExtension(extension: FileExtension): FileType {
  return TYPE_OF_EXTENSION[extension];
}

/** Whether a file of the type is an image, which a page shows with `![[…]]`. */
export function isImageType(type: FileType): boolean {
  return FILE_TYPES[type].image;
}

/** How many bytes of the start of a file `detectType()` reads. */
export const SIGNATURE_LENGTH = 12;

/** Whether the bytes start with the ASCII text at the offset. */
function hasText(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/** The signature of a PNG: the byte 0x89, `PNG`, a line break of DOS, the end of a file of DOS and a line break. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The type of file whose signature the first bytes of the content carry, or `null` for any other content, such as
 * HTML, SVG, text, a ZIP, an empty or a too short file: a PNG, a JPEG (`FF D8 FF`), a GIF (`GIF87a` or `GIF89a`), a
 * WebP (`RIFF`, four bytes of size, `WEBP`) or a PDF (`%PDF-`). The type never comes from the name or the type that the
 * browser claims. The decode of an image (`src/features/files/images.ts`) checks the rest of it.
 */
export function detectType(bytes: Uint8Array): FileType | null {
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (hasText(bytes, 0, "GIF87a") || hasText(bytes, 0, "GIF89a")) return "gif";
  if (hasText(bytes, 0, "RIFF") && hasText(bytes, 8, "WEBP")) return "webp";
  if (hasText(bytes, 0, "%PDF-")) return "pdf";
  return null;
}
