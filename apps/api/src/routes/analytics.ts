import { Router } from 'express'
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  aiTraces,
  batches,
  contacts,
  conversations,
  courses,
  demoBookings,
  feeInstallments,
  leads,
  messages,
  students,
  unansweredQuestions,
} from '@haazir/db'
import { addDays } from '@haazir/shared'
import type { AppDeps } from '../deps'
import { orgOf } from '../lib/http'
import { istDate, istRange } from '../lib/time'

/**
 * Home, "Aaj ka hisaab" (spec §16.3): the day's ledger in one call.
 * `range`: today, yesterday ("kal" in a ledger looks back) or the last 7 days.
 */
export function analyticsRouter(deps: Pick<AppDeps, 'db' | 'now'>) {
  const { db } = deps
  const router = Router()

  router.get('/analytics/summary', async (req, res) => {
    const org = orgOf(req)
    const { range } = z
      .object({ range: z.enum(['today', 'yesterday', 'week']).default('today') })
      .parse(req.query)
    const today = istDate(deps.now())
    const startDate =
      range === 'today' ? today : range === 'yesterday' ? addDays(today, -1) : addDays(today, -6)
    const r = istRange(startDate, range === 'week' ? 7 : 1)
    const inRange = (col: Parameters<typeof gte>[0]) => and(gte(col, r.from), lt(col, r.to))

    const count = (
      table: Parameters<typeof db.$count>[0],
      where: Parameters<typeof db.$count>[1],
    ) => db.$count(table, where)

    const [
      enquiries,
      botReplies,
      latency,
      demosBooked,
      admissions,
      fees,
      waitingChats,
      unanswered,
      demoList,
      dueSoon,
    ] = await Promise.all([
      count(leads, and(eq(leads.orgId, org.id), inRange(leads.createdAt))),
      count(
        messages,
        and(
          eq(messages.orgId, org.id),
          eq(messages.direction, 'out'),
          eq(messages.sentBy, 'bot'),
          inRange(messages.createdAt),
        ),
      ),
      db
        .select({ avg: sql<number | null>`avg(${aiTraces.latencyMs})` })
        .from(aiTraces)
        .where(and(eq(aiTraces.orgId, org.id), inRange(aiTraces.createdAt))),
      count(demoBookings, and(eq(demoBookings.orgId, org.id), inRange(demoBookings.createdAt))),
      count(students, and(eq(students.orgId, org.id), inRange(students.createdAt))),
      db
        .select({ total: sql<number>`coalesce(sum(${feeInstallments.amountPaise}), 0)::int` })
        .from(feeInstallments)
        .where(
          and(
            eq(feeInstallments.orgId, org.id),
            eq(feeInstallments.status, 'paid'),
            inRange(feeInstallments.paidAt),
          ),
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(conversations)
        .innerJoin(contacts, eq(contacts.id, conversations.contactId))
        .where(
          and(
            eq(conversations.orgId, org.id),
            eq(conversations.mode, 'human'),
            sql`${contacts.waId} not like 'playground-%'`,
          ),
        ),
      count(
        unansweredQuestions,
        and(eq(unansweredQuestions.orgId, org.id), eq(unansweredQuestions.resolved, false)),
      ),
      // The day's demo classes (today, or the day looked at), for "Aaye / Nahi aaye".
      db
        .select({
          id: demoBookings.id,
          startsAt: demoBookings.startsAt,
          status: demoBookings.status,
          studentName: demoBookings.studentName,
          courseName: courses.shortName,
          batchName: batches.name,
          conversationId: conversations.id,
        })
        .from(demoBookings)
        .leftJoin(courses, eq(courses.id, demoBookings.courseId))
        .leftJoin(batches, eq(batches.id, demoBookings.batchId))
        .leftJoin(
          conversations,
          and(
            eq(conversations.contactId, demoBookings.contactId),
            eq(conversations.orgId, demoBookings.orgId),
          ),
        )
        .where(
          and(
            eq(demoBookings.orgId, org.id),
            inArray(demoBookings.status, ['booked', 'reminded', 'attended', 'no_show']),
            ...(() => {
              const day = istRange(range === 'yesterday' ? addDays(today, -1) : today)
              return [gte(demoBookings.startsAt, day.from), lt(demoBookings.startsAt, day.to)]
            })(),
          ),
        )
        .orderBy(asc(demoBookings.startsAt)),
      // Fees due this week (and anything already late), most urgent first.
      db
        .select({
          id: feeInstallments.id,
          label: feeInstallments.label,
          dueDate: feeInstallments.dueDate,
          amountPaise: feeInstallments.amountPaise,
          status: feeInstallments.status,
          studentName: students.name,
          courseName: courses.shortName,
        })
        .from(feeInstallments)
        .innerJoin(students, eq(students.id, feeInstallments.studentId))
        .leftJoin(courses, eq(courses.id, students.courseId))
        .where(
          and(
            eq(feeInstallments.orgId, org.id),
            inArray(feeInstallments.status, ['upcoming', 'due', 'overdue']),
            lte(feeInstallments.dueDate, addDays(today, 7)),
          ),
        )
        .orderBy(asc(feeInstallments.dueDate))
        .limit(5),
    ])

    res.json({
      range,
      from: startDate,
      today,
      enquiries,
      botReplies,
      avgReplySeconds:
        latency[0]?.avg == null ? null : Math.round(Number(latency[0].avg) / 100) / 10,
      demosBooked,
      admissions,
      feesCollectedPaise: fees[0]?.total ?? 0,
      waitingChats: waitingChats[0]?.n ?? 0,
      unansweredCount: unanswered,
      demos: demoList,
      feesDue: dueSoon,
    })
  })

  return router
}
