-- The version of every page, counted up by every write of the page. Existing pages get 1, like a new page.

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
