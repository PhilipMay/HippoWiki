-- Records the user who last edited each folder, tab and page. Written by hand, because Prisma cannot fill a new
-- required column: the columns are added as nullable, every existing row gets the admin (the user named `admin`) as
-- its last editor, and only then are the columns made required.
--
-- If content exists but no admin does, the update leaves the columns empty, `SET NOT NULL` fails and the whole
-- migration is rolled back. On an empty database, as in the tests and on the first start of the container image, the
-- update changes nothing.

-- AlterTable
ALTER TABLE "Folder" ADD COLUMN     "lastEditedById" UUID;

-- AlterTable
ALTER TABLE "Tab" ADD COLUMN     "lastEditedById" UUID;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "lastEditedById" UUID;

-- The admin as last editor of the content stored before.
UPDATE "Folder" SET "lastEditedById" = (SELECT "id" FROM "User" WHERE "username" = 'admin');
UPDATE "Tab" SET "lastEditedById" = (SELECT "id" FROM "User" WHERE "username" = 'admin');
UPDATE "Page" SET "lastEditedById" = (SELECT "id" FROM "User" WHERE "username" = 'admin');

-- AlterTable
ALTER TABLE "Folder" ALTER COLUMN "lastEditedById" SET NOT NULL;

-- AlterTable
ALTER TABLE "Tab" ALTER COLUMN "lastEditedById" SET NOT NULL;

-- AlterTable
ALTER TABLE "Page" ALTER COLUMN "lastEditedById" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tab" ADD CONSTRAINT "Tab_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
