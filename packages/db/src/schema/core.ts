import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { DEFAULT_TIMEZONE, type BusinessHours, type PlanLimits } from '@haazir/shared'
import { id, timestamps } from './columns'
import { languageEnum, orgStatusEnum, roleEnum, uiLanguageEnum, verticalEnum } from './enums'

/**
 * Plans and their limits live here, not in code, so the super admin can change
 * them without a deploy (spec §1). Money is integer paise.
 */
export const plans = pgTable('plans', {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  setupFeePaise: integer().notNull(),
  monthlyPaise: integer().notNull(),
  limits: jsonb().$type<PlanLimits>().notNull(),
  active: boolean().notNull().default(true),
  sort: integer().notNull().default(0),
  ...timestamps,
})

/** One row per client business. Every tenant table points here via `org_id`. */
export const organizations = pgTable('organizations', {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  vertical: verticalEnum().notNull().default('coaching'),
  city: text(),
  state: text(),
  address: text(),
  mapsUrl: text(),
  /** For the WhatsApp location pin the bot sends ("Institute kahan hai?"). */
  latitude: doublePrecision(),
  longitude: doublePrecision(),
  phone: text(),
  defaultLanguage: languageEnum().notNull().default('hinglish'),
  timezone: text().notNull().default(DEFAULT_TIMEZONE),
  planId: uuid().references(() => plans.id, { onDelete: 'restrict' }),
  status: orgStatusEnum().notNull().default('onboarding'),
  businessHours: jsonb().$type<BusinessHours>(),
  brand: jsonb().$type<{ logoUrl?: string; displayName?: string }>(),
  onboardingStep: integer().notNull().default(0),
  /** Last fee receipt number issued (R-0001, R-0002…), bumped atomically. */
  receiptSeq: integer().notNull().default(0),
  ...timestamps,
})

/**
 * People who log in. Column names match Better Auth's core `user` model (wired
 * up in Phase 3 with `usePlural`), plus the UI language they chose.
 */
export const users = pgTable('users', {
  id: id(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  phone: text(), // E.164 without "+", e.g. 919876543210
  uiLanguage: uiLanguageEnum().notNull().default('hi'),
  ...timestamps,
})

export interface NotifyPrefs {
  handoff?: { push: boolean; email: boolean }
  newLead?: { push: boolean; email: boolean }
  payment?: { push: boolean; email: boolean }
  /** Roz shaam 8 baje ka hisaab on WhatsApp, to `users.phone` (spec §13). */
  dailySummary?: boolean
}

/** Which user belongs to which org, and as what. A user can belong to several orgs. */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum().notNull().default('agent'),
    notifyPrefs: jsonb().$type<NotifyPrefs>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    // Leads with org_id, so it doubles as the tenant index.
    uniqueIndex('memberships_org_user_unique').on(t.orgId, t.userId),
    index('memberships_user_id_idx').on(t.userId),
  ],
)

/** Haazir staff with cross-org access (Pratap). Deliberately not a membership role. */
export const superAdmins = pgTable('super_admins', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamps.createdAt,
})
