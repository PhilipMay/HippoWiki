// The folder view "AI apps" (`?view=mcp`): the MCP addresses that the logged-in user may connect an AI app to.
import { KNOWN_USER } from "../prisma/known-users";
import { collectErrors } from "./support/browser";
import { createFolder, resetTestDatabase } from "./support/database";
import { ISSUER } from "./support/oauth";
import { expect, test } from "./support/test";

test.beforeEach(async () => {
  await resetTestDatabase();
});

for (const [role, roles] of [
  ["reader", ["Reader"]],
  ["writer", ["Reader", "Writer"]],
  ["manager", ["Reader", "Writer", "Manager"]],
  ["owner", ["Reader", "Writer", "Manager"]],
] as const) {
  test(`a ${role} opens "AI apps" from the folder and sees the addresses of ${roles.join(", ")}`, async ({ page }) => {
    const errors = collectErrors(page);
    const folder = await createFolder({ name: "projects", roles: [{ user: KNOWN_USER, role }] });
    await page.goto("/folders/projects");

    await page.getByRole("link", { name: "AI apps" }).click();

    await expect(page).toHaveURL("/folders/projects?view=mcp");
    await expect(page).toHaveTitle("AI apps – projects – HippoWiki");
    await expect(page.getByRole("heading", { level: 1, name: "AI apps" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "projects" }),
    ).toHaveAttribute("href", "/folders/projects");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(roles);
    for (const label of roles) {
      const field = page.getByRole("textbox", { name: `${label} address` });
      await expect(field).toHaveValue(`${ISSUER}/mcp/${folder.id}/${label.toLowerCase()}`);
      await expect(field).not.toBeEditable();
      await expect(page.getByRole("button", { name: `Copy ${label.toLowerCase()} address` })).toBeEnabled();
    }
    await expect(page.getByText("without changing anything")).toBeVisible();
    if (roles.length >= 2) {
      await expect(page.getByText(/create pages, replace their content, and move or rename them/)).toBeVisible();
    }
    if (roles.length === 3) {
      await expect(page.getByText(/delete pages, and create, rename and delete tabs/)).toBeVisible();
    } else {
      await expect(page.getByText(/delete tabs/)).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test("the copy button puts the full address on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const folder = await createFolder({ name: "projects" });
  await page.goto("/folders/projects?view=mcp");

  await page.getByRole("button", { name: "Copy writer address" }).click();

  await expect(page.getByRole("button", { name: "Copy writer address" })).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ISSUER}/mcp/${folder.id}/writer`);
});

test("the view together with an action shows the not-found page", async ({ page }) => {
  await createFolder({ name: "projects" });

  for (const address of ["/folders/projects?view=mcp&action=rename", "/folders/projects?action=new&view=mcp"]) {
    const response = await page.goto(address);

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  }
});

test("the view of a folder without a role of the user shows the not-found page", async ({ page }) => {
  await createFolder({ name: "hidden", roles: [] });

  const response = await page.goto("/folders/hidden?view=mcp");

  expect(response?.status()).toBe(404);
  await expect(page.getByText(/\/mcp\//)).toHaveCount(0);
});
