-- Removes the API tokens: an AI assistant reaches the MCP server only through OAuth, as a connected app that its
-- user approved. What is left of the table are the grants of users to OAuth clients, renamed to `OAuthGrant`.
--
-- 1. Every row without a client is an API token, created on the account page. Such tokens no longer work, so they
--    are deleted, in one clean cut, rather than left to expire. The deletion is not logged: the README tells the
--    operator about it.
-- 2. With them go the check constraint that told a token from a grant, and the hash of the token with its index.
-- 3. Every row left has a client, which is now required.
-- 4. The table, its primary key, indexes and foreign keys are renamed to the names that Prisma gives the model
--    `OAuthGrant`, so that the grants keep their ids, hashes and dates and keep working.

-- Deletes the API tokens.
DELETE FROM "ApiToken" WHERE "clientId" IS NULL;

-- Drops what only API tokens needed.
ALTER TABLE "ApiToken" DROP CONSTRAINT "ApiToken_token_or_grant";
DROP INDEX "ApiToken_tokenHash_key";
ALTER TABLE "ApiToken" DROP COLUMN "tokenHash";

-- Every grant has a client.
ALTER TABLE "ApiToken" ALTER COLUMN "clientId" SET NOT NULL;

-- Renames the table and everything that carries its name: the indexes, and every constraint, which are the primary
-- key (with its index), the foreign keys and, from PostgreSQL 18 on, the named not-null constraints.
ALTER TABLE "ApiToken" RENAME TO "OAuthGrant";
ALTER INDEX "ApiToken_accessTokenHash_key" RENAME TO "OAuthGrant_accessTokenHash_key";
ALTER INDEX "ApiToken_userId_idx" RENAME TO "OAuthGrant_userId_idx";
ALTER INDEX "ApiToken_clientId_idx" RENAME TO "OAuthGrant_clientId_idx";
DO $$
DECLARE
  old_name text;
BEGIN
  FOR old_name IN
    SELECT conname FROM pg_constraint WHERE conrelid = '"OAuthGrant"'::regclass AND conname LIKE 'ApiToken\_%'
  LOOP
    EXECUTE format('ALTER TABLE "OAuthGrant" RENAME CONSTRAINT %I TO %I', old_name,
      'OAuthGrant' || substr(old_name, length('ApiToken') + 1));
  END LOOP;
END
$$;
