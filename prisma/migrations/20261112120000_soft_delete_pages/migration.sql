-- Soft delete of pages: a deleted page keeps its row and its folder, gets the time of deletion and loses its tab.
-- Deleted pages never block a name, so the partial unique index on the names of pages placed directly in a folder
-- covers only pages that are not deleted.

-- DropIndex
DROP INDEX "Page_folderId_name_key";

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "deletedAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "Page_folderId_name_key" ON "Page"("folderId", "name") WHERE ("tabId" IS NULL AND "deletedAt" IS NULL);
