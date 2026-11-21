import sharp from "sharp";

import { KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE } from "./support/auth";
import { createFile, createFolder, createTab, createUser, getTestDb, resetTestDatabase } from "./support/database";
import {
  expectFileNotFound,
  gifBytes,
  jpegBytes,
  pdfBytes,
  PHOTO_CAMERA,
  phonePhoto,
  pngBytes,
  uploadFile,
  webpBytes,
} from "./support/files";
import { expect, test } from "./support/test";

/** The default size limit of an upload, 25 MiB (`HIPPOWIKI_FILE_SIZE_LIMIT`), which the servers of the tests keep. */
const SIZE_LIMIT = 26_214_400;

/** The message of a refused type, which names the accepted types. */
const ACCEPTED_TYPES = "Only PNG, JPEG, GIF, WebP and PDF files can be uploaded.";

/** The headers that every response of a file address carries, besides its type, name, caching and entity tag. */
const FILE_HEADERS = {
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
};

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** A PDF of exactly the given size: a valid start and spaces up to the size, which nothing parses. */
function pdfOfSize(size: number): Buffer {
  const start = pdfBytes();
  return Buffer.concat([start, Buffer.alloc(size - start.length, 0x20)]);
}

test.describe("uploading", () => {
  test("stores each of the five types and returns it from its address with its type", async ({ page }) => {
    const uploads = [
      ["diagram.png", await pngBytes(), "image/png"],
      ["photo.jpg", await jpegBytes(), "image/jpeg"],
      ["animation.gif", await gifBytes(), "image/gif"],
      ["screen.webp", await webpBytes(), "image/webp"],
      ["manual.pdf", pdfBytes(), "application/pdf"],
    ] as const;

    for (const [name, bytes, type] of uploads) {
      const uploaded = await uploadFile(page, { folder: "handbook", tab: "guides", name, bytes, keepMetadata: true });
      expect(uploaded.status(), name).toBe(201);
      expect(await uploaded.json()).toEqual({ ok: true, address: `/folders/handbook/guides/${name}` });

      const response = await page.request.get(`/files/handbook/guides/${name}`);
      expect(response.status(), name).toBe(200);
      expect(response.headers()["content-type"]).toBe(type);
      expect(new Uint8Array(await response.body())).toEqual(new Uint8Array(bytes));
    }
    const files = await getTestDb().file.findMany({ select: { name: true, tabId: true }, orderBy: { name: "asc" } });
    expect(files).toEqual(
      ["animation.gif", "diagram.png", "manual.pdf", "photo.jpg", "screen.webp"].map((name) => ({
        name,
        tabId: guides.id,
      })),
    );
  });

  test("stores a file placed directly in the folder", async ({ page }) => {
    const uploaded = await uploadFile(page, { folder: "handbook", name: "manual.pdf", bytes: pdfBytes() });

    expect(await uploaded.json()).toEqual({ ok: true, address: "/folders/handbook/manual.pdf" });
    expect((await page.request.get("/files/handbook/manual.pdf")).status()).toBe(200);
  });

  test("refuses HTML and SVG named .png, a text file and a ZIP with the accepted types, and stores nothing", async ({
    page,
  }) => {
    const contents = [
      ["page.png", "<!DOCTYPE html><html><body><script>alert(document.cookie)</script></body></html>"],
      ["drawing.png", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
      ["notes.pdf", "Just some notes"],
      ["archive.png", "PK\u0003\u0004\u0014\u0000\u0000\u0000"],
    ] as const;

    for (const [name, text] of contents) {
      const response = await uploadFile(page, { folder: "handbook", name, bytes: Buffer.from(text, "latin1") });

      expect(response.status(), name).toBe(415);
      expect(await response.json()).toEqual({ ok: false, code: "wrong-type", field: "file", message: ACCEPTED_TYPES });
    }
    expect(await getTestDb().file.count()).toBe(0);
  });

  test("refuses a PDF named .png with a message that names its type", async ({ page }) => {
    const response = await uploadFile(page, { folder: "handbook", name: "manual.png", bytes: pdfBytes() });

    expect(await response.json()).toMatchObject({
      code: "wrong-type",
      message: "The file is a PDF, but the name ends in .png: use a name that ends in .pdf.",
    });
  });

  test("stores a file at the size limit and refuses one byte more with the limit in the message", async ({ page }) => {
    const atLimit = await uploadFile(page, { folder: "handbook", name: "large.pdf", bytes: pdfOfSize(SIZE_LIMIT) });
    expect(atLimit.status()).toBe(201);

    const over = await uploadFile(page, { folder: "handbook", name: "larger.pdf", bytes: pdfOfSize(SIZE_LIMIT + 1) });
    expect(over.status()).toBe(413);
    expect(await over.json()).toEqual({
      ok: false,
      code: "too-large",
      field: "file",
      message: "The file is larger than 25 MiB, the limit.",
    });
    expect(await getTestDb().file.findMany({ select: { name: true } })).toEqual([{ name: "large.pdf" }]);
    const [version] = await getTestDb().fileVersion.findMany({ select: { size: true } });
    expect(version?.size).toBe(SIZE_LIMIT);
  });

  test("refuses a name that breaks the rule, a taken name and a missing tab", async ({ page }) => {
    for (const name of ["Diagram.png", "my%20file.png", "a.b.png", "photo.jpeg"]) {
      const response = await uploadFile(page, { folder: "handbook", name, bytes: await pngBytes() });
      expect(response.status(), name).toBe(400);
      expect(await response.json(), name).toMatchObject({ code: "invalid-input", field: "name" });
    }

    await uploadFile(page, { folder: "handbook", name: "diagram.png", bytes: await pngBytes() });
    const taken = await uploadFile(page, { folder: "handbook", name: "diagram.png", bytes: await pngBytes(5, 5) });
    expect(taken.status()).toBe(409);
    expect(await taken.json()).toMatchObject({ code: "name-taken", field: "name", file: { lockVersion: 1 } });

    const missingTab = await uploadFile(page, {
      folder: "handbook",
      tab: "nowhere",
      name: "a.png",
      bytes: await pngBytes(),
    });
    expect(await missingTab.json()).toMatchObject({ code: "tab-not-found" });
    expect(await getTestDb().fileVersion.count()).toBe(1);
  });

  test("stores a new version of a taken name with its lock version, and the address returns it", async ({ page }) => {
    await uploadFile(page, { folder: "handbook", name: "diagram.png", bytes: await pngBytes(10, 10, "red") });
    const second = await pngBytes(20, 10, "blue");

    const response = await uploadFile(page, { folder: "handbook", name: "diagram.png", bytes: second, replace: 1 });

    expect(response.status()).toBe(201);
    expect((await sharp(await (await page.request.get("/files/handbook/diagram.png")).body()).metadata()).width).toBe(
      20,
    );
    const first = await page.request.get("/files/handbook/diagram.png?version=1");
    expect((await sharp(await first.body()).metadata()).width).toBe(10);
  });

  test("removes the GPS position and the camera of a photo unless strip=0 is sent", async ({ page }) => {
    const photo = await phonePhoto();
    await uploadFile(page, { folder: "handbook", name: "stripped.jpg", bytes: photo });
    await uploadFile(page, { folder: "handbook", name: "kept.jpg", bytes: photo, keepMetadata: true });

    const stripped = await (await page.request.get("/files/handbook/stripped.jpg")).body();
    const kept = await (await page.request.get("/files/handbook/kept.jpg")).body();

    const metadata = await sharp(stripped).metadata();
    expect([metadata.width, metadata.height, metadata.exif, metadata.orientation]).toEqual([
      30,
      40,
      undefined,
      undefined,
    ]);
    expect(stripped.toString("latin1")).not.toContain(PHOTO_CAMERA);
    expect(new Uint8Array(kept)).toEqual(new Uint8Array(photo));
    expect((await sharp(kept).metadata()).exif?.toString("latin1")).toContain(PHOTO_CAMERA);
  });

  test("refuses an upload from another site and stores nothing", async ({ page }) => {
    for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }] as Record<
      string,
      string
    >[]) {
      const response = await uploadFile(page, {
        folder: "handbook",
        name: "evil.png",
        bytes: await pngBytes(),
        headers,
      });

      expect(response.status()).toBe(404);
    }
    expect(await getTestDb().file.count()).toBe(0);
  });

  test("refuses an upload of a Reader and of a user without a role like a missing folder", async ({ page }) => {
    const bob = await createUser({ name: "bob", mustChangePassword: false });
    await createFolder({ name: "secret", roles: [{ user: bob, role: "owner" }] });
    await createFolder({ name: "read-only", roles: [{ user: { id: KNOWN_USER.id }, role: "reader" }] });

    for (const folder of ["secret", "read-only", "nowhere"]) {
      const response = await uploadFile(page, { folder, name: "a.png", bytes: await pngBytes() });
      expect(response.status(), folder).toBe(404);
    }
    expect(await getTestDb().file.count()).toBe(0);
  });
});

test.describe("the address of a file", () => {
  test("carries the headers that run nothing in it, its name inline or as a download, and its entity tag", async ({
    page,
  }) => {
    const file = await createFile({ folder: handbook, name: "manual.pdf" });
    const sha256 = file.versions[0]?.sha256;

    const inline = await page.request.get("/files/handbook/manual.pdf");
    const download = await page.request.get("/files/handbook/manual.pdf?download");

    for (const response of [inline, download]) {
      const headers = response.headers();
      expect(Object.fromEntries(Object.keys(FILE_HEADERS).map((name) => [name, headers[name]]))).toEqual(FILE_HEADERS);
      expect(headers["cache-control"]).toBe("private, no-cache");
      expect(headers.etag).toBe(`"${sha256}"`);
      expect(headers["content-type"]).toBe("application/pdf");
    }
    expect(inline.headers()["content-disposition"]).toBe('inline; filename="manual.pdf"');
    expect(download.headers()["content-disposition"]).toBe('attachment; filename="manual.pdf"');

    const again = await page.request.get("/files/handbook/manual.pdf", { headers: { "if-none-match": `"${sha256}"` } });
    expect(again.status()).toBe(304);
    expect(await again.body()).toHaveLength(0);
  });

  test("answers a missing file, a malformed address and another query with 404", async ({ page }) => {
    await createFile({ tab: guides, name: "diagram.png" });

    for (const address of [
      "/files/handbook/guides/missing.png",
      "/files/handbook/diagram.png",
      "/files/handbook/guides/Diagram.png",
      "/files/handbook/guides/diagram.PNG",
      "/files/handbook/guides/diagram",
      "/files/handbook/guides/diagram.png/more",
      "/files/handbook",
      "/files/nowhere/guides/diagram.png",
      "/files/handbook/guides/diagram.png?version=2",
      "/files/handbook/guides/diagram.png?version=0",
      "/files/handbook/guides/diagram.png?download=yes",
      "/files/handbook/guides/diagram.png?raw",
    ]) {
      await expectFileNotFound(page, address);
    }
  });

  test("answers a user without a role with 404, the same as for a file that does not exist", async ({ page }) => {
    const bob = await createUser({ name: "bob", mustChangePassword: false });
    const secret = await createFolder({ name: "secret", roles: [{ user: bob, role: "owner" }] });
    await createFile({ folder: secret, name: "plan.pdf" });

    await expectFileNotFound(page, "/files/secret/plan.pdf");
    await expectFileNotFound(page, "/files/secret/missing.pdf");
  });

  test("ends the access with the next request after the role is removed", async ({ page }) => {
    await createFile({ folder: handbook, name: "manual.pdf" });
    expect((await page.request.get("/files/handbook/manual.pdf")).status()).toBe(200);

    await getTestDb().folderRole.deleteMany({ where: { folderId: handbook.id, userId: KNOWN_USER.id } });

    await expectFileNotFound(page, "/files/handbook/manual.pdf");
  });

  test.describe("for an admin", () => {
    test.use({ storageState: ADMIN_STORAGE_STATE });

    test("answers with 404, the same as for a file that does not exist", async ({ page }) => {
      await createFile({ folder: handbook, name: "manual.pdf" });

      await expectFileNotFound(page, "/files/handbook/manual.pdf");
      await expectFileNotFound(page, "/files/handbook/missing.pdf");
    });
  });
});
