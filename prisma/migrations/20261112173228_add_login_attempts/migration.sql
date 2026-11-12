-- CreateTable
CREATE TABLE "LoginAttempt" (
    "username" TEXT NOT NULL,
    "failures" INTEGER NOT NULL,
    "lastFailedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("username")
);
