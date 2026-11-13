-- CreateTable
CREATE TABLE "OAuthRegistrationWindow" (
    "clientAddress" TEXT NOT NULL,
    "registrations" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OAuthRegistrationWindow_pkey" PRIMARY KEY ("clientAddress")
);

-- CreateIndex
CREATE INDEX "OAuthRegistrationWindow_startedAt_idx" ON "OAuthRegistrationWindow"("startedAt");

