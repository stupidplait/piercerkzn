-- Newsletter broadcasts: admin-authored marketing campaigns with a
-- server-enforced lifecycle (draft → scheduled → sending → sent | cancelled).
-- The two composite indexes back the cron sweeper:
--   * (state, scheduled_at) for promoting due `scheduled` rows
--   * (state, started_at)   for recovering stuck `sending` rows
-- The partial unique index on `notification_log` is the per-recipient
-- idempotency contract: one (campaign, customer) tuple maps to at most one
-- log row, so an `INSERT … ON CONFLICT` claim atomically gates each send.
-- Scoping the index with `WHERE type = 'newsletter_campaign'` keeps the
-- existing permissive shape of `notification_log` (other types still allow
-- duplicates, which is intentional — bookings / aftercare manage their own
-- dedupe via type-scoped queries, not unique constraints).
CREATE TABLE "newsletter_campaign" (
    "id" varchar(36) PRIMARY KEY NOT NULL,
    "subject" text NOT NULL,
    "preheader" text,
    "body_markdown" text NOT NULL,
    "state" varchar(20) DEFAULT 'draft' NOT NULL,
    "scheduled_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "recipient_count" integer DEFAULT 0 NOT NULL,
    "sent_count" integer DEFAULT 0 NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "created_by_user_id" varchar(36),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_campaign"
    ADD CONSTRAINT "newsletter_campaign_created_by_user_id_admin_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."admin_user"("id")
    ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_newsletter_state_scheduled"
    ON "newsletter_campaign" USING btree ("state", "scheduled_at");
--> statement-breakpoint
CREATE INDEX "idx_newsletter_state_started"
    ON "newsletter_campaign" USING btree ("state", "started_at");
--> statement-breakpoint
-- Per-recipient idempotency: at most one notification_log row per
-- (campaignId, customerId) for newsletter sends. Partial so it doesn't
-- constrain other notification types.
CREATE UNIQUE INDEX "uniq_notif_newsletter_recipient"
    ON "notification_log" ("type", ((metadata->>'campaignId')), ((metadata->>'customerId')))
    WHERE "type" = 'newsletter_campaign';
