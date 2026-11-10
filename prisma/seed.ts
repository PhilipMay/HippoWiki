// Inserts sample pages into the database configured by DATABASE_URL. Run it with `npm run db:seed`; the Prisma CLI
// loads `.env` before starting this script. Pages are upserted by fixed ids, so running it again changes nothing.
import { getDb } from "../src/lib/db";
import { logger } from "../src/lib/logger";

const pages = [
  {
    id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c0001",
    title: "Welcome to HippoWiki",
    content: `# Welcome to HippoWiki

HippoWiki is a small wiki whose pages are written in **Markdown** and stored in PostgreSQL.

## Getting started

1. Open the list of pages.
2. Pick a page to read it.
3. Create your own page with a title and some Markdown.

## Good to know

- Pages are plain Markdown, so they stay readable as text.
- Formatting follows [GitHub Flavored Markdown](https://github.github.com/gfm/).
- The [Markdown Guide](https://www.markdownguide.org/basic-syntax/) explains the basic syntax.
`,
  },
  {
    id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c0002",
    title: "Markdown cheat sheet",
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
    for (const page of pages) {
      await db.page.upsert({
        where: { id: page.id },
        create: page,
        update: { title: page.title, content: page.content },
      });
    }
    logger.info({ count: pages.length }, "seeded sample pages");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "seeding failed");
  process.exitCode = 1;
});
