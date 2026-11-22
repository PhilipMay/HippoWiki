// Tests written from the spec of attachments alone (`spec/attachments.md`), for the rules or the
// parts of rules that the other specs of files leave open: what each role is offered on the views and the details
// page, the details page for a user without a role, the same link from every page of the folder, a PDF never shown
// inside a page, the headers of every answer of a file address, the type a file is served with, and a tab without
// files.

import type { Page as BrowserPage } from "@playwright/test";

import { KNOWN_USER } from "../prisma/known-users";
import { expectNotFound } from "./support/browser";
import {
  createFile,
  createFolder,
  createPage,
  createTab,
  createUser,
  getTestDb,
  resetTestDatabase,
  setOwnRole,
} from "./support/database";
import { pngBytes, uploadFile } from "./support/files";
import { expect, test } from "./support/test";

let handbook: Awaited<ReturnType<typeof createFolder>>;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  await resetTestDatabase();
  handbook = await createFolder({ name: "handbook" });
  guides = await createTab({ folder: handbook, name: "guides" });
});

/** The headers that tell the browser to run nothing in an answer of a file address. */
const RUN_NOTHING = {
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
};

/** The headers of RUN_NOTHING of an answer, by their lower-case names. */
function runNothingOf(headers: Record<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(Object.keys(RUN_NOTHING).map((name) => [name, headers[name]]));
}

/** The link or button of the main area with exactly the given name. */
function offer(page: BrowserPage, name: string) {
  return page.getByRole("main").getByRole("link", { name, exact: true });
}

// attachments.md, "Uploading" and "The details page and versions", and `folder-roles.md`: upload for a Writer, a Manager
// and an Owner, a new version, a revert, move and rename for them too, delete only for a Manager and an Owner.
test("each role is offered upload, new version, revert, move or rename and delete as far as it may use them", async ({
  page,
}) => {
  await createFile({ tab: guides, name: "diagram.png", versions: [{}, {}] });
  const offers = {
    reader: [],
    writer: ["Upload file", "Upload new version", "Revert to version 1", "Move or rename"],
    manager: ["Upload file", "Upload new version", "Revert to version 1", "Move or rename", "Delete"],
    owner: ["Upload file", "Upload new version", "Revert to version 1", "Move or rename", "Delete"],
  } as const;

  for (const [role, offered] of Object.entries(offers) as [keyof typeof offers, readonly string[]][]) {
    await setOwnRole(handbook, role);
    const expected = (name: string) => (offered.includes(name) ? 1 : 0);

    for (const address of ["/folders/handbook", "/folders/handbook/guides"]) {
      await page.goto(address);
      await expect(offer(page, "Upload file"), `${role} at ${address}`).toHaveCount(expected("Upload file"));
    }
    await page.goto("/folders/handbook/guides/diagram.png");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(["diagram.png"]);
    for (const name of ["Upload new version", "Revert to version 1", "Move or rename", "Delete"]) {
      await expect(offer(page, name), `${role}: ${name}`).toHaveCount(expected(name));
    }
  }
});

// attachments.md, "Addresses and headers": the details page answers a user without a role on its folder with
// the not-found page, the same as the details page of a file that does not exist.
test("the details page of a file of a folder without a role is the not-found page, as for a missing file", async ({
  page,
}) => {
  const bob = await createUser({ name: "bob" });
  const secret = await createFolder({ name: "secret", roles: [{ user: bob, role: "owner" }] });
  await createFile({ folder: secret, name: "plan.pdf" });
  await createFile({ tab: await createTab({ folder: secret, name: "drafts" }), name: "sketch.png" });

  for (const address of [
    "/folders/secret/plan.pdf",
    "/folders/secret/drafts/sketch.png",
    "/folders/secret/missing.pdf",
    "/folders/secret/drafts/missing.png",
  ]) {
    await expectNotFound(page, address);
    await expect(page.getByRole("main"), address).not.toContainText(/plan|sketch|secret|drafts|bob/);
  }
});

// attachments.md, "Addresses and headers": the role is checked on every request, so removing it ends the
// access to the files of the folder with the next request, at the details page as at the file itself.
test("after the role is removed, the next request of the details page of a file gets the not-found page", async ({
  page,
}) => {
  await createFile({ tab: guides, name: "diagram.png" });
  await page.goto("/folders/handbook/guides/diagram.png");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["diagram.png"]);

  await getTestDb().folderRole.deleteMany({ where: { folderId: handbook.id, userId: KNOWN_USER.id } });

  await expectNotFound(page, "/folders/handbook/guides/diagram.png");
});

// attachments.md, "Links and embeds": a target names a file as wiki links
// name pages, the same from every page of the folder: `[[name.ext]]` the file placed directly in the folder, also
// from a page in a tab, and `[[tab/name.ext]]` the file in that tab, also from a page in another tab.
test("a link or embed of a file names the same file from every page of the folder", async ({ page }) => {
  const howtos = await createTab({ folder: handbook, name: "howtos" });
  await createFile({ folder: handbook, name: "diagram.png", versions: [{ bytes: await pngBytes(20, 10, "red") }] });
  await createFile({ tab: guides, name: "diagram.png", versions: [{ bytes: await pngBytes(30, 10, "blue") }] });
  const content = "# Links\n\n[[diagram.png|Top]] [[guides/diagram.png|Guide]]\n\n![[guides/diagram.png|Shown]]";
  await createPage({ folder: handbook, name: "top", content });
  await createPage({ tab: guides, name: "inside", content });
  await createPage({ tab: howtos, name: "elsewhere", content });

  for (const address of [
    "/folders/handbook/top.md",
    "/folders/handbook/guides/inside.md",
    "/folders/handbook/howtos/elsewhere.md",
  ]) {
    await page.goto(address);
    const article = page.getByRole("article");
    await expect(article.getByRole("link", { name: "Top" }), address).toHaveAttribute(
      "href",
      "/files/handbook/diagram.png",
    );
    await expect(article.getByRole("link", { name: "Guide" }), address).toHaveAttribute(
      "href",
      "/files/handbook/guides/diagram.png",
    );
    await expect(article.getByRole("img", { name: "Shown" }), address).toHaveAttribute(
      "src",
      "/files/handbook/guides/diagram.png",
    );
  }
});

// attachments.md, "Links and embeds": `![[…]]` of a PDF shows the same as
// `[[…]]`, a link with the name of the file, and neither shows the PDF inside the page.
test("![[…]] of a PDF without a label is a link with its name, and no PDF is shown inside the page", async ({
  page,
}) => {
  await createFile({ tab: guides, name: "report.pdf" });
  await createPage({
    folder: handbook,
    name: "manual",
    content: "# Manual\n\n![[guides/report.pdf]]\n\n[[guides/report.pdf]]",
  });

  await page.goto("/folders/handbook/manual.md");

  const article = page.getByRole("article");
  await expect(article.getByRole("link", { name: "report.pdf", exact: true })).toHaveCount(2);
  for (const link of await article.getByRole("link", { name: "report.pdf", exact: true }).all()) {
    await expect(link).toHaveAttribute("href", "/files/handbook/guides/report.pdf");
  }
  await expect(article.locator("img, iframe, object, embed")).toHaveCount(0);
});

// attachments.md, "Addresses and headers": every response of a file address tells the browser to run nothing
// in it: an earlier version, a download, an answer of 304 and of HEAD, and an answer of 404 for a folder without a
// role.
test("every answer of a file address carries the headers that run nothing in it", async ({ page }) => {
  const file = await createFile({ tab: guides, name: "diagram.png", versions: [{}, {}] });
  const bob = await createUser({ name: "bob" });
  const secret = await createFolder({ name: "secret", roles: [{ user: bob, role: "owner" }] });
  await createFile({ folder: secret, name: "plan.pdf" });
  const current = `"${file.versions[1]?.sha256}"`;

  const answers = [
    ["an earlier version", await page.request.get("/files/handbook/guides/diagram.png?version=1"), 200],
    ["a download", await page.request.get("/files/handbook/guides/diagram.png?download"), 200],
    [
      "an unchanged file",
      await page.request.get("/files/handbook/guides/diagram.png", { headers: { "if-none-match": current } }),
      304,
    ],
    ["HEAD", await page.request.head("/files/handbook/guides/diagram.png"), 200],
    ["a folder without a role", await page.request.get("/files/secret/plan.pdf"), 404],
  ] as const;

  for (const [what, response, status] of answers) {
    expect(response.status(), what).toBe(status);
    expect(runNothingOf(response.headers()), what).toEqual(RUN_NOTHING);
  }
});

// attachments.md, "Addresses and headers": the answer of a file address to a request without a login is a
// response of that address as well, and runs nothing either.
test("the answer of a file address without a login carries the headers that run nothing in it", async ({ page }) => {
  await createFile({ folder: handbook, name: "manual.pdf" });
  await page.context().clearCookies();

  const response = await page.request.get("/files/handbook/manual.pdf", { maxRedirects: 0 });

  expect(response.status()).not.toBe(200);
  expect(runNothingOf(response.headers())).toEqual(RUN_NOTHING);
});

// attachments.md, "Addresses and headers": the browser is told the type that the wiki determined from the
// content of the file, never the type the uploader claimed.
test("a file is served with the type of its content, not the type its upload claimed", async ({ page }) => {
  const bytes = await pngBytes();
  for (const [name, claimed] of [
    ["page.png", "text/html"],
    ["drawing.png", "image/svg+xml"],
    ["photo.png", "image/jpeg"],
  ] as const) {
    const uploaded = await uploadFile(page, { folder: "handbook", name, bytes, headers: { "content-type": claimed } });
    expect(uploaded.status(), name).toBe(201);

    const response = await page.request.get(`/files/handbook/${name}`);
    expect(response.headers()["content-type"], name).toBe("image/png");
  }
});

// content-structure.md, "Lists and order", and attachments.md, "Uploading": without files the section "Files" of a tab is not shown, and a Writer
// still sees "Upload file"; after the first upload the section appears.
test("a tab without files shows no section Files, but Upload file for a Writer, and the section after the first upload", async ({
  page,
}) => {
  await setOwnRole(handbook, "writer");
  await createPage({ tab: guides, name: "setup", title: "Setup" });

  await page.goto("/folders/handbook/guides");
  await expect(offer(page, "Upload file")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Files" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Setup/]);

  await uploadFile(page, { folder: "handbook", tab: "guides", name: "diagram.png", bytes: await pngBytes() });
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Files" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Files" }).getByRole("listitem")).toHaveText([/^diagram\.png/]);
});
