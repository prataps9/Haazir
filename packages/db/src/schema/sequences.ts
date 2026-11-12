import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { ENROLLMENT_STATUSES, SEQUENCE_TRIGGERS } from '@haazir/shared'
import { id, timestamps } from './columns'
import { organizations } from './core'
import { leads, templates } from './crm'
import { contacts } from './whatsapp'

export const sequenceTriggerEnum = pgEnum('sequence_trigger', SEQUENCE_TRIGGERS)
export const enrollmentStatusEnum = pgEnum('enrollment_status', ENROLLMENT_STATUSES)

/**
 * A follow-up sequence: what happens, over a few days, after a lead goes
 * quiet at one point of the journey. One per trigger per institute, off until
 * the owner turns it on.
 */
export const sequences = pgTable(
  'sequences',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    trigger: sequenceTriggerEnum().notNull(),
    enabled: boolean().notNull().default(false),
    /** Only leads that reach the trigger after this moment are enrolled: turning it on never messages old leads. */
    enabledAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  // Leads with org_id, so it doubles as the tenant index.
  (t) => [uniqueIndex('sequences_org_trigger_unique').on(t.orgId, t.trigger)],
)

/** One message of a sequence: which approved template, and how long after the trigger. */
export const sequenceSteps = pgTable(
  'sequence_steps',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sequenceId: uuid()
      .notNull()
      .references(() => sequences.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    delayHours: integer().notNull(),
    templateId: uuid().references(() => templates.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sequence_steps_position_unique').on(t.sequenceId, t.position),
    index('sequence_steps_org_idx').on(t.orgId),
  ],
)

/**
 * A lead going through a sequence. Unique per lead and sequence, so a lead is
 * never taken through the same one twice, and a retried sweep enrols once.
 */
export const sequenceEnrollments = pgTable(
  'sequence_enrollments',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sequenceId: uuid()
      .notNull()
      .references(() => sequences.id, { onDelete: 'cascade' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    /** When the trigger happened (the enquiry, the demo): steps are timed from here. */
    baseAt: timestamp({ withTimezone: true }).notNull(),
    /** The step to send next (1-based). */
    nextPosition: integer().notNull().default(1),
    nextRunAt: timestamp({ withTimezone: true }),
    lastSentAt: timestamp({ withTimezone: true }),
    status: enrollmentStatusEnum().notNull().default('active'),
    /** Why it ended early: replied, admitted, lost, opted_out, no_consent, staff, demo_booked, no_template. */
    stopReason: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sequence_enrollments_unique').on(t.sequenceId, t.leadId),
    index('sequence_enrollments_org_idx').on(t.orgId),
    index('sequence_enrollments_due_idx')
      .on(t.nextRunAt)
      .where(sql`${t.status} = 'active'`),
  ],
)
