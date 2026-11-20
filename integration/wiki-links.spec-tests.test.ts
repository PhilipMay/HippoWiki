// Tests written from the requirements of wiki links alone (`spec/wiki-links-requirements.md`), for the rules or the
// parts of rules that the other tests of wiki links leave open: the folder as the bound of every link and update, a
// page that comes to the name and place of a link, the text forms of `[[...]]` on a rename, the limits on an update,
// the rollback of a whole update and the deleted pages after a restore.
import { beforeEach, describe, expect, it } from "vitest";

import { inBrowser, type BrowserActor, type McpActor } from "@/features/folder-roles/actors";
import * as folderService from "@/features/folders/service";
import { CONTENT_MAX_LENGTH, CONTENT_MAX_WIKI_LINKS } from "@/features/pages/limits";
import { countPagesLinkingTo, listLinkingPages } from "@/features/pages/links-service";
import * as pageService from "@/features/pages/service";
import { searchPages } from "@/features/search/service";
import type { Folder, Tab, User } from "@/generated/prisma/client";

import { createFolder, createPage, createTab, createUser, getTestDb } from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";
import { mcpActorOf, owners, revisionsOf, storedPage } from "./helpers";

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

/** Moves or renames the page through the pages service, based on its stored version. */
async function move(pageId: string, name: string, tabId: string | null, mover: BrowserActor | McpActor = actor) {
  const { version } = await storedPage(pageId);
  return pageService.moveOrRenamePage(mover, pageId, { name, tabId, version });
}

/** The titles that the folder gives the targets of the content, as the page view resolves them. */
async function resolvedTitles(content: string, inFolder: { id: string } = folder): Promise<[string, string][]> {
  const resolution = await pageService.resolveWikiLinks(actor, inFolder.id, content);
  return [...(resolution?.titles ?? new Map<string, string>())];
}

/** Every page, revision and link row of the database, to compare a whole state before and after a write. */
async function everything() {
  const db = getTestDb();
  return {
    pages: await db.page.findMany({ orderBy: { id: "asc" } }),
    revisions: await db.pageRevision.findMany({ orderBy: { id: "asc" } }),
    links: await db.pageLink.findMany({ orderBy: { id: "asc" } }),
    tabs: await db.tab.findMany({ orderBy: { id: "asc" } }),
  };
}

describe("the folder bounds every link (R1)", () => {
  // wiki-links-requirements.md, "Syntax and target", R1.
  it("reads [[other-folder/setup]] as the tab other-folder of the own folder, never as the folder of that name", async () => {
    const otherFolder = await createFolder({ name: "other-folder", roles: owners(user) });
    await createPage({ folder: otherFolder, name: "setup", content: "# Setup elsewhere" });

    expect(await resolvedTitles("[[other-folder/setup]]")).toEqual([]);

    const ownTab = await createTab({ folder, name: "other-folder" });
    await createPage({ tab: ownTab, name: "setup", content: "# Setup in the own tab" });
    expect(await resolvedTitles("[[other-folder/setup]]")).toEqual([["other-folder/setup", "Setup in the own tab"]]);
  });

  // wiki-links-requirements.md, "Syntax and target", R1, and "Rename and move", R7 ("in the pages of the folder").
  it("a rename changes no link in another folder that names the same page", async () => {
    const setup = await createPage({ folder, name: "setup", content: "# Setup" });
    const linking = await createPage({ folder, name: "onboarding", content: "# Onboarding\n\n[[setup]]" });
    const otherFolder = await createFolder({ roles: owners(user) });
    await createPage({ folder: otherFolder, name: "setup", content: "# Setup elsewhere" });
    const elsewhere = await createPage({ folder: otherFolder, name: "notes", content: "# Notes\n\n[[setup]]" });

    const moved = await move(setup.id, "install", null);

    expect(moved.ok && moved.value.updatedPages.map((page) => page.id)).toEqual([linking.id]);
    expect((await storedPage(linking.id)).content).toBe("# Onboarding\n\n[[install]]");
    expect(await storedPage(elsewhere.id)).toEqual(elsewhere);
  });

  // wiki-links-requirements.md, "Rename and move", R11, by the rules of R1.
  it("a tab rename changes no link in another folder that names a tab of the same name", async () => {
    await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
    const otherFolder = await createFolder({ roles: owners(user) });
    await createTab({ folder: otherFolder, name: "guides" });
    const elsewhere = await createPage({ folder: otherFolder, name: "notes", content: "# Notes\n\n[[guides/setup]]" });

    const renamed = await folderService.renameTab(actor, guides.id, { name: "docs" });

    expect(renamed).toMatchObject({ ok: true, value: { name: "docs", updatedPages: [] } });
    expect(await storedPage(elsewhere.id)).toEqual(elsewhere);
  });
});

describe("a page that comes to the name and place of a link (R33)", () => {
  // wiki-links-requirements.md, "Syntax and target", R33.
  it.each(["renamed", "moved"])(
    "a page %s to guides/faq is what [[guides/faq]] leads to, without a change of the linking page",
    async (how) => {
      const linking = await createPage({ folder, name: "links", content: "# Links\n\n[[guides/faq]]" });
      // Renamed: from another name in the same tab. Moved: from the same name directly in the folder.
      const coming =
        how === "renamed"
          ? await createPage({ tab: guides, name: "questions", content: "# Questions" })
          : await createPage({ folder, name: "faq", content: "# Questions" });
      expect(await resolvedTitles(linking.content)).toEqual([]);

      expect((await move(coming.id, "faq", guides.id)).ok).toBe(true);

      expect(await resolvedTitles(linking.content)).toEqual([["guides/faq", "Questions"]]);
      expect(await storedPage(linking.id)).toEqual(linking);
      expect((await listLinkingPages(actor, coming.id))?.map((page) => page.id)).toEqual([linking.id]);
    },
  );

  // wiki-links-requirements.md, "Syntax and target", R33 (a tab renamed to the place of the link).
  it("a tab renamed to the tab of a link makes its page what the link leads to", async () => {
    const linking = await createPage({ folder, name: "links", content: "# Links\n\n[[docs/setup]]" });
    await createPage({ tab: guides, name: "setup", content: "# Setup guide" });

    expect((await folderService.renameTab(actor, guides.id, { name: "docs" })).ok).toBe(true);

    expect(await resolvedTitles(linking.content)).toEqual([["docs/setup", "Setup guide"]]);
    expect(await storedPage(linking.id)).toEqual(linking);
  });
});

describe("[[...]] as text on a rename (R31)", () => {
  // wiki-links-requirements.md, "Syntax and target", R31.
  it("code, a fenced or indented code block, \\[[ and a link over a line break are not changed by a rename and count as no backlink", async () => {
    const setup = await createPage({ tab: guides, name: "setup", content: "# Setup" });
    const content =
      "# Text\n\n`[[guides/setup]]`\n\n```\n[[guides/setup]]\n```\n\n    [[guides/setup]]\n\n" +
      "\\[[guides/setup]]\n\n[[guides/setup\n]]";
    // Stored through the service, so that its links are indexed as by any save.
    const created = await pageService.createPage(actor, folder.id, { content, name: "text", tabId: null });
    if (!created.ok) throw new Error(`page not created: ${created.error.code}`);
    const text = await storedPage(created.value.id);

    expect(await listLinkingPages(actor, setup.id)).toEqual([]);
    expect(await countPagesLinkingTo(actor, setup.id)).toBe(0);

    expect(await move(setup.id, "install", guides.id)).toMatchObject({ ok: true, value: { updatedPages: [] } });
    expect(await folderService.renameTab(actor, guides.id, { name: "docs" })).toMatchObject({
      ok: true,
      value: { updatedPages: [] },
    });

    expect(await storedPage(text.id)).toEqual(text);
    expect(await revisionsOf(text.id)).toHaveLength(1);
  });
});

describe("a link into a tab (R11)", () => {
  // wiki-links-requirements.md, "Rename and move", R11 ("every wiki link into the tab"): [[guides]] names the page
  // `guides` placed directly in the folder, not the tab.
  it("a tab rename changes [[guides/setup]] but not [[guides]], the page of the tab's name directly in the folder", async () => {
    await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
    await createPage({ folder, name: "guides", content: "# Guides overview" });
    const onlyPage = await createPage({ folder, name: "overview", content: "# Overview\n\n[[guides]]" });
    const both = await createPage({ folder, name: "both", content: "# Both\n\n[[guides]] [[guides/setup]]" });

    const renamed = await folderService.renameTab(actor, guides.id, { name: "docs" });

    expect(renamed.ok && renamed.value.updatedPages.map((page) => page.id)).toEqual([both.id]);
    expect((await storedPage(both.id)).content).toBe("# Both\n\n[[guides]] [[docs/setup]]");
    expect(await storedPage(onlyPage.id)).toEqual(onlyPage);
  });
});

describe("the plain text of a link for search (R23)", () => {
  // wiki-links-requirements.md, "Display", R23 ("never as the title of another page").
  it("a search for the title of a linked page does not find the page that links it without a label", async () => {
    const setup = await pageService.createPage(actor, folder.id, {
      content: "# Unusual zebra handbook",
      name: "zebra",
      tabId: guides.id,
    });
    const linking = await pageService.createPage(actor, folder.id, {
      content: "# Links\n\nRead [[guides/zebra]].",
      name: "links",
      tabId: null,
    });
    expect(setup.ok && linking.ok).toBe(true);

    const byTitle = await searchPages(actor, folder.id, "unusual zebra handbook");
    expect(byTitle?.ok && byTitle.value.results.map((page) => page.name)).toEqual(["zebra"]);
    const byTarget = await searchPages(actor, folder.id, "guides/zebra");
    expect(byTarget?.ok && byTarget.value.results.map((page) => page.name)).toContain("links");
  });
});

describe("the limits on an update of links", () => {
  // wiki-links-requirements.md, "Syntax and target", R26 ("The update of links on a rename is never refused for it").
  it("a rename updates a page that holds more than 5,000 wiki links", async () => {
    const setup = await createPage({ folder, name: "setup", content: "# Setup" });
    const many = await createPage({
      folder,
      name: "many",
      content: `# Many\n\n${"[[setup]] ".repeat(CONTENT_MAX_WIKI_LINKS + 1)}`,
    });

    const moved = await move(setup.id, "install", null);

    expect(moved.ok && moved.value.updatedPages.map((page) => page.id)).toEqual([many.id]);
    expect((await storedPage(many.id)).content).toBe(`# Many\n\n${"[[install]] ".repeat(CONTENT_MAX_WIKI_LINKS + 1)}`);
  });

  // wiki-links-requirements.md, "Rename and move", R21 ("or that is already over a limit lowered later") and R11.
  it.each([
    ["a page rename", (setupId: string) => move(setupId, "install", guides.id), "[[guides/install]]"],
    ["a tab rename", () => folderService.renameTab(actor, guides.id, { name: "docs" }), "[[docs/setup]]"],
  ])("%s updates a page that is already over the content limit", async (_name, rename, expected) => {
    const setup = await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
    const head = "# Long\n\n[[guides/setup]]\n\n";
    const over = await createPage({
      folder,
      name: "long",
      content: head + "x".repeat(CONTENT_MAX_LENGTH + 10 - head.length),
    });

    const renamed = await rename(setup.id);

    expect(renamed.ok).toBe(true);
    const stored = await storedPage(over.id);
    expect(stored.content.startsWith(`# Long\n\n${expected}\n\n`)).toBe(true);
    expect(stored.version).toBe(over.version + 1);
  });

  // wiki-links-requirements.md, "Rename and move", R21 ("it can be viewed, moved and deleted, and saved again once it
  // is within the limit").
  it("a page that an update made longer than the limit can be viewed, and saved again once it is within the limit", async () => {
    const setup = await createPage({ folder, name: "s", content: "# Setup" });
    const head = "# Long\n\n[[s]]\n\n";
    const long = await createPage({
      folder,
      name: "long",
      content: head + "x".repeat(CONTENT_MAX_LENGTH - 1 - head.length),
    });
    await move(setup.id, "a-much-longer-name", guides.id);
    expect((await storedPage(long.id)).content.length).toBeGreaterThan(CONTENT_MAX_LENGTH);

    expect(await pageService.getPage(actor, folder.name, null, "long")).toMatchObject({ id: long.id });
    const { version } = await storedPage(long.id);
    const saved = await pageService.updatePageContent(actor, long.id, { content: "# Long\n\nShort now.", version });
    expect(saved.ok).toBe(true);
    expect((await storedPage(long.id)).content).toBe("# Long\n\nShort now.");
  });
});

describe("the update of links is one write (R8)", () => {
  /** Runs the write while a trigger of the test refuses every new revision of the given page. */
  async function whileRevisionsOfAreRefused<T>(pageId: string, write: () => Promise<T>): Promise<T> {
    const db = getTestDb();
    await db.$executeRawUnsafe(`
      CREATE FUNCTION refuse_revision_of() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."pageId" = '${pageId}'::uuid THEN RAISE EXCEPTION 'revision refused by the test'; END IF;
        RETURN NEW;
      END $$`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER refuse_revision_of BEFORE INSERT ON "PageRevision" FOR EACH ROW EXECUTE FUNCTION refuse_revision_of()`,
    );
    try {
      return await write();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER refuse_revision_of ON "PageRevision"`);
      await db.$executeRawUnsafe(`DROP FUNCTION refuse_revision_of()`);
    }
  }

  /** The setup guide in guides, linked from two pages, of which the updates of the second one fail. */
  async function setUp() {
    const setup = await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
    await createPage({ folder, name: "alpha", content: "# Alpha\n\n[[guides/setup]]" });
    const zeta = await createPage({ folder, name: "zeta", content: "# Zeta\n\n[[guides/setup|the setup]]" });
    const third = await createPage({ tab: guides, name: "middle", content: "# Middle\n\n[[guides/setup]]" });
    return { setup, zeta, third };
  }

  // wiki-links-requirements.md, "Rename and move", R8 ("either the rename or move and all the updates are stored, or
  // nothing is").
  it("a move whose update of one linking page fails stores neither the move nor any update", async () => {
    const { setup, zeta } = await setUp();
    const before = await everything();

    const moved = await whileRevisionsOfAreRefused(zeta.id, () => move(setup.id, "install", guides.id));

    expect(moved.ok).toBe(false);
    expect(await everything()).toStrictEqual(before);
  });

  // wiki-links-requirements.md, "Rename and move", R11 by the rules of R8.
  it("a tab rename whose update of one linking page fails stores neither the rename nor any update", async () => {
    const { third } = await setUp();
    const before = await everything();

    const renamed = await whileRevisionsOfAreRefused(third.id, () =>
      folderService.renameTab(actor, guides.id, { name: "docs" }),
    );

    expect(renamed.ok).toBe(false);
    expect(await everything()).toStrictEqual(before);
  });
});

describe("a tab rename by the rules of a page rename (R11, R10)", () => {
  // wiki-links-requirements.md, "Rename and move", R11 with R10: the user and channel of the rename, the version
  // counted up, so that a writer who holds the older version is refused as changed.
  it("through MCP gives a marked revision via mcp, and a save based on the older version is refused as changed", async () => {
    const bob = await createUser({ name: "bob" });
    await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
    const linking = await createPage({
      folder,
      editor: bob,
      name: "linking",
      content: "# Linking\n\n[[guides/setup]]",
    });

    const renamed = await folderService.renameTab(mcpActorOf(user, folder, "manager"), guides.id, { name: "docs" });

    expect(renamed.ok).toBe(true);
    expect(await storedPage(linking.id)).toMatchObject({
      content: "# Linking\n\n[[docs/setup]]",
      version: linking.version + 1,
      lastEditedById: user.id,
      lastEditedVia: "mcp",
    });
    expect((await revisionsOf(linking.id)).at(-1)).toMatchObject({ userId: user.id, via: "mcp", linksUpdated: true });
    const stale = await pageService.updatePageContent(actor, linking.id, {
      content: "# Linking\n\nMine.",
      version: linking.version,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "page-changed" } });
  });
});

describe("a deleted page after a restore (R29, R20)", () => {
  // wiki-links-requirements.md, "Rename and move", R29 ("and shows it as missing after it is restored").
  it("still holds the old link after the rename, and the link is missing once it is restored", async () => {
    const setup = await createPage({ tab: guides, name: "setup", content: "# Setup guide" });
    const gone = await createPage({ folder, name: "gone", content: "# Gone\n\n[[guides/setup]]" });
    await pageService.deletePage(actor, gone.id, { version: gone.version });

    await move(setup.id, "install", guides.id);
    const restored = await pageService.restorePage(actor, gone.id, { name: "gone", tabId: null });

    expect(restored.ok).toBe(true);
    expect((await storedPage(gone.id)).content).toBe("# Gone\n\n[[guides/setup]]");
    expect(await resolvedTitles("[[guides/setup]]")).toEqual([]);
    expect((await listLinkingPages(actor, setup.id))?.map((page) => page.id)).toEqual([]);
  });
});
