// The index of wiki links against the test database: the links stored with every content write, the pages that link
// to a page, and the derivation of the links of the pages stored before the index.
import { beforeEach, describe, expect, it } from "vitest";

import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import { indexOutdatedLinks, listLinkingPages } from "@/features/pages/links-service";
import * as pageService from "@/features/pages/service";
import { LINK_INDEX_VERSION } from "@/features/pages/wiki-links";
import type { Folder, Tab, User } from "@/generated/prisma/client";

import { createFolder, createPage, createTab, createUser, getTestDb } from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";
import { createBob, mcpActorOf, owners, storedPage } from "./helpers";

let user: User;
let actor: BrowserActor;
let folder: Folder;
let guides: Tab;

beforeEach(async () => {
  user = await createUser({ id: KNOWN_USER.id, name: "alice" });
  actor = inBrowser(user);
  folder = await createFolder({ roles: owners(user) });
  guides = await createTab({ folder, name: "guides" });
});

/** The links of the page in the index, as `tab/name` or `name`, in order. */
async function linksOf(pageId: string): Promise<string[]> {
  const rows = await getTestDb().pageLink.findMany({
    where: { pageId },
    select: { folderId: true, tabName: true, pageName: true },
  });
  for (const row of rows) expect(row.folderId).toBe(folder.id);
  return rows.map(({ tabName, pageName }) => (tabName === null ? pageName : `${tabName}/${pageName}`)).sort();
}

/** Creates a page through the pages service and returns its id. */
async function newPage(content: string, options: { name?: string; tabId?: string | null } = {}): Promise<string> {
  const result = await pageService.createPage(actor, folder.id, { content, tabId: null, ...options });
  if (!result.ok) throw new Error(`page not created: ${result.error.code}`);
  return result.value.id;
}

/** Saves the content of the page through the pages service, based on its stored version. */
async function save(pageId: string, content: string): Promise<void> {
  const { version } = await storedPage(pageId);
  const result = await pageService.updatePageContent(actor, pageId, { content, version });
  if (!result.ok) throw new Error(`page not saved: ${result.error.code}`);
}

/** The linking pages of the page as their titles. */
async function linkingTitles(pageId: string): Promise<string[] | undefined> {
  return (await listLinkingPages(actor, pageId))?.map((page) => page.title);
}

describe("the index of links", () => {
  it("holds the distinct valid targets of a new page, a link to itself included", async () => {
    const id = await newPage("# Setup\n\n[[guides/setup]] [[faq]] [[faq|again]] [[Bad Target]] `[[code]]` [[setup]]", {
      name: "setup",
    });

    expect(await linksOf(id)).toEqual(["faq", "guides/setup", "setup"]);
    expect((await storedPage(id)).linkIndexVersion).toBe(LINK_INDEX_VERSION);
  });

  it("follows the content of a save and of a revert, which stores the links of the old content as they are (R27)", async () => {
    const id = await newPage("# Notes\n\n[[a]] [[b]]");
    await save(id, "# Notes\n\n[[b]] [[c]]");
    expect(await linksOf(id)).toEqual(["b", "c"]);

    const { version } = await storedPage(id);
    const reverted = await pageService.revertPage(actor, id, { revision: 1, version });
    expect(reverted.ok).toBe(true);
    expect(await linksOf(id)).toEqual(["a", "b"]);
  });

  it("stays as it was when a save is refused", async () => {
    const id = await newPage("# Notes\n\n[[a]]");
    const refused = await pageService.updatePageContent(actor, id, { content: "# Notes\n\n[[b]]", version: 99 });

    expect(refused).toMatchObject({ ok: false, error: { code: "page-changed" } });
    expect(await linksOf(id)).toEqual(["a"]);
  });

  it("keeps the rows of a deleted page", async () => {
    const id = await newPage("# Notes\n\n[[a]]");
    await pageService.deletePage(actor, id, { version: (await storedPage(id)).version });

    expect(await linksOf(id)).toEqual(["a"]);
  });
});

describe("the linking pages", () => {
  it("are the other pages of the folder that link to the name and place of the page, by title (R12)", async () => {
    const setup = await newPage("# Setup guide\n\n[[guides/setup]]", { name: "setup", tabId: guides.id });
    await newPage("# Onboarding\n\n[[guides/setup|the setup]]", { name: "onboarding", tabId: guides.id });
    await newPage("# First week\n\n[[guides/setup]] and [[guides/setup]]", { name: "first-week" });
    await newPage("# Elsewhere\n\n[[setup]] [[docs/setup]]", { name: "elsewhere" });
    const other = await createFolder({ roles: owners(user) });
    await createPage({ folder: other, content: "# Other folder\n\n[[guides/setup]]" });

    expect(await linkingTitles(setup)).toEqual(["First week", "Onboarding"]);
    expect(await listLinkingPages(actor, setup)).toStrictEqual([
      { id: expect.any(String), name: "first-week", title: "First week", tab: null },
      { id: expect.any(String), name: "onboarding", title: "Onboarding", tab: { name: "guides" } },
    ]);
  });

  it("leave out a deleted linking page, and list it again after a restore (R12)", async () => {
    const setup = await newPage("# Setup", { name: "setup" });
    const linking = await newPage("# Onboarding\n\n[[setup]]", { name: "onboarding" });

    await pageService.deletePage(actor, linking, { version: (await storedPage(linking)).version });
    expect(await linkingTitles(setup)).toEqual([]);

    await pageService.restorePage(actor, linking, { name: "onboarding", tabId: null });
    expect(await linkingTitles(setup)).toEqual(["Onboarding"]);
  });

  it("are null for a deleted page, a user without a role, an admin and another folder through MCP", async () => {
    const setup = await newPage("# Setup", { name: "setup" });
    const bob = await createBob();
    const admin = await createUser({ type: "admin" });
    const other = await createFolder({ roles: owners(user) });

    expect(await listLinkingPages(inBrowser(bob), setup)).toBeNull();
    expect(await listLinkingPages(inBrowser(admin), setup)).toBeNull();
    expect(await listLinkingPages(mcpActorOf(user, other, "reader"), setup)).toBeNull();
    expect(await listLinkingPages(mcpActorOf(user, folder, "reader"), setup)).toEqual([]);

    await pageService.deletePage(actor, setup, { version: (await storedPage(setup)).version });
    expect(await listLinkingPages(actor, setup)).toBeNull();
  });
});

describe("the pages stored before the index of links", () => {
  /** A page as stored before the index of links: no rows and the version 0. */
  const BEFORE_INDEX = { linkIndexVersion: 0, links: {} };

  it("get their links, deleted pages included, and keep their last change, last editor and version", async () => {
    const bob = await createBob();
    const updatedAt = new Date("2026-01-02T03:04:05.000Z");
    const page = await createPage({
      folder,
      editor: bob,
      via: "mcp",
      content: "# Old\n\n[[guides/setup]] [[faq]]",
      version: 7,
      updatedAt,
      ...BEFORE_INDEX,
    });
    const deleted = await createPage({ folder, content: "# Gone\n\n[[faq]]", deletedAt: new Date(), ...BEFORE_INDEX });
    expect(await linksOf(page.id)).toEqual([]);
    const before = await storedPage(page.id);

    expect(await indexOutdatedLinks()).toEqual({ ok: true, value: { pages: 2 } });

    expect(await linksOf(page.id)).toEqual(["faq", "guides/setup"]);
    expect(await linksOf(deleted.id)).toEqual(["faq"]);
    const after = await storedPage(page.id);
    expect(after).toMatchObject({
      updatedAt,
      version: 7,
      lastEditedById: bob.id,
      lastEditedVia: "mcp",
      linkIndexVersion: LINK_INDEX_VERSION,
    });
    expect({ ...after, linkIndexVersion: 0 }).toEqual(before);
  });

  it("are not derived again by a second run, and all again once after the version changed", async () => {
    const page = await createPage({ folder, content: "# Once\n\n[[a]]", ...BEFORE_INDEX });
    expect(await indexOutdatedLinks()).toEqual({ ok: true, value: { pages: 1 } });
    expect(await indexOutdatedLinks()).toEqual({ ok: true, value: { pages: 0 } });

    await getTestDb().page.updateMany({ data: { linkIndexVersion: LINK_INDEX_VERSION - 1 } });
    expect(await indexOutdatedLinks()).toEqual({ ok: true, value: { pages: 1 } });
    expect(await linksOf(page.id)).toEqual(["a"]);
  });

  it("are derived in batches", async () => {
    await Promise.all(
      Array.from({ length: 120 }, (_, index) =>
        createPage({ folder, content: `# Page ${index}\n\n[[a]]`, ...BEFORE_INDEX }),
      ),
    );

    expect(await indexOutdatedLinks()).toEqual({ ok: true, value: { pages: 120 } });
    expect(await getTestDb().pageLink.count()).toBe(120);
  });

  it("do no harm when two runs derive them at the same time", async () => {
    await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        createPage({ folder, content: `# Page ${index}\n\n[[a]] [[b]]`, ...BEFORE_INDEX }),
      ),
    );

    const [first, second] = await Promise.all([indexOutdatedLinks(), indexOutdatedLinks()]);

    expect(first.ok && second.ok && first.value.pages + second.value.pages).toBe(60);
    expect(await getTestDb().pageLink.count()).toBe(120);
  });
});
