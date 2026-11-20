// The budget of the update of wiki links on a rename (`npm run test:integration:cost`): a page that 1,000 pages of the
// folder link to, each of about 2,000 characters with its link in the middle, is renamed through the pages service.
// The rows are written in bulk, with their links in the index, as the writes of the pages service store them.
import { beforeAll, describe, expect, it } from "vitest";

import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import * as pageService from "@/features/pages/service";
import { LINK_INDEX_VERSION } from "@/features/pages/wiki-links";
import { searchIndexData } from "@/features/search/index-data";
import type { Folder, User } from "@/generated/prisma/client";

import { createFolder, createPage, createUser, emptyTestDatabase, getTestDb } from "../e2e/support/database";
import { KNOWN_USER } from "../prisma/known-users";
import { owners } from "./helpers";

const LINKING_PAGES = 1_000;
/** How many pages are written in one statement. */
const BATCH = 100;

/**
 * The budget of the rename, from a measurement on the development machine (Mac16,7: between 2.5 s and 6.4 s in three
 * runs, the first the slowest) with a margin for the runner of CI, which is slower.
 */
const RENAME_BUDGET_MS = 20_000;

let user: User;
let actor: BrowserActor;
let folder: Folder;
let target: { id: string; version: number };

beforeAll(async () => {
  await emptyTestDatabase();
  user = await createUser({ id: KNOWN_USER.id, name: "alice" });
  actor = inBrowser(user);
  folder = await createFolder({ roles: owners(user) });
  const page = await createPage({ folder, name: "setup", content: "# Setup" });
  target = { id: page.id, version: page.version };

  const filler = "Some text of the page. ".repeat(40);
  for (let start = 0; start < LINKING_PAGES; start += BATCH) {
    const pages = await Promise.all(
      Array.from({ length: BATCH }, async (_, offset) => {
        const index = start + offset;
        const content = `# Linking page ${index}\n\n${filler}\n\nSee [[setup|the setup]].\n\n${filler}`;
        return {
          id: crypto.randomUUID(),
          name: `linking-${index}`,
          title: `Linking page ${index}`,
          content,
          folderId: folder.id,
          lastEditedById: user.id,
          lastEditedVia: "web" as const,
          linkIndexVersion: LINK_INDEX_VERSION,
          ...(await searchIndexData(content)),
        };
      }),
    );
    await getTestDb().page.createMany({ data: pages });
    await getTestDb().pageRevision.createMany({
      data: pages.map((page) => ({
        pageId: page.id,
        number: 1,
        title: page.title,
        content: page.content,
        userId: user.id,
        via: "web" as const,
      })),
    });
    await getTestDb().pageLink.createMany({
      data: pages.map((page) => ({ pageId: page.id, folderId: folder.id, tabName: null, pageName: "setup" })),
    });
  }
}, 120_000);

describe("the update of wiki links on a rename", () => {
  it(`renames a page that ${LINKING_PAGES} pages link to within ${RENAME_BUDGET_MS} ms`, async () => {
    const start = performance.now();
    const renamed = await pageService.moveOrRenamePage(actor, target.id, {
      name: "install",
      tabId: null,
      version: target.version,
    });
    const elapsed = performance.now() - start;

    expect(renamed.ok && renamed.value.updatedPages).toHaveLength(LINKING_PAGES);
    expect(await getTestDb().pageLink.count({ where: { pageName: "install" } })).toBe(LINKING_PAGES);
    expect(elapsed).toBeLessThan(RENAME_BUDGET_MS);
  });
});
