import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";
import sharp from "sharp";

import { collectErrors, expectNotFound, expectNotFoundResponse } from "./support/browser";
import {
  createFile,
  createFolder,
  createPage,
  createTab,
  createUser,
  resetTestDatabase,
  setOwnRole,
} from "./support/database";
import { pdfBytes, pngBytes, uploadFile } from "./support/files";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** The cells of the table "Details", as the label of each row and its value. */
async function details(page: Page): Promise<Record<string, string>> {
  const rows = page.getByRole("table", { name: "Details" }).getByRole("row");
  const entries: [string, string][] = [];
  for (const row of await rows.all()) {
    entries.push([
      (await row.getByRole("rowheader").textContent()) ?? "",
      (await row.getByRole("cell").textContent()) ?? "",
    ]);
  }
  return Object.fromEntries(entries);
}

test("the details page of an image shows its preview, its details, the link to copy and its versions", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const bob = await createUser({ name: "bob" });
  await createFile({
    tab: guides,
    name: "diagram.png",
    editor: bob,
    via: "mcp",
    versions: [{ bytes: await pngBytes(64, 48, "red") }, { bytes: await pngBytes(80, 40, "blue") }],
  });

  await page.goto("/folders/handbook/guides/diagram.png");

  await expect(page).toHaveTitle("diagram.png – handbook – HippoWiki");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["diagram.png"]);
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("listitem")).toHaveText(["Folders", "handbook", "guides", "diagram.png"]);
  const preview = page.getByRole("main").getByRole("img", { name: "diagram.png" });
  await expect(preview).toHaveAttribute("src", "/files/handbook/guides/diagram.png");
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(80);
  expect(await details(page)).toEqual({
    Place: "In the tab guides of the folder handbook",
    Type: "PNG",
    Size: expect.stringMatching(/^\d+ B$/),
    "Width and height": "80 × 40 pixels",
    Versions: "2",
    "Last change": expect.stringMatching(/ by bob via mcp$/),
  });
  await expect(page.getByLabel("Link", { exact: true })).toHaveValue("![[guides/diagram.png]]");

  const versions = page.getByRole("table", { name: "Versions" });
  await expect(versions.getByRole("columnheader")).toHaveText(["Version", "Uploaded", "By", "Via", "Size", "Actions"]);
  await expect(versions.getByRole("link", { name: /^Version/ })).toHaveText(["Version 2", "Version 1"]);
  await expect(versions.getByRole("link", { name: /^Version/ }).nth(1)).toHaveAttribute(
    "href",
    "/files/handbook/guides/diagram.png?version=1",
  );
  await expect(versions.getByRole("row").nth(1)).toContainText("bob");
  await expect(versions.getByRole("row").nth(1)).toContainText("mcp");
  expect(errors).toEqual([]);
});

test("the details page of a PDF has no preview and no size in pixels, and links it with [[…]]", async ({ page }) => {
  await createFile({ folder: handbook, name: "manual.pdf", versions: [{ bytes: pdfBytes() }] });

  await page.goto("/folders/handbook/manual.pdf");

  await expect(page.getByRole("main").locator("img")).toHaveCount(0);
  expect(Object.keys(await details(page))).toEqual(["Place", "Type", "Size", "Versions", "Last change"]);
  expect((await details(page)).Place).toBe("Directly in the folder handbook");
  await expect(page.getByLabel("Link", { exact: true })).toHaveValue("[[manual.pdf]]");
});

test("Open opens the address of the file in a new tab, and Download saves it under its name", async ({
  page,
  context,
}) => {
  // An image, because the Chromium of the tests has no viewer of PDFs and downloads them instead.
  await createFile({ folder: handbook, name: "diagram.png" });
  const bytes = pdfBytes("the manual");
  await createFile({ folder: handbook, name: "manual.pdf", versions: [{ bytes }] });
  await page.goto("/folders/handbook/diagram.png");

  const [opened] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("main").getByRole("link", { name: "Open" }).click(),
  ]);
  await expect(opened).toHaveURL(/\/files\/handbook\/diagram\.png$/);
  await opened.close();

  await page.goto("/folders/handbook/manual.pdf");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("main").getByRole("link", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("manual.pdf");
  expect(await readFile((await download.path()) ?? "")).toEqual(bytes);
});

test("the copy button copies the link of the file", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await createFile({ tab: guides, name: "diagram.png" });
  await page.goto("/folders/handbook/guides/diagram.png");

  await page.getByRole("button", { name: "Copy link" }).click();

  await expect(page.getByRole("button", { name: "Copy link" })).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("![[guides/diagram.png]]");
});

test("a page that shows the file can be deleted, and the file stays", async ({ page }) => {
  await createFile({ folder: handbook, name: "diagram.png" });
  await createPage({
    folder: handbook,
    name: "intro",
    content: "# Intro\n\n![Diagram](/files/handbook/diagram.png)",
  });
  await page.goto("/folders/handbook/intro.md");
  await expect(page.getByRole("main").getByRole("img", { name: "Diagram" })).toBeVisible();

  await page.goto("/folders/handbook/intro.md?action=delete");
  await page.getByRole("dialog", { name: "Delete page" }).getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/folders/handbook");

  await expect(page.getByRole("list", { name: "Files" }).getByRole("link")).toHaveText([/^diagram\.png/]);
  await page.goto("/folders/handbook/diagram.png");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["diagram.png"]);
});

// The actions and views of a file address are read by `fileAddressOf()`, whose unit tests cover them.
test("the details page shows the not-found page for a file in another place and a deleted one", async ({ page }) => {
  await createFile({ tab: guides, name: "diagram.png" });
  await createFile({ folder: handbook, name: "gone.png", deletedAt: new Date() });

  for (const address of ["/folders/handbook/diagram.png", "/folders/handbook/gone.png"]) {
    await expectNotFoundResponse(page.request, address);
  }
});

/** The width of the image that the address returns. */
async function widthAt(page: Page, address: string): Promise<number | undefined> {
  return (await sharp(await (await page.request.get(address)).body()).metadata()).width;
}

test.describe("new versions and revert", () => {
  test.beforeEach(async () => {
    await createFile({
      tab: guides,
      name: "diagram.png",
      versions: [{ bytes: await pngBytes(10, 10, "red") }, { bytes: await pngBytes(20, 10, "blue") }],
    });
  });

  test("a new PNG for a PNG file adds a version, and the file address returns it", async ({ page }) => {
    await page.goto("/folders/handbook/guides/diagram.png");
    await page.getByRole("main").getByRole("link", { name: "Upload new version" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/diagram.png?action=upload-version");
    const dialog = page.getByRole("dialog", { name: "Upload new version" });
    await dialog
      .getByLabel("File")
      .setInputFiles({ name: "Anything.png", mimeType: "image/png", buffer: await pngBytes(30, 10, "green") });
    await dialog.getByRole("button", { name: "Upload" }).click();

    await expect(page).toHaveURL("/folders/handbook/guides/diagram.png");
    await expect(page.getByRole("table", { name: "Versions" }).getByRole("link", { name: /^Version/ })).toHaveText([
      "Version 3",
      "Version 2",
      "Version 1",
    ]);
    expect(await widthAt(page, "/files/handbook/guides/diagram.png")).toBe(30);
  });

  test("a PDF chosen for a PNG file is refused with a message, and nothing is stored", async ({ page }) => {
    await page.goto("/folders/handbook/guides/diagram.png?action=upload-version");
    const dialog = page.getByRole("dialog", { name: "Upload new version" });
    await dialog
      .getByLabel("File")
      .setInputFiles({ name: "manual.pdf", mimeType: "application/pdf", buffer: pdfBytes() });
    await dialog.getByRole("button", { name: "Upload" }).click();

    await expect(dialog.getByLabel("File")).toHaveAccessibleDescription(
      "The file is a PDF, but the name ends in .png: use a name that ends in .pdf.",
    );
    expect(await widthAt(page, "/files/handbook/guides/diagram.png")).toBe(20);
  });

  test("a revert to version 1 of a file with two versions stores a third that returns version 1", async ({ page }) => {
    await page.goto("/folders/handbook/guides/diagram.png");
    const versions = page.getByRole("table", { name: "Versions" });
    // The current version offers no revert.
    await expect(versions.getByRole("link", { name: /^Revert/ })).toHaveText(["Revert"]);
    await versions.getByRole("link", { name: "Revert to version 1" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/diagram.png?action=revert&version=1");
    const dialog = page.getByRole("dialog", { name: "Revert file" });
    await expect(dialog).toContainText("Set the file back to version 1 of");
    await dialog.getByRole("button", { name: "Revert" }).click();

    await expect(page).toHaveURL("/folders/handbook/guides/diagram.png");
    await expect(versions.getByRole("link", { name: /^Version/ })).toHaveText(["Version 3", "Version 2", "Version 1"]);
    await expect(versions.getByRole("row").nth(1)).toContainText("(reverted to version 1)");
    expect(await widthAt(page, "/files/handbook/guides/diagram.png")).toBe(10);
  });

  test("a Reader sees the versions, but no Upload new version and no revert, and their addresses are not found", async ({
    page,
  }) => {
    await setOwnRole(handbook, "reader");
    await page.goto("/folders/handbook/guides/diagram.png");

    await expect(page.getByRole("table", { name: "Versions" }).getByRole("link")).toHaveText([
      "Version 2",
      "Version 1",
    ]);
    await expect(page.getByRole("main").getByRole("link", { name: "Upload new version" })).toHaveCount(0);
    await expectNotFound(page, "/folders/handbook/guides/diagram.png?action=upload-version");
    await expectNotFound(page, "/folders/handbook/guides/diagram.png?action=revert&version=1");
  });

  test("a new version uploaded while the revert dialog is open makes the revert show the message", async ({ page }) => {
    await page.goto("/folders/handbook/guides/diagram.png?action=revert&version=1");
    const dialog = page.getByRole("dialog", { name: "Revert file" });
    await uploadFile(page, {
      folder: "handbook",
      tab: "guides",
      name: "diagram.png",
      bytes: await pngBytes(40, 10, "green"),
      replace: 1,
    });

    await dialog.getByRole("button", { name: "Revert" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/diagram.png?action=revert&version=1&notice=changed");
    await expect(dialog.getByRole("alert")).toHaveText(
      /^This file was changed by alice via web at .* after you opened it\.$/,
    );
    expect(await widthAt(page, "/files/handbook/guides/diagram.png")).toBe(40);

    await dialog.getByRole("button", { name: "Revert" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/diagram.png");
    expect(await widthAt(page, "/files/handbook/guides/diagram.png")).toBe(10);
  });

  test("a new version uploaded while Upload new version is open shows the message, and confirming stores it", async ({
    page,
  }) => {
    await page.goto("/folders/handbook/guides/diagram.png?action=upload-version");
    const dialog = page.getByRole("dialog", { name: "Upload new version" });
    await dialog
      .getByLabel("File")
      .setInputFiles({ name: "mine.png", mimeType: "image/png", buffer: await pngBytes(50, 10, "black") });
    await uploadFile(page, {
      folder: "handbook",
      tab: "guides",
      name: "diagram.png",
      bytes: await pngBytes(40, 10, "green"),
      replace: 1,
    });

    await dialog.getByRole("button", { name: "Upload" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      /^This file was changed by alice via web at .* after you opened it\.$/,
    );
    expect(await widthAt(page, "/files/handbook/guides/diagram.png")).toBe(40);

    await dialog.getByRole("button", { name: "Upload" }).click();
    await expect(page).toHaveURL("/folders/handbook/guides/diagram.png");
    expect(await widthAt(page, "/files/handbook/guides/diagram.png")).toBe(50);
  });
});
