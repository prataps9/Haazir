import { and, eq } from 'drizzle-orm'
import { fillCopy, FLOW, formatTime, longDayLabel, type AgentAction } from '@haazir/ai-core'
import {
  bookDemo,
  ensureLead,
  ensurePaymentLink,
  istInstant,
  scheduleDemoReminders,
} from '@haazir/coaching'
import {
  contacts,
  courses,
  demoBookings,
  feeInstallments,
  leadEvents,
  organizations,
  students,
} from '@haazir/db'
import { announceMessage, copyLanguage, notifyOrg, queueOutbound } from '@haazir/messaging'
import { AppError, formatPaise } from '@haazir/shared'
import type { OutboundContent } from '@haazir/whatsapp'
import type { Deps } from './deps'

interface Turn {
  orgId: string
  conversationId: string
  contactId: string
  /** The inbound message this answers; follow-up sends hang off it. */
  messageId: string
}

/**
 * Carries out what the agent decided besides its reply (spec §11.3): books
 * the demo and schedules its reminders, updates the lead, sends the brochure,
 * the map pin or a payment link. Each action stands alone: one failing (no
 * brochure file, Razorpay down) never stops the others or the reply.
 */
export async function applyActions(deps: Deps, turn: Turn, actions: AgentAction[]) {
  const done: string[] = []
  for (const action of actions) {
    try {
      await apply(deps, turn, action)
      done.push(action.type)
    } catch (err) {
      deps.log.warn(
        { action: action.type, conversationId: turn.conversationId, err: (err as Error).message },
        'agent action failed',
      )
    }
  }
  return done
}

async function apply(deps: Deps, turn: Turn, action: AgentAction) {
  const { db } = deps
  const now = deps.now()
  switch (action.type) {
    case 'upsert_lead': {
      await ensureLead(db, {
        orgId: turn.orgId,
        contactId: turn.contactId,
        courseId: action.courseId,
        studentName: action.studentName,
        notes: action.notes,
        actor: 'bot',
      })
      deps.events.emit(turn.orgId, 'lead:updated', { contactId: turn.contactId })
      return
    }

    case 'book_demo': {
      const { booking, created } = await bookDemo(db, {
        orgId: turn.orgId,
        contactId: turn.contactId,
        courseId: action.courseId,
        batchId: action.batchId,
        startsAt: istInstant(action.date, action.startTime),
        studentName: action.studentName,
        actor: 'bot',
      })
      if (!created) return
      await scheduleDemoReminders(db, deps.queues.reminder, booking, now)
      deps.events.emit(turn.orgId, 'demo:updated', { demoId: booking.id })
      deps.events.emit(turn.orgId, 'lead:updated', { leadId: booking.leadId })
      if (deps.push) {
        const [course] = await db.select().from(courses).where(eq(courses.id, action.courseId))
        const today = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)
        await notifyOrg({ db, push: deps.push }, turn.orgId, 'newLead', {
          title: `Demo booked: ${action.studentName}`,
          body: `${course?.shortName ?? ''}, ${longDayLabel(action.date, today, 'hinglish')} ${formatTime(action.startTime)}`,
          url: `/chat/${turn.conversationId}`,
          tag: `demo-${booking.id}`,
        })
      }
      return
    }

    case 'send_brochure': {
      const [course] = await db
        .select()
        .from(courses)
        .where(and(eq(courses.id, action.courseId), eq(courses.orgId, turn.orgId)))
      if (!course?.brochureKey) return
      await send(deps, turn, {
        kind: 'document',
        storageKey: course.brochureKey,
        mimeType: 'application/pdf',
        filename: `${course.shortName.replace(/[^\w+-]+/g, '-')}.pdf`,
        caption: course.name,
      })
      return
    }

    case 'send_location': {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, turn.orgId))
      if (org?.latitude == null || org.longitude == null) return
      await send(deps, turn, {
        kind: 'location',
        latitude: org.latitude,
        longitude: org.longitude,
        name: org.name,
        address: org.address ?? undefined,
      })
      return
    }

    case 'send_payment_link': {
      const link = await ensurePaymentLink(db, {
        orgId: turn.orgId,
        installmentId: action.installmentId,
        encryptionKey: deps.encryptionKey,
        razorpay: deps.razorpay,
      })
      if (!link.ok) {
        deps.log.info(
          { installmentId: action.installmentId, reason: link.reason },
          'no payment link',
        )
        return
      }
      const [row] = await db
        .select({ inst: feeInstallments, student: students, contact: contacts, org: organizations })
        .from(feeInstallments)
        .innerJoin(students, eq(students.id, feeInstallments.studentId))
        .innerJoin(contacts, eq(contacts.id, students.contactId))
        .innerJoin(organizations, eq(organizations.id, feeInstallments.orgId))
        .where(eq(feeInstallments.id, action.installmentId))
      if (!row) return
      const lang = copyLanguage(row.contact.language, row.org.defaultLanguage)
      await send(deps, turn, {
        kind: 'text',
        previewUrl: true,
        body: fillCopy(FLOW.paymentLink[lang], {
          student: row.student.name,
          label: row.inst.label,
          amount: formatPaise(row.inst.amountPaise),
          url: link.url,
        }),
      })
      return
    }

    case 'demo_answer': {
      const [booking] = await db
        .select()
        .from(demoBookings)
        .where(and(eq(demoBookings.id, action.bookingId), eq(demoBookings.orgId, turn.orgId)))
      if (!booking) return
      if (action.answer === 'reschedule') {
        // The old slot is freed; the bot has already started booking a new one.
        await db
          .update(demoBookings)
          .set({ status: 'cancelled' })
          .where(eq(demoBookings.id, booking.id))
      }
      await db.insert(leadEvents).values({
        orgId: turn.orgId,
        leadId: booking.leadId,
        type: 'note',
        actor: 'bot',
        note: action.answer === 'coming' ? 'Demo ke liye aa rahe hain' : 'Demo ka time badalna hai',
      })
      deps.events.emit(turn.orgId, 'demo:updated', { demoId: booking.id })
      return
    }
  }
}

/** A follow-up message after the reply (brochure, pin, link), through the same gate as everything. */
async function send(deps: Deps, turn: Turn, content: OutboundContent) {
  try {
    const message = await queueOutbound(
      { db: deps.db, outboundQueue: deps.queues.outbound },
      {
        orgId: turn.orgId,
        conversationId: turn.conversationId,
        content,
        sentBy: 'bot',
        now: deps.now(),
      },
    )
    await announceMessage(deps.db, deps.events, turn.orgId, message.id, 'message:new')
  } catch (err) {
    if (err instanceof AppError && (err.code === 'OPTED_OUT' || err.code === 'WINDOW_CLOSED'))
      return
    throw err
  }
}
