-- CreateTable
CREATE TABLE "FileLinkKey" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "secret" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileLinkKey_pkey" PRIMARY KEY ("id")
);

-- Hand-written: the table holds a single row, like "AuthSecret".
ALTER TABLE "FileLinkKey" ADD CONSTRAINT "FileLinkKey_single_row" CHECK ("id" = 1);
