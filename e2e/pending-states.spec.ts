// The guard against a double submission: while the request of a Server Action runs, each pattern of a form disables
// its buttons, shows the pending label and, in a dialog, ignores the Escape key. The request is held with
// `holdServerAction()` and released once the pending state is checked.
import type { Locator, Page } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { holdServerAction } from "./support/browser";
import { createFolder, createPage, createUser, getTestDb, resetTestDatabase } from "./support/database";
import { fillContent } from "./support/editor";
import { authorizeUrl, awaitCallback, mcpAddress, registerClient } from "./support/oauth";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
});

/**
 * Clicks the button that submits the form while the request of its Server Action is held, runs `whilePending`, and
 * then lets the request through.
 */
async function submitHeld(page: Page, submit: Locator, whilePending: () => Promise<void>) {
  const hold = await holdServerAction(page);
  await submit.click();
  await hold.held;
  await whilePending();
  hold.release();
}

/**
 * Expects that the Escape key leaves the open dialog and the address as they are. The disabled button that was
 * clicked has lost the focus, so the focus is put into the dialog first, where a user who presses Escape has it.
 */
async function expectEscapeIgnored(page: Page, dialog: Locator, address: string) {
  await dialog.focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(address);
}

test("a dialog with a name disables its buttons, shows Saving… and ignores Escape while it saves", async ({ page }) => {
  await page.goto("/folders/handbook?action=new-tab");
  const dialog = page.getByRole("dialog", { name: "New tab" });
  await dialog.getByLabel("Name").fill("guides");

  await submitHeld(page, dialog.getByRole("button", { name: "Save" }), async () => {
    await expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "Cancel" })).toBeDisabled();
    await expectEscapeIgnored(page, dialog, "/folders/handbook?action=new-tab");
  });

  await expect(page).toHaveURL("/folders/handbook/guides");
});

test("a confirmation dialog disables its buttons, shows Deleting… and ignores Escape while it deletes", async ({
  page,
}) => {
  await createPage({ folder: handbook, name: "intro" });
  await page.goto("/folders/handbook/intro.md?action=delete");
  const dialog = page.getByRole("dialog", { name: "Delete page" });

  await submitHeld(page, dialog.getByRole("button", { name: "Delete" }), async () => {
    await expect(dialog.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "Cancel" })).toBeDisabled();
    await expectEscapeIgnored(page, dialog, "/folders/handbook/intro.md?action=delete");
  });

  await expect(page).toHaveURL("/folders/handbook");
});

test("the editor of a page disables Save and shows Saving… while it saves", async ({ page }) => {
  await createPage({ folder: handbook, name: "intro", content: "# Intro" });
  await page.goto("/folders/handbook/intro.md?action=edit");
  await fillContent(page, "# Intro\n\nMore");

  await submitHeld(page, page.getByRole("button", { name: "Save" }), async () => {
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  await expect(page).toHaveURL("/folders/handbook/intro.md");
  expect((await getTestDb().page.findFirstOrThrow()).content).toBe("# Intro\n\nMore");
});

test('the "Save page" dialog disables its buttons, shows Saving… and ignores Escape while it creates the page', async ({
  page,
}) => {
  await page.goto("/folders/handbook?action=new");
  await fillContent(page, "# Overview");
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog", { name: "Save page" });
  await expect(dialog.getByLabel("Name")).toHaveValue("overview");

  await submitHeld(page, dialog.getByRole("button", { name: "Save" }), async () => {
    await expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expectEscapeIgnored(page, dialog, "/folders/handbook?action=new");
  });

  await expect(page).toHaveURL("/folders/handbook/overview.md");
});

test('"Give role" disables its buttons, shows Saving… and ignores Escape while it gives the role', async ({ page }) => {
  const bob = await createUser({ name: "bob" });
  await page.goto("/folders/handbook?action=give-role");
  const dialog = page.getByRole("dialog", { name: "Give role" });
  await dialog.getByLabel("User").selectOption("bob");
  await dialog.getByRole("radio", { name: "Writer" }).check();

  await submitHeld(page, dialog.getByRole("button", { name: "Save" }), async () => {
    await expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "Cancel" })).toBeDisabled();
    await expectEscapeIgnored(page, dialog, "/folders/handbook?action=give-role");
  });

  await expect(page).toHaveURL("/folders/handbook");
  expect(await getTestDb().folderRole.findFirstOrThrow({ where: { userId: bob.id } })).toMatchObject({
    role: "writer",
  });
});

test("the consent form locks its choices and both buttons while it sends the answer", async ({ page, request }) => {
  const clientId = await registerClient(request);
  const callback = await awaitCallback(page);
  await page.goto(authorizeUrl(clientId, mcpAddress(handbook)));
  const main = page.getByRole("main");
  await main.getByLabel("Your password").fill(KNOWN_USER.password);

  await submitHeld(page, main.getByRole("button", { name: "Approve" }), async () => {
    await expect(main.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(main.getByRole("button", { name: "Deny" })).toBeDisabled();
    await expect(main.getByRole("radio", { name: "90 days" })).toBeDisabled();
    await expect(main.getByLabel("Your password")).toHaveAttribute("readonly");
  });

  expect(await callback()).toHaveProperty("code");
  expect(await getTestDb().oAuthCode.count({ where: { userId: KNOWN_USER.id } })).toBe(1);
});
