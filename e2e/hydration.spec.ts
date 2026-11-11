import { expect, test } from "@playwright/test";

import { createFolder, createPage, resetTestDatabase } from "./support/database";

// Without JavaScript the page never hydrates and shows only the server-rendered HTML: the state in which input could be
// lost, so every control that needs JavaScript must be locked here.
test.use({ javaScriptEnabled: false });

test.beforeEach(async () => {
  await resetTestDatabase();
});

test("the new page form is locked until hydration", async ({ page }) => {
  await page.goto("/pages/new");

  await expect(page.getByLabel("Content")).not.toBeEditable();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/pages");
});

test("the edit form is prefilled and locked until hydration", async ({ page }) => {
  const created = await createPage({ content: "# Locked page\n\nSome content" });

  await page.goto(`/pages/${created.slug}/edit`);

  await expect(page.getByLabel("Slug")).toHaveValue(created.slug);
  await expect(page.getByLabel("Slug")).not.toBeEditable();
  await expect(page.getByLabel("Content")).toHaveValue("# Locked page\n\nSome content");
  await expect(page.getByLabel("Content")).not.toBeEditable();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("the delete button of the page view is disabled until hydration", async ({ page }) => {
  const created = await createPage({ title: "Locked page" });

  await page.goto(`/pages/${created.slug}`);

  await expect(page.getByRole("button", { name: "Delete" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveAttribute("href", `/pages/${created.slug}/edit`);
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
