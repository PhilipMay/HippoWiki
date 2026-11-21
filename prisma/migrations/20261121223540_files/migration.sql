-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('png', 'jpeg', 'gif', 'webp', 'pdf');

-- CreateTable
CREATE TABLE "File" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" "FileType" NOT NULL,
    "folderId" UUID NOT NULL,
    "tabId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "lastEditedById" UUID NOT NULL,
    "lastEditedVia" "ChangeChannel" NOT NULL,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fileId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "via" "ChangeChannel" NOT NULL,
    "revertedTo" INTEGER,

    CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "File_folderId_idx" ON "File"("folderId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "File_tabId_name_key" ON "File"("tabId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "File_folderId_name_key" ON "File"("folderId", "name") WHERE ("tabId" IS NULL AND "deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "FileVersion_sha256_idx" ON "FileVersion"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_fileId_number_key" ON "FileVersion"("fileId", "number");

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_tabId_folderId_fkey" FOREIGN KEY ("tabId", "folderId") REFERENCES "Tab"("id", "folderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Written by hand: what Prisma cannot express in the schema.

-- The SHA-256 of a version names its blob in the files directory (`blobPath()` of `src/features/files/store.ts`), so
-- it is only ever 64 lowercase hex digits and no path can leave the directory.
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- Sizes, numbers and the measures of an image are never negative or zero where they count.
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_number_check" CHECK ("number" >= 1);
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_size_check" CHECK ("size" >= 0);
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_dimensions_check"
  CHECK (("width" IS NULL AND "height" IS NULL) OR ("width" >= 1 AND "height" >= 1));
