import { Router } from 'express'
import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { z } from 'zod'
import { formatTime, longDayLabel } from '@haazir/ai-core'
import { bookDemo, istInstant, markDemo, scheduleDemoReminders } from '@haazir/coaching'
import {
  batches,
  contacts,
  conversations,
  courses,
  demoBookings,
  leads,
  organizations,
} from '@haazir/db'
import { announceMessage, sendAutomation } from '@haazir/messaging'
import { AppError } from '@haazir/shared'
import type { AppDeps } from '../deps'
import { audit, orgOf, userOf, uuidParam } from '../lib/http'
import { istDate, istRange } from '../lib/time'

const demoView = {
  id: demoBookings.id,
  startsAt: demoBookings.startsAt,
  status: demoBookings.status,
  studentName: demoBookings.studentName,
  bookedBy: demoBookings.bookedBy,
  leadId: demoBookings.leadId,
  courseId: demoBookings.courseId,
  courseName: courses.shortName,
  batchId: demoBookings.batchId,
  batchName: batches.name,
  contact: {
    id: contacts.id,
    name: contacts.name,
    profileName: contacts.profileName,
    waId: contacts.waId,
  },
  conversationId: conversations.id,
}

/** Demo classes (spec §9 /demos, §16.3 "Aaj ki demo classes"). */
export function demosRouter(deps: Pick<AppDeps, 'db' | 'queues' | 'events' | 'now'>) {
  const { db } = deps
  const router = Router()

  const query = () =>
    db
      .select(demoView)
      .from(demoBookings)
      .innerJoin(contacts, eq(contacts.id, demoBookings.contactId))
      .leftJoin(courses, eq(courses.id, demoBookings.courseId))
      .leftJoin(batches, eq(batches.id, demoBookings.batchId))
      .leftJoin(
        conversations,
        and(
          eq(conversations.contactId, demoBookings.contactId),
          eq(conversations.orgId, demoBookings.orgId),
        ),
      )

  router.get('/demos', async (req, res) => {
    const org = orgOf(req)
    const { date, days } = z
      .object({
        date: z.iso.date().optional(),
        days: z.coerce.number().int().min(1).max(31).default(1),
      })
      .parse(req.query)
    const range = istRange(date ?? istDate(deps.now()), days)
    const rows = await query()
      .where(
        and(
          eq(demoBookings.orgId, org.id),
          gte(demoBookings.startsAt, range.from),
          lt(demoBookings.startsAt, range.to),
        ),
      )
      .orderBy(asc(demoBookings.startsAt))
    res.json({ demos: rows })
  })

  /** Staff book a demo for a lead (from the chat or the lead card). */
  router.post('/demos', async (req, res) => {
    const org = orgOf(req)
    const user = userOf(req)
    const body = z
      .object({
        leadId: z.uuid(),
        batchId: z.uuid(),
        date: z.iso.date(),
        studentName: z.string().trim().min(1).max(80),
        notify: z.boolean().default(true),
      })
      .parse(req.body)
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, body.leadId), eq(leads.orgId, org.id)))
    const [batch] = await db
      .select()
      .from(batches)
      .where(and(eq(batches.id, body.batchId), eq(batches.orgId, org.id)))
    if (!lead || !batch) throw new AppError('NOT_FOUND', 'Lead or batch not found')
    const startsAt = istInstant(body.date, batch.startTime)
    if (startsAt <= deps.now()) throw new AppError('VALIDATION', 'That class has already started')

    const { booking, created } = await bookDemo(db, {
      orgId: org.id,
      contactId: lead.contactId,
      courseId: batch.courseId,
      batchId: batch.id,
      startsAt,
      studentName: body.studentName,
      actor: 'user',
      actorUserId: user.id,
    })
    if (created) {
      await scheduleDemoReminders(db, deps.queues.reminder, booking, deps.now())
      if (body.notify) {
        const [row] = await db
          .select({
            course: courses.shortName,
            address: organizations.address,
            orgName: organizations.name,
          })
          .from(courses)
          .innerJoin(organizations, eq(organizations.id, courses.orgId))
          .where(eq(courses.id, batch.courseId))
        const sent = await sendAutomation(
          { db, outboundQueue: deps.queues.outbound },
          {
            orgId: org.id,
            contactId: lead.contactId,
            purpose: 'demo_confirm',
            values: [
              body.studentName,
              row?.course ?? '',
              longDayLabel(body.date, istDate(deps.now()), 'hinglish'),
              formatTime(batch.startTime),
              row?.address ?? row?.orgName ?? '',
            ],
            urgent: true,
            sentBy: 'system',
            now: deps.now(),
          },
        )
        if (sent.sent)
          await announceMessage(db, deps.events, org.id, sent.message.id, 'message:new')
      }
      await audit(db, req, { action: 'demo.booked', entity: 'demo_booking', entityId: booking.id })
      deps.events.emit(org.id, 'demo:updated', { demoId: booking.id })
      deps.events.emit(org.id, 'lead:updated', { leadId: lead.id })
    }
    const [view] = await query().where(eq(demoBookings.id, booking.id))
    res.status(created ? 201 : 200).json(view)
  })

  /** "Aaye / Nahi aaye", or cancelled. */
  router.patch('/demos/:id', async (req, res) => {
    const org = orgOf(req)
    const user = userOf(req)
    const { id } = uuidParam.parse(req.params)
    const { status } = z
      .object({ status: z.enum(['attended', 'no_show', 'cancelled', 'reminded']) })
      .parse(req.body)
    const demo = await markDemo(db, {
      orgId: org.id,
      demoId: id,
      status,
      actor: 'user',
      actorUserId: user.id,
    })
    if (!demo) throw new AppError('NOT_FOUND', 'Demo not found')
    deps.events.emit(org.id, 'demo:updated', { demoId: id })
    deps.events.emit(org.id, 'lead:updated', { leadId: demo.leadId })
    const [view] = await query().where(eq(demoBookings.id, id))
    res.json(view)
  })

  return router
}
