// The index of wiki links against the test database: the links stored with every content write, the pages that link
// to a page, and the derivation of the links of the pages stored before the index.
import { beforeEach, describe, expect, it } from "vitest";

import { inBrowser, type BrowserActor, type McpActor } from "@/features/folder-roles/actors";
import { CONTENT_MAX_LENGTH, CONTENT_MAX_WIKI_LINKS } from "@/features/pages/limits";
import { indexOutdatedLinks, listLinkingPages, listPagesLinkingToFile } from "@/features/pages/links-service";
import * as pageService from "@/features/pages/service";
import { LINK_INDEX_VERSION } from "@/features/pages/wiki-links";
import type { Folder, Tab, User } from "@/generated/prisma/client";

import { createFile, createFolder, createPage, createTab, createUser, getTestDb } from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";
import { createBob, mcpActorOf, owners, revisionsOf, storedPage } from "./helpers";

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

  it("follows the content of a save and of a revert, which stores the links of the old content as they are", async () => {
    const id = await newPage("# Notes\n\n[[a]] [[b]]");
    await save(id, "# Notes\n\n[[b]] [[c]]");
    expect(await linksOf(id)).toEqual(["b", "c"]);

    const { version } = await storedPage(id);
    const reverted = await pageService.revertPage(actor, id, { revision: 1, version });
    expect(reverted.ok).toBe(true);
    expect(await linksOf(id)).toEqual(["a", "b"]);
  });

  it("holds all links of a save with the most wiki links a page may have", async () => {
    const id = await newPage("# Links");
    const targets = Array.from({ length: CONTENT_MAX_WIKI_LINKS }, (_, index) => `p-${index}`);
    const content = `# Links\n\n${targets.map((target) => `[[${target}]]`).join(" ")}`;

    await save(id, content);

    expect((await storedPage(id)).content).toBe(content);
    expect(await linksOf(id)).toEqual(targets.sort());
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
  it("are the other pages of the folder that link to the name and place of the page, by title", async () => {
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

  it("leave out a deleted linking page, and list it again after a restore", async () => {
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

describe("the pages that show or link a file", () => {
  /** The pages that show or link the file, as their titles. */
  async function showingTitles(fileId: string): Promise<string[] | undefined> {
    return (await listPagesLinkingToFile(actor, fileId))?.map((page) => page.title);
  }

  it("are the pages of the folder with an embed or a link of its name and place, by title, each once", async () => {
    const file = await createFile({ tab: guides, name: "diagram.png" });
    await newPage("# Setup\n\n![[guides/diagram.png]] ![[guides/diagram.png|again]]", { name: "setup" });
    await newPage("# Network\n\n[[guides/diagram.png|the diagram]]", { name: "network", tabId: guides.id });
    await newPage("# Elsewhere\n\n![[diagram.png]] [[guides/diagram]] `![[guides/diagram.png]]`", {
      name: "elsewhere",
    });
    const other = await createFolder({ roles: owners(user) });
    await createPage({ folder: other, content: "# Other folder\n\n![[guides/diagram.png]]" });

    expect(await listPagesLinkingToFile(actor, file.id)).toStrictEqual([
      { id: expect.any(String), name: "network", title: "Network", tab: { name: "guides" } },
      { id: expect.any(String), name: "setup", title: "Setup", tab: null },
    ]);
  });

  it("leave out a page whose link was removed, once it is saved, and a deleted page", async () => {
    const file = await createFile({ folder, name: "report.pdf" });
    const linking = await newPage("# Manual\n\n[[report.pdf]]", { name: "manual" });
    const showing = await newPage("# Embedding\n\n![[report.pdf]]", { name: "embedding" });
    expect(await showingTitles(file.id)).toEqual(["Embedding", "Manual"]);

    await save(linking, "# Manual\n\nNo link any more.");
    await pageService.deletePage(actor, showing, { version: (await storedPage(showing)).version });

    expect(await showingTitles(file.id)).toEqual([]);
  });

  it("are null for a deleted file, a user without a role, an admin and another folder through MCP", async () => {
    const file = await createFile({ folder, name: "diagram.png" });
    const deleted = await createFile({ folder, name: "gone.png", deletedAt: new Date() });
    const bob = await createBob();
    const admin = await createUser({ type: "admin" });
    const other = await createFolder({ roles: owners(user) });

    expect(await listPagesLinkingToFile(inBrowser(bob), file.id)).toBeNull();
    expect(await listPagesLinkingToFile(inBrowser(admin), file.id)).toBeNull();
    expect(await listPagesLinkingToFile(mcpActorOf(user, other, "reader"), file.id)).toBeNull();
    expect(await listPagesLinkingToFile(mcpActorOf(user, folder, "reader"), file.id)).toEqual([]);
    expect(await listPagesLinkingToFile(actor, deleted.id)).toBeNull();
    expect(await listPagesLinkingToFile(actor, "not-a-uuid")).toBeNull();
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

  it("get the targets of files, which broke the name rule for the index before files", async () => {
    // As the previous version of the derivation stored them: no row for a target with an extension.
    const page = await createPage({
      folder,
      content: "# Old\n\n![[guides/diagram.png]] [[setup.png]] [[setup]]",
      linkIndexVersion: LINK_INDEX_VERSION - 1,
      links: { createMany: { data: [{ folderId: folder.id, tabName: null, pageName: "setup" }] } },
    });

    expect(await indexOutdatedLinks()).toEqual({ ok: true, value: { pages: 1 } });

    expect(await linksOf(page.id)).toEqual(["guides/diagram.png", "setup", "setup.png"]);
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

describe("the update of links on a move or rename", () => {
  /** Moves or renames the page through the pages service, based on its stored version. */
  async function move(pageId: string, name: string, tabId: string | null, mover: BrowserActor | McpActor = actor) {
    const { version } = await storedPage(pageId);
    return pageService.moveOrRenamePage(mover, pageId, { name, tabId, version });
  }

  it("changes the target of every link to the page, the page itself included, and keeps the labels", async () => {
    const setup = await newPage("# Setup guide\n\nSee [[guides/setup]].", { name: "setup", tabId: guides.id });
    const onboarding = await newPage("# Onboarding\n\n[[guides/setup|the setup]] [[faq]]", { name: "onboarding" });
    const other = await newPage("# Other\n\n[[setup]]", { name: "other" });

    const moved = await move(setup, "install", guides.id);

    expect(moved).toMatchObject({ ok: true, value: { name: "install", tab: { name: "guides" } } });
    expect(moved.ok && moved.value.updatedPages.map((page) => page.title)).toEqual(["Onboarding", "Setup guide"]);
    expect((await storedPage(onboarding)).content).toBe("# Onboarding\n\n[[guides/install|the setup]] [[faq]]");
    expect((await storedPage(setup)).content).toBe("# Setup guide\n\nSee [[guides/install]].");
    expect((await storedPage(other)).content).toBe("# Other\n\n[[setup]]");
    expect(await linksOf(onboarding)).toEqual(["faq", "guides/install"]);
    expect(await linkingTitles(setup)).toEqual(["Onboarding"]);
  });

  it("gives each updated page a marked revision by the user and channel of the move, the next version and that user as its last editor", async () => {
    const bob = await createBob();
    const setup = await newPage("# Setup", { name: "setup" });
    const linking = await createPage({ folder, editor: bob, name: "onboarding", content: "# Onboarding\n\n[[setup]]" });
    const mcp = mcpActorOf(user, folder, "writer");

    await move(setup, "install", null, mcp);

    const stored = await storedPage(linking.id);
    expect(stored).toMatchObject({ version: linking.version + 1, lastEditedById: user.id, lastEditedVia: "mcp" });
    const revisions = await revisionsOf(linking.id);
    expect(revisions.at(-1)).toEqual({
      number: 2,
      title: "Onboarding",
      content: "# Onboarding\n\n[[install]]",
      userId: user.id,
      via: "mcp",
      revertedTo: null,
      linksUpdated: true,
    });
    expect(revisions[0]?.linksUpdated).toBe(false);
  });

  it("updates the title and search text that a link in the heading gives, and keeps the language", async () => {
    await newPage("# Setup", { name: "setup", tabId: guides.id });
    const about = await newPage("# About [[guides/setup]]\n\nText", { name: "about" });
    const { searchLanguage } = await storedPage(about);

    await move((await getTestDb().page.findFirstOrThrow({ where: { name: "setup" } })).id, "install", guides.id);

    expect(await storedPage(about)).toMatchObject({ title: "About guides/install", searchLanguage });
  });

  it("changes no page when the move is refused for a taken name or an older version", async () => {
    const setup = await newPage("# Setup", { name: "setup" });
    await newPage("# Install", { name: "install" });
    const linking = await newPage("# Onboarding\n\n[[setup]]", { name: "onboarding" });
    const before = await getTestDb().page.findMany({ orderBy: { id: "asc" } });
    const revisions = await getTestDb().pageRevision.count();

    expect(await move(setup, "install", null)).toEqual({ ok: false, error: { code: "name-taken" } });
    const { version } = await storedPage(setup);
    const stale = await pageService.moveOrRenamePage(actor, setup, {
      name: "other",
      tabId: null,
      version: version + 5,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "page-changed" } });

    expect(await getTestDb().page.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await getTestDb().pageRevision.count()).toBe(revisions);
    expect(await linksOf(linking)).toEqual(["setup"]);
  });

  it("leaves no link to the old name and place once it is stored, and none in code", async () => {
    const setup = await newPage("# Setup", { name: "setup" });
    const linking = await newPage("# L\n\n[[setup]] `[[setup]]`\n\n| [[setup\\|S]] |\n| - |", { name: "linking" });

    await move(setup, "install", guides.id);

    expect((await storedPage(linking)).content).toBe(
      "# L\n\n[[guides/install]] `[[setup]]`\n\n| [[guides/install\\|S]] |\n| - |",
    );
    expect(await getTestDb().pageLink.count({ where: { pageName: "setup" } })).toBe(0);
  });

  it("updates nothing for a move to the own name and place", async () => {
    const setup = await newPage("# Setup\n\n[[setup]]", { name: "setup" });
    const before = await storedPage(setup);

    expect(await move(setup, "setup", null)).toMatchObject({ ok: true, value: { updatedPages: [] } });
    expect(await storedPage(setup)).toEqual(before);
  });

  it("updates a linking page past the content limit and stores it", async () => {
    const setup = await newPage("# Setup", { name: "s" });
    const head = "# Long\n\n[[s]]\n\n";
    const content = head + "x".repeat(CONTENT_MAX_LENGTH - 1 - head.length);
    expect(content).toHaveLength(CONTENT_MAX_LENGTH - 1);
    const long = await newPage(content, { name: "long" });

    await move(setup, "a-much-longer-name", guides.id);

    const stored = await storedPage(long);
    expect(stored.content.length).toBeGreaterThan(CONTENT_MAX_LENGTH);
    expect(stored.content.startsWith("# Long\n\n[[guides/a-much-longer-name]]")).toBe(true);
    // It can be moved and deleted although it is over the limit.
    expect((await move(long, "longer", null)).ok).toBe(true);
    const deleted = await pageService.deletePage(actor, long, { version: (await storedPage(long)).version });
    expect(deleted.ok).toBe(true);
  });

  it("changes only the targets of a linking page whose footnote definition with a link stands before another link, and back", async () => {
    const original = "# Notes\n\n[^1]: see [[setup]]\n\nText[^1] and [[setup|the setup]].\n";
    const setup = await newPage("# Setup", { name: "setup" });
    const notes = await newPage(original, { name: "notes" });

    await move(setup, "install", null);

    const renamed = "# Notes\n\n[^1]: see [[install]]\n\nText[^1] and [[install|the setup]].\n";
    expect((await storedPage(notes)).content).toBe(renamed);
    expect(await linksOf(notes)).toEqual(["install"]);
    expect((await revisionsOf(notes)).at(-1)).toMatchObject({ number: 2, content: renamed, linksUpdated: true });

    await move(setup, "setup", null);

    expect((await storedPage(notes)).content).toBe(original);
    expect(await linksOf(notes)).toEqual(["setup"]);
    expect((await revisionsOf(notes)).at(-1)).toMatchObject({ number: 3, content: original, linksUpdated: true });
  });

  it("keeps the link, versions and history of a deleted page", async () => {
    const setup = await newPage("# Setup", { name: "setup" });
    const gone = await newPage("# Gone\n\n[[setup]]", { name: "gone" });
    await pageService.deletePage(actor, gone, { version: (await storedPage(gone)).version });
    const before = { page: await storedPage(gone), revisions: await revisionsOf(gone) };

    await move(setup, "install", null);

    expect({ page: await storedPage(gone), revisions: await revisionsOf(gone) }).toEqual(before);
    expect(before.page.content).toBe("# Gone\n\n[[setup]]");
  });

  it("waits for a content save that adds a link to the old name and commits while the move waits, and updates it too", async () => {
    const setup = await newPage("# Setup", { name: "setup" });
    const linking = await newPage("# Linking\n\nNo link yet.", { name: "linking" });
    const db = getTestDb();
    // A transaction of the test holds the row of the linking page, so that the save, once it holds the shared lock of
    // the folder, waits at its update until the move waits for the exclusive lock.
    let release = () => {};
    let locked = () => {};
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const held = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Page" WHERE id = ${linking}::uuid FOR UPDATE`;
      locked();
      await new Promise<void>((resolve) => (release = resolve));
    });
    await holding;
    const saving = save(linking, "# Linking\n\n[[setup]]");
    await waitForLocks("the save", (locktype) => locktype !== "advisory", 1);
    const moving = move(setup, "install", null);
    await waitForLocks("the move", (locktype) => locktype === "advisory", 1);
    release();
    await held;
    await saving;
    const moved = await moving;

    expect(moved.ok && moved.value.updatedPages.map((page) => page.name)).toEqual(["linking"]);
    expect((await storedPage(linking)).content).toBe("# Linking\n\n[[install]]");
  });
});

/** Waits until at least `count` locks that the filter takes are waited for. */
async function waitForLocks(what: string, filter: (locktype: string) => boolean, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const rows = await getTestDb().$queryRaw<{ locktype: string }[]>`SELECT locktype FROM pg_locks WHERE NOT granted`;
    if (rows.filter((row) => filter(row.locktype)).length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${what} did not wait for a lock`);
}
