import { sql } from 'drizzle-orm'
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import {
  CAMPAIGN_STATUSES,
  PRICING_CATEGORIES,
  RECIPIENT_STATUSES,
  type CampaignAudience,
  type CampaignVariable,
} from '@haazir/shared'
import { id, timestamps } from './columns'
import { organizations, users } from './core'
import { templates } from './crm'
import { contacts, messages } from './whatsapp'

export const pricingCategoryEnum = pgEnum('pricing_category', PRICING_CATEGORIES)
export const campaignStatusEnum = pgEnum('campaign_status', CAMPAIGN_STATUSES)
export const recipientStatusEnum = pgEnum('recipient_status', RECIPIENT_STATUSES)

/**
 * Meta's per-message rates (spec §8, §10), editable by the super admin. Not a
 * tenant table: one rate card for everyone. The row in force is the latest
 * `effective_from` on or before the day. Centipaise: ₹0.8631 = 8631.
 */
export const metaRates = pgTable(
  'meta_rates',
  {
    id: id(),
    country: text().notNull().default('IN'),
    category: pricingCategoryEnum().notNull(),
    priceCentipaise: integer().notNull(),
    effectiveFrom: date().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('meta_rates_unique').on(t.country, t.category, t.effectiveFrom)],
)

/** A broadcast of one approved template to an audience (spec §8, §16.8). */
export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    templateId: uuid().references(() => templates.id, { onDelete: 'set null' }),
    audience: jsonb().$type<CampaignAudience>().notNull().default({}),
    /** {{1}}, {{2}}… in order. */
    variableMap: jsonb().$type<CampaignVariable[]>().notNull().default([]),
    scheduledAt: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    status: campaignStatusEnum().notNull().default('draft'),
    /** Frozen when it is scheduled, so "estimate vs actual" compares like with like. */
    estimatedRecipients: integer(),
    estimatedCostPaise: integer(),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('campaigns_org_created_idx').on(t.orgId, t.createdAt)],
)

/**
 * Who a campaign went to, written when it starts (the audience is a snapshot:
 * someone tagged later isn't added mid-send). Unique per person, so a retried
 * start never adds anyone twice.
 */
export const campaignRecipients = pgTable(
  'campaign_recipients',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    messageId: uuid().references(() => messages.id, { onDelete: 'set null' }),
    status: recipientStatusEnum().notNull().default('pending'),
    errorCode: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('campaign_recipients_unique').on(t.campaignId, t.contactId),
    index('campaign_recipients_org_idx').on(t.orgId),
    index('campaign_recipients_message_idx').on(t.messageId),
    index('campaign_recipients_pending_idx')
      .on(t.campaignId, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  ],
)
