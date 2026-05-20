ALTER TABLE "product" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: any product currently `published` keeps its first-publish stamp at created_at.
UPDATE "product" SET "published_at" = "created_at" WHERE "status" = 'published' AND "published_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_product_published_at" ON "product" ("published_at");