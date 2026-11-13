-- The failed logins are counted per user name and client address group. The existing rows were counted for the name
-- alone, which is the group `shared`; the column keeps no default afterwards, so that every new row names its group.
-- AlterTable
ALTER TABLE "LoginAttempt" DROP CONSTRAINT "LoginAttempt_pkey",
ADD COLUMN     "clientAddress" TEXT NOT NULL DEFAULT 'shared',
ADD CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("username", "clientAddress");

ALTER TABLE "LoginAttempt" ALTER COLUMN "clientAddress" DROP DEFAULT;
