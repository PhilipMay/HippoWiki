import { KNOWN_USER } from "../prisma/known-users";
import { ADMIN_STORAGE_STATE, NO_STORAGE_STATE, submitLogin } from "./support/auth";
import {
  createFolder,
  createGrant,
  createPage,
  createRevisions,
  createTab,
  createUser,
  resetTestDatabase,
} from "./support/database";
import { authorizeUrl, mcpAddress, registerClient } from "./support/oauth";
import { expect, hydrating, test } from "./support/test";

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
    await expect(dialog.getByRole("radio", { name: "User" })).toBeDisabled();
    await expect(dialog.getByRole("radio", { name: "Admin" })).toBeDisabled();
    // The server-rendered dialog already shows "User" as the choice.
    await expect(dialog.getByRole("radio", { name: "User" })).toBeChecked();
    await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/users");
  });
});

test.describe("as a normal user", () => {
  test("the consent page of OAuth is locked until hydration and says that it needs JavaScript", async ({
    page,
    request,
  }) => {
    const clientId = await registerClient(request);
    const projects = await createFolder({ name: "projects" });
    const address = authorizeUrl(clientId, mcpAddress(projects));

    await page.goto(address);

    const main = page.getByRole("main");
    await expect(main.getByText("127.0.0.1:53682", { exact: true })).toBeVisible();
    for (const label of ["30 days", "90 days", "365 days"]) {
      await expect(main.getByLabel(label)).toBeDisabled();
    }
    await expect(main.getByLabel("Your password")).toHaveAttribute("readonly");
    await expect(main.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(main.getByRole("button", { name: "Deny" })).toBeDisabled();
    // The answer to the app cannot be sent by a plain form: forms stay on this site. The note is in a `noscript`
    // element, which this browser does not show although its scripts are switched off, so the HTML is checked.
    const html = await (await page.request.get(address)).text();
    expect(html).toMatch(
      /<noscript>[\s\S]*This page needs JavaScript to send your answer to the app\.[\s\S]*<\/noscript>/,
    );
  });

  test("the copy buttons of the view AI apps stay disabled until hydration", async ({ page }) => {
    await createFolder({ name: "projects" });

    await page.goto("/folders/projects?view=mcp");

    await expect(page.getByRole("textbox", { name: "Writer address" })).toHaveValue(/\/mcp\/.+\/writer$/);
    await expect(page.getByRole("button", { name: "Copy reader address" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Copy writer address" })).toBeDisabled();
  });

  test("the revoke dialog of a connected app is locked until hydration", async ({ page }) => {
    const { grant } = await createGrant({ owner: KNOWN_USER, name: "Example connector" });

    await page.goto(`/account?action=revoke&app=${grant.id}`);

    const dialog = page.getByRole("dialog", { name: "Revoke app" });
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
    const loginPage = hydrating(await withJavaScript.newPage());
    await loginPage.goto("/login");
    await submitLogin(loginPage, "newcomer");
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

test("the search field is read-only until hydration", async ({ page }) => {
  await createFolder({ name: "locked-folder" });

  await page.goto("/folders/locked-folder");
  await expect(page.getByRole("searchbox", { name: "Search this folder" })).not.toBeEditable();

  await page.goto("/folders/locked-folder?view=search&q=backup%20server");
  await expect(page.getByRole("searchbox", { name: "Search this folder" })).toHaveValue("backup server");
  await expect(page.getByRole("searchbox", { name: "Search this folder" })).not.toBeEditable();
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

test("the give role dialog is locked until hydration", async ({ page }) => {
  await createUser({ name: "bob" });
  await createFolder({ name: "locked-folder" });

  await page.goto("/folders/locked-folder?action=give-role");

  const dialog = page.getByRole("dialog", { name: "Give role" });
  await expect(dialog.getByLabel("User")).toBeDisabled();
  for (const role of ["Reader", "Writer", "Manager", "Owner"]) {
    await expect(dialog.getByRole("radio", { name: role })).toBeDisabled();
  }
  // The server-rendered dialog already shows "Reader" as the choice.
  await expect(dialog.getByRole("radio", { name: "Reader" })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/folders/locked-folder");
});

test("the controls of the roles view are locked until hydration", async ({ page }) => {
  const bob = await createUser({ name: "bob" });
  await createFolder({
    name: "locked-folder",
    roles: [
      { user: KNOWN_USER, role: "owner" },
      { user: bob, role: "writer" },
    ],
  });

  await page.goto("/folders/locked-folder?view=roles");

  const main = page.getByRole("main");
  for (const name of ["alice", "bob"]) {
    await expect(main.getByLabel(`Role of ${name}`, { exact: true })).toBeDisabled();
    await expect(main.getByRole("button", { name: `Remove the role of ${name}` })).toBeDisabled();
  }
  // The confirmation of a change of the own role opens only from these controls, so it cannot open either.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the name dialog is prefilled and locked until hydration", async ({ page }) => {
  await createFolder({ name: "locked-folder" });

  await page.goto("/folders/locked-folder?action=rename");

  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  await expect(dialog.getByLabel("Name")).toHaveValue("locked-folder");
  // "Save" of a rename dialog stays disabled after hydration as well while the name is unchanged, so the read-only
  // field proves the lock here; the dialogs of new items below check "Save".
  await expect(dialog.getByLabel("Name")).not.toBeEditable();
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/folders/locked-folder");
});

test("the name dialog on a tab is prefilled and locked until hydration", async ({ page }) => {
  const folder = await createFolder({ name: "locked-folder" });
  await createTab({ folder, name: "locked-tab" });

  await page.goto("/folders/locked-folder/locked-tab?action=rename");

  const dialog = page.getByRole("dialog", { name: "Rename tab" });
  await expect(dialog.getByLabel("Name")).toHaveValue("locked-tab");
  await expect(dialog.getByLabel("Name")).not.toBeEditable();
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute(
    "href",
    "/folders/locked-folder/locked-tab",
  );
});

test("the new folder and new tab dialogs are locked until hydration", async ({ page }) => {
  await createFolder({ name: "locked-folder" });

  // An empty field enables "Save" after hydration, so here it is disabled only until then.
  for (const [address, title, closeHref] of [
    ["/folders?action=new", "New folder", "/folders"],
    ["/folders/locked-folder?action=new-tab", "New tab", "/folders/locked-folder"],
  ] as const) {
    await page.goto(address);

    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog.getByLabel("Name")).toHaveValue("");
    await expect(dialog.getByLabel("Name")).not.toBeEditable();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", closeHref);
  }
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

test("the revert dialog is locked until hydration", async ({ page }) => {
  const folder = await createFolder({ name: "locked-folder" });
  const locked = await createPage({ folder, name: "locked-page", content: "# Locked page\n\nOld" });
  await createRevisions({ page: locked, count: 1, content: () => "# Locked page\n\nNew" });

  await page.goto("/folders/locked-folder/locked-page.md?action=revert&revision=1");

  const dialog = page.getByRole("dialog", { name: "Revert page" });
  await expect(dialog).toContainText("revision 1");
  await expect(dialog.getByRole("button", { name: "Revert" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute(
    "href",
    "/folders/locked-folder/locked-page.md?view=revision&revision=1",
  );
});

test("the delete dialog of a tab is locked until hydration", async ({ page }) => {
  const folder = await createFolder({ name: "locked-folder" });
  await createTab({ folder, name: "locked-tab" });

  await page.goto("/folders/locked-folder/locked-tab?action=delete");

  const dialog = page.getByRole("dialog", { name: "Delete tab" });
  await expect(dialog).toContainText("locked-tab");
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Cancel" })).toHaveAttribute(
    "href",
    "/folders/locked-folder/locked-tab",
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
