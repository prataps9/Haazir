import { Router } from 'express'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { admitStudent, moveLead } from '@haazir/coaching'
import {
  contacts,
  conversations,
  courses,
  demoBookings,
  leadEvents,
  leads,
  students,
  users,
} from '@haazir/db'
import { AppError, LEAD_SOURCES, LEAD_STAGES, LOST_REASONS } from '@haazir/shared'
import type { AppDeps } from '../deps'
import { audit, orgOf, userOf, uuidParam } from '../lib/http'
import { istDate } from '../lib/time'

const leadView = {
  id: leads.id,
  stage: leads.stage,
  source: leads.source,
  courseId: leads.courseId,
  courseName: courses.shortName,
  batchId: leads.batchId,
  studentName: leads.studentName,
  notes: leads.notes,
  nextFollowupAt: leads.nextFollowupAt,
  lostReason: leads.lostReason,
  valuePaise: leads.valuePaise,
  assignedUserId: leads.assignedUserId,
  stageChangedAt: leads.stageChangedAt,
  createdAt: leads.createdAt,
  contact: {
    id: contacts.id,
    name: contacts.name,
    profileName: contacts.profileName,
    waId: contacts.waId,
  },
  conversationId: conversations.id,
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v)
  // A leading = + - @ turns a cell into a formula in Excel: neutralise it.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Leads (spec §16.5): every enquiry, from the bot's first reply to admission. */
export function leadsRouter(deps: Pick<AppDeps, 'db' | 'events' | 'now'>) {
  const { db } = deps
  const router = Router()

  const filters = z.object({
    stage: z.enum(LEAD_STAGES).optional(),
    course: z.uuid().optional(),
    source: z.enum(LEAD_SOURCES).optional(),
    assigned: z.uuid().optional(),
    q: z.string().trim().max(60).optional(),
  })

  const list = async (orgId: string, f: z.infer<typeof filters>, limit: number) => {
    const q = f.q ? `%${f.q.replace(/[%_]/g, '')}%` : null
    return db
      .select(leadView)
      .from(leads)
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(courses, eq(courses.id, leads.courseId))
      .leftJoin(
        conversations,
        and(eq(conversations.contactId, leads.contactId), eq(conversations.orgId, leads.orgId)),
      )
      .where(
        and(
          eq(leads.orgId, orgId),
          f.stage ? eq(leads.stage, f.stage) : undefined,
          f.course ? eq(leads.courseId, f.course) : undefined,
          f.source ? eq(leads.source, f.source) : undefined,
          f.assigned ? eq(leads.assignedUserId, f.assigned) : undefined,
          q
            ? or(
                ilike(contacts.name, q),
                ilike(contacts.profileName, q),
                ilike(contacts.waId, q),
                ilike(leads.studentName, q),
              )
            : undefined,
        ),
      )
      .orderBy(desc(leads.stageChangedAt))
      .limit(limit)
  }

  router.get('/leads', async (req, res) => {
    const org = orgOf(req)
    const rows = await list(org.id, filters.parse(req.query), 1000)
    const counts = await db
      .select({ stage: leads.stage, count: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.orgId, org.id))
      .groupBy(leads.stage)
    res.json({
      leads: rows,
      counts: Object.fromEntries(
        LEAD_STAGES.map((s) => [s, counts.find((c) => c.stage === s)?.count ?? 0]),
      ),
    })
  })

  router.get('/leads/export', async (req, res) => {
    const org = orgOf(req)
    const rows = await list(org.id, filters.parse(req.query), 10_000)
    const header = [
      'Name',
      'WhatsApp',
      'Student',
      'Course',
      'Stage',
      'Source',
      'Lost reason',
      'Next follow-up',
      'Created',
    ]
    const lines = rows.map((r) =>
      [
        r.contact.name ?? r.contact.profileName,
        `+${r.contact.waId}`,
        r.studentName,
        r.courseName,
        r.stage,
        r.source,
        r.lostReason,
        r.nextFollowupAt,
        r.createdAt,
      ]
        .map(csvCell)
        .join(','),
    )
    await audit(db, req, { action: 'leads.exported', entity: 'lead', diff: { rows: rows.length } })
    res
      .type('text/csv')
      .attachment(`leads-${istDate(deps.now())}.csv`)
      // BOM so Excel reads Hindi names as UTF-8.
      .send(`\uFEFF${[header.join(','), ...lines].join('\n')}\n`)
  })

  const own = async (orgId: string, id: string) => {
    const [row] = await db
      .select(leadView)
      .from(leads)
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(courses, eq(courses.id, leads.courseId))
      .leftJoin(
        conversations,
        and(eq(conversations.contactId, leads.contactId), eq(conversations.orgId, leads.orgId)),
      )
      .where(and(eq(leads.id, id), eq(leads.orgId, orgId)))
    if (!row) throw new AppError('NOT_FOUND', 'Lead not found')
    return row
  }

  router.get('/leads/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const lead = await own(org.id, id)
    const [events, demos, student] = await Promise.all([
      db
        .select({
          id: leadEvents.id,
          type: leadEvents.type,
          fromStage: leadEvents.fromStage,
          toStage: leadEvents.toStage,
          actor: leadEvents.actor,
          actorName: users.name,
          note: leadEvents.note,
          createdAt: leadEvents.createdAt,
        })
        .from(leadEvents)
        .leftJoin(users, eq(users.id, leadEvents.actorUserId))
        .where(and(eq(leadEvents.leadId, id), eq(leadEvents.orgId, org.id)))
        .orderBy(asc(leadEvents.createdAt)),
      db
        .select()
        .from(demoBookings)
        .where(and(eq(demoBookings.leadId, id), eq(demoBookings.orgId, org.id)))
        .orderBy(desc(demoBookings.startsAt)),
      db
        .select({ id: students.id, name: students.name, status: students.status })
        .from(students)
        .where(and(eq(students.orgId, org.id), eq(students.contactId, lead.contact.id))),
    ])
    res.json({ ...lead, events, demos, students: student })
  })

  router.patch('/leads/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    await own(org.id, id)
    const body = z
      .object({
        courseId: z.uuid().nullable(),
        studentName: z.string().trim().max(80).nullable(),
        notes: z.string().trim().max(2000).nullable(),
        nextFollowupAt: z.iso.datetime().nullable(),
        assignedUserId: z.uuid().nullable(),
        source: z.enum(LEAD_SOURCES),
        valuePaise: z.number().int().min(0).nullable(),
      })
      .partial()
      .parse(req.body)
    if (body.courseId) {
      const [c] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.id, body.courseId), eq(courses.orgId, org.id)))
      if (!c) throw new AppError('VALIDATION', 'No such course')
    }
    await db
      .update(leads)
      .set({
        ...body,
        nextFollowupAt:
          body.nextFollowupAt === undefined
            ? undefined
            : body.nextFollowupAt === null
              ? null
              : new Date(body.nextFollowupAt),
      })
      .where(eq(leads.id, id))
    deps.events.emit(org.id, 'lead:updated', { leadId: id })
    res.json(await own(org.id, id))
  })

  /** Drag on the Kanban. Lost needs a reason (spec §16.5 chips). */
  router.post('/leads/:id/stage', async (req, res) => {
    const org = orgOf(req)
    const user = userOf(req)
    const { id } = uuidParam.parse(req.params)
    await own(org.id, id)
    const body = z
      .object({
        stage: z.enum(LEAD_STAGES),
        lostReason: z.enum(LOST_REASONS).optional(),
        note: z.string().trim().max(300).optional(),
      })
      .refine((b) => b.stage !== 'lost' || b.lostReason, 'Pick why the lead was lost')
      .parse(req.body)
    if (body.stage === 'admitted')
      throw new AppError(
        'VALIDATION',
        'Use "Admit" so the student and their installments are created',
      )
    await moveLead(db, {
      orgId: org.id,
      leadId: id,
      to: body.stage,
      lostReason: body.lostReason,
      note: body.note,
      actor: 'user',
      actorUserId: user.id,
      now: deps.now(),
    })
    deps.events.emit(org.id, 'lead:updated', { leadId: id })
    res.json(await own(org.id, id))
  })

  /** Admission: the student, their installments from the course plan, a seat filled. */
  router.post('/leads/:id/admit', async (req, res) => {
    const org = orgOf(req)
    const user = userOf(req)
    const { id } = uuidParam.parse(req.params)
    const lead = await own(org.id, id)
    const today = istDate(deps.now())
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        courseId: z.uuid(),
        batchId: z.uuid().nullable().optional(),
        admissionDate: z.iso.date().default(today),
        rollNo: z.string().trim().max(30).optional(),
      })
      .parse(req.body)
    const result = await admitStudent(db, {
      orgId: org.id,
      contactId: lead.contact.id,
      ...body,
      today,
      actor: 'user',
      actorUserId: user.id,
    })
    await audit(db, req, {
      action: 'student.admitted',
      entity: 'student',
      entityId: result.student.id,
    })
    deps.events.emit(org.id, 'lead:updated', { leadId: id })
    deps.events.emit(org.id, 'fee:updated', { studentId: result.student.id })
    res.status(201).json(result)
  })

  return router
}
