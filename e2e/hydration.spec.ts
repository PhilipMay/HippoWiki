import { KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, NO_STORAGE_STATE } from "./support/auth";
import {
  createApiToken,
  createFolder,
  createPage,
  createTab,
  createUser,
  resetTestDatabase,
  TEST_PASSWORD,
} from "./support/database";
import { expect, test } from "./support/test";

// Without JavaScript the page never hydrates and shows only the server-rendered HTML: the state in which input could be
// lost, so every control that needs JavaScript must be locked here.
test.use({ javaScriptEnabled: false });

test.beforeEach(async () => {
  await resetTestDatabase();
});

test.describe("as the admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("the new user dialog is locked until hydration", async ({ page }) => {
    await page.goto("/users?action=create");

    const dialog = page.getByRole("dialog", { name: "New user" });
    await expect(dialog.getByLabel("User name")).not.toBeEditable();
    await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/users");
  });
});

test.describe("as a normal user", () => {
  test("the new token dialog is locked until hydration", async ({ page }) => {
    await page.goto("/account?action=create");

    const dialog = page.getByRole("dialog", { name: "New token" });
    await expect(dialog.getByLabel("Name")).not.toBeEditable();
    for (const label of [/^read/, /^write/, "30 days", "90 days", "365 days"]) {
      await expect(dialog.getByLabel(label)).toBeDisabled();
    }
    await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/account");
  });

  test("the revoke token dialog is locked until hydration", async ({ page }) => {
    const { token } = await createApiToken({ owner: KNOWN_USER, name: "laptop" });

    await page.goto(`/account?action=revoke&token=${token.id}`);

    const dialog = page.getByRole("dialog", { name: "Revoke token" });
    await expect(dialog.getByRole("button", { name: "Revoke" })).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/account");
  });
});

test.describe("without a login", () => {
  test.use({ storageState: NO_STORAGE_STATE });

  test("the login form is locked until hydration", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByLabel("User name")).not.toBeEditable();
    await expect(page.getByLabel("Password")).not.toBeEditable();
    await expect(page.getByRole("button", { name: "Log in" })).toBeDisabled();
  });

  test("the password change form is locked until hydration", async ({ browser }) => {
    // The login form needs JavaScript, so a browser with JavaScript logs in and hands its session to one without.
    await createUser({ name: "newcomer" });
    const withJavaScript = await browser.newContext({ javaScriptEnabled: true, storageState: NO_STORAGE_STATE });
    const loginPage = await withJavaScript.newPage();
    await loginPage.goto("/login");
    await loginPage.getByLabel("User name").fill("newcomer");
    await loginPage.getByLabel("Password").fill(TEST_PASSWORD);
    await loginPage.getByRole("button", { name: "Log in" }).click();
    await expect(loginPage).toHaveURL("/change-password");
    const storageState = await withJavaScript.storageState();
    await withJavaScript.close();
    const withoutJavaScript = await browser.newContext({ javaScriptEnabled: false, storageState });
    const page = await withoutJavaScript.newPage();

    await page.goto("/change-password");

    for (const label of [/^Current password/, /^New password/, /^Repeat new password/]) {
      await expect(page.getByLabel(label)).not.toBeEditable();
    }
    await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled();
    await withoutJavaScript.close();
  });
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
  await expect(page.getByRole("link", { name: "Move or rename" })).toHaveAttribute(
    "href",
    `${address}?action=move-or-rename`,
  );
  await expect(page.getByRole("link", { name: "Delete" })).toHaveAttribute("href", `${address}?action=delete`);
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
});

test("log out in the header needs no JavaScript", async ({ page }) => {
  await page.goto("/folders");

  // A plain form with a Server Action: the browser submits it itself.
  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Log out" })).toHaveCount(0);
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

test("the name dialog on a tab is prefilled and locked until hydration", async ({ page }) => {
  const folder = await createFolder({ name: "locked-folder" });
  await createTab({ folder, name: "locked-tab" });

  await page.goto("/folders/locked-folder/locked-tab?action=rename");

  const dialog = page.getByRole("dialog", { name: "Rename tab" });
  await expect(dialog.getByLabel("Name")).toHaveValue("locked-tab");
  await expect(dialog.getByLabel("Name")).not.toBeEditable();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute(
    "href",
    "/folders/locked-folder/locked-tab",
  );
});

test("the move or rename dialog is prefilled and locked until hydration", async ({ page }) => {
  const folder = await createFolder({ name: "locked-folder" });
  const tab = await createTab({ folder, name: "locked-tab" });
  await createPage({ tab, name: "locked-page", title: "Locked page" });

  await page.goto("/folders/locked-folder/locked-tab/locked-page.md?action=move-or-rename");

  const dialog = page.getByRole("dialog", { name: "Move or rename page" });
  await expect(dialog.getByLabel("Name")).toHaveValue("locked-page");
  await expect(dialog.getByLabel("Name")).not.toBeEditable();
  await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription(
    "Address: /folders/locked-folder/locked-tab/locked-page.md",
  );
  await expect(dialog.getByRole("radio", { name: "Tab locked-tab" })).toBeChecked();
  await expect(dialog.getByRole("radio")).toHaveCount(2);
  for (const radio of await dialog.getByRole("radio").all()) await expect(radio).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute(
    "href",
    "/folders/locked-folder/locked-tab/locked-page.md",
  );
});

test("the delete dialog is locked until hydration", async ({ page }) => {
  const folder = await createFolder({ name: "locked-folder" });
  await createPage({ folder, name: "locked-page", title: "Locked page" });

  await page.goto("/folders/locked-folder/locked-page.md?action=delete");

  const dialog = page.getByRole("dialog", { name: "Delete page" });
  await expect(dialog).toContainText("locked-page.md");
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute(
    "href",
    "/folders/locked-folder/locked-page.md",
  );
});

test("the restore dialog is prefilled and locked until hydration, without a place", async ({ page }) => {
  const folder = await createFolder({ name: "locked-folder" });
  await createTab({ folder, name: "locked-tab" });
  const removed = await createPage({ folder, name: "locked-page", title: "Locked page", deletedAt: new Date() });

  await page.goto(`/deleted-pages/locked-folder/${removed.id}?action=restore`);

  const dialog = page.getByRole("dialog", { name: "Restore page" });
  await expect(dialog.getByLabel("Name")).toHaveValue("locked-page");
  await expect(dialog.getByLabel("Name")).not.toBeEditable();
  await expect(dialog.getByRole("radio")).toHaveCount(2);
  for (const radio of await dialog.getByRole("radio").all()) {
    await expect(radio).toBeDisabled();
    await expect(radio).not.toBeChecked();
  }
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute(
    "href",
    `/deleted-pages/locked-folder/${removed.id}`,
  );
});
