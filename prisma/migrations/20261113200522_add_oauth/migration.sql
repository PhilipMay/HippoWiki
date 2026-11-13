-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "accessTokenExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "accessTokenHash" TEXT,
ADD COLUMN     "clientId" UUID,
ADD COLUMN     "refreshTokenHash" TEXT,
ALTER COLUMN "tokenHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "metadataUrl" TEXT,
    "fetchedAt" TIMESTAMPTZ(3),
    "freshUntil" TIMESTAMPTZ(3),
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthCode" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codeHash" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "scopes" TEXT[],
    "lifetime" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClient_metadataUrl_key" ON "OAuthClient"("metadataUrl");

-- CreateIndex
CREATE INDEX "OAuthClient_createdAt_idx" ON "OAuthClient"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthCode_codeHash_key" ON "OAuthCode"("codeHash");

-- CreateIndex
CREATE INDEX "OAuthCode_clientId_idx" ON "OAuthCode"("clientId");

-- CreateIndex
CREATE INDEX "OAuthCode_userId_idx" ON "OAuthCode"("userId");

-- CreateIndex
CREATE INDEX "OAuthCode_expiresAt_idx" ON "OAuthCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_accessTokenHash_key" ON "ApiToken"("accessTokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_clientId_idx" ON "ApiToken"("clientId");

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A row is a token created on the account page, with the hash of the token, or a grant to an OAuth client, never
-- both and never neither. Prisma cannot express a check constraint, so it is added by hand.
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_token_or_grant" CHECK (("tokenHash" IS NULL) <> ("clientId" IS NULL));
