-- Adds tabs to folders. A page lives directly in its folder (no tab) or in one of the tabs of its folder; page names
-- are unique within a tab and, with a partial index, among the pages placed directly in a folder.

-- DropIndex
DROP INDEX "Page_folderId_name_key";

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "tabId" UUID;

-- CreateTable
CREATE TABLE "Tab" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "folderId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tab_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tab_folderId_name_key" ON "Tab"("folderId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tab_id_folderId_key" ON "Tab"("id", "folderId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_tabId_name_key" ON "Page"("tabId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Page_folderId_name_key" ON "Page"("folderId", "name") WHERE ("tabId" IS NULL);

-- AddForeignKey
ALTER TABLE "Tab" ADD CONSTRAINT "Tab_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_tabId_folderId_fkey" FOREIGN KEY ("tabId", "folderId") REFERENCES "Tab"("id", "folderId") ON DELETE RESTRICT ON UPDATE CASCADE;

