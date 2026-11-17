-- Hand-written. How each folder, tab and page was last changed: in the browser (`web`) or through MCP (`mcp`).

-- CreateEnum
CREATE TYPE "ChangeChannel" AS ENUM ('web', 'mcp');

-- Every folder, tab and page stored before, deleted pages included, gets `web`, because the past cannot be told apart.
ALTER TABLE "Folder" ADD COLUMN "lastEditedVia" "ChangeChannel" NOT NULL DEFAULT 'web';
ALTER TABLE "Tab" ADD COLUMN "lastEditedVia" "ChangeChannel" NOT NULL DEFAULT 'web';
ALTER TABLE "Page" ADD COLUMN "lastEditedVia" "ChangeChannel" NOT NULL DEFAULT 'web';

-- No default from now on, so that no write can leave the channel out.
ALTER TABLE "Folder" ALTER COLUMN "lastEditedVia" DROP DEFAULT;
ALTER TABLE "Tab" ALTER COLUMN "lastEditedVia" DROP DEFAULT;
ALTER TABLE "Page" ALTER COLUMN "lastEditedVia" DROP DEFAULT;
