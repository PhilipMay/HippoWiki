import { describe, expect, it } from "vitest";

import {
  ACCEPTED_TYPES_MESSAGE,
  detectType,
  FILE_TYPE_LIST,
  FILE_TYPES,
  isImageType,
  SIGNATURE_LENGTH,
  typeOfExtension,
} from "@/features/files/types";
import { FILE_EXTENSIONS } from "@/lib/name-limits";

/** The bytes of the text, followed by the given bytes. */
function bytes(...parts: (string | number[])[]): Uint8Array {
  return new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...Buffer.from(part, "latin1")] : part)));
}

const PNG = bytes([0x89], "PNG\r\n", [0x1a], "\n", [0, 0, 0, 13], "IHDR");

describe("detectType", () => {
  it("detects each type from its signature", () => {
    expect(detectType(PNG)).toBe("png");
    expect(detectType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(detectType(bytes("GIF87a", [1, 0]))).toBe("gif");
    expect(detectType(bytes("GIF89a", [1, 0]))).toBe("gif");
    expect(detectType(bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 "))).toBe("webp");
    expect(detectType(bytes("%PDF-1.7\n"))).toBe("pdf");
  });

  it("detects no type in HTML or SVG, whatever the name says", () => {
    expect(detectType(bytes("<!DOCTYPE html><html><script>alert(1)</script>"))).toBeNull();
    expect(detectType(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(detectType(bytes('<?xml version="1.0"?><svg/>'))).toBeNull();
  });

  it("detects no type in text, a ZIP or a RIFF of another kind", () => {
    expect(detectType(bytes("Just some text"))).toBeNull();
    expect(detectType(bytes("PK", [3, 4, 20, 0]))).toBeNull();
    expect(detectType(bytes("RIFF", [0x24, 0, 0, 0], "WAVEfmt "))).toBeNull();
    expect(detectType(bytes("%PDF"))).toBeNull();
  });

  it("detects no type in an empty file or one shorter than its signature", () => {
    expect(detectType(new Uint8Array())).toBeNull();
    expect(detectType(PNG.subarray(0, 7))).toBeNull();
    expect(detectType(bytes([0xff, 0xd8]))).toBeNull();
    expect(detectType(bytes("GIF89"))).toBeNull();
    expect(detectType(bytes("RIFF", [0x24, 0, 0, 0], "WEB"))).toBeNull();
  });

  it("needs no more than the first bytes of a file", () => {
    expect(SIGNATURE_LENGTH).toBe(12);
    expect(detectType(bytes("RIFF", [0x24, 0, 0, 0], "WEBP").subarray(0, SIGNATURE_LENGTH))).toBe("webp");
  });
});

describe("the types of files", () => {
  it("give each extension one type, JPEG with .jpg", () => {
    expect(FILE_TYPE_LIST.map((type) => FILE_TYPES[type].extension)).toEqual([...FILE_EXTENSIONS]);
    for (const type of FILE_TYPE_LIST) expect(typeOfExtension(FILE_TYPES[type].extension)).toBe(type);
    expect(typeOfExtension("jpg")).toBe("jpeg");
  });

  it("have the MIME type of their content", () => {
    expect(FILE_TYPE_LIST.map((type) => FILE_TYPES[type].mimeType)).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "application/pdf",
    ]);
  });

  it("are images except for a PDF", () => {
    expect(FILE_TYPE_LIST.filter(isImageType)).toEqual(["png", "jpeg", "gif", "webp"]);
  });

  it("are named in the message of a refused type", () => {
    for (const type of FILE_TYPE_LIST) expect(ACCEPTED_TYPES_MESSAGE).toContain(FILE_TYPES[type].label);
  });
});
