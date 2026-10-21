import { and, eq, ne } from 'drizzle-orm'
import { demoBookings, leads, type AnyDatabase } from '@haazir/db'
import type { DemoStatus } from '@haazir/shared'
import { ensureLead, moveLead, type Actor } from './leads'

export type DemoBooking = typeof demoBookings.$inferSelect

export const REMINDER_BEFORE_MS = 3 * 60 * 60 * 1000
export const FOLLOWUP_AFTER_MS = 24 * 60 * 60 * 1000

/** "2026-10-22" + "08:00:00" in IST → the UTC instant the class starts. */
export function istInstant(date: string, time: string): Date {
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+05:30`)
}

/**
 * Books a free demo (spec §11.5) and moves the lead to "demo booked". Safe to
 * call twice for the same person and slot: the second call returns the first
 * booking (`created: false`), so a redelivered webhook or a double tap books once.
 */
export async function bookDemo(
  db: AnyDatabase,
  input: {
    orgId: string
    contactId: string
    courseId: string | null
    batchId: string | null
    startsAt: Date
    studentName: string
  } & Actor,
): Promise<{ booking: DemoBooking; created: boolean }> {
  const lead = await ensureLead(db, {
    orgId: input.orgId,
    contactId: input.contactId,
    courseId: input.courseId,
    studentName: input.studentName,
    ...actorOf(input),
  })
  let leadId = lead?.id
  if (!leadId) {
    // Students don't become leads by chatting, but booking a demo of another course is an enquiry.
    await db
      .insert(leads)
      .values({ orgId: input.orgId, contactId: input.contactId, courseId: input.courseId })
      .onConflictDoNothing()
    const [row] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.orgId, input.orgId), eq(leads.contactId, input.contactId)))
    leadId = row!.id
  }

  const [created] = await db
    .insert(demoBookings)
    .values({
      orgId: input.orgId,
      leadId,
      contactId: input.contactId,
      courseId: input.courseId,
      batchId: input.batchId,
      startsAt: input.startsAt,
      studentName: input.studentName,
      bookedBy: input.actor,
    })
    .onConflictDoNothing()
    .returning()
  if (!created) {
    const [existing] = await db
      .select()
      .from(demoBookings)
      .where(
        and(
          eq(demoBookings.contactId, input.contactId),
          eq(demoBookings.startsAt, input.startsAt),
          ne(demoBookings.status, 'cancelled'),
        ),
      )
    return { booking: existing!, created: false }
  }

  await db
    .update(leads)
    .set({ batchId: input.batchId, courseId: input.courseId ?? undefined })
    .where(eq(leads.id, leadId))
  await moveLead(db, {
    orgId: input.orgId,
    leadId,
    to: 'demo_booked',
    type: 'demo_booked',
    onlyForward: input.actor !== 'user',
    note: input.studentName,
    ...actorOf(input),
  })
  return { booking: created, created: true }
}

/** When the reminder (3h before) and the follow-up (a day after) should go, if still ahead. */
export function demoReminderTimes(startsAt: Date, now: Date) {
  const remindAt = new Date(startsAt.getTime() - REMINDER_BEFORE_MS)
  const followupAt = new Date(startsAt.getTime() + FOLLOWUP_AFTER_MS)
  return {
    reminder: startsAt > now ? (remindAt > now ? remindAt : now) : null,
    followup: followupAt > now ? followupAt : null,
  }
}

/**
 * Staff mark the demo (spec §16.3: "Aaye / Nahi aaye"). Attended moves the
 * lead to "demo done"; cancelling leaves the lead where it was.
 */
export async function markDemo(
  db: AnyDatabase,
  input: { orgId: string; demoId: string; status: Exclude<DemoStatus, 'booked'> } & Actor,
): Promise<DemoBooking | null> {
  const [demo] = await db
    .update(demoBookings)
    .set({ status: input.status })
    .where(and(eq(demoBookings.id, input.demoId), eq(demoBookings.orgId, input.orgId)))
    .returning()
  if (!demo) return null
  if (input.status === 'attended') {
    await moveLead(db, {
      orgId: input.orgId,
      leadId: demo.leadId,
      to: 'demo_done',
      type: 'demo_marked',
      onlyForward: true,
      ...actorOf(input),
    })
  }
  return demo
}

const actorOf = (a: Actor): Actor =>
  a.actor === 'user' ? { actor: 'user', actorUserId: a.actorUserId } : { actor: a.actor }

/** The slice of the reminder queue this needs; BullMQ's Queue fits. */
export interface DemoReminderQueue {
  add(
    name: string,
    data: { kind: 'demo_reminder' | 'demo_followup'; orgId: string; bookingId: string },
    opts?: { jobId?: string; delay?: number },
  ): Promise<unknown>
}

/**
 * Queues the reminder (3h before) and the follow-up (a day after) as delayed
 * jobs with ids derived from the booking, so scheduling twice schedules once.
 * The jobs re-check the booking when they run, so a cancelled demo sends nothing.
 */
export async function scheduleDemoReminders(
  db: AnyDatabase,
  queue: DemoReminderQueue,
  booking: DemoBooking,
  now: Date,
) {
  const times = demoReminderTimes(booking.startsAt, now)
  const ids: string[] = []
  for (const [kind, at] of [
    ['demo_reminder', times.reminder],
    ['demo_followup', times.followup],
  ] as const) {
    if (!at) continue
    // BullMQ job ids can't contain ":".
    const jobId = `${kind.replace('_', '-')}-${booking.id}`
    await queue.add(
      kind,
      { kind, orgId: booking.orgId, bookingId: booking.id },
      { jobId, delay: Math.max(0, at.getTime() - now.getTime()) },
    )
    ids.push(jobId)
  }
  await db.update(demoBookings).set({ reminderJobIds: ids }).where(eq(demoBookings.id, booking.id))
  return ids
}
