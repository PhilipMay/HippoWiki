-- Gives every account a type: an admin manages the accounts, a user works with the content. Written by hand, because
-- Prisma cannot fill a new required column and cannot express a trigger:
--
-- 1. The column is added as nullable, the account named `admin` becomes an admin and every other account a user, and
--    only then is the column made required. On an empty database, as in the tests and on the first start of the
--    container image, the updates change nothing.
-- 2. The API tokens, the grants to OAuth clients and the authorization codes of the account named `admin` are deleted,
--    because admins have none.
-- 3. A trigger refuses every update that changes the type of an account, so that no code and no command can change it
--    after the account was created. Updates that leave the type as it is, such as those of Better Auth, pass.

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('admin', 'user');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "type" "UserType";

-- The account named `admin` is the admin of an existing installation; every other account is a user.
UPDATE "User" SET "type" = 'admin' WHERE "username" = 'admin';
UPDATE "User" SET "type" = 'user' WHERE "username" <> 'admin';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "type" SET NOT NULL;

-- Admins have no tokens, grants and codes.
DELETE FROM "ApiToken" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "type" = 'admin');
DELETE FROM "OAuthCode" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "type" = 'admin');

-- The type of an account never changes.
CREATE FUNCTION "User_keep_type"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."type" IS DISTINCT FROM OLD."type" THEN
    RAISE EXCEPTION 'the type of an account cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_keep_type"
BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION "User_keep_type"();
