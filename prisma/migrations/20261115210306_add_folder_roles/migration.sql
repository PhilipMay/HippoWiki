-- Gives every user a role per folder: Reader, Writer, Manager or Owner. Written by hand, because Prisma cannot fill
-- a new table from existing rows and cannot express a trigger:
--
-- 1. Every existing account of the type `user` becomes Owner of every existing folder, so that nobody loses access
--    on the day of the update; admins get no role. On an empty database, as in the tests and on the first start of
--    the container image, this inserts nothing.
-- 2. A trigger refuses every insert and every update of a role whose user is an admin, so that no code, command or
--    crafted request can give an admin a role. The type of an account never changes (the trigger of
--    `20261115120000_add_user_types`), so the check at insert and update is enough.

-- CreateEnum
CREATE TYPE "FolderRoleType" AS ENUM ('reader', 'writer', 'manager', 'owner');

-- CreateTable
CREATE TABLE "FolderRole" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "folderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "FolderRoleType" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FolderRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FolderRole_userId_idx" ON "FolderRole"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FolderRole_folderId_userId_key" ON "FolderRole"("folderId", "userId");

-- AddForeignKey
ALTER TABLE "FolderRole" ADD CONSTRAINT "FolderRole_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderRole" ADD CONSTRAINT "FolderRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every user is Owner of every existing folder; admins get nothing.
INSERT INTO "FolderRole" ("folderId", "userId", "role", "updatedAt")
SELECT "Folder"."id", "User"."id", 'owner', CURRENT_TIMESTAMP
FROM "Folder" CROSS JOIN "User"
WHERE "User"."type" = 'user';

-- An admin never has a role on a folder.
CREATE FUNCTION "FolderRole_no_admin"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."userId" AND "type" = 'admin') THEN
    RAISE EXCEPTION 'an admin cannot have a role on a folder' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FolderRole_no_admin"
BEFORE INSERT OR UPDATE ON "FolderRole"
FOR EACH ROW EXECUTE FUNCTION "FolderRole_no_admin"();
