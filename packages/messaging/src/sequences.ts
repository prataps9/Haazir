import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import {
  contacts,
  conversations,
  demoBookings,
  leads,
  sequenceEnrollments,
  sequenceSteps,
  sequences,
  templates,
  type AnyDatabase,
} from '@haazir/db'
import {
  partsOf,
  SEQUENCE_VARIABLES,
  variableCount,
  type SequenceTrigger,
  type TemplateCategory,
} from '@haazir/shared'
import { sendAutomation } from './automation'
import type { JobQueue, OutboundJob } from './queue'
import { ratesOn } from './rates'

type Template = typeof templates.$inferSelect
type Step = typeof sequenceSteps.$inferSelect
type Enrollment = typeof sequenceEnrollments.$inferSelect

const HOUR_MS = 60 * 60 * 1000
/** One sweep sends at most this many per institute; the rest wait an hour. */
const SWEEP_LIMIT = 200

export type StopReason =
  | 'replied'
  | 'admitted'
  | 'lost'
  | 'opted_out'
  | 'no_consent'
  | 'staff'
  | 'demo_booked'
  | 'no_template'

/**
 * Whether a sequence can fill every blank of this template for one person.
 * It knows a name, a course and a batch; a template that needs a date, an
 * amount or a link belongs to a reminder, not a sequence.
 */
export function sequenceCanFill(template: Pick<Template, 'variables' | 'components'>): boolean {
  if (template.variables.length < variableCount(partsOf(template.components).body)) return false
  return template.variables.every((v) => v in SEQUENCE_VARIABLES)
}

/** {{1}}, {{2}}… of a step's template for one person. Unknown values fall back to plain words. */
export function sequenceValues(
  template: Pick<Template, 'variables'>,
  who: { name: string | null; course: string | null; batch: string | null },
): string[] {
  return template.variables.map((v) => {
    const kind = SEQUENCE_VARIABLES[v as keyof typeof SEQUENCE_VARIABLES]
    const value = kind === 'contact_name' ? who.name : kind === 'course' ? who.course : who.batch
    return (
      value?.trim() || (kind === 'contact_name' ? 'ji' : kind === 'course' ? 'course' : 'batch')
    )
  })
}

/**
 * The most a sequence can cost per lead: every step charged at Meta's rate
 * for its template's category. A step that lands inside the person's 24-hour
 * window goes as a free message, so the real figure is often lower.
 */
export async function sequenceMaxCostPaise(
  db: AnyDatabase,
  categories: TemplateCategory[],
  day: string,
) {
  const rates = await ratesOn(db, day)
  // Rates are centipaise: total first, then round to paise once.
  return Math.round(categories.reduce((sum, c) => sum + rates[c], 0) / 100)
}

/**
 * Puts leads that have just reached a trigger into its sequence. Only leads
 * that reach it after the sequence was switched on, only one active sequence
 * per lead, and never the same sequence twice.
 */
export async function enrollInSequences(db: AnyDatabase, orgId: string) {
  const active = await db
    .select()
    .from(sequences)
    .where(and(eq(sequences.orgId, orgId), eq(sequences.enabled, true)))
  let enrolled = 0
  for (const seq of active) {
    if (!seq.enabledAt) continue
    const [first] = await db
      .select()
      .from(sequenceSteps)
      .where(and(eq(sequenceSteps.sequenceId, seq.id), eq(sequenceSteps.orgId, orgId)))
      .orderBy(asc(sequenceSteps.position))
      .limit(1)
    if (!first) continue

    const since = seq.enabledAt.toISOString()
    const candidates = await candidatesFor(db, orgId, seq.trigger, since)
    for (const c of candidates) {
      const inserted = await db
        .insert(sequenceEnrollments)
        .values({
          orgId,
          sequenceId: seq.id,
          leadId: c.leadId,
          contactId: c.contactId,
          baseAt: c.baseAt,
          nextPosition: first.position,
          nextRunAt: new Date(c.baseAt.getTime() + first.delayHours * HOUR_MS),
        })
        .onConflictDoNothing()
        .returning({ id: sequenceEnrollments.id })
      enrolled += inserted.length
    }
  }
  return enrolled
}

/** Leads at a trigger, not yet in this sequence and not in the middle of another. */
async function candidatesFor(
  db: AnyDatabase,
  orgId: string,
  trigger: SequenceTrigger,
  since: string,
): Promise<{ leadId: string; contactId: string; baseAt: Date }[]> {
  const free = sql`not exists (select 1 from sequence_enrollments e
    where e.lead_id = "leads"."id" and e.org_id = ${orgId}
      and (e.status = 'active' or e.sequence_id = (
        select s.id from sequences s where s.org_id = ${orgId} and s.trigger = ${trigger})))`

  if (trigger === 'no_demo') {
    const rows = await db
      .select({ leadId: leads.id, contactId: leads.contactId, baseAt: leads.createdAt })
      .from(leads)
      .where(
        and(
          eq(leads.orgId, orgId),
          inArray(leads.stage, ['new', 'contacted']),
          sql`"leads"."created_at" >= ${since}::timestamptz`,
          sql`not exists (select 1 from demo_bookings d
            where d.contact_id = "leads"."contact_id" and d.org_id = ${orgId})`,
          free,
        ),
      )
      .limit(SWEEP_LIMIT)
    return rows
  }

  const status = trigger === 'demo_missed' ? 'no_show' : 'attended'
  const rows = await db
    .select({
      leadId: leads.id,
      contactId: leads.contactId,
      baseAt: sql<Date>`max(${demoBookings.startsAt})`.mapWith(demoBookings.startsAt),
    })
    .from(demoBookings)
    .innerJoin(
      leads,
      and(eq(leads.contactId, demoBookings.contactId), eq(leads.orgId, demoBookings.orgId)),
    )
    .where(
      and(
        eq(demoBookings.orgId, orgId),
        eq(demoBookings.status, status),
        sql`${demoBookings.startsAt} >= ${since}::timestamptz`,
        sql`"leads"."stage" not in ('admitted', 'lost')`,
        free,
      ),
    )
    .groupBy(leads.id, leads.contactId)
    .limit(SWEEP_LIMIT)
  return rows
}

/**
 * Sends the steps that are due. Before each one it checks again that the
 * lead still wants it: a reply, a booking, an admission, a STOP or staff
 * taking the chat ends the sequence. Idempotent: the step is advanced in the
 * same pass that sends it, and a held or failed send is simply due again.
 */
export async function runSequences(
  deps: { db: AnyDatabase; outboundQueue: JobQueue<OutboundJob> },
  orgId: string,
  now: Date,
  opts: { ignoreQuietHours?: boolean } = {},
) {
  const { db } = deps
  const due = await db
    .select({
      enrollment: sequenceEnrollments,
      trigger: sequences.trigger,
      stage: leads.stage,
      courseName: sql<
        string | null
      >`(select c.short_name from courses c where c.id = "leads"."course_id")`,
      batchName: sql<string | null>`(select b.name from batches b where b.id = "leads"."batch_id")`,
      studentName: leads.studentName,
      contact: contacts,
      mode: conversations.mode,
      humanUntil: conversations.humanUntil,
    })
    .from(sequenceEnrollments)
    .innerJoin(sequences, eq(sequences.id, sequenceEnrollments.sequenceId))
    .innerJoin(leads, eq(leads.id, sequenceEnrollments.leadId))
    .innerJoin(contacts, eq(contacts.id, sequenceEnrollments.contactId))
    .leftJoin(
      conversations,
      and(eq(conversations.contactId, contacts.id), eq(conversations.orgId, orgId)),
    )
    .where(
      and(
        eq(sequenceEnrollments.orgId, orgId),
        eq(sequenceEnrollments.status, 'active'),
        lte(sequenceEnrollments.nextRunAt, now),
        // A sequence switched off waits where it is.
        eq(sequences.enabled, true),
      ),
    )
    .orderBy(asc(sequenceEnrollments.nextRunAt))
    .limit(SWEEP_LIMIT)

  const tally = { sent: 0, stopped: 0, done: 0, held: 0, messageIds: [] as string[] }
  for (const row of due) {
    const e = row.enrollment
    const stop = async (reason: StopReason) => {
      await db
        .update(sequenceEnrollments)
        .set({ status: 'stopped', stopReason: reason, nextRunAt: null })
        .where(eq(sequenceEnrollments.id, e.id))
      tally.stopped++
    }

    const reason = await whyStop(db, orgId, now, row)
    if (reason) {
      await stop(reason)
      continue
    }

    const steps = await db
      .select()
      .from(sequenceSteps)
      .where(and(eq(sequenceSteps.sequenceId, e.sequenceId), eq(sequenceSteps.orgId, orgId)))
      .orderBy(asc(sequenceSteps.position))
    const step = steps.find((s) => s.position >= e.nextPosition)
    if (!step) {
      await finish(db, e)
      tally.done++
      continue
    }
    const [template] = step.templateId
      ? await db
          .select()
          .from(templates)
          .where(and(eq(templates.id, step.templateId), eq(templates.orgId, orgId)))
      : []
    if (!template || !sequenceCanFill(template)) {
      await stop('no_template')
      continue
    }

    const result = await sendAutomation(deps, {
      orgId,
      contactId: e.contactId,
      purpose: 'custom',
      templateId: template.id,
      values: sequenceValues(template, {
        name: row.studentName ?? row.contact.name ?? row.contact.profileName,
        course: row.courseName,
        batch: row.batchName,
      }),
      urgent: opts.ignoreQuietHours,
      sentBy: 'reminder',
      now,
    })
    if (!result.sent) {
      if (result.reason === 'opted_out') await stop('opted_out')
      else if (result.reason === 'no_template') await stop('no_template')
      // Night, or no number connected yet: due again at the next sweep.
      else tally.held++
      continue
    }

    tally.sent++
    tally.messageIds.push(result.message.id)
    const next = nextStep(steps, step)
    if (!next) {
      await finish(db, e, now)
      tally.done++
    } else {
      await db
        .update(sequenceEnrollments)
        .set({
          lastSentAt: now,
          nextPosition: next.position,
          // Timed from the trigger, but never sooner than an hour after this one.
          nextRunAt: new Date(
            Math.max(e.baseAt.getTime() + next.delayHours * HOUR_MS, now.getTime() + HOUR_MS),
          ),
        })
        .where(eq(sequenceEnrollments.id, e.id))
    }
  }
  return tally
}

const nextStep = (steps: Step[], after: Step) => steps.find((s) => s.position > after.position)

async function finish(db: AnyDatabase, e: Enrollment, sentAt?: Date) {
  await db
    .update(sequenceEnrollments)
    .set({ status: 'done', nextRunAt: null, ...(sentAt ? { lastSentAt: sentAt } : {}) })
    .where(eq(sequenceEnrollments.id, e.id))
}

/** The reason this lead should get no more of the sequence, if there is one. */
async function whyStop(
  db: AnyDatabase,
  orgId: string,
  now: Date,
  row: {
    enrollment: Enrollment
    trigger: SequenceTrigger
    stage: string
    contact: typeof contacts.$inferSelect
    mode: string | null
    humanUntil: Date | null
  },
): Promise<StopReason | null> {
  const e = row.enrollment
  if (row.stage === 'admitted') return 'admitted'
  if (row.stage === 'lost') return 'lost'
  if (row.contact.optInStatus === 'opted_out') return 'opted_out'
  // These are promotional messages: only for people who said yes to updates.
  if (row.contact.optInStatus !== 'opted_in') return 'no_consent'
  if (row.mode === 'human' && (!row.humanUntil || row.humanUntil > now)) return 'staff'
  // They answered a step: a person (or the bot) carries on from here.
  if (e.lastSentAt && row.contact.lastInboundAt && row.contact.lastInboundAt > e.lastSentAt)
    return 'replied'

  if (row.trigger !== 'demo_no_admission') {
    // Chasing a booking: stop once there is one (after the missed class, for demo_missed).
    const booked = await db.$count(
      demoBookings,
      and(
        eq(demoBookings.orgId, orgId),
        eq(demoBookings.contactId, e.contactId),
        row.trigger === 'demo_missed'
          ? sql`${demoBookings.startsAt} > ${e.baseAt.toISOString()}::timestamptz
              and ${demoBookings.status} <> 'cancelled'`
          : undefined,
      ),
    )
    if (booked > 0) return 'demo_booked'
  }
  return null
}
