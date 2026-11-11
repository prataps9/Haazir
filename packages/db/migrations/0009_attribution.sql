ALTER TABLE "messages" ADD COLUMN "referral" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ad_source_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ad_headline" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ad_source_url" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
CREATE INDEX "leads_org_campaign_idx" ON "leads" USING btree ("org_id","campaign_id");