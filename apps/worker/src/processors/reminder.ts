import { and, eq, inArray, lte } from 'drizzle-orm'
import { formatTime } from '@haazir/ai-core'
import {
  ensurePaymentLink,
  feeReminderDue,
  markReminderSent,
  refreshFeeStatuses,
  type FeeReminderKind,
} from '@haazir/coaching'
import { courses, demoBookings, feeInstallments, leads, organizations, students } from '@haazir/db'
import { announceMessage, quietUntil, sendAutomation, type ReminderJob } from '@haazir/messaging'
import { addDays, formatPaise, type TemplatePurpose } from '@haazir/shared'
import type { Deps } from '../deps'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
const istTime = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16)

/**
 * The `reminder` queue (spec §13): demo reminders and follow-ups (delayed
 * jobs per booking) and the daily fee sweep. Each job re-reads the database
 * before sending, so a demo cancelled or a fee paid in the meantime sends
 * nothing, and a retried job never sends twice.
 */
export async function processReminder(deps: Deps, job: ReminderJob) {
  switch (job.kind) {
    case 'demo_reminder':
      return demoReminder(deps, job.orgId, job.bookingId)
    case 'demo_followup':
      return demoFollowup(deps, job.orgId, job.bookingId)
    case 'fee_sweep':
      return feeSweep(deps, job.orgId)
  }
}

async function demoReminder(deps: Deps, orgId: string, bookingId: string) {
  const now = deps.now()
  const [row] = await deps.db
    .select({ booking: demoBookings, course: courses })
    .from(demoBookings)
    .leftJoin(courses, eq(courses.id, demoBookings.courseId))
    .where(and(eq(demoBookings.id, bookingId), eq(demoBookings.orgId, orgId)))
  if (!row || row.booking.status !== 'booked' || row.booking.startsAt <= now) {
    return { sent: false, reason: 'not_needed' }
  }
  // A 7 AM class reminded at 4 AM wakes people: wait for 8 AM if the class is still ahead then.
  const later = quietUntil(now)
  if (later && later.getTime() < row.booking.startsAt.getTime() - 30 * 60_000) {
    await deps.queues.reminder.add(
      'demo_reminder',
      { kind: 'demo_reminder', orgId, bookingId },
      { jobId: `demo-reminder-${bookingId}-morning`, delay: later.getTime() - now.getTime() },
    )
    return { sent: false, reason: 'quiet_hours' }
  }
  const result = await sendAutomation(
    { db: deps.db, outboundQueue: deps.queues.outbound },
    {
      orgId,
      contactId: row.booking.contactId,
      purpose: 'demo_reminder',
      values: [formatTime(istTime(row.booking.startsAt)), row.course?.shortName ?? 'demo'],
      buttonRef: bookingId,
      urgent: true,
      now,
    },
  )
  if (!result.sent) {
    deps.log.info({ bookingId, reason: result.reason }, 'demo reminder not sent')
    return { sent: false, reason: result.reason }
  }
  await deps.db
    .update(demoBookings)
    .set({ status: 'reminded' })
    .where(eq(demoBookings.id, bookingId))
  await announceMessage(deps.db, deps.events, orgId, result.message.id, 'message:new')
  deps.events.emit(orgId, 'demo:updated', { demoId: bookingId })
  return { sent: true }
}

/** "Demo kaisi lagi?" a day later, only to people who came and haven't joined yet. */
async function demoFollowup(deps: Deps, orgId: string, bookingId: string) {
  const now = deps.now()
  const [row] = await deps.db
    .select({ booking: demoBookings, lead: leads })
    .from(demoBookings)
    .innerJoin(leads, eq(leads.id, demoBookings.leadId))
    .where(and(eq(demoBookings.id, bookingId), eq(demoBookings.orgId, orgId)))
  if (!row || row.booking.status !== 'attended' || row.lead.stage !== 'demo_done') {
    return { sent: false, reason: 'not_needed' }
  }
  const result = await sendAutomation(
    { db: deps.db, outboundQueue: deps.queues.outbound },
    {
      orgId,
      contactId: row.booking.contactId,
      purpose: 'followup',
      values: [row.booking.studentName],
      now,
    },
  )
  if (!result.sent && result.reason === 'quiet_hours' && result.retryAt) {
    await deps.queues.reminder.add(
      'demo_followup',
      { kind: 'demo_followup', orgId, bookingId },
      {
        jobId: `demo-followup-${bookingId}-morning`,
        delay: result.retryAt.getTime() - now.getTime(),
      },
    )
  }
  if (result.sent)
    await announceMessage(deps.db, deps.events, orgId, result.message.id, 'message:new')
  return result.sent ? { sent: true } : { sent: false, reason: result.reason }
}

const PURPOSE: Record<FeeReminderKind, TemplatePurpose> = {
  upcoming: 'fee_upcoming',
  due: 'fee_due',
  overdue3: 'fee_overdue',
  overdue7: 'fee_overdue',
}

/**
 * Once a day (10 AM IST): installments move to due and overdue, and each one
 * gets the reminder it's owed (3 days before, on the day, 3 and 7 days late),
 * with a payment link when the institute has Razorpay connected.
 */
export async function feeSweep(deps: Deps, onlyOrgId?: string) {
  const now = deps.now()
  const today = istDate(now)
  const orgs = await deps.db
    .select({ id: organizations.id })
    .from(organizations)
    .where(onlyOrgId ? eq(organizations.id, onlyOrgId) : eq(organizations.status, 'active'))
  const tally = { sent: 0, skipped: {} as Record<string, number>, statusChanges: 0 }

  for (const org of orgs) {
    tally.statusChanges += await refreshFeeStatuses(deps.db, org.id, today)
    const open = await deps.db
      .select({ inst: feeInstallments, student: students, course: courses })
      .from(feeInstallments)
      .innerJoin(students, eq(students.id, feeInstallments.studentId))
      .leftJoin(courses, eq(courses.id, students.courseId))
      .where(
        and(
          eq(feeInstallments.orgId, org.id),
          inArray(feeInstallments.status, ['upcoming', 'due', 'overdue']),
          lte(feeInstallments.dueDate, addDays(today, 3)),
          eq(students.status, 'active'),
        ),
      )
    for (const { inst, student, course } of open) {
      const kind = feeReminderDue(inst, today)
      if (!kind) continue
      const link = await ensurePaymentLink(deps.db, {
        orgId: org.id,
        installmentId: inst.id,
        encryptionKey: deps.encryptionKey,
        razorpay: deps.razorpay,
      })
      const url = link.ok ? link.url : 'institute office'
      const amount = formatPaise(inst.amountPaise).replace('₹', '')
      const values =
        kind === 'upcoming'
          ? [student.name, course?.shortName ?? '', amount, formatDay(inst.dueDate), url]
          : [student.name, amount, url]
      const result = await sendAutomation(
        { db: deps.db, outboundQueue: deps.queues.outbound },
        { orgId: org.id, contactId: student.contactId, purpose: PURPOSE[kind], values, now },
      )
      if (result.sent) {
        await markReminderSent(deps.db, inst.id, kind, now)
        await announceMessage(deps.db, deps.events, org.id, result.message.id, 'message:new')
        tally.sent++
      } else {
        tally.skipped[result.reason] = (tally.skipped[result.reason] ?? 0) + 1
      }
    }
    deps.events.emit(org.id, 'fee:updated', {})
  }
  deps.log.info({ today, ...tally }, 'fee sweep done')
  return tally
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-10-24" → "24 Oct": short enough for a template variable. */
const formatDay = (iso: string) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
