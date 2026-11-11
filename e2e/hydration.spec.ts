import { expect, test } from "@playwright/test";

import { createFolder, createPage, resetTestDatabase } from "./support/database";

// Without JavaScript the page never hydrates and shows only the server-rendered HTML: the state in which input could be
// lost, so every control that needs JavaScript must be locked here.
test.use({ javaScriptEnabled: false });

test.beforeEach(async () => {
  await resetTestDatabase();
});

test("the new page form is locked until hydration", async ({ page }) => {
  await createFolder({ name: "locked-folder" });

  await page.goto("/folders/locked-folder?action=new");

  await expect(page.getByLabel("Content")).not.toBeEditable();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/folders/locked-folder");
});

test("the edit form is prefilled and locked until hydration", async ({ page }) => {
  const folder = await createFolder({ name: "locked-folder" });
  await createPage({ folder, name: "locked-page", content: "# Locked page\n\nSome content" });

  await page.goto("/folders/locked-folder/locked-page.md?action=edit");

  await expect(page.getByLabel("Content")).toHaveValue("# Locked page\n\nSome content");
  await expect(page.getByLabel("Content")).not.toBeEditable();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute(
    "href",
    "/folders/locked-folder/locked-page.md",
  );
});

test("the page view needs no JavaScript for its controls", async ({ page }) => {
  const folder = await createFolder({ name: "locked-folder" });
  await createPage({ folder, name: "locked-page", title: "Locked page" });

  await page.goto("/folders/locked-folder/locked-page.md");

  const address = "/folders/locked-folder/locked-page.md";
  await expect(page.getByRole("link", { name: "Edit" })).toHaveAttribute("href", `${address}?action=edit`);
  await expect(page.getByRole("link", { name: "Rename" })).toHaveAttribute("href", `${address}?action=rename`);
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("the name dialog is prefilled and locked until hydration", async ({ page }) => {
  await createFolder({ name: "locked-folder" });

  await page.goto("/folders/locked-folder?action=rename");

  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  await expect(dialog.getByLabel("Name")).toHaveValue("locked-folder");
  await expect(dialog.getByLabel("Name")).not.toBeEditable();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/folders/locked-folder");
});
