-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "linkIndexVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PageLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pageId" UUID NOT NULL,
    "folderId" UUID NOT NULL,
    "tabName" TEXT,
    "pageName" TEXT NOT NULL,

    CONSTRAINT "PageLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageLink_pageId_idx" ON "PageLink"("pageId");

-- CreateIndex
CREATE INDEX "PageLink_folderId_tabName_pageName_idx" ON "PageLink"("folderId", "tabName", "pageName");

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
