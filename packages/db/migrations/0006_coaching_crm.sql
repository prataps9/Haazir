CREATE TYPE "public"."actor" AS ENUM('bot', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."demo_status" AS ENUM('booked', 'reminded', 'attended', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."fee_status" AS ENUM('upcoming', 'due', 'overdue', 'paid', 'waived');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('whatsapp', 'ad', 'walkin', 'referral', 'campaign', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('new', 'contacted', 'demo_booked', 'demo_done', 'admitted', 'lost');--> statement-breakpoint
CREATE TYPE "public"."paid_via" AS ENUM('razorpay', 'cash', 'upi_manual', 'bank');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('active', 'completed', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('utility', 'marketing', 'authentication');--> statement-breakpoint
CREATE TYPE "public"."template_purpose" AS ENUM('demo_confirm', 'demo_reminder', 'fee_upcoming', 'fee_due', 'fee_overdue', 'payment_received', 'daily_summary', 'followup', 'announcement', 'custom');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'paused');--> statement-breakpoint
CREATE TABLE "demo_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"course_id" uuid,
	"batch_id" uuid,
	"student_name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"status" "demo_status" DEFAULT 'booked' NOT NULL,
	"booked_by" "actor" DEFAULT 'bot' NOT NULL,
	"reminder_job_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"label" text NOT NULL,
	"due_date" date NOT NULL,
	"amount_paise" integer NOT NULL,
	"status" "fee_status" DEFAULT 'upcoming' NOT NULL,
	"payment_link_id" text,
	"payment_link_url" text,
	"paid_at" timestamp with time zone,
	"paid_via" "paid_via",
	"receipt_no" text,
	"reminders_sent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_stage" "lead_stage",
	"to_stage" "lead_stage",
	"actor" "actor" NOT NULL,
	"actor_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"stage" "lead_stage" DEFAULT 'new' NOT NULL,
	"source" "lead_source" DEFAULT 'whatsapp' NOT NULL,
	"course_id" uuid,
	"batch_id" uuid,
	"student_name" text,
	"notes" text,
	"next_followup_at" timestamp with time zone,
	"lost_reason" text,
	"value_paise" integer,
	"assigned_user_id" uuid,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"key_id" text NOT NULL,
	"key_secret_enc" text NOT NULL,
	"webhook_secret_enc" text NOT NULL,
	"status" "whatsapp_account_status" DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_payment_accounts_orgId_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"lead_id" uuid,
	"name" text NOT NULL,
	"course_id" uuid,
	"batch_id" uuid,
	"admission_date" date NOT NULL,
	"guardian_contact_id" uuid,
	"roll_no" text,
	"status" "student_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"category" "template_category" NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta_template_id" text,
	"status" "template_status" DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"purpose" "template_purpose" DEFAULT 'custom' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "receipt_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_bookings" ADD CONSTRAINT "demo_bookings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_bookings" ADD CONSTRAINT "demo_bookings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_bookings" ADD CONSTRAINT "demo_bookings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_bookings" ADD CONSTRAINT "demo_bookings_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_bookings" ADD CONSTRAINT "demo_bookings_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_payment_accounts" ADD CONSTRAINT "org_payment_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_guardian_contact_id_contacts_id_fk" FOREIGN KEY ("guardian_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_bookings_org_starts_idx" ON "demo_bookings" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE INDEX "demo_bookings_lead_id_idx" ON "demo_bookings" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_bookings_contact_slot_unique" ON "demo_bookings" USING btree ("contact_id","starts_at") WHERE "demo_bookings"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "fee_installments_org_due_idx" ON "fee_installments" USING btree ("org_id","due_date");--> statement-breakpoint
CREATE INDEX "fee_installments_student_id_idx" ON "fee_installments" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_installments_payment_link_unique" ON "fee_installments" USING btree ("payment_link_id") WHERE "fee_installments"."payment_link_id" is not null;--> statement-breakpoint
CREATE INDEX "lead_events_org_id_idx" ON "lead_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "lead_events_lead_id_idx" ON "lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_contact_unique" ON "leads" USING btree ("org_id","contact_id");--> statement-breakpoint
CREATE INDEX "leads_org_stage_idx" ON "leads" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "students_org_id_idx" ON "students" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "students_contact_id_idx" ON "students" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_org_name_language_unique" ON "templates" USING btree ("org_id","name","language");--> statement-breakpoint
CREATE INDEX "templates_org_purpose_idx" ON "templates" USING btree ("org_id","purpose");