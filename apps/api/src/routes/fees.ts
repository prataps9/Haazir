import { Router } from 'express'
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ensurePaymentLink, markReminderSent, recordPayment } from '@haazir/coaching'
import { contacts, conversations, courses, feeInstallments, students } from '@haazir/db'
import { announceMessage, sendAutomation, type AutomationResult } from '@haazir/messaging'
import { AppError, FEE_STATUSES, formatPaise, type TemplatePurpose } from '@haazir/shared'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { audit, orgOf, uuidParam } from '../lib/http'
import { istDate, monthRange } from '../lib/time'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDay = (iso: string) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
const rupees = (paise: number) => formatPaise(paise).replace('₹', '')

const feeView = {
  id: feeInstallments.id,
  label: feeInstallments.label,
  dueDate: feeInstallments.dueDate,
  amountPaise: feeInstallments.amountPaise,
  status: feeInstallments.status,
  paymentLinkUrl: feeInstallments.paymentLinkUrl,
  paidAt: feeInstallments.paidAt,
  paidVia: feeInstallments.paidVia,
  receiptNo: feeInstallments.receiptNo,
  remindersSent: feeInstallments.remindersSent,
  student: { id: students.id, name: students.name, contactId: students.contactId },
  courseName: courses.shortName,
  waId: contacts.waId,
  windowOpenUntil: conversations.serviceWindowExpiresAt,
}

/** Fees (spec §16.7): what's due, what came in, and the nudges in between. */
export function feesRouter(
  deps: Pick<AppDeps, 'db' | 'queues' | 'events' | 'encryptionKey' | 'razorpay' | 'now'>,
) {
  const { db } = deps
  const router = Router()

  const query = () =>
    db
      .select(feeView)
      .from(feeInstallments)
      .innerJoin(students, eq(students.id, feeInstallments.studentId))
      .innerJoin(contacts, eq(contacts.id, students.contactId))
      .leftJoin(courses, eq(courses.id, students.courseId))
      .leftJoin(
        conversations,
        and(
          eq(conversations.contactId, students.contactId),
          eq(conversations.orgId, feeInstallments.orgId),
        ),
      )

  router.get('/fees', async (req, res) => {
    const org = orgOf(req)
    const today = istDate(deps.now())
    const { status, month, student } = z
      .object({
        status: z.enum([...FEE_STATUSES, 'open', 'all']).default('open'),
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
        student: z.uuid().optional(),
      })
      .parse(req.query)
    const m = monthRange(month ?? today.slice(0, 7))
    const rows = await query()
      .where(
        and(
          eq(feeInstallments.orgId, org.id),
          student ? eq(feeInstallments.studentId, student) : undefined,
          status === 'open'
            ? inArray(feeInstallments.status, ['upcoming', 'due', 'overdue'])
            : status === 'all'
              ? undefined
              : eq(feeInstallments.status, status),
          // A month picks installments due in it; overdue ones show whatever their month.
          month && status !== 'overdue'
            ? and(gte(feeInstallments.dueDate, m.start), lt(feeInstallments.dueDate, m.next))
            : undefined,
        ),
      )
      .orderBy(asc(feeInstallments.dueDate))
      .limit(2000)

    const sum = (where: ReturnType<typeof and>) =>
      db
        .select({ total: sql<number>`coalesce(sum(${feeInstallments.amountPaise}), 0)::int` })
        .from(feeInstallments)
        .where(and(eq(feeInstallments.orgId, org.id), where))
        .then((r) => r[0]?.total ?? 0)
    const thisMonth = monthRange(today.slice(0, 7))
    const [dueThisMonth, collectedThisMonth, overdue] = await Promise.all([
      sum(
        and(
          inArray(feeInstallments.status, ['upcoming', 'due', 'overdue']),
          gte(feeInstallments.dueDate, thisMonth.start),
          lt(feeInstallments.dueDate, thisMonth.next),
        ),
      ),
      sum(
        and(
          eq(feeInstallments.status, 'paid'),
          gte(feeInstallments.paidAt, new Date(`${thisMonth.start}T00:00:00+05:30`)),
          lt(feeInstallments.paidAt, new Date(`${thisMonth.next}T00:00:00+05:30`)),
        ),
      ),
      sum(eq(feeInstallments.status, 'overdue')),
    ])
    res.json({
      fees: rows,
      summary: {
        dueThisMonthPaise: dueThisMonth,
        collectedThisMonthPaise: collectedThisMonth,
        overduePaise: overdue,
      },
    })
  })

  const own = async (orgId: string, id: string) => {
    const [row] = await query().where(
      and(eq(feeInstallments.id, id), eq(feeInstallments.orgId, orgId)),
    )
    if (!row) throw new AppError('NOT_FOUND', 'Installment not found')
    return row
  }

  /** The message for this installment: upcoming, due today, or overdue (spec §13 texts). */
  async function remind(
    orgId: string,
    id: string,
  ): Promise<AutomationResult & { link: string | null }> {
    const fee = await own(orgId, id)
    if (fee.status === 'paid' || fee.status === 'waived')
      throw new AppError('VALIDATION', 'Already paid')
    const link = await ensurePaymentLink(db, {
      orgId,
      installmentId: id,
      encryptionKey: deps.encryptionKey,
      razorpay: deps.razorpay,
    })
    const url = link.ok ? link.url : 'institute office'
    const purpose: TemplatePurpose =
      fee.status === 'upcoming' ? 'fee_upcoming' : fee.status === 'due' ? 'fee_due' : 'fee_overdue'
    const values =
      purpose === 'fee_upcoming'
        ? [
            fee.student.name,
            fee.courseName ?? '',
            rupees(fee.amountPaise),
            shortDay(fee.dueDate),
            url,
          ]
        : [fee.student.name, rupees(fee.amountPaise), url]
    const result = await sendAutomation(
      { db, outboundQueue: deps.queues.outbound },
      // Staff pressed the button: they decided it's a good time, so no quiet-hours hold.
      {
        orgId,
        contactId: fee.student.contactId,
        purpose,
        values,
        urgent: true,
        sentBy: 'system',
        now: deps.now(),
      },
    )
    if (result.sent) {
      await markReminderSent(db, id, 'manual', deps.now())
      await announceMessage(db, deps.events, orgId, result.message.id, 'message:new')
    }
    return { ...result, link: link.ok ? link.url : null }
  }

  const sendResult = (r: AutomationResult & { link: string | null }) =>
    r.sent ? { sent: true, link: r.link } : { sent: false, reason: r.reason, link: r.link }

  /** "Link bhejein": make (or reuse) the Razorpay link and send it. */
  router.post('/fees/:id/link', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const { send } = z.object({ send: z.boolean().default(true) }).parse(req.body ?? {})
    if (!send) {
      const link = await ensurePaymentLink(db, {
        orgId: org.id,
        installmentId: id,
        encryptionKey: deps.encryptionKey,
        razorpay: deps.razorpay,
      })
      if (!link.ok && link.reason === 'not_found')
        throw new AppError('NOT_FOUND', 'Installment not found')
      if (!link.ok)
        throw new AppError(
          link.reason === 'no_account' ? 'VALIDATION' : 'UNAVAILABLE',
          link.reason === 'no_account'
            ? 'Connect Razorpay in Settings first'
            : (link.message ?? 'Could not make a link'),
        )
      deps.events.emit(org.id, 'fee:updated', { installmentId: id })
      return void res.json({ link: link.url })
    }
    const result = await remind(org.id, id)
    deps.events.emit(org.id, 'fee:updated', { installmentId: id })
    res.json(sendResult(result))
  })

  router.post('/fees/:id/remind', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const result = await remind(org.id, id)
    res.json(sendResult(result))
  })

  /** "Sab overdue ko reminder bhejein": one confirm, then each gets the overdue message. */
  router.post('/fees/remind-overdue', async (req, res) => {
    const org = orgOf(req)
    const { dryRun } = z.object({ dryRun: z.boolean().default(false) }).parse(req.body ?? {})
    const overdue = await query().where(
      and(eq(feeInstallments.orgId, org.id), eq(feeInstallments.status, 'overdue')),
    )
    const now = deps.now()
    // Outside the 24h window each one is a paid utility template (spec §16.7: estimate before sending).
    const needsTemplate = overdue.filter(
      (f) => !f.windowOpenUntil || f.windowOpenUntil <= now,
    ).length
    if (dryRun)
      return void res.json({
        count: overdue.length,
        needsTemplate,
        inWindow: overdue.length - needsTemplate,
      })
    const tally = { sent: 0, skipped: {} as Record<string, number> }
    for (const fee of overdue) {
      const r = await remind(org.id, fee.id)
      if (r.sent) tally.sent++
      else tally.skipped[r.reason] = (tally.skipped[r.reason] ?? 0) + 1
    }
    await audit(db, req, { action: 'fees.bulk_reminder', entity: 'fee_installment', diff: tally })
    deps.events.emit(org.id, 'fee:updated', {})
    res.json(tally)
  })

  /** "Cash mila": paid at the desk; the receipt goes out on WhatsApp all the same. */
  router.post('/fees/:id/mark-paid', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const body = z
      .object({
        via: z.enum(['cash', 'upi_manual', 'bank']),
        receiptNo: z.string().trim().max(30).optional(),
        paidAt: z.iso.datetime().optional(),
        notify: z.boolean().default(true),
      })
      .parse(req.body)
    const fee = await own(org.id, id)
    const result = await recordPayment(db, {
      orgId: org.id,
      installmentId: id,
      via: body.via,
      paidAt: body.paidAt ? new Date(body.paidAt) : deps.now(),
      receiptNo: body.receiptNo,
    })
    if (!result) throw new AppError('NOT_FOUND', 'Installment not found')
    if (result.alreadyPaid) throw new AppError('VALIDATION', 'This installment is already paid')
    if (body.notify) {
      const sent = await sendAutomation(
        { db, outboundQueue: deps.queues.outbound },
        {
          orgId: org.id,
          contactId: fee.student.contactId,
          purpose: 'payment_received',
          values: [rupees(result.installment.amountPaise), result.installment.receiptNo!],
          urgent: true,
          sentBy: 'system',
          now: deps.now(),
        },
      )
      if (sent.sent) await announceMessage(db, deps.events, org.id, sent.message.id, 'message:new')
    }
    await audit(db, req, {
      action: 'fee.paid',
      entity: 'fee_installment',
      entityId: id,
      diff: { via: body.via, receiptNo: result.installment.receiptNo },
    })
    deps.events.emit(org.id, 'fee:updated', { installmentId: id })
    res.json(await own(org.id, id))
  })

  router.post('/fees/:id/waive', requireRole('owner', 'admin'), async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const fee = await own(org.id, id)
    if (fee.status === 'paid') throw new AppError('VALIDATION', 'This installment is already paid')
    await db.update(feeInstallments).set({ status: 'waived' }).where(eq(feeInstallments.id, id))
    await audit(db, req, { action: 'fee.waived', entity: 'fee_installment', entityId: id })
    deps.events.emit(org.id, 'fee:updated', { installmentId: id })
    res.json(await own(org.id, id))
  })

  return router
}
