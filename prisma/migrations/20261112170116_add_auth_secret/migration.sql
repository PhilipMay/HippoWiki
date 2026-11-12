-- CreateTable
CREATE TABLE "AuthSecret" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "secret" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSecret_pkey" PRIMARY KEY ("id")
);

-- The table holds a single row. Prisma cannot express a check constraint, so it is added by hand.
ALTER TABLE "AuthSecret" ADD CONSTRAINT "AuthSecret_single_row" CHECK ("id" = 1);
