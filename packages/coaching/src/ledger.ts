import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { demoBookings, feeInstallments, leads, students, type AnyDatabase } from '@haazir/db'
import { addDays } from '@haazir/shared'

/** One IST calendar day (or several) as a UTC range [from, to). */
export function istDays(fromDate: string, days = 1) {
  return {
    from: new Date(`${fromDate}T00:00:00+05:30`),
    to: new Date(`${addDays(fromDate, days)}T00:00:00+05:30`),
  }
}

/**
 * The ledger's four numbers for IST days [startDate, startDate + days):
 * new enquiries, demos booked, admissions (by admission date) and fees
 * received. Home (spec §16.3) and the owner's 8 PM WhatsApp summary (§13)
 * read the same numbers from here.
 */
export async function ledgerNumbers(db: AnyDatabase, orgId: string, startDate: string, days = 1) {
  const r = istDays(startDate, days)
  const inRange = (col: Parameters<typeof gte>[0]) => and(gte(col, r.from), lt(col, r.to))
  const [enquiries, demosBooked, admissions, fees] = await Promise.all([
    db.$count(leads, and(eq(leads.orgId, orgId), inRange(leads.createdAt))),
    db.$count(demoBookings, and(eq(demoBookings.orgId, orgId), inRange(demoBookings.createdAt))),
    // By admission date: a student entered today for last week's admission isn't today's.
    db.$count(
      students,
      and(
        eq(students.orgId, orgId),
        gte(students.admissionDate, startDate),
        lt(students.admissionDate, addDays(startDate, days)),
      ),
    ),
    db
      .select({ total: sql<number>`coalesce(sum(${feeInstallments.amountPaise}), 0)::int` })
      .from(feeInstallments)
      .where(
        and(
          eq(feeInstallments.orgId, orgId),
          eq(feeInstallments.status, 'paid'),
          inRange(feeInstallments.paidAt),
        ),
      ),
  ])
  return { enquiries, demosBooked, admissions, feesCollectedPaise: fees[0]?.total ?? 0 }
}
