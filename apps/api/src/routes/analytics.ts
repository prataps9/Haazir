import { Router } from 'express'
import { and, asc, eq, gte, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm'
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
import { ledgerNumbers } from '@haazir/coaching'
import { ratesOn } from '@haazir/messaging'
import { addDays, costPaise, gstPaise, pricingCategoryOf } from '@haazir/shared'
import { requireRole } from '../auth/middleware'
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

    const [ledger, botReplies, latency, waitingChats, unanswered, demoList, dueSoon] =
      await Promise.all([
        ledgerNumbers(db, org.id, startDate, range === 'week' ? 7 : 1),
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
      ...ledger,
      botReplies,
      avgReplySeconds:
        latency[0]?.avg == null ? null : Math.round(Number(latency[0].avg) / 100) / 10,
      waitingChats: waitingChats[0]?.n ?? 0,
      unansweredCount: unanswered,
      demos: demoList,
      feesDue: dueSoon,
    })
  })

  /**
   * Reports (spec §16.12) for the last 7, 30 or 90 days, ending today (IST).
   * Owners and admins only (spec §19).
   */
  router.get('/analytics/report', requireRole('owner', 'admin'), async (req, res) => {
    const org = orgOf(req)
    const { days } = z
      .object({
        days: z.coerce
          .number()
          .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
          .default(30),
      })
      .parse(req.query)
    const today = istDate(deps.now())
    const startDate = addDays(today, -(days - 1))
    const r = istRange(startDate, days)
    const inRange = (col: Parameters<typeof gte>[0]) => and(gte(col, r.from), lt(col, r.to))
    const istDay = (col: unknown) => sql`to_char(${col} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`

    const [ledger, firstReply, perDay, funnel, topCourses, heat, costRows, rates] =
      await Promise.all([
        ledgerNumbers(db, org.id, startDate, days),
        // Median time from someone's first message in the period to our first answer.
        db.execute(sql`
          select percentile_cont(0.5) within group (order by extract(epoch from (o.created_at - i.created_at))) as median
          from (
            select conversation_id, min(created_at) as created_at from ${messages}
            where org_id = ${org.id} and direction = 'in'
              and created_at >= ${r.from.toISOString()} and created_at < ${r.to.toISOString()}
            group by conversation_id
          ) i
          join lateral (
            select created_at from ${messages} o
            where o.conversation_id = i.conversation_id and o.direction = 'out' and o.created_at >= i.created_at
            order by o.created_at limit 1
          ) o on true`),
        db
          .select({ day: sql<string>`${istDay(leads.createdAt)}`, n: sql<number>`count(*)::int` })
          .from(leads)
          .where(and(eq(leads.orgId, org.id), inRange(leads.createdAt)))
          .groupBy(sql`1`),
        // The cohort: enquiries that started in the period, and how far they got.
        db
          .select({
            enquiries: sql<number>`count(*)::int`,
            demos: sql<number>`(count(*) filter (where ${leads.stage} in ('demo_booked', 'demo_done', 'admitted')
              or exists (select 1 from ${demoBookings} d where d.lead_id = ${leads.id})))::int`,
            admitted: sql<number>`(count(*) filter (where ${leads.stage} = 'admitted'))::int`,
            fromCampaigns: sql<number>`(count(*) filter (where ${leads.source} = 'campaign'))::int`,
          })
          .from(leads)
          .where(and(eq(leads.orgId, org.id), inRange(leads.createdAt))),
        db
          .select({ course: courses.shortName, n: sql<number>`count(*)::int` })
          .from(leads)
          .innerJoin(courses, eq(courses.id, leads.courseId))
          .where(and(eq(leads.orgId, org.id), inRange(leads.createdAt)))
          .groupBy(courses.shortName)
          .orderBy(sql`2 desc`)
          .limit(6),
        // When people write: IST weekday (1 = Monday) × hour.
        db
          .select({
            weekday: sql<number>`extract(isodow from ${messages.createdAt} at time zone 'Asia/Kolkata')::int`,
            hour: sql<number>`extract(hour from ${messages.createdAt} at time zone 'Asia/Kolkata')::int`,
            n: sql<number>`count(*)::int`,
          })
          .from(messages)
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .innerJoin(contacts, eq(contacts.id, conversations.contactId))
          .where(
            and(
              eq(messages.orgId, org.id),
              eq(messages.direction, 'in'),
              inRange(messages.createdAt),
              sql`${contacts.waId} not like 'playground-%'`,
            ),
          )
          .groupBy(sql`1`, sql`2`),
        // What Meta charged, by category: messages it marked billable and delivered.
        db
          .select({
            category: messages.pricingCategory,
            sent: sql<number>`count(*)::int`,
            billable: sql<number>`(count(*) filter (where ${messages.billable} and ${messages.status} in ('delivered', 'read')))::int`,
          })
          .from(messages)
          .where(
            and(
              eq(messages.orgId, org.id),
              eq(messages.direction, 'out'),
              inRange(messages.createdAt),
              isNotNull(messages.pricingCategory),
            ),
          )
          .groupBy(messages.pricingCategory),
        ratesOn(db, today),
      ])

    const counts = new Map(perDay.map((d) => [d.day, d.n]))
    const costs = costRows
      .map((c) => {
        const category = pricingCategoryOf(c.category) ?? 'service'
        return {
          category,
          sent: c.sent,
          billable: c.billable,
          costPaise: costPaise(c.billable, rates[category]),
        }
      })
      .sort((a, b) => b.costPaise - a.costPaise || b.sent - a.sent)
    const messageCostPaise = costs.reduce((sum, c) => sum + c.costPaise, 0)
    const cohort = funnel[0] ?? { enquiries: 0, demos: 0, admitted: 0, fromCampaigns: 0 }
    const median = (firstReply as unknown as { rows: { median: number | string | null }[] }).rows[0]
      ?.median

    res.json({
      days,
      from: startDate,
      to: today,
      tiles: {
        ...ledger,
        medianFirstReplySeconds: median == null ? null : Math.round(Number(median)),
        conversionPercent: cohort.enquiries
          ? Math.round((cohort.admitted / cohort.enquiries) * 1000) / 10
          : null,
        messageCostPaise,
        messageGstPaise: gstPaise(messageCostPaise),
      },
      enquiriesPerDay: Array.from({ length: days }, (_, i) => {
        const day = addDays(startDate, i)
        return { day, n: counts.get(day) ?? 0 }
      }),
      funnel: cohort,
      topCourses,
      heatmap: heat,
      costs,
    })
  })

  return router
}
