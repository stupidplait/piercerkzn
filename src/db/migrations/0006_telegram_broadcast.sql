-- Telegram broadcasts: admin-authored Russian-language one-off messages with a
-- server-enforced lifecycle (draft → scheduled → sending → sent | cancelled).
-- The two composite indexes back the cron sweeper:
--   * (state, scheduled_at) for promoting due `scheduled` rows
--   * (state, started_at)   for recovering stuck `sending` rows
-- The partial unique index on `notification_log` is the per-recipient
-- idempotency contract: one (broadcastId, telegramId) tuple maps to at most
-- one log row, so an `INSERT … ON CONFLICT` claim atomically gates each send.
-- The dedupe key is `telegramId` (not `customerId`) because unlinked bot users
-- have `customerId = NULL`, and Postgres treats NULLs as distinct on unique
-- indexes — keying on `customerId` would let two unlinked recipients (each
-- with a NULL customer) bypass dedupe and receive the same broadcast twice.
-- `telegramId` is always non-null for opted-in bot users, which makes it a
-- safe dedupe key. Scoping the index with `WHERE type = 'telegram_broadcast'`
-- keeps the existing permissive shape of `notification_log` and makes this
-- index disjoint from `uniq_notif_newsletter_recipient` (different partial
-- predicate, different dedupe metadata key) — the two indexes never collide.
CREATE TABLE "telegram_broadcast" (
    "id" varchar(36) PRIMARY KEY NOT NULL,
    "title" varchar(200) NOT NULL,
    "body_text" text NOT NULL,
    "parse_mode" varchar(20) DEFAULT 'HTML' NOT NULL,
    "inline_button_label" varchar(64),
    "inline_button_url" varchar(256),
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
ALTER TABLE "telegram_broadcast"
    ADD CONSTRAINT "telegram_broadcast_created_by_user_id_admin_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."admin_user"("id")
    ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_broadcast"
    ADD CONSTRAINT "telegram_broadcast_parse_mode_check"
    CHECK ("parse_mode" IN ('HTML', 'MarkdownV2'));
--> statement-breakpoint
ALTER TABLE "telegram_broadcast"
    ADD CONSTRAINT "telegram_broadcast_state_check"
    CHECK ("state" IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled'));
--> statement-breakpoint
CREATE INDEX "idx_telegram_broadcast_state_scheduled"
    ON "telegram_broadcast" USING btree ("state", "scheduled_at");
--> statement-breakpoint
CREATE INDEX "idx_telegram_broadcast_state_started"
    ON "telegram_broadcast" USING btree ("state", "started_at");
--> statement-breakpoint
-- Per-recipient idempotency: at most one notification_log row per
-- (broadcastId, telegramId) for telegram broadcast sends. Partial so it
-- doesn't constrain other notification types and so it is disjoint from
-- `uniq_notif_newsletter_recipient` (different `type` predicate).
CREATE UNIQUE INDEX "uniq_notif_telegram_broadcast_recipient"
    ON "notification_log" ("type", ((metadata->>'broadcastId')), ((metadata->>'telegramId')))
    WHERE "type" = 'telegram_broadcast';
