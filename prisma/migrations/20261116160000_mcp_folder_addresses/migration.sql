-- Grants and codes name the MCP address of a folder, `/mcp/<folder-uuid>/<role>`, instead of a scope. Written by hand
-- (see "Database" in `spec/architecture.md`): the SQL of the schema change comes from `prisma migrate diff`, the rest is
-- added by hand.

-- Every grant and every code of before names the plain `/mcp`, which no longer serves MCP, and none of them names a
-- folder: they are removed, and their users connect again to the address of a folder.
DELETE FROM "OAuthCode";
DELETE FROM "OAuthGrant";

-- AlterTable
ALTER TABLE "OAuthCode" DROP COLUMN "scopes",
ADD COLUMN     "folderId" UUID NOT NULL,
ADD COLUMN     "role" "FolderRoleType" NOT NULL;

-- AlterTable
ALTER TABLE "OAuthGrant" DROP COLUMN "scopes",
ADD COLUMN     "folderId" UUID NOT NULL,
ADD COLUMN     "role" "FolderRoleType" NOT NULL;

-- CreateIndex
CREATE INDEX "OAuthCode_folderId_idx" ON "OAuthCode"("folderId");

-- CreateIndex
CREATE INDEX "OAuthGrant_folderId_idx" ON "OAuthGrant"("folderId");

-- AddForeignKey
ALTER TABLE "OAuthGrant" ADD CONSTRAINT "OAuthGrant_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written parts. Prisma cannot express check constraints, so they are added here by hand.

-- The role of an MCP address is Reader or Writer; Manager and Owner are never roles of MCP.
ALTER TABLE "OAuthGrant" ADD CONSTRAINT "OAuthGrant_mcp_role" CHECK ("role" IN ('reader', 'writer'));
ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_mcp_role" CHECK ("role" IN ('reader', 'writer'));
