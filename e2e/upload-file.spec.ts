import type { Locator, Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { by, collectErrors, expectNotFound } from "./support/browser";
import {
  createFile,
  createFolder,
  createPage,
  createTab,
  getTestDb,
  resetTestDatabase,
  setOwnRole,
} from "./support/database";
import { jpegBytes, pdfBytes, pngBytes } from "./support/files";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** The dialog "Upload file" of the page. */
function uploadDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Upload file" });
}

/** Chooses a file of the given name and content in the dialog. */
async function chooseFile(dialog: Locator, name: string, buffer: Buffer, mimeType = "image/png") {
  await dialog.getByLabel("File").setInputFiles({ name, mimeType, buffer });
}

/** The rows of the section "Files" of the page. */
function fileRows(page: Page): Locator {
  return page.getByRole("list", { name: "Files" }).getByRole("listitem");
}

test("a Writer uploads into the folder and into a tab, and each file is listed at its place only", async ({ page }) => {
  const errors = collectErrors(page);
  await setOwnRole(handbook, "writer");
  await createPage({ folder: handbook, name: "overview", title: "Overview" });
  await createPage({ tab: guides, name: "setup", title: "Setup" });

  await page.goto("/folders/handbook");
  await page.getByRole("main").getByRole("link", { name: "Upload file" }).click();
  await expect(page).toHaveURL("/folders/handbook?action=upload");
  const dialog = uploadDialog(page);
  await chooseFile(dialog, "Manual.pdf", pdfBytes(), "application/pdf");
  await expect(dialog.getByLabel("Name")).toHaveValue("manual.pdf");
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(page).toHaveURL("/folders/handbook/manual.pdf");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["manual.pdf"]);

  await page.goto("/folders/handbook/guides?action=upload");
  await chooseFile(uploadDialog(page), "diagram.png", await pngBytes(30, 20));
  await uploadDialog(page).getByRole("button", { name: "Upload" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/diagram.png");

  await page.goto("/folders/handbook");
  await expect(fileRows(page)).toHaveText([/^manual\.pdfPDF · [\d.]+ (B|KiB) · Updated .* by alice via web$/]);
  await expect(page.getByRole("list", { name: "Contents" }).getByRole("link")).toHaveText([/^Overview/, /^guides/]);
  await expect(fileRows(page).getByRole("link")).toHaveAttribute("href", "/folders/handbook/manual.pdf");

  await page.goto("/folders/handbook/guides");
  await expect(fileRows(page)).toHaveText([/^diagram\.pngPNG · [\d.]+ (B|KiB) · Updated /]);
  await expect(fileRows(page).first()).toHaveText(by(KNOWN_USER.name));
  await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Setup/]);
  await fileRows(page).getByRole("link").click();
  await expect(page).toHaveURL("/folders/handbook/guides/diagram.png");
  expect(errors).toEqual([]);
});

test("the dialog suggests the name of the chosen file by the name rule, .jpeg as .jpg", async ({ page }) => {
  await page.goto("/folders/handbook?action=upload");
  const dialog = uploadDialog(page);

  await chooseFile(dialog, "Network Diagram (v2).PNG", await pngBytes());
  await expect(dialog.getByLabel("Name")).toHaveValue("network-diagram-v2.png");
  await chooseFile(dialog, "photo.jpeg", await jpegBytes(), "image/jpeg");
  await expect(dialog.getByLabel("Name")).toHaveValue("photo.jpg");

  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(page).toHaveURL("/folders/handbook/photo.jpg");
});

test("names that break the rule are refused at the name field, and nothing is stored", async ({ page }) => {
  await page.goto("/folders/handbook?action=upload");
  const dialog = uploadDialog(page);
  await chooseFile(dialog, "diagram.png", await pngBytes());

  for (const name of ["Setup.png", "my file.png", "a.b.png", "photo.jpeg"]) {
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("button", { name: "Upload" }).click();
    await expect(dialog.getByLabel("Name"), name).toHaveAccessibleDescription(
      "Use lowercase letters, digits and single hyphens, then a dot and png, jpg, gif, webp or pdf",
    );
  }
  await expect(page).toHaveURL("/folders/handbook?action=upload");
  expect(await getTestDb().file.count()).toBe(0);
});

test("a file without a type of the wiki is refused at the file field with the accepted types", async ({ page }) => {
  await page.goto("/folders/handbook?action=upload");
  const dialog = uploadDialog(page);

  await chooseFile(dialog, "page.png", Buffer.from("<!DOCTYPE html><script>alert(1)</script>"), "text/html");
  await dialog.getByRole("button", { name: "Upload" }).click();

  await expect(dialog.getByLabel("File")).toHaveAccessibleDescription(
    "Only PNG, JPEG, GIF, WebP and PDF files can be uploaded.",
  );
  expect(await getTestDb().file.count()).toBe(0);
});

test("an upload under a taken name asks for a new version: confirmed it stores version 2, cancelled nothing", async ({
  page,
}) => {
  await createFile({ tab: guides, name: "diagram.png" });

  await page.goto("/folders/handbook/guides?action=upload");
  await chooseFile(uploadDialog(page), "diagram.png", await pngBytes(50, 50, "blue"));
  await uploadDialog(page).getByRole("button", { name: "Upload" }).click();
  await expect(uploadDialog(page)).toContainText("A file named diagram.png exists here already");
  await uploadDialog(page).getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides");
  expect(await getTestDb().fileVersion.count()).toBe(1);

  await page.goto("/folders/handbook/guides?action=upload");
  await chooseFile(uploadDialog(page), "diagram.png", await pngBytes(50, 50, "blue"));
  await uploadDialog(page).getByRole("button", { name: "Upload" }).click();
  await uploadDialog(page).getByRole("button", { name: "Upload new version" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/diagram.png");
  await expect(page.getByRole("table", { name: "Versions" }).getByRole("row")).toHaveCount(3);
  expect(await getTestDb().fileVersion.count()).toBe(2);
});

test("the option to remove the metadata is offered for an image, on, and not for a PDF", async ({ page }) => {
  await page.goto("/folders/handbook?action=upload");
  const dialog = uploadDialog(page);
  const option = dialog.getByRole("checkbox", { name: "Remove location and camera data" });

  await chooseFile(dialog, "photo.jpg", await jpegBytes(), "image/jpeg");
  await expect(option).toBeChecked();
  await chooseFile(dialog, "manual.pdf", pdfBytes(), "application/pdf");
  await expect(option).toHaveCount(0);
});

test("a folder without files shows no section, but Upload file for a Writer, a Manager and an Owner", async ({
  page,
}) => {
  for (const role of ["writer", "manager", "owner"] as const) {
    await setOwnRole(handbook, role);
    await page.goto("/folders/handbook");
    await expect(page.getByRole("main").getByRole("link", { name: "Upload file" }), role).toBeVisible();
    await expect(page.getByRole("heading", { name: "Files" })).toHaveCount(0);
  }

  await createFile({ folder: handbook, name: "manual.pdf" });
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Files" })).toBeVisible();
  await expect(fileRows(page)).toHaveCount(1);
});

test("a Reader sees the files and their details, but no Upload file, and its address is not found", async ({
  page,
}) => {
  await setOwnRole(handbook, "reader");
  await createFile({ folder: handbook, name: "manual.pdf" });
  await createFile({ tab: guides, name: "diagram.png", versions: [{}, {}] });

  await page.goto("/folders/handbook");
  await expect(fileRows(page)).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("link", { name: "Upload file" })).toHaveCount(0);
  await page.goto("/folders/handbook/guides/diagram.png");
  await expect(page.getByRole("table", { name: "Versions" }).getByRole("row")).toHaveCount(3);

  await expectNotFound(page, "/folders/handbook?action=upload");
  await expectNotFound(page, "/folders/handbook/guides?action=upload");
  await expectNotFound(page, "/folders/handbook/guides?action=upload&name=manual.pdf");
});

test("the dialog takes the name of the address instead of the one of the chosen file", async ({ page }) => {
  await page.goto("/folders/handbook/guides?action=upload&name=manual.pdf");
  const dialog = uploadDialog(page);
  await expect(dialog.getByLabel("Name")).toHaveValue("manual.pdf");

  await chooseFile(dialog, "Some Scan.pdf", pdfBytes(), "application/pdf");
  await expect(dialog.getByLabel("Name")).toHaveValue("manual.pdf");
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(page).toHaveURL("/folders/handbook/guides/manual.pdf");
});
