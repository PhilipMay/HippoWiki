-- CreateTable
CREATE TABLE "LoginWindow" (
    "username" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoginWindow_pkey" PRIMARY KEY ("username")
);
