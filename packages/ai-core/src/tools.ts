import { tool } from 'ai'
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { batches, courses, feeInstallments, students, type AnyDatabase } from '@haazir/db'
import type { AgentAction } from './actions'
import { formatDate, formatDays, formatTime, rupees } from './facts'
import { longDayLabel } from './flows/calendar'
import { cleanName, daysWithSlots, slotsOn, type FlowContext } from './flows/demo'
import { matchCourse } from './match'

export { matchCourse }

export interface ToolContext {
  db: AnyDatabase
  orgId: string
  /** Today in IST, as YYYY-MM-DD. */
  today: string
  /** Every tool result, verbatim: the only place numbers in a reply may come from. */
  facts: string[]
  toolCalls: { name: string; input: unknown; output: unknown }[]
  handoff: { reason: string; summary: string } | null
  /** Who the bot is talking to; write tools act for this contact only. */
  contactId: string
  /** What the write tools want done, carried out by the worker after the reply. */
  actions: AgentAction[]
  org: {
    name: string
    address: string | null
    mapsUrl: string | null
    hasLocation: boolean
    /** The institute connected Razorpay, so the bot can send fee payment links. */
    paymentsEnabled: boolean
  }
  /** Demo slots, built the same way as the deterministic booking flow. */
  flow: FlowContext
}

function record<T>(ctx: ToolContext, name: string, input: unknown, output: T): T {
  ctx.facts.push(JSON.stringify(output))
  ctx.toolCalls.push({ name, input, output })
  return output
}

async function activeCourses(ctx: ToolContext) {
  return ctx.db
    .select()
    .from(courses)
    .where(and(eq(courses.orgId, ctx.orgId), eq(courses.active, true)))
    .orderBy(asc(courses.sort))
}

async function upcomingBatches(
  ctx: ToolContext,
  courseId: string,
  fromDate: string,
  demoOnly: boolean,
) {
  return ctx.db
    .select()
    .from(batches)
    .where(
      and(
        eq(batches.orgId, ctx.orgId),
        eq(batches.courseId, courseId),
        eq(batches.active, true),
        gte(batches.startDate, fromDate),
        demoOnly ? eq(batches.demoAllowed, true) : undefined,
        sql`${batches.seatsFilled} < ${batches.seatsTotal}`,
      ),
    )
    .orderBy(asc(batches.startDate), asc(batches.startTime))
}

const batchFacts = (b: typeof batches.$inferSelect) => ({
  batch_id: b.id,
  name: b.name,
  days: formatDays(b.days),
  time: `${formatTime(b.startTime)} to ${formatTime(b.endTime)}`,
  starts: formatDate(b.startDate),
  seats_left: b.seatsTotal - b.seatsFilled,
  demo_allowed: b.demoAllowed,
})

/**
 * The bot's tools (spec §11.3). Every query is scoped to the org; errors come
 * back as short text for the model, never stack traces. The "write" tools
 * (book_demo, upsert_lead, send_*) only record an action: the worker carries
 * it out after the reply, so the playground can never book or send anything.
 */
export function createTools(ctx: ToolContext) {
  const notFound = async (name: string, input: unknown, query: string) => {
    const available = (await activeCourses(ctx)).map((c) => c.shortName)
    return record(ctx, name, input, {
      error: `No course matches "${query}".`,
      available_courses: available,
    })
  }

  return {
    get_courses: tool({
      description: "List the institute's active courses with duration and total fee.",
      inputSchema: z.object({}),
      execute: async (input) => {
        const list = await activeCourses(ctx)
        return record(ctx, 'get_courses', input, {
          courses: list.map((c) => ({
            course: c.shortName,
            duration: c.durationText,
            mode: c.mode,
            total_fee: rupees(c.feeTotalPaise),
          })),
        })
      },
    }),

    get_course_details: tool({
      description:
        'Full details of one course: what it covers, duration, mode, total fee, installments, certificate.',
      inputSchema: z.object({ course: z.string().describe('Course name as the person wrote it') }),
      execute: async (input) => {
        const course = matchCourse(await activeCourses(ctx), input.course)
        if (!course) return notFound('get_course_details', input, input.course)
        return record(ctx, 'get_course_details', input, {
          course: course.name,
          short_name: course.shortName,
          description: course.description,
          duration: course.durationText,
          mode: course.mode,
          total_fee: rupees(course.feeTotalPaise),
          installments: course.installmentPlan.map((i) => ({
            label: i.label,
            amount: rupees(i.amountPaise),
            due: i.dueOffsetDays === 0 ? 'at admission' : `${i.dueOffsetDays} days after admission`,
          })),
          certificate: course.certificateText,
        })
      },
    }),

    get_batches: tool({
      description: 'Upcoming batches of a course with days, timings, start date and seats left.',
      inputSchema: z.object({
        course: z.string(),
        from_date: z.string().optional().describe('YYYY-MM-DD; defaults to today'),
      }),
      execute: async (input) => {
        const course = matchCourse(await activeCourses(ctx), input.course)
        if (!course) return notFound('get_batches', input, input.course)
        const list = await upcomingBatches(ctx, course.id, input.from_date ?? ctx.today, false)
        return record(ctx, 'get_batches', input, {
          course: course.shortName,
          batches: list.map(batchFacts),
          ...(list.length
            ? {}
            : { note: 'No upcoming batch with seats. The team will confirm the next one.' }),
        })
      },
    }),

    check_demo_slots: tool({
      description:
        'Free demo class slots for a course over the next 7 days: date, day, time and batch_id to book with.',
      inputSchema: z.object({
        course: z.string(),
        date: z.string().optional().describe('YYYY-MM-DD, if they asked for a particular day'),
      }),
      execute: async (input) => {
        const course = matchCourse(await activeCourses(ctx), input.course)
        if (!course) return notFound('check_demo_slots', input, input.course)
        const days = input.date ? [input.date] : daysWithSlots(ctx.flow, course.id)
        const slots = days.flatMap((date) =>
          slotsOn(ctx.flow, course.id, date).map((b) => ({
            batch_id: b.id,
            date,
            day: longDayLabel(date, ctx.today, ctx.flow.lang),
            time: `${formatTime(b.startTime)} to ${formatTime(b.endTime)}`,
            batch: b.name,
          })),
        )
        return record(ctx, 'check_demo_slots', input, {
          course: course.shortName,
          demo_slots: slots.slice(0, 12),
          ...(slots.length
            ? {}
            : { note: 'No demo slot in the next 7 days. Hand over to the team.' }),
        })
      },
    }),

    book_demo: tool({
      description:
        'Book a free demo class. Only after the person chose a slot from check_demo_slots and gave the student name.',
      inputSchema: z.object({
        batch_id: z.string().describe('batch_id from check_demo_slots'),
        date: z.string().describe('YYYY-MM-DD from check_demo_slots'),
        student_name: z.string(),
      }),
      execute: async (input) => {
        const batch = ctx.flow.batches.find((b) => b.id === input.batch_id)
        const course = ctx.flow.courses.find((c) => c.id === batch?.courseId)
        const name = cleanName(input.student_name) ?? input.student_name.trim().slice(0, 40)
        if (
          !batch ||
          !course ||
          !slotsOn(ctx.flow, course.id, input.date).some((b) => b.id === batch.id)
        ) {
          return record(ctx, 'book_demo', input, {
            booked: false,
            error: 'That slot is not available. Call check_demo_slots and offer its slots.',
          })
        }
        if (!name)
          return record(ctx, 'book_demo', input, {
            booked: false,
            error: 'Ask for the student name first.',
          })
        ctx.actions.push({
          type: 'book_demo',
          courseId: course.id,
          batchId: batch.id,
          date: input.date,
          startTime: batch.startTime,
          studentName: name,
        })
        return record(ctx, 'book_demo', input, {
          booked: true,
          course: course.shortName,
          day: longDayLabel(input.date, ctx.today, ctx.flow.lang),
          time: formatTime(batch.startTime),
          student: name,
          address: ctx.org.address,
          note: 'A reminder goes automatically 3 hours before the class.',
        })
      },
    }),

    upsert_lead: tool({
      description:
        "Save what you learned about this enquiry: the course they want, the student's name, a note for staff.",
      inputSchema: z.object({
        course: z.string().optional(),
        name: z.string().optional().describe("The student's name"),
        notes: z.string().optional().describe('One short line for staff'),
      }),
      execute: async (input) => {
        const course = input.course ? matchCourse(await activeCourses(ctx), input.course) : null
        ctx.actions.push({
          type: 'upsert_lead',
          courseId: course?.id,
          studentName: input.name ? (cleanName(input.name) ?? undefined) : undefined,
          notes: input.notes?.slice(0, 200),
        })
        ctx.toolCalls.push({ name: 'upsert_lead', input, output: 'saved' })
        return 'Saved.'
      },
    }),

    send_brochure: tool({
      description: "Send the course's PDF brochure as a WhatsApp document after your reply.",
      inputSchema: z.object({ course: z.string() }),
      execute: async (input) => {
        const course = matchCourse(await activeCourses(ctx), input.course)
        if (!course) return notFound('send_brochure', input, input.course)
        if (!course.brochureKey) {
          return record(ctx, 'send_brochure', input, {
            sent: false,
            note: 'No brochure uploaded for this course. Share the details from get_course_details instead.',
          })
        }
        ctx.actions.push({ type: 'send_brochure', courseId: course.id })
        return record(ctx, 'send_brochure', input, { sent: true, course: course.shortName })
      },
    }),

    send_location: tool({
      description: "Send the institute's address and map pin after your reply.",
      inputSchema: z.object({}),
      execute: async (input) => {
        if (ctx.org.hasLocation) ctx.actions.push({ type: 'send_location' })
        return record(ctx, 'send_location', input, {
          address: ctx.org.address,
          maps_link: ctx.org.mapsUrl,
          pin_sent: ctx.org.hasLocation,
        })
      },
    }),

    get_my_fee_status: tool({
      description:
        'For an admitted student writing in: their next unpaid installment, and whether a payment link will be sent.',
      inputSchema: z.object({}),
      execute: async (input) => {
        const mine = await ctx.db
          .select({ id: students.id, name: students.name })
          .from(students)
          .where(and(eq(students.orgId, ctx.orgId), eq(students.contactId, ctx.contactId)))
        if (!mine.length) {
          return record(ctx, 'get_my_fee_status', input, {
            student: false,
            note: 'This number is not an admitted student. Hand over if they insist.',
          })
        }
        const open = await ctx.db
          .select()
          .from(feeInstallments)
          .where(
            and(
              eq(feeInstallments.orgId, ctx.orgId),
              inArray(
                feeInstallments.studentId,
                mine.map((m) => m.id),
              ),
              inArray(feeInstallments.status, ['upcoming', 'due', 'overdue']),
            ),
          )
          .orderBy(asc(feeInstallments.dueDate))
        const next = open[0]
        if (!next) {
          return record(ctx, 'get_my_fee_status', input, {
            students: mine.map((m) => m.name),
            all_paid: true,
          })
        }
        const student = mine.find((m) => m.id === next.studentId)!
        if (ctx.org.paymentsEnabled)
          ctx.actions.push({ type: 'send_payment_link', installmentId: next.id })
        return record(ctx, 'get_my_fee_status', input, {
          student: student.name,
          next_installment: next.label,
          amount: rupees(next.amountPaise),
          due: formatDate(next.dueDate),
          status: next.status,
          more_installments_after_this: open.length - 1,
          payment: ctx.org.paymentsEnabled
            ? 'A payment link is sent in a separate message right after your reply.'
            : 'Pay at the institute office.',
        })
      },
    }),

    handoff_to_human: tool({
      description:
        'Hand the chat to a person at the institute. Use when a fact is missing, the person is upset, asks for a human, or asks something sensitive.',
      inputSchema: z.object({
        reason: z.enum(['missing_info', 'upset', 'asked_for_human', 'sensitive', 'other']),
        summary: z
          .string()
          .describe('One line for the staff, e.g. "Hostel ke baare mein poochh rahe hain"'),
      }),
      execute: async (input) => {
        ctx.handoff = { reason: input.reason, summary: input.summary }
        ctx.toolCalls.push({ name: 'handoff_to_human', input, output: 'ok' })
        return 'Handed over. Tell the person the team will reply shortly; do not answer the question yourself.'
      },
    }),
  }
}

export type HaazirTools = ReturnType<typeof createTools>
