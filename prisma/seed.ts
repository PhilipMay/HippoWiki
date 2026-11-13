// Inserts the known users and a sample folder with sample pages into the database configured by DATABASE_URL. Run it
// with `npm run db:seed`; the Prisma CLI loads `.env` before starting this script. The folder and its pages are
// upserted by fixed ids, so running it again changes nothing. The known users are upserted by their names: running it
// again gives them their known passwords back.
import { titleFromContent } from "../src/features/pages/derive";
import { CREDENTIAL_PROVIDER_ID, newUserData } from "../src/features/users/records";
import { ADMIN_NAME } from "../src/features/users/schema";
import { getDb } from "../src/lib/db";
import { logger } from "../src/lib/logger";
import { hashPassword } from "../src/lib/password-hash";
import { KNOWN_USERS } from "./known-users";

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
    for (const { id, name, password } of KNOWN_USERS) {
      const passwordHash = await hashPassword(password);
      // By name, not by id: an admin that `npm run admin:setup` created has another id and keeps it.
      await db.user.upsert({
        where: { username: name },
        create: newUserData({ id, name, passwordHash, mustChangePassword: false }),
        update: {
          mustChangePassword: false,
          accounts: { updateMany: { where: { providerId: CREDENTIAL_PROVIDER_ID }, data: { password: passwordHash } } },
        },
      });
    }
    logger.info({ users: KNOWN_USERS.map(({ name }) => name) }, "seeded known users");

    // The known users come first: the admin is the last editor of the sample folder and pages. It is looked up by
    // name, because one that `npm run admin:setup` created has another id.
    const admin = await db.user.findUniqueOrThrow({ where: { username: ADMIN_NAME }, select: { id: true } });
    const lastEditedById = admin.id;
    await db.folder.upsert({
      where: { id: folder.id },
      create: { ...folder, lastEditedById },
      update: { name: folder.name, lastEditedById },
    });
    for (const { id, name, content } of pages) {
      // Like the page form, the title comes from the content's first heading.
      const title = titleFromContent(content);
      if (title === null) throw new Error(`Sample page ${name} has no title heading`);
      // Placed directly in the sample folder.
      const data = { title, name, content, folderId: folder.id, lastEditedById };
      await db.page.upsert({ where: { id }, create: { id, ...data }, update: data });
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
