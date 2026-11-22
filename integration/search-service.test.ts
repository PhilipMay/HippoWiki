// The search service against the test database: which pages a search of a folder finds, for whom, and in which order,
// with pages written through the pages service, so that the vectors and the words of the folder are those of a save.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { inBrowser, type BrowserActor, type ContentActor } from "@/features/folder-roles/actors";
import type { Role } from "@/features/folder-roles/roles";
import * as pageService from "@/features/pages/service";
import type { ExcerptPart } from "@/features/search/excerpt";
import { SEARCH_MAX_RESULTS, SEARCH_MAX_RUNNING, SEARCH_TIME_LIMIT_MS } from "@/features/search/limits";
import { searchPages, type SearchResults } from "@/features/search/service";
import type { Folder, User } from "@/generated/prisma/client";
import { samplePage } from "@/test/language-samples";

import {
  createFile,
  createFolder,
  createFolderRole,
  createPage,
  createTab,
  createUser,
  getTestDb,
} from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";
import { createBob, mcpActorOf, owners, storedPage } from "./helpers";

let user: User;
let actor: BrowserActor;
let folder: Folder;

beforeEach(async () => {
  user = await createUser({ id: KNOWN_USER.id, name: "alice" });
  actor = inBrowser(user);
  folder = await createFolder({ roles: owners(user) });
});

/** Creates a page through the pages service and returns its id; the name is derived from the title unless given. */
async function newPage(
  content: string,
  options: { name?: string; tabId?: string | null; folderId?: string } = {},
): Promise<string> {
  const { folderId = folder.id, ...input } = options;
  const result = await pageService.createPage(actor, folderId, { content, tabId: null, ...input });
  if (!result.ok) throw new Error(`page not created: ${result.error.code}`);
  return result.value.id;
}

/** The results of the search, or a failure of the test when the search found no folder or refused its words. */
async function search(
  input: string,
  searcher: ContentActor = actor,
  folderId: string = folder.id,
): Promise<SearchResults> {
  const result = await searchPages(searcher, folderId, input);
  if (result === null) throw new Error("no folder to search");
  if (!result.ok) throw new Error(`search refused: ${result.error.code}`);
  return result.value;
}

/** The titles of the results of the search, in their order. */
async function titles(input: string, searcher: ContentActor = actor, folderId: string = folder.id): Promise<string[]> {
  return (await search(input, searcher, folderId)).results.map(({ title }) => title);
}

/** Sets the time of the last change of the page, as if it had been changed then. */
async function changedAt(pageId: string, updatedAt: Date): Promise<void> {
  await getTestDb().page.update({ where: { id: pageId }, data: { updatedAt } });
}

describe("the folder and the deletion of the pages", () => {
  it("finds only the pages of the folder searched", async () => {
    const other = await createFolder({ roles: owners(user) });
    await newPage("# Backup here\n\nNightly.");
    await newPage("# Backup there\n\nNightly.", { folderId: other.id });

    expect(await titles("backup")).toEqual(["Backup here"]);
    expect(await titles("backup", actor, other.id)).toEqual(["Backup there"]);
  });

  it("never finds a deleted page, and finds a restored one", async () => {
    const id = await newPage("# Backup plan\n\nNightly dumps.");
    await newPage("# Restore plan\n\nNightly dumps.");
    const deleted = await pageService.deletePage(actor, id, { version: 1 });
    expect(deleted.ok).toBe(true);

    expect(await titles("nightly")).toEqual(["Restore plan"]);
    expect(await titles("backup")).toEqual([]);

    const restored = await pageService.restorePage(actor, id, { name: "backup-plan", tabId: null });
    expect(restored.ok).toBe(true);
    expect(await titles("backup")).toEqual(["Backup plan"]);
  });

  it("finds the pages placed directly in the folder and in every tab", async () => {
    const first = await createTab({ folder, name: "first" });
    const second = await createTab({ folder, name: "second" });
    await newPage("# Direct\n\nThe gateway.");
    await newPage("# In first\n\nThe gateway.", { tabId: first.id });
    await newPage("# In second\n\nThe gateway.", { tabId: second.id });

    const { results } = await search("gateway");
    expect(results.map(({ title, tab }) => [title, tab?.name ?? null]).sort()).toEqual([
      ["Direct", null],
      ["In first", "first"],
      ["In second", "second"],
    ]);
  });

  it("returns the fields of each result", async () => {
    const tab = await createTab({ folder, name: "ops" });
    const id = await newPage("# Backup plan\n\nNightly dumps.", { tabId: tab.id });
    const stored = await storedPage(id);

    expect(await search("backup")).toStrictEqual({
      results: [
        {
          id,
          name: "backup-plan",
          title: "Backup plan",
          tab: { name: "ops" },
          updatedAt: stored.updatedAt,
          lastEditedBy: { name: "alice", via: "web" },
          excerpt: [{ text: "Nightly dumps.", match: false }],
        },
      ],
      total: 1,
      more: false,
      files: [],
      moreFiles: false,
    });
  });
});

describe("who searches", () => {
  it.each<Role>(["reader", "writer", "manager", "owner"])("a %s of the folder searches it", async (role) => {
    await newPage("# Backup plan\n\nNightly.");
    const searcher = await createUser({ name: `searcher-${role}` });
    await createFolderRole({ folder, user: searcher, role });

    expect(await titles("backup", inBrowser(searcher))).toEqual(["Backup plan"]);
  });

  it("gives null to a user without a role and to an admin", async () => {
    await newPage("# Backup plan\n\nNightly.");
    const bob = await createBob();
    const admin = await createUser({ name: "root", type: "admin" });

    expect(await searchPages(inBrowser(bob), folder.id, "backup")).toBeNull();
    expect(await searchPages(inBrowser(admin), folder.id, "backup")).toBeNull();
  });

  it("gives null for a folder that does not exist and for a malformed id", async () => {
    expect(await searchPages(actor, crypto.randomUUID(), "backup")).toBeNull();
    expect(await searchPages(actor, "not-a-uuid", "backup")).toBeNull();
  });

  it.each(["reader", "writer", "manager"] as const)(
    "an actor of MCP with a %s connection searches the folder of its connection only",
    async (role) => {
      const other = await createFolder({ roles: owners(user) });
      await newPage("# Backup here\n\nNightly.");
      await newPage("# Backup there\n\nNightly.", { folderId: other.id });
      const mcp = mcpActorOf(user, folder, role);

      expect(await titles("backup", mcp)).toEqual(["Backup here"]);
      expect(await searchPages(mcp, other.id, "backup")).toBeNull();
    },
  );
});

describe("where a word occurs", () => {
  it("finds a page by a word only in its title, only in its name and only in its content", async () => {
    await newPage("# Firewall\n\nRules of the edge.", { name: "edge-rules" });
    await newPage("# Proxy\n\nThe front.", { name: "nginx-setup" });
    await newPage("# Mail\n\nThe postfix relay.", { name: "mail" });

    expect(await titles("firewall")).toEqual(["Firewall"]);
    expect(await titles("nginx")).toEqual(["Proxy"]);
    expect(await titles("postfix")).toEqual(["Mail"]);
  });

  it("finds a command only in a code block and a domain only in the address of a link", async () => {
    await newPage("# Restore\n\nRun this:\n\n```sh\npg_restore --clean dump.sql\n```\n");
    await newPage("# Status\n\nSee [the status page](https://status.example.org/now).\n");

    expect(await titles("pg_restore")).toEqual(["Restore"]);
    expect(await titles("status.example.org")).toEqual(["Status"]);
  });
});

describe("the order of the results", () => {
  it("lists the page whose title is exactly the words first", async () => {
    await newPage("# Backup plan overview\n\nThe backup plan.");
    await newPage("# Backup Plan\n\nNightly.");
    await newPage("# Notes\n\nThe backup plan, backup plan and backup plan again.");

    expect((await titles("  backup PLAN "))[0]).toBe("Backup Plan");
  });

  it("lists a match in the title before a match in the content", async () => {
    await newPage("# Notes\n\nThe gateway, the gateway and the gateway.");
    await newPage("# Gateway setup\n\nNothing more.");

    expect(await titles("gateway")).toEqual(["Gateway setup", "Notes"]);
  });

  it("lists a page found only by a typo after every page with the exact words", async () => {
    await newPage("# Notes\n\nThe konfiguration of the server.");
    await newPage("# Konfigurazion\n\nAbout the server.");
    await newPage("# Other\n\nThe konfiguration is here.");

    const found = await titles("konfiguration");
    expect(found).toHaveLength(3);
    expect(found[2]).toBe("Konfigurazion");
  });

  it("lists a page with one exact word and one typo among the typo matches", async () => {
    await newPage("# Alpha\n\nThe database konfiguration.");
    await newPage("# Beta\n\nThe database konfigurazion.");
    await newPage("# Gamma\n\nThe databse konfigurazion.");

    const { results } = await search("database konfiguration");
    expect(results.map(({ title }) => title)[0]).toBe("Alpha");
    expect(
      results
        .map(({ title }) => title)
        .slice(1)
        .sort(),
    ).toEqual(["Beta", "Gamma"]);
  });

  it("lists the page where the word occurs more often first", async () => {
    await newPage("# Once\n\nThe gateway and other words that fill this page.");
    await newPage("# Thrice\n\nThe gateway, a gateway and the gateway.");

    expect(await titles("gateway")).toEqual(["Thrice", "Once"]);
  });

  it("lists pages that match equally newest first", async () => {
    const older = await newPage("# First\n\nThe gateway.");
    const newer = await newPage("# Second\n\nThe gateway.");
    await changedAt(older, new Date("2026-01-01T00:00:00Z"));
    await changedAt(newer, new Date("2026-02-01T00:00:00Z"));
    expect(await titles("gateway")).toEqual(["Second", "First"]);

    await changedAt(older, new Date("2026-03-01T00:00:00Z"));
    expect(await titles("gateway")).toEqual(["First", "Second"]);
  });
});

describe("the syntax of the search words", () => {
  beforeEach(async () => {
    await newPage("# Both\n\nThe backup server runs nightly.");
    await newPage("# Apart\n\nThe server keeps a backup.");
    await newPage("# Backup only\n\nNightly dumps.");
    await newPage("# Restore only\n\nThe restore of dumps.");
  });

  it("finds only pages with every word", async () => {
    expect((await titles("backup server")).sort()).toEqual(["Apart", "Both"]);
  });

  it("finds only pages where the words of a phrase follow each other", async () => {
    expect(await titles('"backup server"')).toEqual(["Both"]);
  });

  it("leaves out the pages with an excluded word", async () => {
    expect(await titles("backup -server")).toEqual(["Backup only"]);
  });

  it("finds pages with either word of or", async () => {
    expect((await titles("backup or restore")).sort()).toEqual(["Apart", "Backup only", "Both", "Restore only"]);
  });

  it("reads quotes, - and or in odd places as plain words", async () => {
    expect((await titles('backup "server')).sort()).toEqual(["Apart", "Both"]);
    expect((await titles("backup - server")).sort()).toEqual(["Apart", "Both"]);
    expect(await titles("or restore")).toEqual([]);
    expect((await titles("-restore")).sort()).toEqual(["Restore only"]);
  });

  it("reads the operators of a text search query as plain text", async () => {
    for (const input of ["backup & !server", "backup:*", "'backup'", "backup | (server", "!!", "back\\up", "it's"]) {
      await expect(searchPages(actor, folder.id, input), input).resolves.toBeTruthy();
    }
    // The parser of the configuration splits a word as it splits the text, into a phrase, which only "Both" holds;
    // "backup" and "server" are close to it, as typos.
    expect((await titles("backup&server"))[0]).toBe("Both");
  });
});

describe("the start of a word, parts of words and typos", () => {
  it('finds "Konfiguration" by "konfig" and "kon", but not by "ko"', async () => {
    await newPage("# Konfiguration der Datenbank\n\nWie die Datenbank eingerichtet wird.");

    expect(await titles("konfig")).toEqual(["Konfiguration der Datenbank"]);
    expect(await titles("kon")).toEqual(["Konfiguration der Datenbank"]);
    expect(await titles("ko")).toEqual([]);
  });

  it('finds "Datenbank-Übersicht" in a title and "Datenbank" in a text by "bank"', async () => {
    await newPage("# Datenbank-Übersicht\n\nAlles auf einen Blick.");
    await newPage("# Notizen\n\nDie Datenbank läuft auf dem zweiten Server.");

    expect(await titles("bank")).toEqual(["Datenbank-Übersicht", "Notizen"]);
  });

  it('finds "Konfiguration" in a title and in a text by "Konfiguraton"', async () => {
    await newPage("# Konfiguration der Datenbank\n\nWie sie eingerichtet wird.");
    await newPage("# Notizen\n\nDie Konfiguration liegt im Ordner etc.");

    expect(await titles("Konfiguraton")).toEqual(["Konfiguration der Datenbank", "Notizen"]);
  });

  it("matches umlauts inside a word", async () => {
    await newPage("# Notizen\n\nDie Datenbankübersicht liegt im Wiki.");

    expect(await titles("übersicht")).toEqual(["Notizen"]);
    expect(await titles("ÜBERSICHT")).toEqual(["Notizen"]);
  });

  it('finds a German page with "Haus" and "Konfiguration" by "Häuser konfiguraton"', async () => {
    await newPage(
      "# Das Haus\n\nDie Konfiguration des Hauses wird hier beschrieben, mit allen Einstellungen der Heizung und des Lichts.",
    );

    expect(await titles("Häuser konfiguraton")).toEqual(["Das Haus"]);
  });

  it("matches a word of 1 or 2 letters only as a whole word", async () => {
    await newPage("# Ops\n\nThe kv store.");
    await newPage("# Kvm\n\nThe hypervisor.");

    expect(await titles("kv")).toEqual(["Ops"]);
  });
});

describe("languages", () => {
  it('finds a German page with "Haus" by "Häuser", and a French page with "maison" by "maisons"', async () => {
    await newPage(
      "# Unser Haus\n\nDas Haus steht am Ende der Straße. Im Garten wachsen Blumen, und im Winter heizen wir mit Holz aus dem Wald.",
    );
    await newPage(
      "# Notre maison\n\nLa maison se trouve au bout de la rue. Dans le jardin poussent des fleurs, et en hiver nous chauffons au bois.",
    );

    expect(await titles("Häuser")).toEqual(["Unser Haus"]);
    expect(await titles("maisons")).toEqual(["Notre maison"]);
  });

  it("finds a German and an English page in one search", async () => {
    await newPage(samplePage("german"));
    await newPage(samplePage("english"));

    const { results } = await search("server");
    const languages = await Promise.all(results.map(async ({ id }) => (await storedPage(id)).searchLanguage));
    expect(languages.sort()).toEqual(["english", "german"]);
  });

  it("finds a German page with many code blocks by German inflections", async () => {
    const code = "```sh\npg_dump --format=custom --file=/var/backups/db.dump hippowiki\n```\n\n".repeat(6);
    await newPage(
      `# Sicherung\n\nDie Sicherungen der Datenbank laufen jede Nacht.\n\n${code}Danach prüfen wir die Sicherungen und schreiben die Ergebnisse in das Protokoll der Woche.\n`,
    );
    const [found] = (await search("Sicherung")).results;
    expect(found?.title).toBe("Sicherung");
    expect((await storedPage(found?.id ?? "")).searchLanguage).toBe("german");

    expect(await titles("Ergebnis")).toEqual(["Sicherung"]);
  });

  it("finds an English word on a German page", async () => {
    await newPage(samplePage("german") + "\nDer Failover wird jeden Monat geprobt.\n");

    expect(await titles("failover")).toHaveLength(1);
  });

  it("finds a Polish and an Irish page and a page of one short line by a word and by its start", async () => {
    const ids = [
      await newPage(samplePage("polish")),
      await newPage(samplePage("irish")),
      await newPage("# Notizen\n\nTODO morgen"),
    ];
    for (const id of ids) expect((await storedPage(id)).searchLanguage).toBe("simple");

    expect(await titles("zapasowe")).toHaveLength(1);
    expect(await titles("zapas")).toHaveLength(1);
    expect(await titles("cúltaca")).toHaveLength(1);
    expect(await titles("cúlt")).toHaveLength(1);
    expect(await titles("morgen")).toEqual(["Notizen"]);
    expect(await titles("morg")).toEqual(["Notizen"]);
  });

  it("excludes an excluded word on pages of several languages", async () => {
    await newPage(samplePage("german") + "\nSiehe auch Grafana.\n");
    await newPage(samplePage("english") + "\nSee also Grafana.\n");
    await newPage(samplePage("french") + "\nVoir aussi Grafana.\n");

    expect(await titles("grafana")).toHaveLength(3);
    // The French page holds "serveur", not "server".
    expect(await titles("grafana -server")).toHaveLength(1);
  });
});

describe("the number of results", () => {
  /** Creates the given number of pages that hold the word, directly in the test database. */
  async function pagesWith(count: number): Promise<void> {
    for (let index = 0; index < count; index++) {
      await createPage({ folder, editor: user, name: `entry-${index}`, content: `# Entry ${index}\n\nThe gateway.` });
    }
  }

  it("returns the 100 best of 150 matching pages and says that more match", async () => {
    await pagesWith(150);

    const { results, total, more } = await search("gateway");
    expect(results).toHaveLength(SEARCH_MAX_RESULTS);
    expect(total).toBe(SEARCH_MAX_RESULTS);
    expect(more).toBe(true);
  });

  it("returns all of 30 matching pages and nothing more", async () => {
    await pagesWith(30);

    const { results, total, more } = await search("gateway");
    expect(results).toHaveLength(30);
    expect(total).toBe(30);
    expect(more).toBe(false);
  });

  it("returns a window of the best results", async () => {
    await pagesWith(30);
    const all = (await search("gateway")).results.map(({ id }) => id);

    const result = await searchPages(actor, folder.id, "gateway", { offset: 10, limit: 10 });
    expect(result?.ok && result.value.results.map(({ id }) => id)).toEqual(all.slice(10, 20));
    expect(result?.ok && result.value.total).toBe(30);
    const beyond = await searchPages(actor, folder.id, "gateway", { offset: 30, limit: 10 });
    expect(beyond?.ok && beyond.value.results).toEqual([]);
  });
});

describe("files", () => {
  /** The files that the search finds, each as its place and name, in their order. */
  async function fileNames(input: string, searcher: ContentActor = actor): Promise<string[]> {
    const { files } = await search(input, searcher);
    return files.map((file) => (file.tab ? `${file.tab.name}/${file.name}` : file.name));
  }

  it("finds guides/network-diagram.png by diagram, with its fields", async () => {
    const guides = await createTab({ folder, name: "guides" });
    const file = await createFile({ tab: guides, name: "network-diagram.png", editor: user });
    await newPage("# Network\n\nThe diagram of the network.");

    const found = await search("diagram");
    expect(found.files).toStrictEqual([
      {
        id: file.id,
        name: "network-diagram.png",
        type: "png",
        tab: { name: "guides" },
        size: file.versions[0]?.size,
        width: file.versions[0]?.width,
        height: file.versions[0]?.height,
        updatedAt: file.updatedAt,
        lastEditedBy: { name: "alice", via: "web" },
      },
    ]);
    expect(found.moreFiles).toBe(false);
    expect(found.results.map(({ title }) => title)).toEqual(["Network"]);
  });

  it("finds a file by the start of a part and by a part of a word, but not by a short part", async () => {
    await createFile({ folder, name: "network-diagram-v2.pdf", editor: user });

    expect(await fileNames("diag")).toEqual(["network-diagram-v2.pdf"]);
    expect(await fileNames("agra")).toEqual(["network-diagram-v2.pdf"]);
    expect(await fileNames("v2")).toEqual(["network-diagram-v2.pdf"]);
    expect(await fileNames("ag")).toEqual([]);
    expect(await fileNames("diagrams")).toEqual([]);
  });

  it("finds only files with every word, and leaves out those with an excluded word", async () => {
    await createFile({ folder, name: "network-diagram.png", editor: user });
    await createFile({ folder, name: "office-diagram.png", editor: user });

    expect(await fileNames("diagram network")).toEqual(["network-diagram.png"]);
    expect(await fileNames("diagram -network")).toEqual(["office-diagram.png"]);
    expect(await fileNames("network or office")).toEqual(["network-diagram.png", "office-diagram.png"]);
    expect(await fileNames('"diagram network"')).toEqual([]);
  });

  it("orders the whole name first, then the start of a part, then a part of a word, then by name and place", async () => {
    const guides = await createTab({ folder, name: "guides" });
    await createFile({ folder, name: "subdiagram.png", editor: user });
    await createFile({ folder, name: "network-diagram.png", editor: user });
    await createFile({ tab: guides, name: "diagram.png", editor: user });
    await createFile({ folder, name: "diagram.png", editor: user });
    await createFile({ folder, name: "a-diagram.png", editor: user });

    expect(await fileNames("diagram")).toEqual([
      "diagram.png",
      "guides/diagram.png",
      "a-diagram.png",
      "network-diagram.png",
      "subdiagram.png",
    ]);
  });

  it("never finds a deleted file or a file of another folder", async () => {
    const other = await createFolder({ roles: owners(user) });
    await createFile({ folder: other, name: "network-diagram.png", editor: user });
    await createFile({ folder, name: "old-diagram.png", editor: user, deletedAt: new Date() });

    expect(await fileNames("diagram")).toEqual([]);
  });

  it("finds nothing by a word that is only inside a PDF", async () => {
    await createFile({
      folder,
      name: "manual.pdf",
      editor: user,
      versions: [{ bytes: new TextEncoder().encode("%PDF-1.4\n(zanzibar) Tj\n%%EOF\n") }],
    });

    expect(await fileNames("zanzibar")).toEqual([]);
    expect(await fileNames("manual")).toEqual(["manual.pdf"]);
  });

  it("reads the operators of a regular expression as plain text", async () => {
    await createFile({ folder, name: "network-diagram.png", editor: user });

    expect(await fileNames(".* diagram")).toEqual(["network-diagram.png"]);
    for (const input of ["n.*", "(a|n)etwork", "[n]etwork", "\\w+"]) {
      expect(await fileNames(input), input).toEqual([]);
    }
  });

  it("returns the 100 best files, says that more match, and no files beyond the first window", async () => {
    for (let index = 0; index < 101; index++) {
      await createFile({ folder, name: `diagram-${index}.png`, editor: user, versions: [{ width: 1, height: 1 }] });
    }

    const found = await search("diagram");
    expect(found.files).toHaveLength(SEARCH_MAX_RESULTS);
    expect(found.moreFiles).toBe(true);
    const beyond = await searchPages(actor, folder.id, "diagram", { offset: 10, limit: 10 });
    expect(beyond?.ok && beyond.value.files).toEqual([]);
  });

  it("finds the files for a Reader and for an MCP connection", async () => {
    const bob = await createBob();
    await createFolderRole({ folder, user: bob, role: "reader" });
    await createFile({ folder, name: "network-diagram.png", editor: user });

    expect(await fileNames("diagram", inBrowser(bob))).toEqual(["network-diagram.png"]);
    expect(await fileNames("diagram", mcpActorOf(bob, folder, "reader"))).toEqual(["network-diagram.png"]);
  });
});

describe("a search after a write", () => {
  it("finds an added word and no longer a removed one", async () => {
    const id = await newPage("# Notes\n\nThe gateway.");
    expect(await titles("firewall")).toEqual([]);

    const added = await pageService.updatePageContent(actor, id, { content: "# Notes\n\nThe firewall.", version: 1 });
    expect(added.ok).toBe(true);
    expect(await titles("firewall")).toEqual(["Notes"]);
    expect(await titles("gateway")).toEqual([]);
  });

  it("finds a renamed page by its new name and not by its old one", async () => {
    const id = await newPage("# Notes\n\nText.", { name: "oldname" });
    const renamed = await pageService.moveOrRenamePage(actor, id, { name: "newname", tabId: null, version: 1 });
    expect(renamed.ok).toBe(true);

    expect(await titles("newname")).toEqual(["Notes"]);
    expect(await titles("oldname")).toEqual([]);
  });

  it("returns a moved page with its new tab", async () => {
    const tab = await createTab({ folder, name: "archive" });
    const id = await newPage("# Notes\n\nThe gateway.");
    const moved = await pageService.moveOrRenamePage(actor, id, { name: "notes", tabId: tab.id, version: 1 });
    expect(moved.ok).toBe(true);

    expect((await search("gateway")).results.map(({ tab }) => tab)).toEqual([{ name: "archive" }]);
  });
});

/** The marked words of the piece of text of a result. */
function marks(excerpt: ExcerptPart[]): string[] {
  return excerpt.filter(({ match }) => match).map(({ text }) => text);
}

/** The piece of text of a result as plain text. */
function plain(excerpt: ExcerptPart[]): string {
  return excerpt.map(({ text }) => text).join("");
}

describe("the piece of text of a result", () => {
  it('shows the text around "Konfiguration" for "Konfiguraton", marked', async () => {
    await newPage("# Notizen\n\nAm Anfang steht etwas anderes. Die Konfiguration liegt im Ordner etc.");

    const [result] = (await search("Konfiguraton")).results;
    expect(marks(result?.excerpt ?? [])).toEqual(["Konfiguration"]);
    expect(plain(result?.excerpt ?? [])).toContain("Die Konfiguration liegt im Ordner");
  });

  it('shows the text around "Datenbank" for "bank", marked', async () => {
    await newPage("# Notizen\n\nDie Datenbank läuft auf dem zweiten Server.");

    const [result] = (await search("bank")).results;
    expect(marks(result?.excerpt ?? [])).toEqual(["Datenbank"]);
  });

  it("shows the start of the text without a mark for a page found only by its title", async () => {
    await newPage("# Firewall\n\nThe rules of the edge are kept here, one per line, with the reason for each rule.");

    const [result] = (await search("firewall")).results;
    expect(result?.excerpt).toEqual([
      { text: expect.stringMatching(/^The rules of the edge/) as string, match: false },
    ]);
  });

  it("shows the text around an exact match", async () => {
    const filler = "Other words fill the page here. ".repeat(20);
    await newPage(`# Notes\n\n${filler}The gateway is restarted every night. ${filler}`);

    const [result] = (await search("gateway")).results;
    expect(marks(result?.excerpt ?? [])).toEqual(["gateway"]);
    expect(plain(result?.excerpt ?? [])).toContain("The gateway is restarted");
    expect(plain(result?.excerpt ?? []).length).toBeLessThan(filler.length);
  });

  it("marks the words that matched, also an inflection", async () => {
    await newPage(
      "# Unser Garten\n\nDie Häuser stehen am Ende der Straße. Im Garten wachsen Blumen, und im Winter heizen wir mit Holz.",
    );

    const [result] = (await search("Haus")).results;
    expect(marks(result?.excerpt ?? [])).toEqual(["Häuser"]);
  });

  it("keeps text that looks like HTML as plain text", async () => {
    await newPage("# Notes\n\nThe <script>alert(1)</script> of the <b>gateway</b> is never run on the page.");

    const [result] = (await search("gateway")).results;
    expect(plain(result?.excerpt ?? [])).toContain("The <script>alert(1)</script> of the <b>gateway</b> is never run");
    expect(marks(result?.excerpt ?? [])).toEqual(["gateway"]);
  });
});

describe("the limits of a search", () => {
  /** Holds the table of the words of the folders in a transaction of the test until the returned function is called. */
  async function holdWords(): Promise<{ release: () => Promise<void> }> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const transaction = getTestDb().$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "SearchWord" IN ACCESS EXCLUSIVE MODE`;
        locked();
        await held;
      },
      { timeout: 30_000 },
    );
    await isLocked;
    return {
      release: async () => {
        release();
        await transaction;
      },
    };
  }

  /** Waits until the given number of statements wait for the lock on the table of the words. */
  async function waitingSearches(count: number): Promise<void> {
    await vi.waitFor(
      async () => {
        const [row] = await getTestDb().$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::integer AS waiting FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%SearchWord%'`;
        expect(row?.waiting).toBe(count);
      },
      { timeout: 4_000, interval: 50 },
    );
  }

  it(
    "answers a search that takes longer than the time limit as too broad, and runs the next one",
    async () => {
      await newPage("# Notes\n\nThe gateway.");
      const { release } = await holdWords();
      const started = performance.now();
      try {
        expect(await searchPages(actor, folder.id, "gateway")).toEqual({ ok: false, error: { code: "too-broad" } });
        const elapsed = performance.now() - started;
        expect(elapsed).toBeGreaterThanOrEqual(SEARCH_TIME_LIMIT_MS - 100);
        expect(elapsed).toBeLessThan(SEARCH_TIME_LIMIT_MS + 2_000);
      } finally {
        await release();
      }
      expect(await titles("gateway")).toEqual(["Notes"]);
    },
    SEARCH_TIME_LIMIT_MS + 15_000,
  );

  it(
    "answers a search beyond the running ones as busy at once, while the other reads answer",
    async () => {
      await newPage("# Notes\n\nThe gateway.");
      const { release } = await holdWords();
      let running: Promise<unknown>[] = [];
      try {
        running = Array.from({ length: SEARCH_MAX_RUNNING }, () => searchPages(actor, folder.id, "gateway"));
        await waitingSearches(SEARCH_MAX_RUNNING);

        const started = performance.now();
        expect(await searchPages(actor, folder.id, "gateway")).toEqual({ ok: false, error: { code: "busy" } });
        expect(performance.now() - started).toBeLessThan(500);
        expect((await pageService.listFolderPages(actor, folder.id))?.map(({ title }) => title)).toEqual(["Notes"]);
        // Words that are no search are answered as such, without a slot.
        expect(await searchPages(actor, folder.id, "x".repeat(201))).toEqual({
          ok: false,
          error: { code: "too-long" },
        });
      } finally {
        await release();
      }
      for (const result of await Promise.all(running)) {
        expect(result).toMatchObject({ ok: true, value: { total: 1 } });
      }
      expect(await titles("gateway")).toEqual(["Notes"]);
    },
    SEARCH_TIME_LIMIT_MS + 15_000,
  );

  it("runs nothing for 201 characters and 11 words", async () => {
    await newPage("# Notes\n\nThe gateway.");
    const { release } = await holdWords();
    try {
      // The table of the words is held, so a search that ran would wait for it.
      const started = performance.now();
      expect(await searchPages(actor, folder.id, "gateway ".repeat(25) + "g")).toEqual({
        ok: false,
        error: { code: "too-long" },
      });
      expect(
        await searchPages(actor, folder.id, Array.from({ length: 11 }, (_, index) => `gateway${index}`).join(" ")),
      ).toEqual({ ok: false, error: { code: "too-long" } });
      expect(performance.now() - started).toBeLessThan(500);
    } finally {
      await release();
    }
  });
});
