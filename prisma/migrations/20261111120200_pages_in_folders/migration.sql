-- Places every page in a folder and turns the slug into the page name, which is unique within its folder.

-- AlterTable: nullable first, so that existing rows can be filled.
ALTER TABLE "Page" ADD COLUMN "folderId" UUID;

-- If any page exists, the folder `test-folder` takes the existing pages. A folder of that name that was created
-- before this migration is used as it is.
INSERT INTO "Folder" ("name", "updatedAt")
SELECT 'test-folder', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Page")
ON CONFLICT ("name") DO NOTHING;

UPDATE "Page"
SET "folderId" = (SELECT "id" FROM "Folder" WHERE "name" = 'test-folder');

ALTER TABLE "Page" ALTER COLUMN "folderId" SET NOT NULL;

-- Existing slugs are valid names, so they are kept.
ALTER TABLE "Page" RENAME COLUMN "slug" TO "name";

-- DropIndex
DROP INDEX "Page_slug_key";

-- CreateIndex
CREATE UNIQUE INDEX "Page_folderId_name_key" ON "Page"("folderId", "name");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
