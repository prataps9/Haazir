import { pathToFileURL } from 'node:url'
import { hashPassword } from 'better-auth/crypto'
import { and, eq, sql } from 'drizzle-orm'
import { loadEnv } from '@haazir/shared/env'
import { createDb, type AnyDatabase } from './client'
import {
  accounts,
  batches,
  botConfigs,
  courses,
  knowledgeFaqs,
  knowledgeSources,
  memberships,
  organizations,
  plans,
  superAdmins,
  users,
} from './schema'
import {
  DEMO_BATCHES,
  DEMO_BOT_CONFIG,
  DEMO_COURSES,
  DEMO_FAQS,
  DEMO_ORG,
  DEMO_PASSWORD,
  DEMO_USERS,
  PLANS,
  SECOND_ORG,
  SECOND_ORG_OWNER,
} from './seed-data'

/**
 * Idempotent: running it twice leaves the same rows. Grows each phase (courses,
 * contacts, leads, messages…) until it matches the demo institute in spec §8.
 */
export async function seed(db: AnyDatabase, options: { passwords?: boolean } = {}) {
  await db
    .insert(plans)
    .values(PLANS)
    .onConflictDoUpdate({
      target: plans.code,
      set: {
        name: sql`excluded.name`,
        setupFeePaise: sql`excluded.setup_fee_paise`,
        monthlyPaise: sql`excluded.monthly_paise`,
        limits: sql`excluded.limits`,
        sort: sql`excluded.sort`,
      },
    })

  const [growth] = await db.select().from(plans).where(eq(plans.code, 'growth'))

  await db
    .insert(organizations)
    .values({ ...DEMO_ORG, planId: growth?.id })
    .onConflictDoNothing({ target: organizations.slug })
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, DEMO_ORG.slug))
  if (!org) throw new Error('demo org missing after insert')

  const upsertUser = async (u: (typeof DEMO_USERS)[keyof typeof DEMO_USERS]) => {
    await db.insert(users).values(u).onConflictDoNothing({ target: users.email })
    const [row] = await db.select().from(users).where(eq(users.email, u.email))
    if (!row) throw new Error(`user ${u.email} missing after insert`)
    return row
  }

  const owner = await upsertUser(DEMO_USERS.owner)
  const staff = await upsertUser(DEMO_USERS.staff)
  const admin = await upsertUser(DEMO_USERS.superAdmin)
  const secondOwner = await upsertUser(SECOND_ORG_OWNER)

  await db
    .insert(organizations)
    .values({ ...SECOND_ORG, planId: growth?.id })
    .onConflictDoNothing({ target: organizations.slug })
  const [second] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, SECOND_ORG.slug))
  if (!second) throw new Error('second org missing after insert')

  await db
    .insert(memberships)
    .values([
      { orgId: org.id, userId: owner.id, role: 'owner' },
      { orgId: org.id, userId: staff.id, role: 'agent' },
      { orgId: second.id, userId: secondOwner.id, role: 'owner' },
    ])
    .onConflictDoNothing()

  await db.insert(superAdmins).values({ userId: admin.id }).onConflictDoNothing()

  await seedCoaching(db, org.id)
  await seedCoaching(db, second.id)

  if (options.passwords) {
    for (const user of [owner, staff, admin, secondOwner]) {
      const [existing] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')))
      if (!existing) {
        await db.insert(accounts).values({
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: await hashPassword(DEMO_PASSWORD),
        })
      }
    }
  }

  return { org, owner, staff, admin, second, secondOwner }
}

/** Courses, batches, bot config and FAQs for one org. Skips anything already there. */
export async function seedCoaching(db: AnyDatabase, orgId: string, today = new Date()) {
  for (const course of DEMO_COURSES) {
    const [existing] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.orgId, orgId), eq(courses.shortName, course.shortName)))
    if (!existing) await db.insert(courses).values({ ...course, orgId })
  }
  const byShortName = new Map(
    (await db.select().from(courses).where(eq(courses.orgId, orgId))).map((c) => [c.shortName, c]),
  )

  for (const b of DEMO_BATCHES) {
    const course = byShortName.get(b.course)
    if (!course) continue
    const [existing] = await db
      .select()
      .from(batches)
      .where(and(eq(batches.orgId, orgId), eq(batches.name, b.name)))
    if (existing) continue
    const start = new Date(today.getTime() + b.startInDays * 86_400_000)
    await db.insert(batches).values({
      orgId,
      courseId: course.id,
      name: b.name,
      days: b.days,
      startTime: b.startTime,
      endTime: b.endTime,
      startDate: start.toISOString().slice(0, 10),
      seatsTotal: b.seatsTotal,
      seatsFilled: b.seatsFilled,
      demoAllowed: b.demoAllowed,
    })
  }

  await db
    .insert(botConfigs)
    .values({ ...DEMO_BOT_CONFIG, orgId })
    .onConflictDoNothing({ target: botConfigs.orgId })

  // FAQs are stored now and embedded by the ingest job once an embedding key is set.
  const [faqSource] = await db
    .select()
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.orgId, orgId), eq(knowledgeSources.title, 'Aam sawaal (demo)')))
  if (!faqSource) {
    const [source] = await db
      .insert(knowledgeSources)
      .values({ orgId, type: 'faq', title: 'Aam sawaal (demo)' })
      .returning()
    await db
      .insert(knowledgeFaqs)
      .values(DEMO_FAQS.map((f) => ({ ...f, orgId, sourceId: source!.id, language: 'hinglish' })))
  }
}

// Run directly: `pnpm db:seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadEnv()
  const { db, close } = createDb(env.DATABASE_URL, { max: 1 })
  try {
    // Demo logins are for local development; production accounts come from invites.
    const passwords = env.NODE_ENV !== 'production'
    const { org, second } = await seed(db, { passwords })
    console.log(
      `Seeded: ${org.name}, ${org.city} and ${second.name}, ${second.city} (${PLANS.length} plans).`,
    )
    if (passwords)
      console.log(
        `Demo logins use the password "${DEMO_PASSWORD}" (e.g. ${DEMO_USERS.owner.email}).`,
      )
  } finally {
    await close()
  }
}
