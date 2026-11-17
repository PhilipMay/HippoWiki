-- Hand-written. The revisions of the content of pages, and one first revision for every page stored before.

-- CreateTable
CREATE TABLE "PageRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pageId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "via" "ChangeChannel" NOT NULL,
    "revertedTo" INTEGER,

    CONSTRAINT "PageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageRevision_pageId_number_key" ON "PageRevision"("pageId", "number");

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every page stored before, deleted pages included, starts its history with one revision of its current content and
-- title, made by its last editor through its channel. The time of the last content change was not stored, so
-- `updatedAt`, the time of the last write of any kind, stands for it: it is the time the "Last updated" line shows,
-- and a later move, rename, delete or restore cannot be told apart from a content change any more. For a deleted page
-- the last editor and the channel are those of the delete, for the same reason.
INSERT INTO "PageRevision" ("pageId", "number", "title", "content", "createdAt", "userId", "via", "revertedTo")
SELECT "id", 1, "title", "content", "updatedAt", "lastEditedById", "lastEditedVia", NULL
FROM "Page";
