CREATE TABLE "review_helpful_vote" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"review_id" varchar(36) NOT NULL,
	"customer_id" varchar(36) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_helpful_review_customer" UNIQUE("review_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "review_helpful_vote" ADD CONSTRAINT "review_helpful_vote_review_id_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_helpful_vote" ADD CONSTRAINT "review_helpful_vote_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_helpful_review" ON "review_helpful_vote" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "idx_helpful_customer" ON "review_helpful_vote" USING btree ("customer_id");