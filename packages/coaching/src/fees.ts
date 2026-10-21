import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import { feeInstallments, organizations, type AnyDatabase, type FeeRemindersSent } from '@haazir/db'
import { daysBetween, type PaidVia } from '@haazir/shared'
import type { Installment } from './students'

/**
 * Moves unpaid installments along by date (spec §16.7): upcoming → due on the
 * day → overdue after it. Runs in the daily sweep; returns how many changed.
 */
export async function refreshFeeStatuses(db: AnyDatabase, orgId: string, today: string) {
  const open = and(
    eq(feeInstallments.orgId, orgId),
    inArray(feeInstallments.status, ['upcoming', 'due']),
  )
  const toDue = await db
    .update(feeInstallments)
    .set({ status: 'due' })
    .where(and(open, eq(feeInstallments.dueDate, today), ne(feeInstallments.status, 'due')))
    .returning({ id: feeInstallments.id })
  const toOverdue = await db
    .update(feeInstallments)
    .set({ status: 'overdue' })
    .where(and(open, lt(feeInstallments.dueDate, today)))
    .returning({ id: feeInstallments.id })
  return toDue.length + toOverdue.length
}

export type FeeReminderKind = 'upcoming' | 'due' | 'overdue3' | 'overdue7'

/**
 * Which automatic reminder this installment needs today, if any (spec §13):
 * 3 days before, on the day, and 3 and 7 days after. A sweep that missed a
 * day still sends the reminder it skipped, never one twice.
 */
export function feeReminderDue(
  installment: Pick<Installment, 'dueDate' | 'status' | 'remindersSent'>,
  today: string,
): FeeReminderKind | null {
  if (installment.status === 'paid' || installment.status === 'waived') return null
  const days = daysBetween(today, installment.dueDate)
  const sent = installment.remindersSent ?? {}
  if (days <= -7) return sent.overdue7 ? null : 'overdue7'
  if (days <= -3) return sent.overdue3 ? null : 'overdue3'
  if (days === 0) return sent.due ? null : 'due'
  if (days > 0 && days <= 3) return sent.upcoming ? null : 'upcoming'
  return null
}

export async function markReminderSent(
  db: AnyDatabase,
  installmentId: string,
  kind: FeeReminderKind | 'manual',
  at: Date,
) {
  const [row] = await db
    .select({ sent: feeInstallments.remindersSent })
    .from(feeInstallments)
    .where(eq(feeInstallments.id, installmentId))
  const sent: FeeRemindersSent = { ...row?.sent }
  if (kind === 'manual') sent.manual = [...(sent.manual ?? []), at.toISOString()]
  else sent[kind] = at.toISOString()
  await db
    .update(feeInstallments)
    .set({ remindersSent: sent })
    .where(eq(feeInstallments.id, installmentId))
}

/** The next receipt number for the org (R-0001…), taken atomically so two payments never share one. */
export async function nextReceiptNo(db: AnyDatabase, orgId: string) {
  const [row] = await db
    .update(organizations)
    .set({ receiptSeq: sql`${organizations.receiptSeq} + 1` })
    .where(eq(organizations.id, orgId))
    .returning({ seq: organizations.receiptSeq })
  return `R-${String(row!.seq).padStart(4, '0')}`
}

/**
 * Records a payment: Razorpay's webhook, or staff marking "Cash mila". Only
 * the first call for an installment counts (`alreadyPaid` after that), so a
 * webhook redelivery doesn't issue a second receipt or a second thank-you.
 */
export async function recordPayment(
  db: AnyDatabase,
  input: {
    orgId: string
    installmentId: string
    via: PaidVia
    paidAt: Date
    receiptNo?: string | null
  },
): Promise<{ installment: Installment; alreadyPaid: boolean } | null> {
  const [current] = await db
    .select()
    .from(feeInstallments)
    .where(and(eq(feeInstallments.id, input.installmentId), eq(feeInstallments.orgId, input.orgId)))
  if (!current) return null
  if (current.status === 'paid') return { installment: current, alreadyPaid: true }

  const receiptNo = input.receiptNo?.trim() || (await nextReceiptNo(db, input.orgId))
  const [updated] = await db
    .update(feeInstallments)
    .set({ status: 'paid', paidAt: input.paidAt, paidVia: input.via, receiptNo })
    // Two webhooks racing: only the one that flips it from unpaid wins.
    .where(and(eq(feeInstallments.id, current.id), ne(feeInstallments.status, 'paid')))
    .returning()
  if (!updated) {
    const [now] = await db.select().from(feeInstallments).where(eq(feeInstallments.id, current.id))
    return { installment: now!, alreadyPaid: true }
  }
  return { installment: updated, alreadyPaid: false }
}
