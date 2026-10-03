import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './columns'
import { organizations, users } from './core'
import { roleEnum } from './enums'

/*
 * Better Auth's core models (spec §4: email + password, sessions in the
 * database), with the column names its Drizzle adapter expects (`usePlural`,
 * uuid ids from Postgres). `users` lives in core.ts.
 */

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    ...timestamps,
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    /** Password hash (scrypt, by Better Auth) for the "credential" provider. */
    password: text(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    ...timestamps,
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
)

export const verifications = pgTable('verifications', {
  id: id(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  ...timestamps,
})

/**
 * Accounts are created by invitation (spec §16.1): the super admin invites an
 * owner, owners invite staff. Only a hash of the token is stored; the link
 * carries the token itself.
 */
export const invites = pgTable(
  'invites',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    name: text(),
    role: roleEnum().notNull().default('agent'),
    tokenHash: text().notNull().unique(),
    invitedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('invites_org_id_idx').on(t.orgId)],
)

/** A browser or phone that asked for push notifications (Web Push, VAPID). */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text().notNull().unique(),
    keys: jsonb().$type<{ p256dh: string; auth: string }>().notNull(),
    deviceLabel: text(),
    lastUsedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('push_subscriptions_user_id_idx').on(t.userId)],
)

/** Who did what (spec §19): takeovers, settings changes, org creation, … */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    orgId: uuid().references(() => organizations.id, { onDelete: 'cascade' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    diff: jsonb().$type<Record<string, unknown>>(),
    ip: text(),
    ...timestamps,
  },
  (t) => [index('audit_logs_org_created_idx').on(t.orgId, t.createdAt)],
)
