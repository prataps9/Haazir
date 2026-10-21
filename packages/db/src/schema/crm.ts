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
  DEMO_STATUSES,
  FEE_STATUSES,
  LEAD_SOURCES,
  LEAD_STAGES,
  PAID_VIA,
  STUDENT_STATUSES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_PURPOSES,
  TEMPLATE_STATUSES,
} from '@haazir/shared'
import { batches, courses } from './coaching'
import { id, timestamps } from './columns'
import { organizations, users } from './core'
import { contacts, whatsappAccountStatusEnum } from './whatsapp'

export const leadStageEnum = pgEnum('lead_stage', LEAD_STAGES)
export const leadSourceEnum = pgEnum('lead_source', LEAD_SOURCES)
export const actorEnum = pgEnum('actor', ['bot', 'user', 'system'])
export const demoStatusEnum = pgEnum('demo_status', DEMO_STATUSES)
export const studentStatusEnum = pgEnum('student_status', STUDENT_STATUSES)
export const feeStatusEnum = pgEnum('fee_status', FEE_STATUSES)
export const paidViaEnum = pgEnum('paid_via', PAID_VIA)
export const templateCategoryEnum = pgEnum('template_category', TEMPLATE_CATEGORIES)
export const templateStatusEnum = pgEnum('template_status', TEMPLATE_STATUSES)
export const templatePurposeEnum = pgEnum('template_purpose', TEMPLATE_PURPOSES)

/**
 * One enquiry per contact (spec §8, §16.5). The bot opens it on the first
 * message and moves it along (demo booked, admitted); staff move it too.
 */
export const leads = pgTable(
  'leads',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    stage: leadStageEnum().notNull().default('new'),
    source: leadSourceEnum().notNull().default('whatsapp'),
    courseId: uuid().references(() => courses.id, { onDelete: 'set null' }),
    batchId: uuid().references(() => batches.id, { onDelete: 'set null' }),
    /** Who the enquiry is for: often a parent asks for their child. */
    studentName: text(),
    notes: text(),
    nextFollowupAt: timestamp({ withTimezone: true }),
    lostReason: text(),
    valuePaise: integer(),
    assignedUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    stageChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('leads_org_contact_unique').on(t.orgId, t.contactId),
    index('leads_org_stage_idx').on(t.orgId, t.stage),
  ],
)

/** The lead's timeline: every stage change, note and booking, and who did it. */
export const leadEvents = pgTable(
  'lead_events',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: text().notNull(), // created | stage | note | demo_booked | demo_marked | admitted
    fromStage: leadStageEnum(),
    toStage: leadStageEnum(),
    actor: actorEnum().notNull(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lead_events_org_id_idx').on(t.orgId),
    index('lead_events_lead_id_idx').on(t.leadId, t.createdAt),
  ],
)

/** A free demo class (spec §11.5). Reminders are delayed jobs whose ids are kept here. */
export const demoBookings = pgTable(
  'demo_bookings',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    courseId: uuid().references(() => courses.id, { onDelete: 'set null' }),
    batchId: uuid().references(() => batches.id, { onDelete: 'set null' }),
    studentName: text().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    status: demoStatusEnum().notNull().default('booked'),
    bookedBy: actorEnum().notNull().default('bot'),
    reminderJobIds: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [
    index('demo_bookings_org_starts_idx').on(t.orgId, t.startsAt),
    index('demo_bookings_lead_id_idx').on(t.leadId),
    // One live booking per person per slot, so a double tap or a redelivered
    // webhook can't book the same demo twice.
    uniqueIndex('demo_bookings_contact_slot_unique')
      .on(t.contactId, t.startsAt)
      .where(sql`${t.status} <> 'cancelled'`),
  ],
)

export const students = pgTable(
  'students',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    leadId: uuid().references(() => leads.id, { onDelete: 'set null' }),
    name: text().notNull(),
    courseId: uuid().references(() => courses.id, { onDelete: 'set null' }),
    batchId: uuid().references(() => batches.id, { onDelete: 'set null' }),
    admissionDate: date().notNull(),
    guardianContactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    rollNo: text(),
    status: studentStatusEnum().notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    index('students_org_id_idx').on(t.orgId),
    index('students_contact_id_idx').on(t.contactId),
  ],
)

/** Which automatic reminders went out for an installment, so a retry never sends one twice. */
export interface FeeRemindersSent {
  upcoming?: string
  due?: string
  overdue3?: string
  overdue7?: string
  manual?: string[]
}

export const feeInstallments = pgTable(
  'fee_installments',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studentId: uuid()
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    dueDate: date().notNull(),
    amountPaise: integer().notNull(),
    status: feeStatusEnum().notNull().default('upcoming'),
    paymentLinkId: text(),
    paymentLinkUrl: text(),
    paidAt: timestamp({ withTimezone: true }),
    paidVia: paidViaEnum(),
    receiptNo: text(),
    remindersSent: jsonb().$type<FeeRemindersSent>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index('fee_installments_org_due_idx').on(t.orgId, t.dueDate),
    index('fee_installments_student_id_idx').on(t.studentId),
    uniqueIndex('fee_installments_payment_link_unique')
      .on(t.paymentLinkId)
      .where(sql`${t.paymentLinkId} is not null`),
  ],
)

/** The institute's own Razorpay account (spec §8): fees go straight to them, never through us. */
export const orgPaymentAccounts = pgTable('org_payment_accounts', {
  id: id(),
  orgId: uuid()
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  provider: text().notNull().default('razorpay'),
  keyId: text().notNull(),
  keySecretEnc: text().notNull(),
  webhookSecretEnc: text().notNull(),
  status: whatsappAccountStatusEnum().notNull().default('connected'),
  lastError: text(),
  ...timestamps,
})

/**
 * WhatsApp message templates (spec §8, §13). Phase 4 sends the approved ones
 * for reminders outside the 24-hour window; Phase 5 adds editing, submitting
 * to Meta and syncing statuses.
 */
export const templates = pgTable(
  'templates',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    language: text().notNull(), // Meta's code: hi, en, en_US…
    category: templateCategoryEnum().notNull(),
    /** Meta's component list (header, body, footer, buttons). */
    components: jsonb().$type<Record<string, unknown>[]>().notNull().default([]),
    /** What each {{n}} in the body means, in order, e.g. ["student_name", "course", "date"]. */
    variables: jsonb().$type<string[]>().notNull().default([]),
    metaTemplateId: text(),
    status: templateStatusEnum().notNull().default('draft'),
    rejectionReason: text(),
    purpose: templatePurposeEnum().notNull().default('custom'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('templates_org_name_language_unique').on(t.orgId, t.name, t.language),
    index('templates_org_purpose_idx').on(t.orgId, t.purpose),
  ],
)
