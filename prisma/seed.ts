// Inserts the known users and a sample folder with sample pages, owned by the known user, into the database configured
// by DATABASE_URL. Run it with `npm run db:seed`; the Prisma CLI loads `.env` before starting this script. The folder,
// its pages and the role of the known user are upserted by fixed keys, so running it again changes nothing. The known users are upserted by their names: running it
// again gives them their known passwords back and leaves their types as they are, because a type never changes.
import { titleFromContent } from "../src/features/pages/derive";
import { searchIndexData } from "../src/features/search/index-data";
import type { ChangeChannel } from "../src/generated/prisma/client";
import { CREDENTIAL_PROVIDER_ID, newUserData } from "../src/features/users/records";
import { getDb } from "../src/lib/db";
import { logger } from "../src/lib/logger";
import { hashPassword } from "../src/lib/password-hash";
import { KNOWN_USER, KNOWN_USERS } from "./known-users";

/** The sample folder that holds the sample pages. */
const folder = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6cf001", name: "getting-started" };

const pages = [
  {
    id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c0001",
    name: "welcome-to-hippowiki",
    content: `# Welcome to HippoWiki

HippoWiki is a small wiki whose pages are written in **Markdown** and stored in PostgreSQL.

## Getting started

1. Open a folder from the list of folders.
2. Pick a page to read it.
3. Create your own folder and add a page with a title and some Markdown.

## Good to know

- Pages are plain Markdown, so they stay readable as text.
- Formatting follows [GitHub Flavored Markdown](https://github.github.com/gfm/).
- The [Markdown Guide](https://www.markdownguide.org/basic-syntax/) explains the basic syntax.
`,
  },
  {
    id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c0002",
    name: "markdown-cheat-sheet",
    content: `# Markdown cheat sheet

A quick reference for the formatting you can use on a page.

## Text

Write *italic*, **bold**, ~~strikethrough~~ and \`inline code\`. Links look like
[this](https://commonmark.org/help/).

## Lists

- Unordered item
- Another item
  - Nested item

1. First step
2. Second step

- [x] Done task
- [ ] Open task

## Code

\`\`\`ts
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Tables

| Syntax      | Result         |
| ----------- | -------------- |
| \`# Title\`   | Heading        |
| \`**bold**\`  | **bold**       |
| \`[a](url)\`  | Link           |

> Quotes start with a \`>\`.
`,
  },
];

async function main() {
  const db = getDb();
  try {
    for (const { id, name, type, password } of KNOWN_USERS) {
      const passwordHash = await hashPassword(password);
      // By name, not by id: an admin that `npm run admin:setup` created has another id and keeps it.
      await db.user.upsert({
        where: { username: name },
        create: newUserData({ id, name, type, passwordHash, mustChangePassword: false }),
        update: {
          mustChangePassword: false,
          accounts: { updateMany: { where: { providerId: CREDENTIAL_PROVIDER_ID }, data: { password: passwordHash } } },
        },
      });
    }
    logger.info({ users: KNOWN_USERS.map(({ name }) => name) }, "seeded known users");

    // The known users come first: the known user is the last editor of the sample folder and pages, because admins
    // do not edit content. It is looked up by name, like the upsert above.
    const user = await db.user.findUniqueOrThrow({ where: { username: KNOWN_USER.name }, select: { id: true } });
    const lastEditedById = user.id;
    // Seeded content counts as changed in the browser.
    const lastEditedVia: ChangeChannel = "web";
    await db.folder.upsert({
      where: { id: folder.id },
      create: { ...folder, lastEditedById, lastEditedVia },
      update: { name: folder.name, lastEditedById, lastEditedVia },
    });
    // The known user owns the sample folder, as every user owns every folder after the update of an existing
    // installation. Admins get no role.
    await db.folderRole.upsert({
      where: { folderId_userId: { folderId: folder.id, userId: user.id } },
      create: { folderId: folder.id, userId: user.id, role: "owner" },
      update: { role: "owner" },
    });
    for (const { id, name, content } of pages) {
      // Like the page form, the title comes from the content's first heading.
      const title = titleFromContent(content);
      if (title === null) throw new Error(`Sample page ${name} has no title heading`);
      // Placed directly in the sample folder, with what search reads of the content, like a save.
      const data = {
        title,
        name,
        content,
        ...(await searchIndexData(content)),
        folderId: folder.id,
        lastEditedById,
        lastEditedVia,
      };
      const revision = { title, content, userId: lastEditedById, via: lastEditedVia };
      // Like every content change, the sample content is recorded as a revision: revision 1 of a new page, and the
      // next one of a page whose content was changed since it was seeded.
      await db.page.upsert({
        where: { id },
        create: { id, ...data, revisions: { create: { number: 1, ...revision } } },
        update: data,
      });
      const newest = await db.pageRevision.findFirst({
        where: { pageId: id },
        orderBy: { number: "desc" },
        select: { number: true, content: true },
      });
      if (newest && newest.content !== content) {
        await db.pageRevision.create({ data: { pageId: id, number: newest.number + 1, ...revision } });
      }
    }
    logger.info({ folder: folder.name, count: pages.length }, "seeded sample folder and pages");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "seeding failed");
  process.exitCode = 1;
});
