-- Hand-written. Checks that search can work on the database before anything of search is created, and creates the
-- extension `pg_trgm`, which search uses for parts of words and typos. It changes no table, and sorts before the
-- migration of the search index, so that a database that fails the check gets nothing of search.
--
-- A migration that stops here is recorded as failed in `_prisma_migrations` (P3018), and `prisma migrate deploy`
-- applies no further migration until it is marked as rolled back (P3009). Each message therefore names that step:
-- after the fix, run `prisma migrate resolve --rolled-back 20261119100000_search_database_check` once (in the
-- container image, in `/app/migrate`), and the next start applies the migrations again.

DO $$
DECLARE
  resolve CONSTANT text := 'This migration stays recorded as failed, also in a copy of this database: after the '
    'fix, mark it as rolled back with "prisma migrate resolve --rolled-back 20261119100000_search_database_check" '
    '(in the container image: cd /app/migrate && ./node_modules/.bin/prisma migrate resolve --rolled-back '
    '20261119100000_search_database_check), then start again.';
  db_ctype text;
  db_encoding text;
BEGIN
  SELECT datctype, pg_encoding_to_char(encoding) INTO db_ctype, db_encoding
  FROM pg_database WHERE datname = current_database();

  -- Without a UTF-8 character type, `pg_trgm` takes letters with umlauts and of other scripts for separators, so that
  -- parts of words and typos would be matched wrongly. The character type counts whatever the locale provider.
  IF db_ctype IN ('C', 'POSIX') OR db_encoding <> 'UTF8' THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'HippoWiki needs a database with the encoding UTF8 and a UTF-8 character type, but the database %I has the '
        'encoding %s and the character type %s.', current_database(), db_encoding, db_ctype),
      HINT = 'Create the database with a UTF-8 locale such as C.UTF-8 or en_US.utf8, e.g. CREATE DATABASE ... '
        'ENCODING ''UTF8'' LOCALE ''C.UTF-8'' TEMPLATE template0. ' || resolve;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
      RAISE EXCEPTION USING
        MESSAGE = 'HippoWiki needs the extension pg_trgm, which this PostgreSQL server does not offer.',
        HINT = 'Install the contrib extensions of PostgreSQL on the database server (often the package '
          'postgresql-contrib); the official postgres image has them. ' || resolve;
    END IF;
    -- `pg_trgm` is a trusted extension: a user with the right to create objects in the database may create it.
    IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
      AND NOT has_database_privilege(current_database(), 'CREATE') THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'HippoWiki needs the extension pg_trgm in the database %I, and the database user %I may not create it.',
          current_database(), current_user),
        HINT = format(
          'The operator must create pg_trgm in the database (CREATE EXTENSION pg_trgm;) or give the user the right '
          'to create it (GRANT CREATE ON DATABASE %I TO %I;). ', current_database(), current_user) || resolve;
    END IF;
  END IF;
END
$$;

-- A database where the operator created `pg_trgm` before passes without the right to create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
