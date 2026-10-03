import { sql } from 'drizzle-orm'
import {
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
import { id, timestamps } from './columns'
import { organizations, users } from './core'

export const whatsappAccountStatusEnum = pgEnum('whatsapp_account_status', [
  'connected',
  'error',
  'disconnected',
])
export const optInStatusEnum = pgEnum('opt_in_status', ['opted_in', 'opted_out', 'unknown'])
export const conversationModeEnum = pgEnum('conversation_mode', ['bot', 'human', 'closed'])
export const messageDirectionEnum = pgEnum('message_direction', ['in', 'out'])
export const messageStatusEnum = pgEnum('message_status', [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
])
export const sentByEnum = pgEnum('sent_by', ['bot', 'user', 'campaign', 'reminder', 'system'])

/** A WhatsApp number an org has connected. Meta routes webhooks by `phone_number_id`. */
export const whatsappAccounts = pgTable(
  'whatsapp_accounts',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    wabaId: text().notNull(),
    phoneNumberId: text().notNull().unique(),
    displayPhone: text(),
    verifiedName: text(),
    /** AES-256-GCM (`@haazir/shared/crypto`). Never returned by the API. */
    accessTokenEnc: text().notNull(),
    tokenExpiresAt: timestamp({ withTimezone: true }),
    qualityRating: text(),
    messagingLimitTier: text(),
    status: whatsappAccountStatusEnum().notNull().default('connected'),
    lastError: text(),
    ...timestamps,
  },
  (t) => [index('whatsapp_accounts_org_id_idx').on(t.orgId)],
)

/**
 * Someone who has messaged an org. `wa_id` is the identifier Meta gives us:
 * usually the phone number (E.164 digits), but for people who have adopted a
 * WhatsApp username it can be their business-scoped user ID (BSUID). `bsuid`
 * is stored separately because it is always present in webhooks since March
 * 2026, so it survives a person switching from phone number to username.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    waId: text().notNull(),
    bsuid: text(),
    name: text(),
    profileName: text(),
    language: text(),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    optInStatus: optInStatusEnum().notNull().default('unknown'),
    optInSource: text(),
    optInAt: timestamp({ withTimezone: true }),
    optedOutAt: timestamp({ withTimezone: true }),
    lastInboundAt: timestamp({ withTimezone: true }),
    notes: text(),
    customFields: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    // Leads with org_id, so it doubles as the tenant index.
    uniqueIndex('contacts_org_wa_id_unique').on(t.orgId, t.waId),
    uniqueIndex('contacts_org_bsuid_unique')
      .on(t.orgId, t.bsuid)
      .where(sql`${t.bsuid} is not null`),
  ],
)

/** One thread per contact per org. Holds the state the inbox and the bot need. */
export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    /**
     * The number this contact last wrote to: replies go out from it. Null
     * only for the bot playground, which never sends to WhatsApp.
     */
    whatsappAccountId: uuid().references(() => whatsappAccounts.id, { onDelete: 'restrict' }),
    mode: conversationModeEnum().notNull().default('bot'),
    assignedUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    unreadCount: integer().notNull().default(0),
    lastMessageAt: timestamp({ withTimezone: true }),
    lastMessagePreview: text(),
    /** Free-form replies are allowed until this moment (24h after the contact's last message). */
    serviceWindowExpiresAt: timestamp({ withTimezone: true }),
    humanUntil: timestamp({ withTimezone: true }),
    /** Why the bot handed over, and its one-line summary for the inbox banner (spec §11.6). */
    handoffReason: text(),
    handoffSummary: text(),
    handoffAt: timestamp({ withTimezone: true }),
    flowState: jsonb().$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('conversations_org_contact_unique').on(t.orgId, t.contactId),
    index('conversations_org_last_message_idx').on(t.orgId, t.lastMessageAt),
  ],
)

export type MessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button'
  | 'reaction'
  | 'template'
  | 'unsupported'

export const messages = pgTable(
  'messages',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    direction: messageDirectionEnum().notNull(),
    /** Null for outbound rows until Meta accepts them (the row is written first). */
    waMessageId: text().unique(),
    type: text().$type<MessageType>().notNull(),
    body: text(),
    interactive: jsonb().$type<Record<string, unknown>>(),
    mediaId: text(), // Meta's id, only valid for ~30 days; media_key is our copy
    mediaKey: text(),
    mediaMime: text(),
    transcript: text(),
    /** Outbound delivery state. Null for inbound messages. */
    status: messageStatusEnum(),
    errorCode: text(),
    errorTitle: text(),
    pricingCategory: text(),
    costPaiseEstimate: integer(),
    sentBy: sentByEnum(),
    sentByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    aiTraceId: uuid(),
    replyToWaMessageId: text(),
    /** When WhatsApp says it happened (inbound: sent by the contact). */
    waTimestamp: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    index('messages_org_id_idx').on(t.orgId),
  ],
)
