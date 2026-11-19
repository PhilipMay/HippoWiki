-- Hand-written. What search reads of the pages: the search columns of `Page`, the words of the pages of each folder
-- in `SearchWord`, and the triggers that keep the vector and the words current in every write of a page. It follows the
-- check of the database (`20261119100000_search_database_check`), which created `pg_trgm`.
--
-- The existing pages keep `searchIndexVersion` 0 and have no search text, no vector and no words until the server
-- derives them at its next start (`scripts/search-index.ts`).

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "searchIndexVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "searchLanguage" TEXT,
ADD COLUMN     "searchText" TEXT,
ADD COLUMN     "searchVector" tsvector;

-- CreateTable
CREATE TABLE "SearchWord" (
    "folderId" UUID NOT NULL,
    "word" TEXT NOT NULL,
    "pages" INTEGER NOT NULL,

    CONSTRAINT "SearchWord_pkey" PRIMARY KEY ("folderId","word")
);

-- CreateIndex
CREATE INDEX "SearchWord_word_idx" ON "SearchWord" USING GIN ("word" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Page_folderId_idx" ON "Page"("folderId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector") WHERE ("deletedAt" IS NULL);

-- AddForeignKey
ALTER TABLE "SearchWord" ADD CONSTRAINT "SearchWord_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written parts, which Prisma cannot express.

-- The language of a page is one of `SEARCH_LANGUAGES` of `src/features/search/language.ts`, so that it always names a
-- text search configuration, and is given together with the search text.
ALTER TABLE "Page" ADD CONSTRAINT "Page_searchLanguage_check" CHECK (
  "searchLanguage" IN ('basque', 'catalan', 'danish', 'dutch', 'english', 'estonian', 'finnish', 'french', 'german',
    'greek', 'hungarian', 'italian', 'lithuanian', 'norwegian', 'portuguese', 'romanian', 'russian', 'serbian',
    'spanish', 'swedish', 'turkish', 'simple')
);
ALTER TABLE "Page" ADD CONSTRAINT "Page_search_columns_check" CHECK (("searchText" IS NULL) = ("searchLanguage" IS NULL));

-- The vector of a page: the title and the name, with hyphens as spaces, with the highest weight, the search text with
-- the lowest, all with the configuration of the page. A vector holds at most 1 MB; content at the content limit stays
-- far below it, but a vector beyond it never fails the save: it is built again from the first half of the search
-- text, and so on.
CREATE FUNCTION "search_vector"(config regconfig, title text, name text, search_text text) RETURNS tsvector
LANGUAGE plpgsql STABLE AS $$
DECLARE
  head tsvector := setweight(to_tsvector(config, title || ' ' || replace(name, '-', ' ')), 'A');
  text_length integer := length(search_text);
BEGIN
  LOOP
    BEGIN
      RETURN head || setweight(to_tsvector(config, left(search_text, text_length)), 'D');
    EXCEPTION WHEN program_limit_exceeded THEN
      IF text_length = 0 THEN
        RAISE;
      END IF;
      text_length := text_length / 2;
    END;
  END LOOP;
END;
$$;

-- The words of a page for `SearchWord`: every word of the title, the name and the search text, as the text search
-- parser of PostgreSQL splits them for the vector, in lower case and not stemmed (the configuration `simple`), each
-- once. Shortened like the vector when the words of the whole text would pass the limit of a vector.
CREATE FUNCTION "search_words"(title text, name text, search_text text) RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
  head text := title || ' ' || replace(name, '-', ' ');
  text_length integer := length(search_text);
BEGIN
  LOOP
    BEGIN
      RETURN tsvector_to_array(to_tsvector('simple', head || ' ' || left(search_text, text_length)));
    EXCEPTION WHEN program_limit_exceeded THEN
      IF text_length = 0 THEN
        RAISE;
      END IF;
      text_length := text_length / 2;
    END;
  END LOOP;
END;
$$;

-- The vector of a page, at an insert and at an update that changes the title, the name, the search text or the
-- language. An update that changes none of them, such as a move, a delete or a content save of the same text, leaves
-- it as it is. A page whose search text is not derived yet has no vector.
CREATE FUNCTION "Page_search_vector"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW."title" IS NOT DISTINCT FROM OLD."title"
    AND NEW."name" IS NOT DISTINCT FROM OLD."name"
    AND NEW."searchText" IS NOT DISTINCT FROM OLD."searchText"
    AND NEW."searchLanguage" IS NOT DISTINCT FROM OLD."searchLanguage" THEN
    RETURN NEW;
  END IF;
  IF NEW."searchText" IS NULL THEN
    NEW."searchVector" := NULL;
  ELSE
    NEW."searchVector" := "search_vector"(NEW."searchLanguage"::regconfig, NEW."title", NEW."name", NEW."searchText");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Page_search_vector"
BEFORE INSERT OR UPDATE OF "title", "name", "searchText", "searchLanguage" ON "Page"
FOR EACH ROW EXECUTE FUNCTION "Page_search_vector"();

-- Removes the rows of the given pairs of a folder and a word, whose words no page holds any more.
CREATE FUNCTION "SearchWord_remove"(folders uuid[], words text[]) RETURNS void
LANGUAGE sql AS $$
  DELETE FROM "SearchWord" AS sw
  USING unnest(folders, words) AS gone("folderId", "word")
  WHERE sw."folderId" = gone."folderId" AND sw."word" = gone."word";
$$;

-- The words of the folders, at the end of every statement that inserts or updates pages. A page counts for each of
-- its words while it is not deleted and its search text is derived; a page whose title, name, search text,
-- deletion or folder did not change, such as one that was moved, changes nothing. The changes of all rows of the
-- statement, such as the pages deleted with their tab, are summed per pair of a folder and a word, +1 for each page
-- that gained the word and -1 for each that lost it, and applied in one statement in the order of the folder and the
-- word, so that two writes in one folder lock the same rows in the same order and never wait for each other in a
-- circle. A word that no page holds any more loses its row. Statement triggers with transition tables, because the
-- triggers of each row would lock the words of one page after the other.
CREATE FUNCTION "Page_search_words"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  gone_folders uuid[];
  gone_words text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    WITH changes ("folderId", "word", "delta") AS (
      SELECT n."folderId", word, 1
      FROM new_pages AS n, unnest("search_words"(n."title", n."name", n."searchText")) AS word
      WHERE n."deletedAt" IS NULL AND n."searchText" IS NOT NULL
    ),
    upserted AS (
      INSERT INTO "SearchWord" AS existing ("folderId", "word", "pages")
      SELECT "folderId", "word", sum("delta") FROM changes
      GROUP BY "folderId", "word"
      ORDER BY "folderId", "word"
      ON CONFLICT ("folderId", "word") DO UPDATE SET "pages" = existing."pages" + EXCLUDED."pages"
      RETURNING "folderId", "word", "pages"
    )
    SELECT array_agg("folderId"), array_agg("word") INTO gone_folders, gone_words FROM upserted WHERE "pages" <= 0;
  ELSE
    WITH changed AS (
      SELECT o."folderId" AS "oldFolderId", o."title" AS "oldTitle", o."name" AS "oldName",
        o."searchText" AS "oldText", o."deletedAt" IS NULL AND o."searchText" IS NOT NULL AS "oldCounts",
        n."folderId", n."title", n."name", n."searchText",
        n."deletedAt" IS NULL AND n."searchText" IS NOT NULL AS "counts"
      FROM old_pages AS o JOIN new_pages AS n ON n."id" = o."id"
      WHERE (o."folderId", o."title", o."name", o."searchText", o."deletedAt" IS NULL)
        IS DISTINCT FROM (n."folderId", n."title", n."name", n."searchText", n."deletedAt" IS NULL)
    ),
    changes ("folderId", "word", "delta") AS (
      SELECT c."oldFolderId", word, -1
      FROM changed AS c, unnest("search_words"(c."oldTitle", c."oldName", c."oldText")) AS word
      WHERE c."oldCounts"
      UNION ALL
      SELECT c."folderId", word, 1
      FROM changed AS c, unnest("search_words"(c."title", c."name", c."searchText")) AS word
      WHERE c."counts"
    ),
    upserted AS (
      INSERT INTO "SearchWord" AS existing ("folderId", "word", "pages")
      SELECT "folderId", "word", sum("delta") FROM changes
      GROUP BY "folderId", "word"
      HAVING sum("delta") <> 0
      ORDER BY "folderId", "word"
      ON CONFLICT ("folderId", "word") DO UPDATE SET "pages" = existing."pages" + EXCLUDED."pages"
      RETURNING "folderId", "word", "pages"
    )
    SELECT array_agg("folderId"), array_agg("word") INTO gone_folders, gone_words FROM upserted WHERE "pages" <= 0;
  END IF;

  IF gone_words IS NOT NULL THEN
    PERFORM "SearchWord_remove"(gone_folders, gone_words);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Page_search_words_insert"
AFTER INSERT ON "Page"
REFERENCING NEW TABLE AS new_pages
FOR EACH STATEMENT EXECUTE FUNCTION "Page_search_words"();

CREATE TRIGGER "Page_search_words_update"
AFTER UPDATE ON "Page"
REFERENCING OLD TABLE AS old_pages NEW TABLE AS new_pages
FOR EACH STATEMENT EXECUTE FUNCTION "Page_search_words"();
