-- Adds a unique slug to every page. Existing pages get a slug derived from their title, approximating `deriveSlug`
-- in src/features/pages/derive.ts.

-- AlterTable: nullable first, so that existing rows can be filled.
ALTER TABLE "Page" ADD COLUMN "slug" TEXT;

-- Derive the slug from the title: spell out German umlauts and ß, drop other accents, lowercase, turn every run of
-- characters other than a-z0-9 into "-", trim "-" at both ends and cut to 80 characters.
UPDATE "Page"
SET "slug" = trim(BOTH '-' FROM left(
  trim(BOTH '-' FROM regexp_replace(
    lower(regexp_replace(
      normalize(
        replace(replace(replace(replace(replace(replace(replace("title",
          'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'Ä', 'Ae'), 'Ö', 'Oe'), 'Ü', 'Ue'), 'ß', 'ss'),
        NFKD),
      '[̀-ͯ]', '', 'g')),
    '[^a-z0-9]+', '-', 'g')),
  80));

-- Empty, reserved and duplicate slugs get the first 8 characters of the page id: empty ones as the whole slug, the
-- others as a suffix. Of pages with the same slug, the oldest keeps it unchanged.
WITH "ranked" AS (
  SELECT "id", row_number() OVER (PARTITION BY "slug" ORDER BY "createdAt", "id") AS "position"
  FROM "Page"
)
UPDATE "Page" AS "page"
SET "slug" = CASE
  WHEN "page"."slug" = '' THEN left("page"."id"::text, 8)
  ELSE trim(BOTH '-' FROM left("page"."slug", 71)) || '-' || left("page"."id"::text, 8)
END
FROM "ranked"
WHERE "ranked"."id" = "page"."id"
  AND ("page"."slug" = '' OR "page"."slug" = 'new' OR "ranked"."position" > 1);

ALTER TABLE "Page" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Page_slug_key" ON "Page"("slug");
