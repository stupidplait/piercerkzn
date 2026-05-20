CREATE TABLE "auth_account" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "auth_account_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification_token" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "appointment_jewelry" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"appointment_id" varchar(36) NOT NULL,
	"variant_id" varchar(36),
	"piercing_point" varchar(50),
	"source" varchar(20) DEFAULT 'catalog',
	"price" integer
);
--> statement-breakpoint
CREATE TABLE "appointment_service" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"appointment_id" varchar(36) NOT NULL,
	"service_id" varchar(36) NOT NULL,
	"price" integer NOT NULL,
	"duration_minutes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"reference_number" varchar(20) NOT NULL,
	"customer_id" varchar(36),
	"customer_first_name" varchar(100) NOT NULL,
	"customer_last_name" varchar(100),
	"customer_email" varchar(255) NOT NULL,
	"customer_phone" varchar(20) NOT NULL,
	"customer_dob" date,
	"date" date NOT NULL,
	"time_start" time NOT NULL,
	"time_end" time NOT NULL,
	"total_duration_min" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"estimated_total" integer NOT NULL,
	"waiver_id" varchar(36),
	"reservation_id" varchar(36),
	"customer_notes" text,
	"internal_notes" text,
	"completion_notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "appointment_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "piercer_profile" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100),
	"title" varchar(100),
	"bio" text,
	"avatar_url" varchar(512),
	"banner_url" varchar(512),
	"experience_years" integer,
	"specializations" text[],
	"certifications" text[],
	"social_instagram" varchar(255),
	"social_tiktok" varchar(255),
	"social_telegram" varchar(255),
	"rating_average" numeric(3, 1) DEFAULT '0.0',
	"rating_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "piercer_schedule" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"day_of_week" integer NOT NULL,
	"is_working" boolean DEFAULT true,
	"start_time" time,
	"end_time" time,
	"breaks" jsonb DEFAULT '[]'::jsonb,
	CONSTRAINT "piercer_schedule_day_of_week_unique" UNIQUE("day_of_week")
);
--> statement-breakpoint
CREATE TABLE "schedule_exception" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"is_working" boolean DEFAULT false,
	"start_time" time,
	"end_time" time,
	"reason" varchar(255),
	CONSTRAINT "schedule_exception_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"handle" varchar(100) NOT NULL,
	"category" varchar(30) NOT NULL,
	"subcategory" varchar(30),
	"description" text,
	"duration_minutes" integer NOT NULL,
	"price_from" integer NOT NULL,
	"price_to" integer,
	"currency_code" varchar(3) DEFAULT 'rub',
	"price_note" varchar(500),
	"jewelry_included" boolean DEFAULT false,
	"requires_consultation" boolean DEFAULT false,
	"minimum_age" integer DEFAULT 18,
	"healing_time_min_weeks" integer,
	"healing_time_max_weeks" integer,
	"compatible_jewelry_types" varchar(500),
	"image_url" varchar(512),
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "service_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "time_block" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"reason" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "waiver_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"created_by" varchar(36),
	CONSTRAINT "waiver_template_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "waiver" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"appointment_id" varchar(36),
	"customer_id" varchar(36),
	"template_version" integer NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"signature_data" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now(),
	"ip_address" varchar(45),
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "aftercare_guide" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"handle" varchar(100) NOT NULL,
	"title" varchar(200) NOT NULL,
	"piercing_type" varchar(50) NOT NULL,
	"content" jsonb NOT NULL,
	"healing_min_weeks" integer,
	"healing_max_weeks" integer,
	"icon_url" varchar(512),
	"service_id" varchar(36),
	"meta_title" varchar(200),
	"meta_description" varchar(500),
	"version" integer DEFAULT 1,
	"is_published" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "aftercare_guide_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "aftercare_tracking" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"customer_id" varchar(36) NOT NULL,
	"appointment_id" varchar(36),
	"piercing_type" varchar(50) NOT NULL,
	"piercing_date" date NOT NULL,
	"guide_id" varchar(36),
	"daily_log" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true,
	"downsize_reminded" boolean DEFAULT false,
	"downsize_scheduled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "blog_category" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"handle" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "blog_category_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "blog_post" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"slug" varchar(255) NOT NULL,
	"title" varchar(500) NOT NULL,
	"excerpt" varchar(1000),
	"content" text NOT NULL,
	"featured_image" varchar(512),
	"category_id" varchar(36),
	"author_id" varchar(36),
	"status" varchar(20) DEFAULT 'draft',
	"published_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"read_time_min" integer,
	"view_count" integer DEFAULT 0,
	"meta_title" varchar(200),
	"meta_description" varchar(500),
	"tags" text[],
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "blog_post_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100),
	"phone" varchar(20),
	"date_of_birth" date,
	"avatar_url" varchar(512),
	"locale" varchar(5) DEFAULT 'ru',
	"oauth_provider" varchar(20),
	"oauth_id" varchar(255),
	"notification_email" boolean DEFAULT true,
	"notification_sms" boolean DEFAULT true,
	"notification_push" boolean DEFAULT false,
	"notification_marketing" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customer_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "curated_look" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"handle" varchar(100) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"body_model_id" varchar(36) NOT NULL,
	"body_area" varchar(30) NOT NULL,
	"thumbnail_url" varchar(512),
	"total_individual_price" integer NOT NULL,
	"bundle_price" integer NOT NULL,
	"discount_percent" numeric(4, 1),
	"currency_code" varchar(3) DEFAULT 'rub',
	"camera_state" jsonb,
	"is_published" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "curated_look_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "look_piece" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"look_id" varchar(36) NOT NULL,
	"piercing_point_id" varchar(36) NOT NULL,
	"variant_id" varchar(36) NOT NULL,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "saved_look" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"customer_id" varchar(36) NOT NULL,
	"title" varchar(200),
	"body_model_id" varchar(36) NOT NULL,
	"pieces" jsonb NOT NULL,
	"camera_state" jsonb,
	"thumbnail_url" varchar(512),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_category" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"handle" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"parent_id" varchar(36),
	"image_url" varchar(512),
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "product_category_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "product_piercing_area" (
	"product_id" varchar(36) NOT NULL,
	"piercing_area" varchar(50) NOT NULL,
	CONSTRAINT "product_piercing_area_product_id_piercing_area_pk" PRIMARY KEY("product_id","piercing_area")
);
--> statement-breakpoint
CREATE TABLE "product_variant" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"product_id" varchar(36) NOT NULL,
	"title" varchar(255) NOT NULL,
	"sku" varchar(100),
	"material_finish" varchar(50),
	"gauge" varchar(10),
	"length_mm" numeric(5, 1),
	"diameter_mm" numeric(5, 1),
	"gem_type" varchar(50),
	"gem_color" varchar(50),
	"price_rub" integer NOT NULL,
	"price_usd" integer,
	"original_price_rub" integer,
	"sale_start" timestamp with time zone,
	"sale_end" timestamp with time zone,
	"manage_inventory" boolean DEFAULT true,
	"inventory_quantity" integer DEFAULT 0,
	"low_stock_threshold" integer DEFAULT 3,
	"allow_backorder" boolean DEFAULT false,
	"image_url" varchar(512),
	"model_3d_material_key" varchar(50),
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "product_variant_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"handle" varchar(255) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"category_id" varchar(36),
	"material" varchar(50) NOT NULL,
	"jewelry_type" varchar(50) NOT NULL,
	"threading" varchar(20),
	"status" varchar(20) DEFAULT 'draft',
	"is_featured" boolean DEFAULT false,
	"thumbnail_url" varchar(512),
	"has_3d_model" boolean DEFAULT false,
	"meta_title" varchar(200),
	"meta_description" varchar(500),
	"og_image_url" varchar(512),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "product_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "reservation_item" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"reservation_id" varchar(36) NOT NULL,
	"product_id" varchar(36),
	"variant_id" varchar(36),
	"title" varchar(500) NOT NULL,
	"variant_title" varchar(255),
	"sku" varchar(100),
	"thumbnail_url" varchar(512),
	"unit_price" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"total" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reservation" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"reference_number" varchar(20) NOT NULL,
	"customer_id" varchar(36),
	"customer_first_name" varchar(100) NOT NULL,
	"customer_last_name" varchar(100),
	"customer_email" varchar(255) NOT NULL,
	"customer_phone" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"total" integer NOT NULL,
	"currency_code" varchar(3) DEFAULT 'rub',
	"expires_at" timestamp with time zone NOT NULL,
	"customer_notes" text,
	"internal_notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"confirmed_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "reservation_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100),
	"role" varchar(20) DEFAULT 'owner' NOT NULL,
	"avatar_url" varchar(512),
	"totp_secret" varchar(255),
	"totp_enabled" boolean DEFAULT false,
	"last_login_at" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "admin_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "inquiry" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"reference_number" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(20),
	"subject" varchar(50) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(20) DEFAULT 'new',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"resolved_at" timestamp with time zone,
	CONSTRAINT "inquiry_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "inquiry_reply" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"inquiry_id" varchar(36) NOT NULL,
	"content" text NOT NULL,
	"sent_via" varchar(20) DEFAULT 'email',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"customer_id" varchar(36),
	"channel" varchar(20) NOT NULL,
	"type" varchar(50) NOT NULL,
	"recipient" varchar(255) NOT NULL,
	"subject" varchar(500),
	"content_preview" varchar(500),
	"status" varchar(20) DEFAULT 'sent',
	"provider_id" varchar(255),
	"sent_at" timestamp with time zone DEFAULT now(),
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "portfolio_image" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"image_url" varchar(512) NOT NULL,
	"thumbnail_url" varchar(512),
	"piercing_type" varchar(50),
	"product_id" varchar(36),
	"description" varchar(500),
	"client_consent" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"type" varchar(20) NOT NULL,
	"product_id" varchar(36),
	"customer_id" varchar(36) NOT NULL,
	"appointment_id" varchar(36),
	"rating" smallint NOT NULL,
	"title" varchar(200),
	"content" text,
	"images" text[],
	"is_verified_client" boolean DEFAULT false,
	"helpful_count" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"group_name" varchar(50) NOT NULL,
	"description" varchar(500),
	"updated_at" timestamp with time zone DEFAULT now(),
	"updated_by" varchar(36)
);
--> statement-breakpoint
CREATE TABLE "telegram_bot_user" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"telegram_username" varchar(255),
	"first_name" varchar(100),
	"last_name" varchar(100),
	"language_code" varchar(10) DEFAULT 'ru',
	"customer_id" varchar(36),
	"phone" varchar(20),
	"bot_state" jsonb DEFAULT '{}'::jsonb,
	"notifications_enabled" boolean DEFAULT true,
	"aftercare_active" boolean DEFAULT false,
	"last_interaction_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "telegram_bot_user_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "wishlist_item" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"customer_id" varchar(36) NOT NULL,
	"product_id" varchar(36) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_wishlist_customer_product" UNIQUE("customer_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "body_model" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"area" varchar(30) NOT NULL,
	"side" varchar(10),
	"model_url" varchar(512) NOT NULL,
	"model_url_lod1" varchar(512),
	"model_url_lod2" varchar(512),
	"thumbnail_url" varchar(512),
	"polygon_count" integer,
	"file_size_bytes" bigint,
	"camera_defaults" jsonb NOT NULL,
	"skin_textures" jsonb DEFAULT '[]'::jsonb,
	"version" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jewelry_3d_model" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"product_id" varchar(36) NOT NULL,
	"model_url" varchar(512) NOT NULL,
	"thumbnail_url" varchar(512),
	"polygon_count" integer,
	"file_size_bytes" bigint,
	"material_mapping" jsonb DEFAULT '{}'::jsonb,
	"jewelry_type" varchar(50) NOT NULL,
	"default_attachment" varchar(50),
	"is_validated" boolean DEFAULT false,
	"validation_errors" text[],
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "piercing_point" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"body_model_id" varchar(36) NOT NULL,
	"name" varchar(50) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"position_x" numeric(8, 4) NOT NULL,
	"position_y" numeric(8, 4) NOT NULL,
	"position_z" numeric(8, 4) NOT NULL,
	"rotation_x" numeric(8, 4) DEFAULT '0',
	"rotation_y" numeric(8, 4) DEFAULT '0',
	"rotation_z" numeric(8, 4) DEFAULT '0',
	"normal_x" numeric(8, 4) NOT NULL,
	"normal_y" numeric(8, 4) NOT NULL,
	"normal_z" numeric(8, 4) NOT NULL,
	"compatible_jewelry_types" text[] NOT NULL,
	"compatible_gauges" text[],
	"max_jewelry_diameter_mm" numeric(5, 1),
	"service_id" varchar(36),
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_pp_body_model_name" UNIQUE("body_model_id","name")
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_jewelry" ADD CONSTRAINT "appointment_jewelry_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_jewelry" ADD CONSTRAINT "appointment_jewelry_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_service" ADD CONSTRAINT "appointment_service_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_service" ADD CONSTRAINT "appointment_service_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_waiver_id_waiver_id_fk" FOREIGN KEY ("waiver_id") REFERENCES "public"."waiver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_reservation_id_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver" ADD CONSTRAINT "waiver_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver" ADD CONSTRAINT "waiver_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aftercare_guide" ADD CONSTRAINT "aftercare_guide_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aftercare_tracking" ADD CONSTRAINT "aftercare_tracking_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aftercare_tracking" ADD CONSTRAINT "aftercare_tracking_guide_id_aftercare_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."aftercare_guide"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_category_id_blog_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."blog_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_author_id_piercer_profile_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."piercer_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_look" ADD CONSTRAINT "curated_look_body_model_id_body_model_id_fk" FOREIGN KEY ("body_model_id") REFERENCES "public"."body_model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "look_piece" ADD CONSTRAINT "look_piece_look_id_curated_look_id_fk" FOREIGN KEY ("look_id") REFERENCES "public"."curated_look"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "look_piece" ADD CONSTRAINT "look_piece_piercing_point_id_piercing_point_id_fk" FOREIGN KEY ("piercing_point_id") REFERENCES "public"."piercing_point"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "look_piece" ADD CONSTRAINT "look_piece_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_look" ADD CONSTRAINT "saved_look_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_look" ADD CONSTRAINT "saved_look_body_model_id_body_model_id_fk" FOREIGN KEY ("body_model_id") REFERENCES "public"."body_model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_parent_id_product_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."product_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_piercing_area" ADD CONSTRAINT "product_piercing_area_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_product_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_item" ADD CONSTRAINT "reservation_item_reservation_id_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_item" ADD CONSTRAINT "reservation_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_item" ADD CONSTRAINT "reservation_item_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_reply" ADD CONSTRAINT "inquiry_reply_inquiry_id_inquiry_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_image" ADD CONSTRAINT "portfolio_image_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bot_user" ADD CONSTRAINT "telegram_bot_user_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_item" ADD CONSTRAINT "wishlist_item_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_item" ADD CONSTRAINT "wishlist_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jewelry_3d_model" ADD CONSTRAINT "jewelry_3d_model_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piercing_point" ADD CONSTRAINT "piercing_point_body_model_id_body_model_id_fk" FOREIGN KEY ("body_model_id") REFERENCES "public"."body_model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piercing_point" ADD CONSTRAINT "piercing_point_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_account_user" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_auth_session_user" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_customer" ON "appointment" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_date" ON "appointment" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_appointment_status" ON "appointment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_appointment_ref" ON "appointment" USING btree ("reference_number");--> statement-breakpoint
CREATE INDEX "idx_exception_date" ON "schedule_exception" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_block_date" ON "time_block" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_aftercare_customer" ON "aftercare_tracking" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_blog_slug" ON "blog_post" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_blog_status" ON "blog_post" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_blog_published" ON "blog_post" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_customer_email" ON "customer" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_customer_phone" ON "customer" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_saved_look_customer" ON "saved_look" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_variant_product" ON "product_variant" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_variant_sku" ON "product_variant" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "idx_product_handle" ON "product" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "idx_product_category" ON "product" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_product_material" ON "product" USING btree ("material");--> statement-breakpoint
CREATE INDEX "idx_product_type" ON "product" USING btree ("jewelry_type");--> statement-breakpoint
CREATE INDEX "idx_product_status" ON "product" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reservation_item_res" ON "reservation_item" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "idx_reservation_customer" ON "reservation" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_reservation_status" ON "reservation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reservation_ref" ON "reservation" USING btree ("reference_number");--> statement-breakpoint
CREATE INDEX "idx_reservation_expires" ON "reservation" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_notif_customer" ON "notification_log" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_notif_type" ON "notification_log" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_notif_sent" ON "notification_log" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "idx_review_product" ON "review" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_review_customer" ON "review" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_tg_user_telegram" ON "telegram_bot_user" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "idx_tg_user_customer" ON "telegram_bot_user" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_j3d_product" ON "jewelry_3d_model" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_pp_body_model" ON "piercing_point" USING btree ("body_model_id");