import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AnyDatabase } from '../client'
import { verifyPassword } from 'better-auth/crypto'
import {
  accounts,
  batches,
  botConfigs,
  courses,
  knowledgeFaqs,
  memberships,
  organizations,
  plans,
  users,
} from '../schema'
import { seed } from '../seed'
import { DEMO_BATCHES, DEMO_COURSES, DEMO_FAQS, DEMO_PASSWORD, PLANS } from '../seed-data'
import { createTestDb } from '../testing'

// PGlite is real Postgres compiled to WASM, in-process: these tests run the
// actual migration SQL without Docker. CI additionally migrates a real server.
let db: AnyDatabase
// node-postgres and PGlite both return { rows }; the generic database type can't say so.
const rows = <T>(result: unknown) => (result as { rows: T[] }).rows
let close: () => Promise<void>

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
})

afterAll(async () => {
  await close()
})

describe('migrations', () => {
  it('creates the tables so far (core, WhatsApp, AI + coaching, auth)', async () => {
    const result = rows<{ table_name: string }>(
      await db.execute(
        sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
      ),
    )
    expect(result.map((r) => r.table_name)).toEqual([
      'accounts',
      'ai_traces',
      'audit_logs',
      'batches',
      'bot_configs',
      'contacts',
      'conversations',
      'courses',
      'invites',
      'knowledge_chunks',
      'knowledge_faqs',
      'knowledge_sources',
      'memberships',
      'messages',
      'organizations',
      'plans',
      'push_subscriptions',
      'sessions',
      'super_admins',
      'unanswered_questions',
      'users',
      'verifications',
      'whatsapp_accounts',
    ])
  })

  it('generates uuids and timestamps in the database', async () => {
    const [org] = await db.insert(organizations).values({ name: 'Test', slug: 'test' }).returning()
    expect(org?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(org?.createdAt).toBeInstanceOf(Date)
    expect(org?.timezone).toBe('Asia/Kolkata')
    expect(org?.status).toBe('onboarding')
  })

  it('rejects values outside the enums', async () => {
    await expect(
      db.execute(sql`insert into organizations (name, slug, vertical) values ('x', 'x', 'bakery')`),
    ).rejects.toThrow()
  })
})

describe('seed', () => {
  it('is idempotent', async () => {
    await seed(db)
    await seed(db)
    expect(await db.$count(plans)).toBe(PLANS.length)
    expect(await db.$count(users)).toBe(4)
    expect(await db.$count(memberships)).toBe(3)
    // Two institutes, each with its own copy of the demo catalogue.
    expect(await db.$count(courses)).toBe(DEMO_COURSES.length * 2)
    expect(await db.$count(batches)).toBe(DEMO_BATCHES.length * 2)
    expect(await db.$count(botConfigs)).toBe(2)
    expect(await db.$count(knowledgeFaqs)).toBe(DEMO_FAQS.length * 2)
  })

  it('sets demo passwords only when asked, hashed the way Better Auth verifies them', async () => {
    expect(await db.$count(accounts)).toBe(0)
    await seed(db, { passwords: true })
    await seed(db, { passwords: true })
    const rows = await db.select().from(accounts)
    expect(rows).toHaveLength(4)
    expect(rows[0]?.password).not.toContain(DEMO_PASSWORD)
    expect(await verifyPassword({ hash: rows[0]!.password!, password: DEMO_PASSWORD })).toBe(true)
  })

  it('has pgvector: stores and ranks embeddings by cosine distance', async () => {
    const result = rows<{ d: number }>(
      await db.execute(sql`select ('[1,0,0]'::vector <=> '[0.9,0.1,0]'::vector) as d`),
    )
    expect(Number(result[0]?.d)).toBeLessThan(0.01)
  })

  it('builds the full-text column itself', async () => {
    const result = rows<{ t: string }>(
      await db.execute(sql`select to_tsvector('simple', 'RS-CIT ki fees') as t`),
    )
    expect(result[0]?.t).toContain('fees')
  })

  it('stores plan money as integer paise', async () => {
    const [growth] = await db.select().from(plans).where(eq(plans.code, 'growth'))
    expect(growth?.setupFeePaise).toBe(1_999_900)
    expect(growth?.monthlyPaise).toBe(499_900)
    expect(growth?.limits.seats).toBe(5)
  })

  it('allows one membership per user per org', async () => {
    const { org, owner } = await seed(db)
    await expect(
      db.insert(memberships).values({ orgId: org.id, userId: owner.id, role: 'admin' }),
    ).rejects.toThrow()
  })

  it('removes memberships when the org is deleted', async () => {
    const [temp] = await db.insert(organizations).values({ name: 'Temp', slug: 'temp' }).returning()
    const [user] = await db.insert(users).values({ name: 'T', email: 't@temp.example' }).returning()
    await db.insert(memberships).values({ orgId: temp!.id, userId: user!.id })
    await db.delete(organizations).where(eq(organizations.id, temp!.id))
    expect(await db.$count(memberships, eq(memberships.userId, user!.id))).toBe(0)
  })
})
