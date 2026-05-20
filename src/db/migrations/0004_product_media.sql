-- Product media gallery: multiple ordered assets per product, optionally
-- per-variant. `is_primary` is enforced to be unique-per-product by a
-- partial unique index so swap-primary writes can be a two-step atomic
-- "unset old / set new" inside one transaction without violating the
-- constraint mid-statement (PG defers nothing here; the partial index is
-- evaluated row-by-row, so use a single UPDATE that flips both rows or
-- explicit unset-then-set ordering).
CREATE TABLE "product_media" (
    "id" varchar(36) PRIMARY KEY NOT NULL,
    "product_id" varchar(36) NOT NULL,
    "variant_id" varchar(36),
    "url" varchar(512) NOT NULL,
    "alt" varchar(255),
    "kind" varchar(20) NOT NULL DEFAULT 'image',
    "is_primary" boolean NOT NULL DEFAULT false,
    "sort_order" integer NOT NULL DEFAULT 0,
    "metadata" jsonb DEFAULT '{}'::jsonb,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "product_media"
    ADD CONSTRAINT "product_media_product_id_product_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."product"("id")
    ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_media"
    ADD CONSTRAINT "product_media_variant_id_product_variant_id_fk"
    FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id")
    ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_product_media_product" ON "product_media" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX "idx_product_media_variant" ON "product_media" USING btree ("variant_id");
--> statement-breakpoint
-- At most one primary media per product; partial index keeps writes cheap.
CREATE UNIQUE INDEX "uq_product_media_primary"
    ON "product_media" ("product_id")
    WHERE "is_primary" = true;
--> statement-breakpoint
-- Backfill: every existing product with a thumbnail_url gets an initial
-- primary media row so the new read shape (media[]) is never empty for
-- already-seeded catalogue rows.
INSERT INTO "product_media" ("id", "product_id", "url", "kind", "is_primary", "sort_order")
SELECT
    gen_random_uuid()::text,
    p."id",
    p."thumbnail_url",
    'image',
    true,
    0
FROM "product" p
WHERE p."thumbnail_url" IS NOT NULL
  AND p."deleted_at" IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM "product_media" pm
      WHERE pm."product_id" = p."id" AND pm."is_primary" = true
  );
