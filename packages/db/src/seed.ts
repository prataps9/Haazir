import { pathToFileURL } from 'node:url'
import { hashPassword } from 'better-auth/crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  DEFAULT_META_RATES_IN,
  DEFAULT_TEMPLATES,
  feeStatusOn,
  PRICING_CATEGORIES,
  scheduleInstallments,
  templateKey,
  type CopyLanguage,
} from '@haazir/shared'
import { loadEnv } from '@haazir/shared/env'
import { createDb, type AnyDatabase } from './client'
import {
  accounts,
  batches,
  botConfigs,
  contacts,
  conversations,
  courses,
  demoBookings,
  feeInstallments,
  knowledgeFaqs,
  knowledgeSources,
  leadEvents,
  leads,
  memberships,
  messages,
  metaRates,
  organizations,
  plans,
  students,
  superAdmins,
  templates,
  users,
} from './schema'
import {
  DEMO_BATCHES,
  DEMO_BOT_CONFIG,
  DEMO_CONTACTS,
  DEMO_OPTED_OUT,
  DEMO_COURSES,
  DEMO_FAQS,
  DEMO_LEADS,
  DEMO_ORG,
  DEMO_PASSWORD,
  DEMO_STUDENTS,
  DEMO_THREADS,
  DEMO_USERS,
  PLANS,
  SECOND_ORG,
  SECOND_ORG_OWNER,
} from './seed-data'

/**
 * Idempotent: running it twice leaves the same rows. Grows each phase (courses,
 * contacts, leads, messages…) until it matches the demo institute in spec §8.
 */
export async function seed(
  db: AnyDatabase,
  options: {
    passwords?: boolean
    /** The demo CRM (contacts, chats, leads, students, fees). Off in tests that count rows. */
    crm?: boolean
  } = {},
) {
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
  await seedTemplates(db, org.id)
  await seedTemplates(db, second.id)
  await seedMetaRates(db)
  if (options.crm) await seedCrm(db, org.id)

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

/**
 * The automation templates (spec §13) as drafts, every language variant.
 * Phase 5 submits them to Meta; existing rows are left alone.
 */
/** Meta's India rate card (spec §8 `meta_rates`), as of the date below. */
export const META_RATES_FROM = '2026-07-01'
export async function seedMetaRates(db: AnyDatabase) {
  await db
    .insert(metaRates)
    .values(
      PRICING_CATEGORIES.map((category) => ({
        country: 'IN',
        category,
        priceCentipaise: DEFAULT_META_RATES_IN[category],
        effectiveFrom: META_RATES_FROM,
      })),
    )
    .onConflictDoNothing()
}

export async function seedTemplates(db: AnyDatabase, orgId: string) {
  const rows = DEFAULT_TEMPLATES.flatMap((t) =>
    (['hi', 'hinglish', 'en'] as CopyLanguage[]).map((lang) => {
      const { name, language } = templateKey(t.purpose, lang)
      const components: Record<string, unknown>[] = [{ type: 'BODY', text: t.body[lang] }]
      if (t.buttons)
        components.push({
          type: 'BUTTONS',
          buttons: t.buttons.map((b) => ({ type: 'QUICK_REPLY', text: b.title[lang] })),
        })
      return {
        orgId,
        name,
        language,
        category: t.category,
        components,
        variables: t.variables,
        purpose: t.purpose,
      }
    }),
  )
  // New orgs get every template; existing drafts pick up text changes (they
  // were never submitted, so nothing at Meta refers to them yet).
  for (const row of rows)
    await db
      .insert(templates)
      .values(row)
      .onConflictDoUpdate({
        target: [templates.orgId, templates.name, templates.language],
        set: { components: row.components, variables: row.variables, category: row.category },
        setWhere: sql`${templates.status} = 'draft'`,
      })
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
/** Calendar date in India for a moment, YYYY-MM-DD. */
const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)

/**
 * The demo institute's people (spec §8): contacts with chat history, leads in
 * every stage, booked demos, students and their installments. Skipped when the
 * org already has leads, so re-seeding never duplicates or resets them.
 */
export async function seedCrm(db: AnyDatabase, orgId: string, now = new Date()) {
  if ((await db.$count(leads, eq(leads.orgId, orgId))) > 0) return

  const courseRows = await db.select().from(courses).where(eq(courses.orgId, orgId))
  const batchRows = await db.select().from(batches).where(eq(batches.orgId, orgId))
  const course = (short: string) => courseRows.find((c) => c.shortName === short)
  const batch = (name: string) => batchRows.find((b) => b.name === name)
  const ago = (days: number, minutes = 0) =>
    new Date(now.getTime() - days * 86_400_000 - minutes * 60_000)

  await db
    .insert(contacts)
    .values(
      DEMO_CONTACTS.map((c, i) => ({
        ...c,
        orgId,
        ...(DEMO_OPTED_OUT.has(i)
          ? { optInStatus: 'opted_out' as const, optedOutAt: ago(2) }
          : {
              optInStatus: 'opted_in' as const,
              optInSource: 'whatsapp_inbound',
              optInAt: ago(30),
            }),
        lastInboundAt: ago(i % 7, i * 13),
      })),
    )
    .onConflictDoNothing()
  const contactRows = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.orgId, orgId),
        inArray(
          contacts.waId,
          DEMO_CONTACTS.map((c) => c.waId),
        ),
      ),
    )
  const contactAt = (i: number) => contactRows.find((c) => c.waId === DEMO_CONTACTS[i]!.waId)!

  // Conversations and sample messages.
  for (const thread of DEMO_THREADS) {
    const contact = contactAt(thread.contact)
    const lastAt = ago(thread.contact % 4, thread.contact * 7)
    const [conversation] = await db
      .insert(conversations)
      .values({
        orgId,
        contactId: contact.id,
        lastMessageAt: lastAt,
        lastMessagePreview: thread.lines.at(-1)![1].slice(0, 120),
        unreadCount: thread.lines.at(-1)![0] === 'in' ? 1 : 0,
        serviceWindowExpiresAt: new Date(lastAt.getTime() + 24 * 3_600_000),
      })
      .onConflictDoNothing()
      .returning()
    if (!conversation) continue
    await db.insert(messages).values(
      thread.lines.map(([dir, text], j) => ({
        orgId,
        conversationId: conversation.id,
        direction: dir,
        type: 'text' as const,
        body: text,
        status: dir === 'out' ? ('read' as const) : null,
        sentBy: dir === 'out' ? ('bot' as const) : null,
        createdAt: new Date(lastAt.getTime() - (thread.lines.length - j) * 90_000),
      })),
    )
  }

  // Leads, their timelines, and demos for the ones that booked.
  for (const l of DEMO_LEADS) {
    const contact = contactAt(l.contact)
    const c = course(l.course)
    const created = ago(l.daysAgo, 30)
    const [lead] = await db
      .insert(leads)
      .values({
        orgId,
        contactId: contact.id,
        stage: l.stage,
        source: l.source ?? 'whatsapp',
        courseId: c?.id,
        studentName: contact.name,
        lostReason: l.lostReason,
        valuePaise: c?.feeTotalPaise,
        stageChangedAt: ago(Math.max(0, l.daysAgo - 1)),
        nextFollowupAt: l.stage === 'contacted' ? ago(-1) : null,
        createdAt: created,
      })
      .returning()
    await db.insert(leadEvents).values([
      {
        orgId,
        leadId: lead!.id,
        type: 'created',
        toStage: 'new',
        actor: 'bot',
        createdAt: created,
      },
      ...(l.stage !== 'new'
        ? [
            {
              orgId,
              leadId: lead!.id,
              type: 'stage',
              fromStage: 'new' as const,
              toStage: l.stage,
              actor: 'bot' as const,
              note: l.lostReason ?? null,
              createdAt: ago(Math.max(0, l.daysAgo - 1)),
            },
          ]
        : []),
    ])
    if (l.stage === 'demo_booked' || l.stage === 'demo_done') {
      const b = batchRows.find((x) => x.courseId === c?.id)
      // Booked demos are tomorrow at the batch's time; done ones were two days ago.
      const day = l.stage === 'demo_booked' ? istDate(ago(-1)) : istDate(ago(2))
      const startsAt = new Date(`${day}T${b?.startTime ?? '10:00:00'}+05:30`)
      await db.insert(demoBookings).values({
        orgId,
        leadId: lead!.id,
        contactId: contact.id,
        courseId: c?.id,
        batchId: b?.id,
        studentName: contact.name ?? 'Student',
        startsAt,
        status: l.stage === 'demo_booked' ? 'booked' : 'attended',
        createdAt: ago(Math.max(0, l.daysAgo - 1)),
      })
    }
  }

  // Students and their installments, with statuses as of today.
  const today = istDate(now)
  for (const st of DEMO_STUDENTS) {
    const contact = contactAt(st.contact)
    const c = course(st.course)
    if (!c) continue
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.orgId, orgId), eq(leads.contactId, contact.id)))
    const admissionDate = istDate(ago(st.daysAgo))
    const [student] = await db
      .insert(students)
      .values({
        orgId,
        contactId: contact.id,
        leadId: lead?.id,
        name: contact.name ?? 'Student',
        courseId: c.id,
        batchId: batch(st.batch)?.id,
        admissionDate,
        rollNo: `SCI-${String(st.contact + 100)}`,
      })
      .returning()
    const plan = scheduleInstallments(c.installmentPlan, admissionDate)
    await db.insert(feeInstallments).values(
      plan.map((inst, k) => {
        // The first installment is paid at admission; older students paid a second one too,
        // except two who are behind, so "Overdue" has rows to show.
        const behind = st.contact === 19 || st.contact === 21
        const paid = k === 0 || (k === 1 && st.daysAgo > 60 && !behind)
        const status = paid
          ? 'paid'
          : feeStatusOn({ dueDate: inst.dueDate, status: 'upcoming' }, today)
        return {
          orgId,
          studentId: student!.id,
          ...inst,
          status,
          paidAt: paid ? new Date(`${inst.dueDate}T11:00:00+05:30`) : null,
          paidVia: paid ? ('cash' as const) : null,
          receiptNo: paid ? `R-${String(st.contact * 10 + k).padStart(4, '0')}` : null,
        }
      }),
    )
  }
  await db.update(organizations).set({ receiptSeq: 300 }).where(eq(organizations.id, orgId))
}

// Run directly: `pnpm db:seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadEnv()
  const { db, close } = createDb(env.DATABASE_URL, { max: 1 })
  try {
    // Demo logins are for local development; production accounts come from invites.
    const passwords = env.NODE_ENV !== 'production'
    const { org, second } = await seed(db, { passwords, crm: true })
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
